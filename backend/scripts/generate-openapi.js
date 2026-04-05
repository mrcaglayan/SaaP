import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CASH_TRANSIT_TRANSFER_STATUS_VALUES,
  INVENTORY_TRANSFER_STATUS_VALUES,
  STOCK_LANDED_COST_VOUCHER_STATUS_VALUES,
  STOCK_LANDED_COST_VOUCHER_UI_STATUS_VALUES,
} from "../src/constants/lifecycle.js";

const errorResponseRef = { $ref: "#/components/responses/ErrorResponse" };
const createdResponseRef = { $ref: "#/components/responses/CreatedResponse" };
const okResponseRef = { $ref: "#/components/responses/OkResponse" };

const intId = { type: "integer", minimum: 1 };
const nonNegativeInt = { type: "integer", minimum: 0 };
const shortText = { type: "string", minLength: 1 };
const currencyCode = { type: "string", minLength: 3, maxLength: 3 };

function positiveNumber(nullable = false) {
  return nullable
    ? { type: "number", minimum: 0, exclusiveMinimum: true, nullable: true }
    : { type: "number", minimum: 0, exclusiveMinimum: true };
}

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
  ["Approvals", "Unified approval policy and approval request engine endpoints (Bank + Payroll)."],
  ["GL", "General ledger setup and journal workflows."],
  ["FX", "Foreign exchange rate management."],
  ["Cari", "Cari (AR/AP) documents, settlements, bank links, and reporting endpoints."],
  ["Contracts", "Contract lifecycle, line management, and document-link workflows."],
  ["RevenueRecognition", "Revenue recognition schedule, run, accrual, and reporting endpoints."],
  ["Intercompany", "Intercompany relationship and reconciliation endpoints."],
  ["Consolidation", "Consolidation setup, runs, and report endpoints."],
  ["Onboarding", "Tenant/company bootstrap flow endpoints."],
  ["Cash", "Cash register, session, transaction, and exception workflows."],
  ["Inventory", "Warehouse, stock-link materialization, valuation, and inventory movement endpoints."],
  ["Items", "Item-card master data endpoints used by CARI and inventory flows."],
  ["Bank", "Bank account, statements, reconciliation, and payment-file workflows."],
  ["Payments", "Generic payment batch workflows (create, approve, export, post, cancel)."],
  ["Payroll", "Payroll import runs and payroll subledger workflow endpoints."],
  ["FixedAssets", "Fixed-assets register, depreciation, disposal, and subledger workflow endpoints."],
  ["Jobs", "Background jobs, retries, and operational queue management endpoints."],
  ["Ops", "Operational dashboards for KPI, SLA, and pipeline health summaries."],
  ["Exceptions", "Unified exception workbench endpoints across bank and payroll operations."],
  ["Auth", "Session and identity endpoints."],
  ["Provider", "Provider control-plane administration endpoints."],
  ["System", "System health and operational endpoints."],
]);

const CASH_REGISTER_OWNERSHIP_SCOPES = ["CENTRAL", "OPERATING_UNIT"];
const CASH_REGISTER_TYPES = ["VAULT", "DRAWER", "TILL"];
const CASH_SESSION_MODES = ["REQUIRED", "OPTIONAL", "NONE"];
const CASH_REGISTER_STATUSES = ["ACTIVE", "INACTIVE"];
const CASH_SESSION_STATUSES = ["OPEN", "CLOSED", "CANCELLED"];
const CASH_SESSION_CLOSE_REASONS = ["END_SHIFT", "FORCED_CLOSE", "COUNT_CORRECTION"];
const CASH_TRANSACTION_TYPES = [
  "RECEIPT",
  "PAYOUT",
  "DEPOSIT_TO_BANK",
  "WITHDRAWAL_FROM_BANK",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "VARIANCE",
  "OPENING_FLOAT",
  "CLOSING_ADJUSTMENT",
];
const CASH_TRANSACTION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "POSTED",
  "REVERSED",
  "CANCELLED",
];
const CASH_SOURCE_DOC_TYPES = [
  "AP_PAYMENT",
  "AR_RECEIPT",
  "EXPENSE_CLAIM",
  "PETTY_CASH_VOUCHER",
  "BANK_DEPOSIT_SLIP",
  "OTHER",
];
const CASH_COUNTERPARTY_TYPES = ["CUSTOMER", "VENDOR", "EMPLOYEE", "LEGAL_ENTITY", "OTHER"];
const CASH_SOURCE_MODULES = [
  "MANUAL",
  "CARI",
  "CONTRACTS",
  "REVREC",
  "CASH",
  "SYSTEM",
  "OTHER",
];
const CASH_INTEGRATION_LINK_STATUSES = [
  "UNLINKED",
  "PENDING",
  "LINKED",
  "PARTIALLY_LINKED",
  "FAILED",
];
const CASH_FX_FALLBACK_MODES = ["EXACT_ONLY", "PRIOR_DATE"];
const CASH_TRANSIT_STATUSES = [...CASH_TRANSIT_TRANSFER_STATUS_VALUES];

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

function compareStableStrings(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) {
    return 0;
  }

  // `localeCompare` can reorder punctuation differently across ICU/platform builds.
  // The release gate needs byte-stable OpenAPI output on every environment.
  return a < b ? -1 : 1;
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
  if (normalizedPath.startsWith("/api/v1/inventory")) {
    return "Inventory";
  }
  if (normalizedPath.startsWith("/api/v1/items")) {
    return "Items";
  }
  if (normalizedPath.startsWith("/api/v1/bank")) {
    return "Bank";
  }
  if (normalizedPath.startsWith("/api/v1/payments")) {
    return "Payments";
  }
  if (normalizedPath.startsWith("/api/v1/jobs")) {
    return "Jobs";
  }
  if (normalizedPath.startsWith("/api/v1/ops")) {
    return "Ops";
  }
  if (normalizedPath.startsWith("/api/v1/exceptions")) {
    return "Exceptions";
  }
  if (normalizedPath.startsWith("/api/v1/payroll")) {
    return "Payroll";
  }
  if (normalizedPath.startsWith("/api/v1/fixed-assets")) {
    return "FixedAssets";
  }
  if (normalizedPath.startsWith("/api/v1/org")) {
    return "Org";
  }
  if (normalizedPath.startsWith("/api/v1/security") || normalizedPath.startsWith("/api/v1/rbac")) {
    return "Security";
  }
  if (normalizedPath.startsWith("/api/v1/approvals")) {
    return "Approvals";
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
    const pathCompare = compareStableStrings(a.path, b.path);
    if (pathCompare !== 0) {
      return pathCompare;
    }
    return compareStableStrings(a.method, b.method);
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
  const schemas = specObject.components?.schemas || {};
  const cariRecommendedFlowDescription = [
    "Recommended path for new AP/AR documents: create them in CARI with explicit `subledgerType` values on each line so posting knows whether a line remains in GL, drives inventory, or capitalizes or disposes a fixed asset.",
    "Fallback flows remain available for backward compatibility: manual FA acquisition, capitalize-from-AP for legacy posted bills, FA sale staging, classic stock-impact documents without `subledgerType`, manual CARI cash settlement with `settlementMode = ACCRUAL`, and standalone cash transactions."
  ].join(" ");
  const cariImmediateSettlementDescription = [
    "Recommended cash purchase and sale flow: set `settlementMode` to `IMMEDIATE_CASH` and provide `settlementCashRegisterId` so posting creates the cash transaction and applies the settlement in the same transaction.",
    "`IMMEDIATE_BANK` is intentionally deferred until the repo exposes a bank-side immediate-posting primitive that can participate in that same posting transaction."
  ].join(" ");
  const cariWorkflowContractDescription = [
    cariRecommendedFlowDescription,
    cariImmediateSettlementDescription,
  ].join(" ");

  Object.assign(schemas, {
    CariDocumentDirection: {
      type: "string",
      enum: ["AR", "AP"],
    },
    CariDocumentType: {
      type: "string",
      enum: ["INVOICE", "DEBIT_NOTE", "CREDIT_NOTE", "PAYMENT", "ADJUSTMENT"],
    },
    CariDocumentStatus: {
      type: "string",
      enum: ["DRAFT", "POSTED", "REVERSED", "CANCELLED", "PARTIALLY_SETTLED", "SETTLED"],
    },
    CariDocumentLineKind: {
      type: "string",
      enum: ["STANDARD", "COMMENT", "ROUNDING", "ADJUSTMENT", "OTHER"],
    },
    CariDocumentLineStockImpactMode: {
      type: "string",
      enum: ["NONE", "RECEIPT_PENDING", "ISSUE_PENDING"],
    },
    CariDocumentSettlementMode: {
      type: "string",
      enum: ["ACCRUAL", "IMMEDIATE_CASH"],
      description: [
        "Persists to `settlement_mode`.",
        "Use `IMMEDIATE_CASH` for the recommended same-transaction cash settlement flow.",
        "Use `ACCRUAL` to keep the legacy manual settlement flow as a supported fallback.",
        "`IMMEDIATE_BANK` is not exposed here because it is deferred until a bank-side immediate-posting primitive exists."
      ].join(" "),
    },
    CariDocumentLineSubledgerType: {
      type: "string",
      enum: ["NONE", "STOCK", "FIXED_ASSET"],
      description: [
        "Persists to `subledger_type`.",
        "Recommended line-routing field for new CARI documents.",
        "Use `NONE` for plain GL lines, `STOCK` for inventory-linked lines, and `FIXED_ASSET` for capitalization or disposal lines.",
        "Legacy requests that omit this field remain supported as fallback and keep the existing stock/manual behavior."
      ].join(" "),
    },
    CariDocumentLineFixedAssetMode: {
      type: "string",
      enum: ["AUTO_CREATE", "LINK_EXISTING", "IMPROVE_EXISTING"],
      description: [
        "`AUTO_CREATE` is the recommended AP acquisition flow for new bills because posting creates draft assets directly from the CARI line.",
        "`LINK_EXISTING` remains available when one specific target asset must be referenced.",
        "`IMPROVE_EXISTING` capitalizes a post-activation improvement onto an existing ACTIVE or FULLY_DEPRECIATED asset.",
        "Legacy capitalize-from-AP and sale-staging flows remain supported fallback paths outside this document contract."
      ].join(" "),
    },
    CariDocumentLineChargeAllocationMethod: {
      type: "string",
      enum: ["NONE", "EQUAL", "BY_AMOUNT", "BY_QTY", "MANUAL"],
      description: [
        "Persists to `charge_allocation_method`.",
        "AP-only landed-cost flow for CARI line charges.",
        "When this is not `NONE`, the line stays `subledgerType = NONE`, its standalone debit is suppressed, and its net amount is absorbed into the selected target lines before posting."
      ].join(" "),
    },
    CariDocumentOpenItemStatus: {
      type: "string",
      enum: ["OPEN", "PARTIALLY_SETTLED", "SETTLED"],
    },
    CariDocumentLineTaxRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        documentId: { ...intId, nullable: true },
        documentLineId: { ...intId, nullable: true },
        componentNo: { type: "integer", nullable: true },
        taxCode: { type: "string", nullable: true },
        taxKind: { type: "string", nullable: true },
        ratePct: { type: "number", nullable: true },
        taxBaseAmountTxn: { type: "number", nullable: true },
        taxAmountTxn: { type: "number", nullable: true },
        taxBaseAmountBase: { type: "number", nullable: true },
        taxAmountBase: { type: "number", nullable: true },
        taxPurposeCode: { type: "string", nullable: true },
        accountId: { ...intId, nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: ["id", "tenantId", "legalEntityId", "documentId", "documentLineId", "componentNo"],
    },
    CariDocumentLineChargeTargetRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        chargeLineId: { ...intId, nullable: true },
        targetLineId: { ...intId, nullable: true },
        targetLineNo: { type: "integer", nullable: true },
        allocatedAmountTxn: { type: "number", nullable: true },
        allocatedAmountBase: { type: "number", nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "chargeLineId",
        "targetLineId",
      ],
    },
    CariDocumentLineChargeTargetInput: {
      type: "object",
      properties: {
        targetLineNo: {
          type: "integer",
          minimum: 1,
          description:
            "Required same-document line reference for charge allocation. Frontend state may keep row ids internally, but the API serializes charge targets by `targetLineNo`.",
        },
        allocatedAmountTxn: {
          type: "number",
          minimum: 0,
          nullable: true,
          description:
            "Required only when `chargeAllocationMethod = MANUAL`; ignored for computed allocation methods.",
        },
      },
      required: ["targetLineNo"],
    },
    CariDocumentLineStockLinkRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        documentId: { ...intId, nullable: true },
        documentLineId: { ...intId, nullable: true },
        documentLineNo: { type: "integer", nullable: true },
        documentLineDescription: { type: "string", nullable: true },
        itemCardId: { ...intId, nullable: true },
        itemCardCode: { type: "string", nullable: true },
        itemCardName: { type: "string", nullable: true },
        direction: { $ref: "#/components/schemas/CariDocumentDirection" },
        stockImpactMode: { $ref: "#/components/schemas/CariDocumentLineStockImpactMode" },
        linkStatus: { type: "string", nullable: true },
        requestedQuantity: { type: "number", nullable: true },
        postedNetAmountTxn: { type: "number", nullable: true },
        postedNetAmountBase: { type: "number", nullable: true },
        boundWarehouseId: { ...intId, nullable: true },
        boundWarehouseCode: { type: "string", nullable: true },
        boundWarehouseName: { type: "string", nullable: true },
        inventoryDocumentType: { type: "string", nullable: true },
        inventoryDocumentId: { ...intId, nullable: true },
        inventoryMovementId: { ...intId, nullable: true },
        reopenedFromStockLinkId: { ...intId, nullable: true },
        supersededByStockLinkId: { ...intId, nullable: true },
        queueState: { type: "string", nullable: true },
        repairReasonCode: { type: "string", nullable: true },
        successorInheritanceStatus: { type: "string", nullable: true },
        inventoryMovementType: { $ref: "#/components/schemas/InventoryMovementType" },
        inventoryValuationStatus: { $ref: "#/components/schemas/InventoryValuationStatus" },
        inventoryMovementDate: { type: "string", format: "date", nullable: true },
        inventoryMovementReversedAt: { type: "string", format: "date-time", nullable: true },
        inventoryMovementReversalJournalEntryId: { ...intId, nullable: true },
        inventoryWarehouseId: { ...intId, nullable: true },
        inventoryWarehouseCode: { type: "string", nullable: true },
        inventoryWarehouseName: { type: "string", nullable: true },
        resolvedAt: { type: "string", format: "date-time", nullable: true },
        resolutionNote: { type: "string", nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: ["id", "tenantId", "legalEntityId", "documentId", "documentLineId"],
    },
    CariDocumentLineRow: {
      type: "object",
      description:
        "Stored CARI document line, including subledger-aware routing fields for the recommended new flow while still returning legacy lines that were created without them.",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        documentId: { ...intId, nullable: true },
        lineNo: { type: "integer", nullable: true },
        lineKind: { $ref: "#/components/schemas/CariDocumentLineKind" },
        description: { type: "string", nullable: true },
        itemCardId: { ...intId, nullable: true },
        subledgerType: {
          allOf: [{ $ref: "#/components/schemas/CariDocumentLineSubledgerType" }],
          nullable: true,
        },
        chargeAllocationMethod: {
          allOf: [{ $ref: "#/components/schemas/CariDocumentLineChargeAllocationMethod" }],
          nullable: true,
        },
        quantity: { type: "number", nullable: true },
        unitPriceTxn: { type: "number", nullable: true },
        lineNetAmountTxn: { type: "number", nullable: true },
        lineTaxAmountTxn: { type: "number", nullable: true },
        lineGrossAmountTxn: { type: "number", nullable: true },
        lineNetAmountBase: { type: "number", nullable: true },
        lineTaxAmountBase: { type: "number", nullable: true },
        lineGrossAmountBase: { type: "number", nullable: true },
        postingAccountId: { ...intId, nullable: true },
        taxCategoryCode: { type: "string", nullable: true },
        stockImpactMode: { $ref: "#/components/schemas/CariDocumentLineStockImpactMode" },
        fixedAssetMode: {
          allOf: [{ $ref: "#/components/schemas/CariDocumentLineFixedAssetMode" }],
          nullable: true,
        },
        targetFixedAssetId: {
          ...intId,
          nullable: true,
          description:
            "Target asset for `LINK_EXISTING` and `IMPROVE_EXISTING` AP lines, and for AR fixed-asset disposal lines. Persists to `target_fixed_asset_id`.",
        },
        improvementEffectiveDate: {
          type: "string",
          format: "date",
          nullable: true,
          description:
            "Optional line-level effective date for `IMPROVE_EXISTING` AP lines. Defaults to the document date. If backdated into already-posted historical periods, the system may post a current-period catch-up depreciation delta instead of rewriting posted history.",
        },
        fixedAssetCategoryId: {
          ...intId,
          nullable: true,
          description:
            "Required category for `AUTO_CREATE` fixed-asset acquisition lines.",
        },
        fixedAssetOwnerOperatingUnitId: {
          ...intId,
          nullable: true,
          description:
            "Owner operating unit for `AUTO_CREATE` fixed-asset acquisition lines.",
        },
        fixedAssetLocationOperatingUnitId: {
          ...intId,
          nullable: true,
          description:
            "Location operating unit for `AUTO_CREATE` fixed-asset acquisition lines.",
        },
        revisedUsefulLifeMonths: {
          type: "integer",
          minimum: 1,
          nullable: true,
          description:
            "Optional absolute useful-life revision for `IMPROVE_EXISTING` AP lines. Mutually exclusive with `lifeExtensionMonths`.",
        },
        lifeExtensionMonths: {
          type: "integer",
          minimum: 1,
          nullable: true,
          description:
            "Optional remaining-life extension for `IMPROVE_EXISTING` AP lines. Mutually exclusive with `revisedUsefulLifeMonths`.",
        },
        fixedAssetNameOverride: {
          type: "string",
          nullable: true,
          description:
            "Optional per-line asset name override used by the recommended AUTO_CREATE flow.",
        },
        fixedAssetSerialNo: {
          type: "string",
          nullable: true,
          description:
            "Optional asset serial number captured on fixed-asset acquisition lines.",
        },
        fixedAssetTag: {
          type: "string",
          nullable: true,
          description: "Optional asset tag captured on fixed-asset acquisition lines.",
        },
        warehouseId: { ...intId, nullable: true },
        warehouseCode: { type: "string", nullable: true },
        warehouseName: { type: "string", nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
        taxes: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentLineTaxRow" },
        },
        chargeTargets: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentLineChargeTargetRow" },
        },
        stockLinks: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentLineStockLinkRow" },
        },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "documentId",
        "lineNo",
        "lineKind",
        "taxes",
        "stockLinks",
      ],
    },
    CariDocumentRow: {
      type: "object",
      description:
        "Stored CARI document, including immediate-settlement linkage for the recommended cash flow while preserving legacy accrual and manual-settlement documents as fallback records.",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        operatingUnitId: { ...intId, nullable: true },
        operatingUnitCode: { type: "string", nullable: true },
        operatingUnitName: { type: "string", nullable: true },
        counterpartyId: { ...intId, nullable: true },
        paymentTermId: { ...intId, nullable: true },
        settlementMode: {
          allOf: [{ $ref: "#/components/schemas/CariDocumentSettlementMode" }],
          nullable: true,
        },
        settlementCashRegisterId: {
          ...intId,
          nullable: true,
          description:
            "Cash register used when the recommended `IMMEDIATE_CASH` flow is selected. Persists to `settlement_cash_register_id`.",
        },
        autoSettlementBatchId: {
          ...intId,
          nullable: true,
          description:
            "Settlement batch created by `IMMEDIATE_CASH`; used for settlement drillbacks and reversal lookup.",
        },
        autoSettlementCashTransactionId: {
          ...intId,
          nullable: true,
          description:
            "Cash transaction created by `IMMEDIATE_CASH`; used for cash drillbacks and reversal lookup.",
        },
        paymentTermCode: { type: "string", nullable: true },
        paymentTermName: { type: "string", nullable: true },
        direction: { $ref: "#/components/schemas/CariDocumentDirection" },
        documentType: { $ref: "#/components/schemas/CariDocumentType" },
        sequenceNamespace: { type: "string", nullable: true },
        fiscalYear: { type: "integer", nullable: true },
        sequenceNo: { type: "integer", nullable: true },
        documentNo: { type: "string", nullable: true },
        status: { $ref: "#/components/schemas/CariDocumentStatus" },
        documentDate: { type: "string", format: "date", nullable: true },
        dueDate: { type: "string", format: "date", nullable: true },
        subtotalAmountTxn: { type: "number", nullable: true },
        subtotalAmountBase: { type: "number", nullable: true },
        taxAmountTxn: { type: "number", nullable: true },
        taxAmountBase: { type: "number", nullable: true },
        grossAmountTxn: { type: "number", nullable: true },
        grossAmountBase: { type: "number", nullable: true },
        amountTxn: { type: "number", nullable: true },
        amountBase: { type: "number", nullable: true },
        openAmountTxn: { type: "number", nullable: true },
        openAmountBase: { type: "number", nullable: true },
        currencyCode: { ...currencyCode, nullable: true },
        fxRate: { type: "number", nullable: true },
        counterpartyCodeSnapshot: { type: "string", nullable: true },
        counterpartyNameSnapshot: { type: "string", nullable: true },
        paymentTermSnapshot: { type: "string", nullable: true },
        dueDateSnapshot: { type: "string", format: "date", nullable: true },
        currencyCodeSnapshot: { ...currencyCode, nullable: true },
        fxRateSnapshot: { type: "number", nullable: true },
        postedJournalEntryId: { ...intId, nullable: true },
        reversalOfDocumentId: { ...intId, nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
        rowVersion: { type: "integer", minimum: 1, nullable: true },
        postedAt: { type: "string", format: "date-time", nullable: true },
        reversedAt: { type: "string", format: "date-time", nullable: true },
        draftSequenceAssigned: { type: "boolean", nullable: true },
        lineCount: { type: "integer", minimum: 0, nullable: true },
        lines: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentLineRow" },
        },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "counterpartyId",
        "direction",
        "documentType",
        "status",
        "rowVersion",
      ],
    },
    CariDocumentListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        total: nonNegativeInt,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentRow" },
        },
      },
      required: ["tenantId", "total", "rows"],
    },
    CariDocumentResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/CariDocumentRow" },
      },
      required: ["tenantId", "row"],
    },
    CariDocumentWarehouseLookupRow: {
      type: "object",
      properties: {
        id: intId,
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        legalEntityCode: { type: "string", nullable: true },
        ownershipScope: { type: "string", nullable: true },
        operatingUnitId: { ...intId, nullable: true },
        operatingUnitCode: { type: "string", nullable: true },
        operatingUnitName: { type: "string", nullable: true },
        code: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
      },
      required: ["id"],
    },
    CariDocumentWarehouseLookupResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentWarehouseLookupRow" },
        },
      },
      required: ["tenantId", "rows"],
    },
    CariDocumentOpenItemRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        counterpartyId: { ...intId, nullable: true },
        documentId: { ...intId, nullable: true },
        itemNo: { type: "integer", nullable: true },
        status: {
          allOf: [{ $ref: "#/components/schemas/CariDocumentOpenItemStatus" }],
          nullable: true,
        },
        documentDate: { type: "string", format: "date", nullable: true },
        dueDate: { type: "string", format: "date", nullable: true },
        originalAmountTxn: { type: "number", nullable: true },
        originalAmountBase: { type: "number", nullable: true },
        residualAmountTxn: { type: "number", nullable: true },
        residualAmountBase: { type: "number", nullable: true },
        settledAmountTxn: { type: "number", nullable: true },
        settledAmountBase: { type: "number", nullable: true },
        currencyCode: { ...currencyCode, nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: ["id", "tenantId", "legalEntityId", "counterpartyId", "documentId", "itemNo"],
    },
    CariDocumentOpenItemListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        documentId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentOpenItemRow" },
        },
      },
      required: ["tenantId", "documentId", "rows"],
    },
    CariPostingLineRequest: {
      type: "object",
      properties: {
        amountTxn: { type: "number", minimum: 0, exclusiveMinimum: true },
        amountBase: { type: "number", minimum: 0, exclusiveMinimum: true },
        offsetAccountId: { ...intId, nullable: true },
        offsetAccountCode: { type: "string", maxLength: 50, nullable: true },
        description: { type: "string", maxLength: 255, nullable: true },
      },
      required: ["amountTxn", "amountBase"],
    },
    CariDocumentCreateRequest: {
      type: "object",
      description: cariWorkflowContractDescription,
      properties: {
        legalEntityId: intId,
        operatingUnitId: { ...intId, nullable: true },
        counterpartyId: intId,
        paymentTermId: { ...intId, nullable: true },
        settlementMode: { $ref: "#/components/schemas/CariDocumentSettlementMode" },
        settlementCashRegisterId: {
          ...intId,
          nullable: true,
          description:
            "Required when `settlementMode = IMMEDIATE_CASH`; leave empty for the fallback `ACCRUAL` flow. Persists to `settlement_cash_register_id`.",
        },
        direction: { $ref: "#/components/schemas/CariDocumentDirection" },
        documentType: { $ref: "#/components/schemas/CariDocumentType" },
        documentDate: { type: "string", format: "date" },
        dueDate: { type: "string", format: "date", nullable: true },
        amountTxn: { type: "number", nullable: true },
        amountBase: { type: "number", nullable: true },
        currencyCode: currencyCode,
        fxRate: { type: "number", nullable: true },
        lines: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentLineInput" },
          nullable: true,
        },
      },
      required: [
        "legalEntityId",
        "counterpartyId",
        "direction",
        "documentType",
        "documentDate",
        "currencyCode",
      ],
    },
    CariDocumentUpdateRequest: {
      type: "object",
      description: cariWorkflowContractDescription,
      properties: {
        rowVersion: { type: "integer", minimum: 1 },
        legalEntityId: { ...intId, nullable: true },
        operatingUnitId: { ...intId, nullable: true },
        counterpartyId: { ...intId, nullable: true },
        paymentTermId: { ...intId, nullable: true },
        settlementMode: { $ref: "#/components/schemas/CariDocumentSettlementMode" },
        settlementCashRegisterId: {
          ...intId,
          nullable: true,
          description:
            "Required when `settlementMode = IMMEDIATE_CASH`; leave empty for the fallback `ACCRUAL` flow. Persists to `settlement_cash_register_id`.",
        },
        direction: { $ref: "#/components/schemas/CariDocumentDirection" },
        documentType: { $ref: "#/components/schemas/CariDocumentType" },
        documentDate: { type: "string", format: "date", nullable: true },
        dueDate: { type: "string", format: "date", nullable: true },
        amountTxn: { type: "number", nullable: true },
        amountBase: { type: "number", nullable: true },
        currencyCode: { ...currencyCode, nullable: true },
        fxRate: { type: "number", nullable: true },
        lines: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentLineInput" },
          nullable: true,
        },
      },
      required: ["rowVersion"],
    },
    CariDocumentLineInput: {
      type: "object",
      description:
        "Draft line input for the recommended subledger-aware document flow. Legacy requests that omit the new routing fields remain supported as fallback.",
      properties: {
        lineKind: { $ref: "#/components/schemas/CariDocumentLineKind" },
        description: { type: "string", maxLength: 500, nullable: true },
        itemCardId: { ...intId, nullable: true },
        subledgerType: { $ref: "#/components/schemas/CariDocumentLineSubledgerType" },
        chargeAllocationMethod: {
          $ref: "#/components/schemas/CariDocumentLineChargeAllocationMethod",
        },
        chargeTargets: {
          type: "array",
          nullable: true,
          items: { $ref: "#/components/schemas/CariDocumentLineChargeTargetInput" },
          description:
            "Required non-empty array when `chargeAllocationMethod != NONE`. Targets must reference other STANDARD lines on the same AP document.",
        },
        quantity: { type: "number", minimum: 0, nullable: true },
        unitPriceTxn: { type: "number", minimum: 0, nullable: true },
        lineNetAmountTxn: { type: "number", minimum: 0 },
        lineTaxAmountTxn: { type: "number", minimum: 0, nullable: true },
        lineGrossAmountTxn: { type: "number", minimum: 0, nullable: true },
        postingAccountId: { ...intId, nullable: true },
        taxCodeId: { ...intId, nullable: true },
        taxCode: { type: "string", maxLength: 40, nullable: true },
        taxCategoryCode: { type: "string", maxLength: 60, nullable: true },
        stockImpactMode: { $ref: "#/components/schemas/CariDocumentLineStockImpactMode" },
        fixedAssetMode: { $ref: "#/components/schemas/CariDocumentLineFixedAssetMode" },
        targetFixedAssetId: {
          ...intId,
          nullable: true,
          description:
            "Required for `LINK_EXISTING` and `IMPROVE_EXISTING` AP lines, and for AR fixed-asset disposal lines. Persists to `target_fixed_asset_id`.",
        },
        improvementEffectiveDate: {
          type: "string",
          format: "date",
          nullable: true,
          description:
            "Optional line-level effective date for `IMPROVE_EXISTING` AP lines. Defaults to the document date. Backdated improvements may create current-period catch-up depreciation when historical periods are already posted.",
        },
        fixedAssetCategoryId: {
          ...intId,
          nullable: true,
          description:
            "Required for the recommended `AUTO_CREATE` fixed-asset acquisition flow.",
        },
        fixedAssetOwnerOperatingUnitId: {
          ...intId,
          nullable: true,
          description:
            "Owner operating unit for the recommended `AUTO_CREATE` fixed-asset acquisition flow.",
        },
        fixedAssetLocationOperatingUnitId: {
          ...intId,
          nullable: true,
          description:
            "Location operating unit for the recommended `AUTO_CREATE` fixed-asset acquisition flow.",
        },
        revisedUsefulLifeMonths: {
          type: "integer",
          minimum: 1,
          nullable: true,
          description:
            "Optional absolute useful-life revision for `IMPROVE_EXISTING` AP lines. Mutually exclusive with `lifeExtensionMonths`.",
        },
        lifeExtensionMonths: {
          type: "integer",
          minimum: 1,
          nullable: true,
          description:
            "Optional remaining-life extension for `IMPROVE_EXISTING` AP lines. Mutually exclusive with `revisedUsefulLifeMonths`.",
        },
        fixedAssetNameOverride: {
          type: "string",
          maxLength: 255,
          nullable: true,
        },
        fixedAssetSerialNo: {
          type: "string",
          maxLength: 100,
          nullable: true,
        },
        fixedAssetTag: {
          type: "string",
          maxLength: 100,
          nullable: true,
        },
        warehouseId: { ...intId, nullable: true },
      },
      required: ["lineNetAmountTxn"],
    },
    CariDocumentPostRequest: {
      type: "object",
      properties: {
        offsetAccountId: { ...intId, nullable: true },
        offsetAccountCode: { type: "string", maxLength: 50, nullable: true },
        useFxOverride: { type: "boolean", nullable: true },
        fxOverrideReason: { type: "string", maxLength: 500, nullable: true },
        postingLines: {
          type: "array",
          items: { $ref: "#/components/schemas/CariPostingLineRequest" },
          nullable: true,
        },
      },
    },
    CariDocumentPostJournalSummary: {
      type: "object",
      properties: {
        journalEntryId: { ...intId, nullable: true },
        bookId: { ...intId, nullable: true },
        fiscalPeriodId: { ...intId, nullable: true },
        lineCount: { type: "integer", minimum: 0, nullable: true },
        totalDebit: { type: "number", nullable: true },
        totalCredit: { type: "number", nullable: true },
        subledgerReferenceNo: { type: "string", nullable: true },
        tax: { type: "object", additionalProperties: true, nullable: true },
      },
      required: ["journalEntryId"],
    },
    CariDocumentPostResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/CariDocumentRow" },
        journal: { $ref: "#/components/schemas/CariDocumentPostJournalSummary" },
      },
      required: ["tenantId", "row", "journal"],
    },
    CariDocumentReverseRequest: {
      type: "object",
      properties: {
        reason: { type: "string", maxLength: 255, nullable: true },
        reversalDate: { type: "string", format: "date", nullable: true },
      },
    },
    CariDocumentReverseJournalSummary: {
      type: "object",
      properties: {
        originalJournalEntryId: { ...intId, nullable: true },
        reversalJournalEntryId: { ...intId, nullable: true },
        lineCount: { type: "integer", minimum: 0, nullable: true },
        totalDebit: { type: "number", nullable: true },
        totalCredit: { type: "number", nullable: true },
        subledgerReferenceNo: { type: "string", nullable: true },
      },
    },
    CariDocumentReverseResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/CariDocumentRow" },
        original: { $ref: "#/components/schemas/CariDocumentRow" },
        journal: { $ref: "#/components/schemas/CariDocumentReverseJournalSummary" },
      },
      required: ["tenantId", "row", "original", "journal"],
    },
    CariDocumentInternalCommentRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        sourceRefType: { type: "string", nullable: true },
        sourceRefId: { ...intId, nullable: true },
        body: { type: "string", nullable: true },
        status: { type: "string", nullable: true },
        createdByUserId: { ...intId, nullable: true },
        createdByUserName: { type: "string", nullable: true },
        createdByUserEmail: { type: "string", nullable: true },
        updatedByUserId: { ...intId, nullable: true },
        deletedByUserId: { ...intId, nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
        deletedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: ["id", "tenantId", "legalEntityId", "sourceRefType", "sourceRefId", "body", "status"],
    },
    CariDocumentInternalCommentListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        documentId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentInternalCommentRow" },
        },
      },
      required: ["tenantId", "documentId", "rows"],
    },
    CariDocumentInternalCommentResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        documentId: intId,
        row: { $ref: "#/components/schemas/CariDocumentInternalCommentRow" },
      },
      required: ["tenantId", "documentId", "row"],
    },
    CariDocumentInternalCommentCreateRequest: {
      type: "object",
      properties: {
        body: { type: "string", minLength: 1, maxLength: 2000 },
      },
      required: ["body"],
    },
    CariDocumentMentionCandidateRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        email: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
      },
      required: ["id", "email"],
    },
    CariDocumentMentionCandidateListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        documentId: intId,
        q: { type: "string", nullable: true },
        limit: { type: "integer", minimum: 1, nullable: true },
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/CariDocumentMentionCandidateRow" },
        },
      },
      required: ["tenantId", "documentId", "q", "limit", "rows"],
    },
    CariDocumentOpsStatusRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        sourceRefType: { type: "string", nullable: true },
        sourceRefId: { ...intId, nullable: true },
        opsStatus: { type: "string", enum: ["OK", "AT_RISK", "BLOCKED"], nullable: true },
        blockedReason: { type: "string", nullable: true },
        note: { type: "string", nullable: true },
        updatedByUserId: { ...intId, nullable: true },
        updatedByUserName: { type: "string", nullable: true },
        updatedByUserEmail: { type: "string", nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
        isDefault: { type: "boolean", nullable: true },
      },
      required: ["tenantId", "legalEntityId", "sourceRefType", "sourceRefId", "opsStatus"],
    },
    CariDocumentOpsStatusResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        documentId: intId,
        row: { $ref: "#/components/schemas/CariDocumentOpsStatusRow" },
      },
      required: ["tenantId", "documentId", "row"],
    },
    CariDocumentOpsStatusUpsertRequest: {
      type: "object",
      properties: {
        opsStatus: { type: "string", enum: ["OK", "AT_RISK", "BLOCKED"] },
        blockedReason: { type: "string", maxLength: 500, nullable: true },
        note: { type: "string", maxLength: 1000, nullable: true },
      },
      required: ["opsStatus"],
    },
  });

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
    queryParamInt("operatingUnitId", false, "Operating unit filter"),
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

  const openItemsReportOperation = paths["/api/v1/cari/reports/open-items"]?.get;
  if (openItemsReportOperation) {
    openItemsReportOperation.responses = withStandardResponses(
      "200",
      "Cari open-items report",
      "#/components/schemas/CariOpenItemsReportResponse"
    );
  }

  const statementReportOperation = paths["/api/v1/cari/reports/statement"]?.get;
  if (statementReportOperation) {
    statementReportOperation.responses = withStandardResponses(
      "200",
      "Cari counterparty statement report",
      "#/components/schemas/CariCounterpartyStatementReportResponse"
    );
  }

  const realizedFxReportOperation = paths["/api/v1/cari/reports/settlement-realized-fx"]?.get;
  if (realizedFxReportOperation) {
    realizedFxReportOperation.summary = "Cari settlement realized-FX report";
    mergeOperationParameters(realizedFxReportOperation, [
      queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
      queryParamInt("legalEntityId", false, "Legal entity filter"),
      queryParamInt("counterpartyId", false, "Counterparty filter"),
      queryParam(
        "role",
        { type: "string", enum: ["CUSTOMER", "VENDOR", "BOTH"] },
        false,
        "Counterparty role filter"
      ),
      queryParam(
        "currencyCode",
        { type: "string", minLength: 3, maxLength: 3 },
        false,
        "Settlement currency filter"
      ),
      queryParam(
        "periodFrom",
        { type: "string", format: "date" },
        false,
        "Settlement-date lower bound"
      ),
      queryParam(
        "periodTo",
        { type: "string", format: "date" },
        false,
        "Settlement-date upper bound"
      ),
      queryParam("includeDetails", { type: "boolean" }, false, "Include grouped detail rows"),
      queryParam("limit", { type: "integer", minimum: 1, maximum: 1000 }, false, "Page size"),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ]);
    realizedFxReportOperation.responses = withStandardResponses(
      "200",
      "Cari settlement realized-FX report",
      "#/components/schemas/CariSettlementRealizedFxReportResponse"
    );
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
    documentsListOperation.responses = withStandardResponses(
      "200",
      "Cari document list",
      "#/components/schemas/CariDocumentListResponse"
    );
  }

  const documentWarehouseLookupOperation =
    paths["/api/v1/cari/documents/warehouse-options"]?.get;
  if (documentWarehouseLookupOperation) {
    documentWarehouseLookupOperation.summary =
      "List active warehouses for the selected cari ownership context";
    mergeOperationParameters(documentWarehouseLookupOperation, [
      queryParamInt(
        "legalEntityId",
        true,
        "Legal entity identifier for the document context"
      ),
      queryParamInt(
        "operatingUnitId",
        false,
        "Operating unit identifier; omit for CENTRAL ownership context"
      ),
      queryParam("q", { type: "string", maxLength: 120 }, false, "Warehouse code/name search"),
      queryParam("limit", { type: "integer", minimum: 1, maximum: 300 }, false, "Page size"),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ]);
    documentWarehouseLookupOperation.responses = withStandardResponses(
      "200",
      "Cari warehouse lookup options",
      "#/components/schemas/CariDocumentWarehouseLookupResponse"
    );
  }

  const documentsCreateOperation = paths["/api/v1/cari/documents"]?.post;
  if (documentsCreateOperation) {
    documentsCreateOperation.summary = "Create draft cari document";
    documentsCreateOperation.description = cariRecommendedFlowDescription;
    documentsCreateOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariDocumentCreateRequest"
    );
    documentsCreateOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/CariDocumentResponse",
        "Draft cari document created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const documentDetailOperation = paths["/api/v1/cari/documents/{documentId}"]?.get;
  if (documentDetailOperation) {
    documentDetailOperation.summary = "Get cari document detail";
    documentDetailOperation.description = [
      "Detail responses include subledger-aware line fields and immediate-settlement linkage fields when those recommended flows were used.",
      "Legacy documents that were created without the new fields remain valid fallback records."
    ].join(" ");
    documentDetailOperation.responses = withStandardResponses(
      "200",
      "Cari document detail",
      "#/components/schemas/CariDocumentResponse"
    );
  }

  const documentUpdateOperation = paths["/api/v1/cari/documents/{documentId}"]?.put;
  if (documentUpdateOperation) {
    documentUpdateOperation.summary = "Update draft cari document";
    documentUpdateOperation.description = cariRecommendedFlowDescription;
    documentUpdateOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariDocumentUpdateRequest"
    );
    documentUpdateOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/CariDocumentResponse",
        "Draft cari document updated"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
      "409": errorResponseRef,
    };
  }

  const documentCancelOperation = paths["/api/v1/cari/documents/{documentId}/cancel"]?.post;
  if (documentCancelOperation) {
    documentCancelOperation.summary = "Cancel draft cari document";
    delete documentCancelOperation.requestBody;
    documentCancelOperation.responses = withStandardResponses(
      "200",
      "Draft cari document cancelled",
      "#/components/schemas/CariDocumentResponse"
    );
  }

  const documentOpenItemsOperation =
    paths["/api/v1/cari/documents/{documentId}/open-items"]?.get;
  if (documentOpenItemsOperation) {
    documentOpenItemsOperation.summary = "List open items for one cari document";
    documentOpenItemsOperation.responses = withStandardResponses(
      "200",
      "Cari document open items",
      "#/components/schemas/CariDocumentOpenItemListResponse"
    );
  }

  const documentCommentsListOperation =
    paths["/api/v1/cari/documents/{documentId}/comments"]?.get;
  if (documentCommentsListOperation) {
    documentCommentsListOperation.summary = "List internal comments for one cari document";
    documentCommentsListOperation.responses = withStandardResponses(
      "200",
      "Cari document internal comments",
      "#/components/schemas/CariDocumentInternalCommentListResponse"
    );
  }

  const documentCommentsCreateOperation =
    paths["/api/v1/cari/documents/{documentId}/comments"]?.post;
  if (documentCommentsCreateOperation) {
    documentCommentsCreateOperation.summary = "Create internal comment for one cari document";
    documentCommentsCreateOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariDocumentInternalCommentCreateRequest"
    );
    documentCommentsCreateOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/CariDocumentInternalCommentResponse",
        "Cari document internal comment created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const documentMentionCandidatesOperation =
    paths["/api/v1/cari/documents/{documentId}/comments/mention-candidates"]?.get;
  if (documentMentionCandidatesOperation) {
    documentMentionCandidatesOperation.summary =
      "List internal-comment mention candidates for one cari document";
    mergeOperationParameters(documentMentionCandidatesOperation, [
      queryParam("q", { type: "string" }, false, "Email/name search"),
      queryParam("limit", { type: "integer", minimum: 1, maximum: 20 }, false, "Candidate limit"),
    ]);
    documentMentionCandidatesOperation.responses = withStandardResponses(
      "200",
      "Cari document mention candidates",
      "#/components/schemas/CariDocumentMentionCandidateListResponse"
    );
  }

  const documentOpsStatusGetOperation =
    paths["/api/v1/cari/documents/{documentId}/ops-status"]?.get;
  if (documentOpsStatusGetOperation) {
    documentOpsStatusGetOperation.summary = "Get ops status note for one cari document";
    documentOpsStatusGetOperation.responses = withStandardResponses(
      "200",
      "Cari document ops status",
      "#/components/schemas/CariDocumentOpsStatusResponse"
    );
  }

  const documentOpsStatusPutOperation =
    paths["/api/v1/cari/documents/{documentId}/ops-status"]?.put;
  if (documentOpsStatusPutOperation) {
    documentOpsStatusPutOperation.summary = "Create or update ops status note for one cari document";
    documentOpsStatusPutOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariDocumentOpsStatusUpsertRequest"
    );
    documentOpsStatusPutOperation.responses = withStandardResponses(
      "200",
      "Cari document ops status updated",
      "#/components/schemas/CariDocumentOpsStatusResponse"
    );
  }

  const documentPostOperation = paths["/api/v1/cari/documents/{documentId}/post"]?.post;
  if (documentPostOperation) {
    documentPostOperation.summary = "Post draft cari document";
    documentPostOperation.description = [
      cariImmediateSettlementDescription,
      "Use `settlementMode = ACCRUAL` to preserve the legacy manual CARI-to-cash settlement flow.",
      "Subledger-aware lines are the recommended posting path for new inventory and fixed-asset documents; legacy capitalize-from-AP and sale-staging flows remain available as fallback."
    ].join(" ");
    documentPostOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariDocumentPostRequest",
      false
    );
    documentPostOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/CariDocumentPostResponse",
        "Draft cari document posted"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
      "409": errorResponseRef,
    };
  }

  const documentReverseOperation = paths["/api/v1/cari/documents/{documentId}/reverse"]?.post;
  if (documentReverseOperation) {
    documentReverseOperation.summary = "Reverse posted cari document";
    documentReverseOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariDocumentReverseRequest",
      false
    );
    documentReverseOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/CariDocumentReverseResponse",
        "Posted cari document reversed"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
      "409": errorResponseRef,
    };
  }

  const counterpartyListQueryParams = [
    queryParamInt("legalEntityId", false, "Legal entity filter"),
    queryParam("q", { type: "string" }, false, "Code/name/AR/AP enrichment search"),
    queryParam("role", { type: "string", enum: ["CUSTOMER", "VENDOR", "BOTH"] }, false, "Role filter"),
    queryParam("status", { type: "string", enum: ["ACTIVE", "INACTIVE"] }, false, "Status filter"),
    queryParam("arAccountCode", { type: "string" }, false, "AR account code contains filter"),
    queryParam("arAccountName", { type: "string" }, false, "AR account name contains filter"),
    queryParam("apAccountCode", { type: "string" }, false, "AP account code contains filter"),
    queryParam("apAccountName", { type: "string" }, false, "AP account name contains filter"),
    queryParam(
      "sortBy",
      {
        type: "string",
        enum: [
          "id",
          "code",
          "name",
          "status",
          "arAccountCode",
          "arAccountName",
          "apAccountCode",
          "apAccountName",
        ],
      },
      false,
      "List sort field"
    ),
    queryParam("sortDir", { type: "string", enum: ["asc", "desc"] }, false, "List sort direction"),
    queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
    queryParam("offset", nonNegativeInt, false, "Page offset"),
  ];

  const counterpartiesListOperation = paths["/api/v1/cari/counterparties"]?.get;
  if (counterpartiesListOperation) {
    counterpartiesListOperation.summary = "List cari counterparties";
    mergeOperationParameters(counterpartiesListOperation, counterpartyListQueryParams);
    counterpartiesListOperation.responses = withStandardResponses(
      "200",
      "Counterparty list",
      "#/components/schemas/CounterpartyListResponse"
    );
  }

  const counterpartiesCreateOperation = paths["/api/v1/cari/counterparties"]?.post;
  if (counterpartiesCreateOperation) {
    counterpartiesCreateOperation.summary = "Create cari counterparty";
    counterpartiesCreateOperation.requestBody = bodyFromRef(
      "#/components/schemas/CounterpartyUpsertInput"
    );
    counterpartiesCreateOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/CounterpartyMutationResponse",
        "Counterparty created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const counterpartiesDetailOperation = paths["/api/v1/cari/counterparties/{id}"]?.get;
  if (counterpartiesDetailOperation) {
    counterpartiesDetailOperation.summary = "Get cari counterparty detail";
    counterpartiesDetailOperation.responses = withStandardResponses(
      "200",
      "Counterparty detail",
      "#/components/schemas/CounterpartyDetailResponse"
    );
  }

  const counterpartiesUpdateOperation = paths["/api/v1/cari/counterparties/{id}"]?.put;
  if (counterpartiesUpdateOperation) {
    counterpartiesUpdateOperation.summary = "Update cari counterparty";
    counterpartiesUpdateOperation.requestBody = bodyFromRef(
      "#/components/schemas/CounterpartyUpsertInput"
    );
    counterpartiesUpdateOperation.responses = withStandardResponses(
      "200",
      "Counterparty updated",
      "#/components/schemas/CounterpartyMutationResponse"
    );
  }

  const settlementApplyOperation = paths["/api/v1/cari/settlements/apply"]?.post;
  if (settlementApplyOperation) {
    settlementApplyOperation.summary =
      "Apply cari settlement (manual or CASH-linked payment channel)";
    settlementApplyOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariSettlementApplyRequest"
    );
    settlementApplyOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/CariSettlementApplyResponse",
        "Idempotent replay response"
      ),
      "201": jsonResponse(
        "#/components/schemas/CariSettlementApplyResponse",
        "Cari settlement apply created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const bankApplyOperation = paths["/api/v1/cari/bank/apply"]?.post;
  if (bankApplyOperation) {
    bankApplyOperation.summary =
      "Apply cari settlement from bank reference (manual payment channel)";
    bankApplyOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariBankApplyRequest"
    );
    bankApplyOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/CariSettlementApplyResponse",
        "Idempotent replay response"
      ),
      "201": jsonResponse(
        "#/components/schemas/CariSettlementApplyResponse",
        "Cari bank-apply settlement created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const settlementReverseOperation = paths["/api/v1/cari/settlements/{settlementBatchId}/reverse"]?.post;
  if (settlementReverseOperation) {
    settlementReverseOperation.summary =
      "Reverse cari settlement batch with downstream cross-context guardrails";
    settlementReverseOperation.parameters = [
      pathParam("settlementBatchId", "Settlement batch identifier"),
    ];
    settlementReverseOperation.requestBody = bodyFromRef(
      "#/components/schemas/CariSettlementReverseRequest",
      false
    );
    settlementReverseOperation.responses = {
      "201": jsonResponse(
        "#/components/schemas/CariSettlementReverseResponse",
        "Cari settlement reversed"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }
}

function applyCashOperationOverrides(specObject) {
  ensureTagPresent(specObject, "Cash");
  const paths = specObject.paths || {};

  const registerListOperation = paths["/api/v1/cash/registers"]?.get;
  if (registerListOperation) {
    registerListOperation.summary =
      "List cash registers with Central vs Operating Unit ownership context";
    registerListOperation.description =
      "Central registers stay in a central/no-OU posting context; OPERATING_UNIT registers carry explicit operating-unit scope.";
    registerListOperation.tags = ["Cash"];
    registerListOperation.parameters = [
      queryParamInt(
        "tenantId",
        false,
        "Tenant identifier when not implied by authenticated session"
      ),
      queryParamInt("legalEntityId", false, "Legal entity filter"),
      queryParamInt("operatingUnitId", false, "Operating unit filter"),
      queryParam(
        "ownershipScope",
        { $ref: "#/components/schemas/CashRegisterOwnershipScope" },
        false,
        "Ownership scope filter"
      ),
      queryParam(
        "status",
        { $ref: "#/components/schemas/CashRegisterStatus" },
        false,
        "Register status filter"
      ),
      queryParam("q", { type: "string", maxLength: 120 }, false, "Code/name search"),
      queryParam(
        "limit",
        { type: "integer", minimum: 1, maximum: 200 },
        false,
        "Page size"
      ),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ];
    registerListOperation.responses = withStandardResponses(
      "200",
      "Cash register list",
      "#/components/schemas/CashRegisterListResponse"
    );
  }

  const registerUpsertOperation = paths["/api/v1/cash/registers"]?.post;
  if (registerUpsertOperation) {
    registerUpsertOperation.summary =
      "Create or update a cash register with explicit ownership context";
    registerUpsertOperation.tags = ["Cash"];
    registerUpsertOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashRegisterUpsertRequest"
    );
    registerUpsertOperation.responses = withStandardResponses(
      "200",
      "Cash register saved",
      "#/components/schemas/CashRegisterResponse"
    );
  }

  const registerDetailOperation = paths["/api/v1/cash/registers/{registerId}"]?.get;
  if (registerDetailOperation) {
    registerDetailOperation.summary = "Get one cash register with ownership-aware context";
    registerDetailOperation.tags = ["Cash"];
    registerDetailOperation.parameters = [
      pathParam("registerId", "Cash register identifier"),
      queryParamInt(
        "tenantId",
        false,
        "Tenant identifier when not implied by authenticated session"
      ),
    ];
    registerDetailOperation.responses = withStandardResponses(
      "200",
      "Cash register detail",
      "#/components/schemas/CashRegisterResponse"
    );
  }

  const registerStatusOperation = paths["/api/v1/cash/registers/{registerId}/status"]?.post;
  if (registerStatusOperation) {
    registerStatusOperation.summary = "Update cash register ACTIVE/INACTIVE status";
    registerStatusOperation.tags = ["Cash"];
    registerStatusOperation.parameters = [pathParam("registerId", "Cash register identifier")];
    registerStatusOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashRegisterStatusUpdateRequest"
    );
    registerStatusOperation.responses = withStandardResponses(
      "200",
      "Cash register status updated",
      "#/components/schemas/CashRegisterResponse"
    );
  }

  const sessionListOperation = paths["/api/v1/cash/sessions"]?.get;
  if (sessionListOperation) {
    sessionListOperation.summary = "List cash sessions with register ownership context";
    sessionListOperation.tags = ["Cash"];
    sessionListOperation.parameters = [
      queryParamInt(
        "tenantId",
        false,
        "Tenant identifier when not implied by authenticated session"
      ),
      queryParamInt("legalEntityId", false, "Legal entity filter"),
      queryParamInt("registerId", false, "Cash register filter"),
      queryParam(
        "status",
        { $ref: "#/components/schemas/CashSessionStatus" },
        false,
        "Session status filter"
      ),
      queryParam(
        "openedFrom",
        { type: "string", format: "date" },
        false,
        "Open-date lower bound"
      ),
      queryParam(
        "openedTo",
        { type: "string", format: "date" },
        false,
        "Open-date upper bound"
      ),
      queryParam(
        "limit",
        { type: "integer", minimum: 1, maximum: 200 },
        false,
        "Page size"
      ),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ];
    sessionListOperation.responses = withStandardResponses(
      "200",
      "Cash session list",
      "#/components/schemas/CashSessionListResponse"
    );
  }

  const sessionDetailOperation = paths["/api/v1/cash/sessions/{sessionId}"]?.get;
  if (sessionDetailOperation) {
    sessionDetailOperation.summary = "Get one cash session with ownership-aware context";
    sessionDetailOperation.tags = ["Cash"];
    sessionDetailOperation.parameters = [
      pathParam("sessionId", "Cash session identifier"),
      queryParamInt(
        "tenantId",
        false,
        "Tenant identifier when not implied by authenticated session"
      ),
    ];
    sessionDetailOperation.responses = withStandardResponses(
      "200",
      "Cash session detail",
      "#/components/schemas/CashSessionResponse"
    );
  }

  const sessionOpenOperation = paths["/api/v1/cash/sessions/open"]?.post;
  if (sessionOpenOperation) {
    sessionOpenOperation.summary = "Open a cash session for a register";
    sessionOpenOperation.tags = ["Cash"];
    sessionOpenOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashSessionOpenRequest"
    );
    sessionOpenOperation.responses = withStandardResponses(
      "200",
      "Cash session opened",
      "#/components/schemas/CashSessionResponse"
    );
  }

  const sessionCloseOperation = paths["/api/v1/cash/sessions/{sessionId}/close"]?.post;
  if (sessionCloseOperation) {
    sessionCloseOperation.summary =
      "Close an OPEN cash session and optionally approve variance";
    sessionCloseOperation.tags = ["Cash"];
    sessionCloseOperation.parameters = [pathParam("sessionId", "Cash session identifier")];
    sessionCloseOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashSessionCloseRequest"
    );
    sessionCloseOperation.responses = withStandardResponses(
      "200",
      "Cash session closed",
      "#/components/schemas/CashSessionResponse"
    );
  }

  const transactionListOperation = paths["/api/v1/cash/transactions"]?.get;
  if (transactionListOperation) {
    transactionListOperation.summary = "List cash transactions with ownership and transit context";
    transactionListOperation.tags = ["Cash"];
    transactionListOperation.parameters = [
      queryParamInt(
        "tenantId",
        false,
        "Tenant identifier when not implied by authenticated session"
      ),
      queryParamInt("legalEntityId", false, "Legal entity filter"),
      queryParamInt("registerId", false, "Cash register filter"),
      queryParamInt("sessionId", false, "Cash session filter"),
      queryParam(
        "txnType",
        { $ref: "#/components/schemas/CashTransactionType" },
        false,
        "Transaction type filter"
      ),
      queryParam(
        "status",
        { $ref: "#/components/schemas/CashTransactionStatus" },
        false,
        "Transaction status filter"
      ),
      queryParam(
        "bookDateFrom",
        { type: "string", format: "date" },
        false,
        "Book-date lower bound"
      ),
      queryParam(
        "bookDateTo",
        { type: "string", format: "date" },
        false,
        "Book-date upper bound"
      ),
      queryParam(
        "limit",
        { type: "integer", minimum: 1, maximum: 200 },
        false,
        "Page size"
      ),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ];
    transactionListOperation.responses = withStandardResponses(
      "200",
      "Cash transaction list",
      "#/components/schemas/CashTransactionListResponse"
    );
  }

  const transactionCreateOperation = paths["/api/v1/cash/transactions"]?.post;
  if (transactionCreateOperation) {
    transactionCreateOperation.summary = "Create a cash transaction";
    transactionCreateOperation.tags = ["Cash"];
    transactionCreateOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashTransactionCreateRequest"
    );
    transactionCreateOperation.responses = withStandardResponses(
      "200",
      "Cash transaction created or replayed",
      "#/components/schemas/CashTransactionMutationResponse"
    );
  }

  const transactionDetailOperation = paths["/api/v1/cash/transactions/{transactionId}"]?.get;
  if (transactionDetailOperation) {
    transactionDetailOperation.summary = "Get one cash transaction with ownership-aware context";
    transactionDetailOperation.tags = ["Cash"];
    transactionDetailOperation.parameters = [
      pathParam("transactionId", "Cash transaction identifier"),
      queryParamInt(
        "tenantId",
        false,
        "Tenant identifier when not implied by authenticated session"
      ),
    ];
    transactionDetailOperation.responses = withStandardResponses(
      "200",
      "Cash transaction detail",
      "#/components/schemas/CashTransactionResponse"
    );
  }

  const transactionCancelOperation =
    paths["/api/v1/cash/transactions/{transactionId}/cancel"]?.post;
  if (transactionCancelOperation) {
    transactionCancelOperation.summary = "Cancel a draft cash transaction";
    transactionCancelOperation.tags = ["Cash"];
    transactionCancelOperation.parameters = [
      pathParam("transactionId", "Cash transaction identifier"),
    ];
    transactionCancelOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashTransactionCancelRequest"
    );
    transactionCancelOperation.responses = withStandardResponses(
      "200",
      "Cash transaction cancelled",
      "#/components/schemas/CashTransactionResponse"
    );
  }

  const transactionPostOperation =
    paths["/api/v1/cash/transactions/{transactionId}/post"]?.post;
  if (transactionPostOperation) {
    transactionPostOperation.summary = "Post a cash transaction";
    transactionPostOperation.tags = ["Cash"];
    transactionPostOperation.parameters = [pathParam("transactionId", "Cash transaction identifier")];
    transactionPostOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashTransactionPostRequest",
      false
    );
    transactionPostOperation.responses = withStandardResponses(
      "200",
      "Cash transaction posted",
      "#/components/schemas/CashTransactionMutationResponse"
    );
  }

  const transactionReverseOperation =
    paths["/api/v1/cash/transactions/{transactionId}/reverse"]?.post;
  if (transactionReverseOperation) {
    transactionReverseOperation.summary = "Reverse a posted cash transaction";
    transactionReverseOperation.tags = ["Cash"];
    transactionReverseOperation.parameters = [
      pathParam("transactionId", "Cash transaction identifier"),
    ];
    transactionReverseOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashTransactionReverseRequest"
    );
    transactionReverseOperation.responses = withStandardResponses(
      "200",
      "Cash transaction reversed",
      "#/components/schemas/CashTransactionReverseResponse"
    );
  }

  const exchangeListOperation = paths["/api/v1/cash/exchanges"]?.get;
  if (exchangeListOperation) {
    exchangeListOperation.summary = "List cash exchange batches";
    exchangeListOperation.tags = ["Cash"];
    exchangeListOperation.parameters = [
      queryParamInt(
        "tenantId",
        false,
        "Tenant identifier when not implied by authenticated session"
      ),
      queryParamInt("legalEntityId", false, "Legal entity filter"),
      queryParamInt("sourceRegisterId", false, "Source cash register filter"),
      queryParamInt("targetRegisterId", false, "Target cash register filter"),
      queryParam(
        "status",
        { $ref: "#/components/schemas/CashExchangeStatus" },
        false,
        "Cash exchange status filter"
      ),
      queryParam(
        "createdDateFrom",
        { type: "string", format: "date" },
        false,
        "Created-date lower bound"
      ),
      queryParam(
        "createdDateTo",
        { type: "string", format: "date" },
        false,
        "Created-date upper bound"
      ),
      queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ];
    exchangeListOperation.responses = withStandardResponses(
      "200",
      "Cash exchange list",
      "#/components/schemas/CashExchangeListResponse"
    );
  }

  const exchangeCreateOperation = paths["/api/v1/cash/exchanges"]?.post;
  if (exchangeCreateOperation) {
    exchangeCreateOperation.summary = "Create and post a cash exchange batch";
    exchangeCreateOperation.tags = ["Cash"];
    exchangeCreateOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashExchangeCreateRequest"
    );
    exchangeCreateOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/CashExchangeEnvelope",
        "Existing cash exchange returned from idempotent replay"
      ),
      "201": jsonResponse(
        "#/components/schemas/CashExchangeEnvelope",
        "Cash exchange created and posted"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const exchangeDetailOperation = paths["/api/v1/cash/exchanges/{exchangeBatchId}"]?.get;
  if (exchangeDetailOperation) {
    exchangeDetailOperation.summary = "Get one cash exchange batch";
    exchangeDetailOperation.tags = ["Cash"];
    exchangeDetailOperation.parameters = [
      pathParam("exchangeBatchId", "Cash exchange batch identifier"),
      queryParamInt(
        "tenantId",
        false,
        "Tenant identifier when not implied by authenticated session"
      ),
    ];
    exchangeDetailOperation.responses = withStandardResponses(
      "200",
      "Cash exchange detail",
      "#/components/schemas/CashExchangeEnvelope"
    );
  }

  const exchangePostOperation = paths["/api/v1/cash/exchanges/{exchangeBatchId}/post"]?.post;
  if (exchangePostOperation) {
    exchangePostOperation.summary = "Post an existing draft cash exchange batch";
    exchangePostOperation.tags = ["Cash"];
    exchangePostOperation.parameters = [
      pathParam("exchangeBatchId", "Cash exchange batch identifier"),
    ];
    exchangePostOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashExchangePostRequest",
      false
    );
    exchangePostOperation.responses = withStandardResponses(
      "200",
      "Cash exchange posted",
      "#/components/schemas/CashExchangeEnvelope"
    );
  }

  const exchangeReverseOperation =
    paths["/api/v1/cash/exchanges/{exchangeBatchId}/reverse"]?.post;
  if (exchangeReverseOperation) {
    exchangeReverseOperation.summary = "Reverse a posted cash exchange batch";
    exchangeReverseOperation.tags = ["Cash"];
    exchangeReverseOperation.parameters = [
      pathParam("exchangeBatchId", "Cash exchange batch identifier"),
    ];
    exchangeReverseOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashExchangeReverseRequest"
    );
    exchangeReverseOperation.responses = withStandardResponses(
      "200",
      "Cash exchange reversed",
      "#/components/schemas/CashExchangeEnvelope"
    );
  }

  const applyCariOperation = paths["/api/v1/cash/transactions/{transactionId}/apply-cari"]?.post;
  if (applyCariOperation) {
    applyCariOperation.summary = "Apply Cari settlement from posted cash transaction";
    applyCariOperation.tags = ["Cash"];
    applyCariOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashTransactionApplyCariRequest"
    );
    applyCariOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/CashTransactionApplyCariResponse",
        "Idempotent replay response"
      ),
      "201": jsonResponse(
        "#/components/schemas/CashTransactionApplyCariResponse",
        "Settlement/unapplied apply created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const transitListOperation = paths["/api/v1/cash/transactions/transit"]?.get;
  if (transitListOperation) {
    transitListOperation.summary = "List cash transit transfers";
    transitListOperation.tags = ["Cash"];
    mergeOperationParameters(transitListOperation, [
      queryParamInt("legalEntityId", false, "Legal entity filter"),
      queryParamInt("sourceRegisterId", false, "Source cash register filter"),
      queryParamInt("targetRegisterId", false, "Target cash register filter"),
      queryParam(
        "status",
        {
          type: "string",
          enum: [...CASH_TRANSIT_TRANSFER_STATUS_VALUES],
        },
        false,
        "Transit status filter"
      ),
      queryParam(
        "initiatedDateFrom",
        { type: "string", format: "date" },
        false,
        "Initiated date lower bound"
      ),
      queryParam(
        "initiatedDateTo",
        { type: "string", format: "date" },
        false,
        "Initiated date upper bound"
      ),
      queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ]);
    transitListOperation.responses = withStandardResponses(
      "200",
      "Cash transit transfer list",
      "#/components/schemas/CashTransitTransferListResponse"
    );
  }

  const transitDetailOperation = paths["/api/v1/cash/transactions/transit/{transitTransferId}"]?.get;
  if (transitDetailOperation) {
    transitDetailOperation.summary = "Get cash transit transfer detail";
    transitDetailOperation.tags = ["Cash"];
    mergeOperationParameters(transitDetailOperation, [
      pathParam("transitTransferId", "Cash transit transfer identifier"),
    ]);
    transitDetailOperation.responses = withStandardResponses(
      "200",
      "Cash transit transfer detail",
      "#/components/schemas/CashTransitTransferResponse"
    );
  }

  const transitInitiateOperation = paths["/api/v1/cash/transactions/transit/initiate"]?.post;
  if (transitInitiateOperation) {
    transitInitiateOperation.summary =
      "Initiate cash transit transfer for different operating-unit contexts (creates transfer-out)";
    transitInitiateOperation.description =
      "Use this workflow when the source and target registers are in different operating-unit contexts, including Central to branch, branch to Central, or branch-to-branch moves between different operating units.";
    transitInitiateOperation.tags = ["Cash"];
    transitInitiateOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashTransitTransferInitiateRequest"
    );
    transitInitiateOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/CashTransitTransferResponse",
        "Idempotent replay response"
      ),
      "201": jsonResponse(
        "#/components/schemas/CashTransitTransferResponse",
        "Cash transit transfer initiated"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const transitReceiveOperation =
    paths["/api/v1/cash/transactions/transit/{transitTransferId}/receive"]?.post;
  if (transitReceiveOperation) {
    transitReceiveOperation.summary =
      "Receive cash transit transfer (creates and posts linked transfer-in)";
    transitReceiveOperation.tags = ["Cash"];
    mergeOperationParameters(transitReceiveOperation, [
      pathParam("transitTransferId", "Cash transit transfer identifier"),
    ]);
    transitReceiveOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashTransitTransferReceiveRequest"
    );
    transitReceiveOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/CashTransitTransferResponse",
        "Idempotent replay response"
      ),
      "201": jsonResponse(
        "#/components/schemas/CashTransitTransferResponse",
        "Cash transit transfer received"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const transitCancelOperation =
    paths["/api/v1/cash/transactions/transit/{transitTransferId}/cancel"]?.post;
  if (transitCancelOperation) {
    transitCancelOperation.summary = "Cancel initiated cash transit transfer";
    transitCancelOperation.tags = ["Cash"];
    mergeOperationParameters(transitCancelOperation, [
      pathParam("transitTransferId", "Cash transit transfer identifier"),
    ]);
    transitCancelOperation.requestBody = bodyFromRef(
      "#/components/schemas/CashTransitTransferCancelRequest"
    );
    transitCancelOperation.responses = withStandardResponses(
      "200",
      "Cash transit transfer cancelled",
      "#/components/schemas/CashTransitTransferResponse"
    );
  }
}

function applyInventoryOperationOverrides(specObject) {
  ensureTagPresent(specObject, "Inventory");
  ensureTagPresent(specObject, "Items");
  const paths = specObject.paths || {};
  const schemas = specObject.components?.schemas || {};

  Object.assign(schemas, {
    ItemCardItemType: {
      type: "string",
      enum: ["SERVICE", "NON_STOCK_GOOD", "STOCK_ITEM"],
    },
    ItemCardStatus: {
      type: "string",
      enum: ["ACTIVE", "INACTIVE"],
    },
    InventoryWarehouseStatus: {
      type: "string",
      enum: ["ACTIVE", "INACTIVE"],
    },
    InventoryWarehouseOwnershipScope: {
      type: "string",
      enum: ["CENTRAL", "OPERATING_UNIT"],
    },
    InventoryTransferStatus: {
      type: "string",
      enum: [...INVENTORY_TRANSFER_STATUS_VALUES],
    },
    InventoryTransferEvidenceStatus: {
      type: "string",
      enum: ["PENDING_UPLOAD", "ACTIVE", "DELETED"],
    },
    EvidenceCompressionCodec: {
      type: "string",
      enum: ["NONE", "GZIP"],
    },
    InventoryStockLinkStatus: {
      type: "string",
      enum: ["PENDING", "LINKED", "VOID"],
    },
    InventoryStockImpactMode: {
      type: "string",
      enum: ["RECEIPT_PENDING", "ISSUE_PENDING"],
    },
    InventoryStockLinkQueueState: {
      type: "string",
      enum: ["READY", "BLOCKED", "REPAIR_REQUIRED", "TRANSFER_REQUIRED", "COMPLETED", "VOID"],
    },
    InventoryStockLinkQueueScope: {
      type: "string",
      enum: ["ACTIONABLE", "COMPLETED", "VOID", "ALL"],
    },
    InventoryMovementType: {
      type: "string",
      enum: ["RECEIPT", "ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"],
    },
    InventoryValuationStatus: {
      type: "string",
      enum: ["NOT_REQUIRED", "PENDING", "VALUED"],
    },
    InventoryCostLayerStatus: {
      type: "string",
      enum: ["OPEN", "CLOSED"],
    },
    InventoryValuationMethod: {
      type: "string",
      enum: ["FIFO"],
    },
    ItemCardRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        code: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        itemType: { $ref: "#/components/schemas/ItemCardItemType" },
        defaultSalesAccountId: { ...intId, nullable: true },
        defaultPurchaseAccountId: { ...intId, nullable: true },
        inventoryAssetAccountId: { ...intId, nullable: true },
        inventoryTransitAccountId: { ...intId, nullable: true },
        defaultCogsAccountId: { ...intId, nullable: true },
        taxCategoryCode: { type: "string", nullable: true },
        status: { $ref: "#/components/schemas/ItemCardStatus" },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: ["id", "tenantId", "code", "name", "itemType", "status"],
    },
    ItemCardListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        total: nonNegativeInt,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/ItemCardRow" },
        },
      },
      required: ["tenantId", "total", "rows"],
    },
    ItemCardResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/ItemCardRow" },
      },
      required: ["tenantId", "row"],
    },
    ItemCardUpsertRequest: {
      type: "object",
      properties: {
        legalEntityId: { ...intId, nullable: true },
        code: { type: "string", minLength: 1, maxLength: 80 },
        name: { type: "string", minLength: 1, maxLength: 200 },
        itemType: { $ref: "#/components/schemas/ItemCardItemType" },
        defaultSalesAccountId: { ...intId, nullable: true },
        defaultPurchaseAccountId: { ...intId, nullable: true },
        inventoryAssetAccountId: { ...intId, nullable: true },
        inventoryTransitAccountId: { ...intId, nullable: true },
        defaultCogsAccountId: { ...intId, nullable: true },
        taxCategoryCode: { type: "string", maxLength: 60, nullable: true },
        status: {
          allOf: [{ $ref: "#/components/schemas/ItemCardStatus" }],
          nullable: true,
        },
      },
      required: ["code", "name", "itemType"],
    },
    InventoryWarehouseRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        legalEntityCode: { type: "string", nullable: true },
        ownershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        operatingUnitId: { ...intId, nullable: true },
        operatingUnitCode: { type: "string", nullable: true },
        operatingUnitName: { type: "string", nullable: true },
        code: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        status: { $ref: "#/components/schemas/InventoryWarehouseStatus" },
        notes: { type: "string", nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "ownershipScope",
        "code",
        "name",
        "status",
      ],
    },
    InventoryWarehouseListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryWarehouseRow" },
        },
      },
      required: ["tenantId", "rows"],
    },
    InventoryWarehouseResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/InventoryWarehouseRow" },
      },
      required: ["tenantId", "row"],
    },
    InventoryWarehouseCreateRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        ownershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        operatingUnitId: { ...intId, nullable: true },
        code: { type: "string", minLength: 1, maxLength: 80 },
        name: { type: "string", minLength: 1, maxLength: 200 },
        status: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseStatus" }],
          nullable: true,
        },
        notes: { type: "string", maxLength: 255, nullable: true },
      },
      required: ["legalEntityId", "ownershipScope", "code", "name"],
    },
    InventoryPendingStockLinkRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        legalEntityCode: { type: "string", nullable: true },
        documentId: { ...intId, nullable: true },
        documentLineId: { ...intId, nullable: true },
        documentNo: { type: "string", nullable: true },
        documentDate: { type: "string", format: "date", nullable: true },
        documentOperatingUnitId: { ...intId, nullable: true },
        documentOperatingUnitCode: { type: "string", nullable: true },
        documentOperatingUnitName: { type: "string", nullable: true },
        direction: { type: "string", nullable: true },
        stockImpactMode: { $ref: "#/components/schemas/InventoryStockImpactMode" },
        linkStatus: { $ref: "#/components/schemas/InventoryStockLinkStatus" },
        requestedQuantity: { type: "number", nullable: true },
        materializedQuantity: { type: "number", nullable: true },
        remainingQuantity: { type: "number", nullable: true },
        postedNetAmountTxn: { type: "number", nullable: true },
        postedNetAmountBase: { type: "number", nullable: true },
        currencyCode: { type: "string", maxLength: 3, nullable: true },
        boundWarehouseId: { ...intId, nullable: true },
        boundWarehouseCode: { type: "string", nullable: true },
        boundWarehouseName: { type: "string", nullable: true },
        itemCardId: { ...intId, nullable: true },
        itemCardCode: { type: "string", nullable: true },
        itemCardName: { type: "string", nullable: true },
        itemType: { $ref: "#/components/schemas/ItemCardItemType" },
        lineNo: { type: "integer", nullable: true },
        lineDescription: { type: "string", nullable: true },
        inventoryMovementId: { ...intId, nullable: true },
        inventoryDocumentId: { ...intId, nullable: true },
        reopenedFromStockLinkId: { ...intId, nullable: true },
        supersededByStockLinkId: { ...intId, nullable: true },
        boundAvailableQuantity: { type: "number", nullable: true },
        crossContextAvailableQuantity: { type: "number", nullable: true },
        transferSourceWarehouseId: { ...intId, nullable: true },
        transferSourceWarehouseCode: { type: "string", nullable: true },
        transferSourceWarehouseName: { type: "string", nullable: true },
        transferSourceOwnershipScope: { type: "string", nullable: true },
        transferSourceOperatingUnitId: { ...intId, nullable: true },
        transferSourceOperatingUnitCode: { type: "string", nullable: true },
        transferSourceOperatingUnitName: { type: "string", nullable: true },
        transferSourceAvailableQuantity: { type: "number", nullable: true },
        queueState: {
          allOf: [{ $ref: "#/components/schemas/InventoryStockLinkQueueState" }],
          nullable: true,
        },
        blockedReasonCode: { type: "string", nullable: true },
        repairReasonCode: { type: "string", nullable: true },
        successorInheritanceStatus: { type: "string", nullable: true },
        canMaterialize: { type: "boolean", nullable: true },
        isStrictMode: { type: "boolean", nullable: true },
        isRepairOnly: { type: "boolean", nullable: true },
        isLegacyRow: { type: "boolean", nullable: true },
        resolvedAt: { type: "string", format: "date-time", nullable: true },
        resolutionNote: { type: "string", nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "documentId",
        "documentLineId",
        "stockImpactMode",
        "linkStatus",
        "itemCardId",
      ],
    },
    InventoryPendingStockLinkListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryPendingStockLinkRow" },
        },
      },
      required: ["tenantId", "rows"],
    },
    InventoryWorkQueueSummaryResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        asOfDate: { type: "string", format: "date", nullable: true },
        filters: {
          type: "object",
          properties: {
            legalEntityId: { ...intId, nullable: true },
          },
        },
        stockLinks: {
          type: "object",
          properties: {
            total_pending: { type: "integer", nullable: true },
            actionable_total: { type: "integer", nullable: true },
            ready_total: { type: "integer", nullable: true },
            blocked_total: { type: "integer", nullable: true },
            repair_required_total: { type: "integer", nullable: true },
            transfer_required_total: { type: "integer", nullable: true },
            completed_total: { type: "integer", nullable: true },
            void_total: { type: "integer", nullable: true },
            ready_receipt_materialization: { type: "integer", nullable: true },
            ready_issue_materialization: { type: "integer", nullable: true },
            pending_receipt_materialization: { type: "integer", nullable: true },
            pending_issue_materialization: { type: "integer", nullable: true },
            reopened_pending: { type: "integer", nullable: true },
            stale_pending_gt_2d: { type: "integer", nullable: true },
            oldest_pending_days: { type: "integer", nullable: true },
            aging_pending: {
              type: "object",
              properties: {
                "0_1d": { type: "integer", nullable: true },
                "2_7d": { type: "integer", nullable: true },
                "8_plus_d": { type: "integer", nullable: true },
              },
            },
          },
        },
        transfers: {
          type: "object",
          properties: {
            total_open: { type: "integer", nullable: true },
            waiting_approval: { type: "integer", nullable: true },
            ready_to_ship: { type: "integer", nullable: true },
            in_transit_waiting_receipt: { type: "integer", nullable: true },
            cross_context_in_transit: { type: "integer", nullable: true },
            stale_waiting_approval_gt_1d: { type: "integer", nullable: true },
            stale_ready_to_ship_gt_1d: { type: "integer", nullable: true },
            stale_in_transit_gt_2d: { type: "integer", nullable: true },
            oldest_in_transit_days: { type: "integer", nullable: true },
          },
        },
      },
      required: ["tenantId", "asOfDate", "filters", "stockLinks", "transfers"],
    },
    InventoryIssueLayerConsumptionRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        issueMovementId: { ...intId, nullable: true },
        costLayerId: { ...intId, nullable: true },
        consumptionNo: { type: "integer", nullable: true },
        quantityConsumed: { type: "number", nullable: true },
        unitCostTxn: { type: "number", nullable: true },
        unitCostBase: { type: "number", nullable: true },
        totalCostTxn: { type: "number", nullable: true },
        totalCostBase: { type: "number", nullable: true },
        currencyCode: { type: "string", maxLength: 3, nullable: true },
        layerStatus: { $ref: "#/components/schemas/InventoryCostLayerStatus" },
        valuationMethod: { $ref: "#/components/schemas/InventoryValuationMethod" },
        sourceMovementId: { ...intId, nullable: true },
        sourceStockLinkId: { ...intId, nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "issueMovementId",
        "costLayerId",
        "consumptionNo",
        "quantityConsumed",
      ],
    },
    InventoryMovementRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        legalEntityCode: { type: "string", nullable: true },
        warehouseId: { ...intId, nullable: true },
        warehouseCode: { type: "string", nullable: true },
        warehouseName: { type: "string", nullable: true },
        itemCardId: { ...intId, nullable: true },
        itemCardCode: { type: "string", nullable: true },
        itemCardName: { type: "string", nullable: true },
        movementType: { $ref: "#/components/schemas/InventoryMovementType" },
        sourceType: { type: "string", nullable: true },
        sourceStockLinkId: { ...intId, nullable: true },
        sourceDocumentType: { type: "string", nullable: true },
        sourceDocumentId: { ...intId, nullable: true },
        sourceDocumentLineId: { ...intId, nullable: true },
        sourceDocumentNo: { type: "string", nullable: true },
        sourceTransferNo: { type: "string", nullable: true },
        sourceTransferStatus: {
          allOf: [{ $ref: "#/components/schemas/InventoryTransferStatus" }],
          nullable: true,
        },
        movementDate: { type: "string", format: "date", nullable: true },
        quantity: { type: "number", nullable: true },
        unitCostTxn: { type: "number", nullable: true },
        unitCostBase: { type: "number", nullable: true },
        totalCostTxn: { type: "number", nullable: true },
        totalCostBase: { type: "number", nullable: true },
        currencyCode: { type: "string", maxLength: 3, nullable: true },
        valuationStatus: { $ref: "#/components/schemas/InventoryValuationStatus" },
        postedJournalEntryId: { ...intId, nullable: true },
        postedJournalNo: { type: "string", nullable: true },
        postedAt: { type: "string", format: "date-time", nullable: true },
        reversalJournalEntryId: { ...intId, nullable: true },
        reversalJournalNo: { type: "string", nullable: true },
        reversedAt: { type: "string", format: "date-time", nullable: true },
        note: { type: "string", nullable: true },
        layerConsumptions: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryIssueLayerConsumptionRow" },
        },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "warehouseId",
        "itemCardId",
        "movementType",
        "valuationStatus",
        "layerConsumptions",
      ],
    },
    InventoryMovementListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryMovementRow" },
        },
      },
      required: ["tenantId", "rows"],
    },
    InventoryMovementResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/InventoryMovementRow" },
      },
      required: ["tenantId", "row"],
    },
    InventoryStockLinkMaterializeRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        movementDate: { type: "string", format: "date" },
        note: { type: "string", maxLength: 255, nullable: true },
      },
      required: ["legalEntityId", "movementDate"],
    },
    InventoryMovementCreateRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        warehouseId: intId,
        sourceStockLinkId: intId,
        movementDate: { type: "string", format: "date" },
        note: { type: "string", maxLength: 255, nullable: true },
      },
      required: ["legalEntityId", "warehouseId", "sourceStockLinkId", "movementDate"],
    },
    InventoryMovementReverseRequest: {
      type: "object",
      properties: {
        reversalDate: { type: "string", format: "date", nullable: true },
        reason: { type: "string", maxLength: 255, nullable: true },
      },
    },
    InventoryTransferLineRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        inventoryTransferId: { ...intId, nullable: true },
        lineNo: { type: "integer", nullable: true },
        itemCardId: { ...intId, nullable: true },
        itemCardCode: { type: "string", nullable: true },
        itemCardName: { type: "string", nullable: true },
        quantityRequested: { type: "number", nullable: true },
        quantityShipped: { type: "number", nullable: true },
        quantityReceived: { type: "number", nullable: true },
        shippedCurrencyCode: { type: "string", maxLength: 3, nullable: true },
        shippedUnitCostTxn: { type: "number", nullable: true },
        shippedUnitCostBase: { type: "number", nullable: true },
        shippedTotalCostTxn: { type: "number", nullable: true },
        shippedTotalCostBase: { type: "number", nullable: true },
        sourceIssueMovementId: { ...intId, nullable: true },
        targetReceiptMovementId: { ...intId, nullable: true },
        note: { type: "string", nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "inventoryTransferId",
        "lineNo",
        "itemCardId",
      ],
    },
    InventoryTransferRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        legalEntityCode: { type: "string", nullable: true },
        transferNo: { type: "string", nullable: true },
        transferDate: { type: "string", format: "date", nullable: true },
        status: {
          allOf: [{ $ref: "#/components/schemas/InventoryTransferStatus" }],
          nullable: true,
        },
        sourceWarehouseId: { ...intId, nullable: true },
        sourceWarehouseCode: { type: "string", nullable: true },
        sourceWarehouseName: { type: "string", nullable: true },
        targetWarehouseId: { ...intId, nullable: true },
        targetWarehouseCode: { type: "string", nullable: true },
        targetWarehouseName: { type: "string", nullable: true },
        sourceOwnershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        sourceOperatingUnitId: { ...intId, nullable: true },
        sourceOperatingUnitCode: { type: "string", nullable: true },
        sourceOperatingUnitName: { type: "string", nullable: true },
        targetOwnershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        targetOperatingUnitId: { ...intId, nullable: true },
        targetOperatingUnitCode: { type: "string", nullable: true },
        targetOperatingUnitName: { type: "string", nullable: true },
        shipmentJournalEntryId: { ...intId, nullable: true },
        shipmentJournalNo: { type: "string", nullable: true },
        receiptJournalEntryId: { ...intId, nullable: true },
        receiptJournalNo: { type: "string", nullable: true },
        reversalJournalEntryId: { ...intId, nullable: true },
        reversalJournalNo: { type: "string", nullable: true },
        initiatedByUserId: { ...intId, nullable: true },
        approvedByUserId: { ...intId, nullable: true },
        shippedByUserId: { ...intId, nullable: true },
        receivedByUserId: { ...intId, nullable: true },
        canceledByUserId: { ...intId, nullable: true },
        reversedByUserId: { ...intId, nullable: true },
        initiatedAt: { type: "string", format: "date-time", nullable: true },
        approvedAt: { type: "string", format: "date-time", nullable: true },
        inTransitAt: { type: "string", format: "date-time", nullable: true },
        receivedAt: { type: "string", format: "date-time", nullable: true },
        canceledAt: { type: "string", format: "date-time", nullable: true },
        reversedAt: { type: "string", format: "date-time", nullable: true },
        cancelReason: { type: "string", nullable: true },
        reverseReason: { type: "string", nullable: true },
        idempotencyKey: { type: "string", nullable: true },
        integrationEventUid: { type: "string", nullable: true },
        sourceModule: { type: "string", nullable: true },
        sourceEntityType: { type: "string", nullable: true },
        sourceEntityId: { ...intId, nullable: true },
        note: { type: "string", nullable: true },
        lineCount: { type: "integer", minimum: 0, nullable: true },
        lines: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryTransferLineRow" },
        },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "status",
        "sourceWarehouseId",
        "targetWarehouseId",
      ],
    },
    InventoryTransferListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        total: nonNegativeInt,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryTransferRow" },
        },
      },
      required: ["tenantId", "total", "rows"],
    },
    InventoryTransferResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/InventoryTransferRow" },
      },
      required: ["tenantId", "row"],
    },
    InventoryTransferCreateLineInput: {
      type: "object",
      properties: {
        itemCardId: intId,
        quantityRequested: {
          type: "string",
          pattern: "^\\d+(\\.\\d{1,6})?$",
        },
        note: { type: "string", maxLength: 255, nullable: true },
      },
      required: ["itemCardId", "quantityRequested"],
    },
    InventoryTransferCreateRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        transferDate: { type: "string", format: "date" },
        sourceWarehouseId: intId,
        targetWarehouseId: intId,
        sourceModule: { type: "string", maxLength: 40, nullable: true },
        sourceEntityType: { type: "string", maxLength: 60, nullable: true },
        sourceEntityId: { ...intId, nullable: true },
        integrationEventUid: { type: "string", maxLength: 100, nullable: true },
        note: { type: "string", maxLength: 500, nullable: true },
        lines: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/components/schemas/InventoryTransferCreateLineInput" },
        },
      },
      required: [
        "legalEntityId",
        "transferDate",
        "sourceWarehouseId",
        "targetWarehouseId",
        "lines",
      ],
    },
    InventoryTransferCancelRequest: {
      type: "object",
      properties: {
        cancelReason: { type: "string", maxLength: 255, nullable: true },
      },
    },
    InventoryTransferReverseRequest: {
      type: "object",
      properties: {
        reverseReason: { type: "string", maxLength: 255, nullable: true },
      },
    },
    InventoryTransferEvidenceRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        sourceRefType: { type: "string", nullable: true },
        sourceRefId: { ...intId, nullable: true },
        status: {
          allOf: [{ $ref: "#/components/schemas/InventoryTransferEvidenceStatus" }],
          nullable: true,
        },
        displayName: { type: "string", nullable: true },
        note: { type: "string", nullable: true },
        fileName: { type: "string", nullable: true },
        fileExtension: { type: "string", nullable: true },
        contentType: { type: "string", nullable: true },
        compressionCodec: {
          allOf: [{ $ref: "#/components/schemas/EvidenceCompressionCodec" }],
          nullable: true,
        },
        fileSizeBytes: { type: "number", nullable: true },
        storedSizeBytes: { type: "number", nullable: true },
        fileSha256: { type: "string", nullable: true },
        storageDriver: { type: "string", nullable: true },
        storagePath: { type: "string", nullable: true },
        uploadedAt: { type: "string", format: "date-time", nullable: true },
        createdByUserId: { ...intId, nullable: true },
        deletedByUserId: { ...intId, nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
        deletedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: ["id", "tenantId", "legalEntityId", "sourceRefType", "sourceRefId", "status"],
    },
    InventoryTransferEvidenceListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        transferId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryTransferEvidenceRow" },
        },
      },
      required: ["tenantId", "transferId", "rows"],
    },
    InventoryTransferEvidenceResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        transferId: intId,
        row: { $ref: "#/components/schemas/InventoryTransferEvidenceRow" },
      },
      required: ["tenantId", "transferId", "row"],
    },
    InventoryTransferEvidenceDraftRequest: {
      type: "object",
      properties: {
        fileName: { type: "string", minLength: 1, maxLength: 255 },
        contentType: { type: "string", maxLength: 120, nullable: true },
        displayName: { type: "string", maxLength: 190, nullable: true },
        note: { type: "string", maxLength: 500, nullable: true },
      },
      required: ["fileName"],
    },
    InventoryTransferEvidenceDraftResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        transferId: intId,
        row: { $ref: "#/components/schemas/InventoryTransferEvidenceRow" },
        uploadPath: { type: "string", nullable: true },
      },
      required: ["tenantId", "transferId", "row", "uploadPath"],
    },
    InventoryCostLayerRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        legalEntityCode: { type: "string", nullable: true },
        warehouseId: { ...intId, nullable: true },
        warehouseCode: { type: "string", nullable: true },
        warehouseName: { type: "string", nullable: true },
        itemCardId: { ...intId, nullable: true },
        itemCardCode: { type: "string", nullable: true },
        itemCardName: { type: "string", nullable: true },
        sourceMovementId: { ...intId, nullable: true },
        sourceStockLinkId: { ...intId, nullable: true },
        valuationMethod: { $ref: "#/components/schemas/InventoryValuationMethod" },
        layerStatus: { $ref: "#/components/schemas/InventoryCostLayerStatus" },
        currencyCode: { type: "string", maxLength: 3, nullable: true },
        quantityIn: { type: "number", nullable: true },
        quantityRemaining: { type: "number", nullable: true },
        unitCostTxn: { type: "number", nullable: true },
        unitCostBase: { type: "number", nullable: true },
        totalCostTxn: { type: "number", nullable: true },
        totalCostBase: { type: "number", nullable: true },
        createdAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "tenantId",
        "legalEntityId",
        "warehouseId",
        "itemCardId",
        "sourceMovementId",
        "valuationMethod",
        "layerStatus",
      ],
    },
    InventoryCostLayerListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryCostLayerRow" },
        },
      },
      required: ["tenantId", "rows"],
    },
    InventoryLandedCostVoucherStatus: {
      type: "string",
      enum: [...STOCK_LANDED_COST_VOUCHER_STATUS_VALUES],
    },
    InventoryLandedCostVoucherUiStatus: {
      type: "string",
      enum: [...STOCK_LANDED_COST_VOUCHER_UI_STATUS_VALUES],
    },
    InventoryLandedCostAllocationMethod: {
      type: "string",
      enum: ["EQUAL", "BY_AMOUNT", "BY_QTY", "MANUAL"],
    },
    InventoryLandedCostSourceLookupRow: {
      type: "object",
      properties: {
        sourceCariDocumentId: { ...intId, nullable: true },
        sourceCariDocumentLineId: { ...intId, nullable: true },
        billNo: { type: "string", nullable: true },
        billDate: { type: "string", format: "date", nullable: true },
        vendorCode: { type: "string", nullable: true },
        vendorName: { type: "string", nullable: true },
        currencyCode,
        lineDescription: { type: "string", nullable: true },
        remainingUnappliedAmountBase: { type: "number", nullable: true },
        eligible: { type: "boolean", nullable: true },
        disabledReasonCode: { type: "string", nullable: true },
      },
      required: ["sourceCariDocumentId", "sourceCariDocumentLineId", "eligible"],
    },
    InventoryLandedCostSourceLookupResponse: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryLandedCostSourceLookupRow" },
        },
      },
      required: ["rows"],
    },
    InventoryLandedCostTargetLookupRow: {
      type: "object",
      properties: {
        sourceStockLinkId: { ...intId, nullable: true },
        sourceAnchorInventoryMovementId: { ...intId, nullable: true },
        receiptRef: { type: "string", nullable: true },
        receiptDate: { type: "string", format: "date", nullable: true },
        itemCardId: { ...intId, nullable: true },
        itemCode: { type: "string", nullable: true },
        itemName: { type: "string", nullable: true },
        warehouseId: { ...intId, nullable: true },
        warehouseCode: { type: "string", nullable: true },
        warehouseName: { type: "string", nullable: true },
        currentOnHandQuantity: { type: "number", nullable: true },
        currentConsumedQuantity: { type: "number", nullable: true },
        ownershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        operatingUnitId: { ...intId, nullable: true },
        blockedReasonCodes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["sourceStockLinkId", "sourceAnchorInventoryMovementId", "blockedReasonCodes"],
    },
    InventoryLandedCostTargetLookupResponse: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryLandedCostTargetLookupRow" },
        },
      },
      required: ["rows"],
    },
    InventoryLandedCostVoucherSourceLineInput: {
      type: "object",
      properties: {
        sourceCariDocumentLineId: intId,
        appliedAmountBase: { type: "number", nullable: true },
      },
      required: ["sourceCariDocumentLineId"],
    },
    InventoryLandedCostVoucherTargetInput: {
      type: "object",
      properties: {
        sourceStockLinkId: intId,
        allocatedAmountBase: { type: "number", nullable: true },
      },
      required: ["sourceStockLinkId"],
    },
    InventoryLandedCostVoucherPreviewRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        postingDate: { type: "string", format: "date", nullable: true },
        allocationMethod: { $ref: "#/components/schemas/InventoryLandedCostAllocationMethod" },
        ownershipScope: { $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" },
        operatingUnitId: { ...intId, nullable: true },
        sourceLines: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/components/schemas/InventoryLandedCostVoucherSourceLineInput" },
        },
        targets: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/components/schemas/InventoryLandedCostVoucherTargetInput" },
        },
      },
      required: ["legalEntityId", "allocationMethod", "ownershipScope", "sourceLines", "targets"],
    },
    InventoryLandedCostVoucherCreateRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        postingDate: { type: "string", format: "date" },
        allocationMethod: { $ref: "#/components/schemas/InventoryLandedCostAllocationMethod" },
        ownershipScope: { $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" },
        operatingUnitId: { ...intId, nullable: true },
        note: { type: "string", maxLength: 500, nullable: true },
        sourceLines: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/components/schemas/InventoryLandedCostVoucherSourceLineInput" },
        },
        targets: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/components/schemas/InventoryLandedCostVoucherTargetInput" },
        },
      },
      required: ["legalEntityId", "postingDate", "allocationMethod", "ownershipScope", "sourceLines", "targets"],
    },
    InventoryLandedCostVoucherReverseRequest: {
      type: "object",
      properties: {
        reversalDate: { type: "string", format: "date", nullable: true },
        reverseReason: { type: "string", maxLength: 255, nullable: true },
      },
    },
    InventoryLandedCostVoucherPreviewResponse: {
      type: "object",
      properties: {
        tenantId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        postingDate: { type: "string", format: "date", nullable: true },
        allocationMethod: {
          allOf: [{ $ref: "#/components/schemas/InventoryLandedCostAllocationMethod" }],
          nullable: true,
        },
        ownershipContext: { $ref: "#/components/schemas/AnyObject" },
        sourceSummary: { $ref: "#/components/schemas/AnyObject" },
        targetSummary: { $ref: "#/components/schemas/AnyObject" },
        targets: {
          type: "array",
          items: { $ref: "#/components/schemas/AnyObject" },
        },
      },
      required: ["sourceSummary", "targetSummary", "targets"],
    },
    InventoryLandedCostVoucherListRow: {
      type: "object",
      properties: {
        voucherId: { ...intId, nullable: true },
        voucherNo: { type: "string", nullable: true },
        status: {
          allOf: [{ $ref: "#/components/schemas/InventoryLandedCostVoucherStatus" }],
          nullable: true,
        },
        postingDate: { type: "string", format: "date", nullable: true },
        legalEntityId: { ...intId, nullable: true },
        legalEntityCode: { type: "string", nullable: true },
        legalEntityName: { type: "string", nullable: true },
        ownershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        operatingUnitId: { ...intId, nullable: true },
        sourceAmountBase: { type: "number", nullable: true },
        capitalizedAmountBase: { type: "number", nullable: true },
        consumedAmountBase: { type: "number", nullable: true },
        sourceBillCount: { type: "integer", nullable: true },
        targetCount: { type: "integer", nullable: true },
        hasReversalDependencies: { type: "boolean", nullable: true },
        uiStatus: {
          allOf: [{ $ref: "#/components/schemas/InventoryLandedCostVoucherUiStatus" }],
          nullable: true,
        },
      },
      required: ["voucherId", "voucherNo", "uiStatus"],
    },
    InventoryLandedCostVoucherListResponse: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/InventoryLandedCostVoucherListRow" },
        },
      },
      required: ["rows"],
    },
    InventoryLandedCostVoucherDetailResponse: {
      type: "object",
      properties: {
        voucherId: { ...intId, nullable: true },
        voucherNo: { type: "string", nullable: true },
        status: {
          allOf: [{ $ref: "#/components/schemas/InventoryLandedCostVoucherStatus" }],
          nullable: true,
        },
        postingDate: { type: "string", format: "date", nullable: true },
        legalEntityId: { ...intId, nullable: true },
        ownershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        operatingUnitId: { ...intId, nullable: true },
        currencyCode,
        note: { type: "string", nullable: true },
        sourceSummary: { $ref: "#/components/schemas/AnyObject" },
        targetSummary: { $ref: "#/components/schemas/AnyObject" },
        sources: {
          type: "array",
          items: { $ref: "#/components/schemas/AnyObject" },
        },
        targets: {
          type: "array",
          items: { $ref: "#/components/schemas/AnyObject" },
        },
        layerAllocations: {
          type: "array",
          items: { $ref: "#/components/schemas/AnyObject" },
        },
        landedCostConsumptions: {
          type: "array",
          items: { $ref: "#/components/schemas/AnyObject" },
        },
        reversalDependencies: {
          type: "array",
          items: { $ref: "#/components/schemas/AnyObject" },
        },
        hasReversalDependencies: { type: "boolean", nullable: true },
        journalAudit: { $ref: "#/components/schemas/AnyObject" },
        uiStatus: {
          allOf: [{ $ref: "#/components/schemas/InventoryLandedCostVoucherUiStatus" }],
          nullable: true,
        },
      },
      required: [
        "voucherId",
        "voucherNo",
        "sources",
        "targets",
        "layerAllocations",
        "landedCostConsumptions",
        "reversalDependencies",
        "journalAudit",
        "uiStatus",
      ],
    },
    InventoryLandedCostVoucherCreateResponse: {
      type: "object",
      properties: {
        voucherId: intId,
        voucherNo: { type: "string", nullable: true },
        status: { $ref: "#/components/schemas/InventoryLandedCostVoucherStatus" },
        postingDate: { type: "string", format: "date", nullable: true },
        legalEntityId: { ...intId, nullable: true },
        ownershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        operatingUnitId: { ...intId, nullable: true },
        postedJournalEntryId: { ...intId, nullable: true },
        sourceSummary: { $ref: "#/components/schemas/AnyObject" },
        targetSummary: { $ref: "#/components/schemas/AnyObject" },
        targetIdsByStockLinkId: {
          type: "object",
          additionalProperties: intId,
        },
      },
      required: ["voucherId", "status", "sourceSummary", "targetSummary", "targetIdsByStockLinkId"],
    },
    InventoryLandedCostVoucherReverseResponse: {
      type: "object",
      properties: {
        voucherId: intId,
        voucherNo: { type: "string", nullable: true },
        status: { $ref: "#/components/schemas/InventoryLandedCostVoucherStatus" },
        postingDate: { type: "string", format: "date", nullable: true },
        legalEntityId: { ...intId, nullable: true },
        ownershipScope: {
          allOf: [{ $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" }],
          nullable: true,
        },
        operatingUnitId: { ...intId, nullable: true },
        postedJournalEntryId: { ...intId, nullable: true },
        reversalJournalEntryId: { ...intId, nullable: true },
        reversedAt: { type: "string", format: "date-time", nullable: true },
      },
      required: ["voucherId", "status"],
    },
  });

  paths["/api/v1/items/cards"] = {
    get: {
      tags: ["Items"],
      operationId: "listItemCards",
      summary: "List item cards",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity filter"),
        queryParam(
          "status",
          { $ref: "#/components/schemas/ItemCardStatus" },
          false,
          "Item-card status filter"
        ),
        queryParam(
          "itemType",
          { $ref: "#/components/schemas/ItemCardItemType" },
          false,
          "Item-card type filter"
        ),
        queryParam("q", { type: "string", maxLength: 120 }, false, "Code/name search"),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }, false, "Page size"),
        queryParam("offset", nonNegativeInt, false, "Page offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Item-card list",
        "#/components/schemas/ItemCardListResponse"
      ),
    },
    post: {
      tags: ["Items"],
      operationId: "createItemCard",
      summary: "Create item card",
      requestBody: bodyFromRef("#/components/schemas/ItemCardUpsertRequest"),
      responses: {
        "201": jsonResponse("#/components/schemas/ItemCardResponse", "Item card created"),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/items/cards/{itemCardId}"] = {
    get: {
      tags: ["Items"],
      operationId: "getItemCard",
      summary: "Get item-card detail",
      parameters: [
        pathParam("itemCardId", "Item-card identifier"),
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
      ],
      responses: withStandardResponses(
        "200",
        "Item-card detail",
        "#/components/schemas/ItemCardResponse"
      ),
    },
    patch: {
      tags: ["Items"],
      operationId: "updateItemCard",
      summary: "Update item card",
      parameters: [pathParam("itemCardId", "Item-card identifier")],
      requestBody: bodyFromRef("#/components/schemas/ItemCardUpsertRequest"),
      responses: withStandardResponses(
        "200",
        "Item card updated",
        "#/components/schemas/ItemCardResponse"
      ),
    },
  };

  paths["/api/v1/inventory/warehouses"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryWarehouses",
      summary: "List inventory warehouses",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity filter"),
        queryParam(
          "ownershipScope",
          { $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" },
          false,
          "Warehouse ownership scope filter"
        ),
        queryParamInt("operatingUnitId", false, "Warehouse operating-unit filter"),
        queryParam(
          "status",
          { $ref: "#/components/schemas/InventoryWarehouseStatus" },
          false,
          "Warehouse status filter"
        ),
        queryParam("q", { type: "string", maxLength: 120 }, false, "Warehouse code/name search"),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }, false, "Page size"),
        queryParam("offset", nonNegativeInt, false, "Page offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Inventory warehouse list",
        "#/components/schemas/InventoryWarehouseListResponse"
      ),
    },
    post: {
      tags: ["Inventory"],
      operationId: "createInventoryWarehouse",
      summary: "Create inventory warehouse",
      requestBody: bodyFromRef("#/components/schemas/InventoryWarehouseCreateRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/InventoryWarehouseResponse",
          "Inventory warehouse created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/inventory/work-queue-summary"] = {
    get: {
      tags: ["Inventory"],
      operationId: "getInventoryWorkQueueSummary",
      summary: "Summarize actionable and history-oriented inventory work-queue counts",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity filter"),
      ],
      responses: withStandardResponses(
        "200",
        "Inventory work-queue summary",
        "#/components/schemas/InventoryWorkQueueSummaryResponse"
      ),
    },
  };

  paths["/api/v1/inventory/cari-stock-links"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryCariStockLinks",
      summary: "List strict-mode CARI stock-link queue rows across actionable and history scopes",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity filter"),
        queryParam(
          "queueScope",
          { $ref: "#/components/schemas/InventoryStockLinkQueueScope" },
          false,
          "Queue scope filter. ACTIONABLE stays execution-focused; COMPLETED and VOID expose explicit history views."
        ),
        queryParam(
          "linkStatus",
          { $ref: "#/components/schemas/InventoryStockLinkStatus" },
          false,
          "Stock-link status filter"
        ),
        queryParam(
          "stockImpactMode",
          { $ref: "#/components/schemas/InventoryStockImpactMode" },
          false,
          "Stock-impact mode filter"
        ),
        queryParamInt("warehouseId", false, "Bound warehouse filter"),
        queryParam(
          "warehouseLinked",
          { type: "boolean" },
          false,
          "Filter links with or without related inventory movement"
        ),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }, false, "Page size"),
        queryParam("offset", nonNegativeInt, false, "Page offset"),
      ],
      responses: withStandardResponses(
        "200",
        "CARI stock-link queue list",
        "#/components/schemas/InventoryPendingStockLinkListResponse"
      ),
    },
  };

  paths["/api/v1/inventory/cari-stock-links/{stockLinkId}/materialize"] = {
    post: {
      tags: ["Inventory"],
      operationId: "materializeInventoryCariStockLink",
      summary:
        "Materialize one strict-mode CARI stock link using its bound warehouse and authoritative rechecks",
      parameters: [pathParam("stockLinkId", "CARI stock-link identifier")],
      requestBody: bodyFromRef(
        "#/components/schemas/InventoryStockLinkMaterializeRequest"
      ),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/InventoryMovementResponse",
          "Strict-mode stock link materialized or existing linked movement returned"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/inventory/movements"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryMovements",
      summary: "List inventory movements with valuation and issue-consumption detail",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity filter"),
        queryParamInt("warehouseId", false, "Warehouse filter"),
        queryParam(
          "movementType",
          { $ref: "#/components/schemas/InventoryMovementType" },
          false,
          "Movement type filter"
        ),
        queryParam(
          "valuationStatus",
          { $ref: "#/components/schemas/InventoryValuationStatus" },
          false,
          "Valuation status filter"
        ),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }, false, "Page size"),
        queryParam("offset", nonNegativeInt, false, "Page offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Inventory movement list",
        "#/components/schemas/InventoryMovementListResponse"
      ),
    },
    post: {
      tags: ["Inventory"],
      operationId: "createInventoryMovementFromStockLink",
      summary:
        "Legacy-only non-strict stock-link materialization using caller-selected warehouse input",
      requestBody: bodyFromRef("#/components/schemas/InventoryMovementCreateRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/InventoryMovementResponse",
          "Inventory movement created or existing linked movement returned"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/inventory/movements/{movementId}/reverse"] = {
    post: {
      tags: ["Inventory"],
      operationId: "reverseInventoryMovement",
      summary:
        "Reverse one valued outbound issue, restore FIFO layer quantities, and post the inventory-side reversal journal",
      parameters: [pathParam("movementId", "Inventory movement identifier")],
      requestBody: bodyFromRef(
        "#/components/schemas/InventoryMovementReverseRequest",
        false
      ),
      responses: withStandardResponses(
        "200",
        "Inventory movement reversed",
        "#/components/schemas/InventoryMovementResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryTransfers",
      summary: "List inventory transfers across warehouse ownership contexts",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity filter"),
        queryParamInt("sourceWarehouseId", false, "Source warehouse filter"),
        queryParamInt("targetWarehouseId", false, "Target warehouse filter"),
        queryParam(
          "status",
          { $ref: "#/components/schemas/InventoryTransferStatus" },
          false,
          "Transfer status filter"
        ),
        queryParam("q", { type: "string", maxLength: 120 }, false, "Transfer or warehouse search"),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 200 }, false, "Page size"),
        queryParam("offset", nonNegativeInt, false, "Page offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Inventory transfer list",
        "#/components/schemas/InventoryTransferListResponse"
      ),
    },
    post: {
      tags: ["Inventory"],
      operationId: "createInventoryTransfer",
      summary: "Create inventory transfer draft between different ownership contexts",
      requestBody: bodyFromRef("#/components/schemas/InventoryTransferCreateRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/InventoryTransferResponse",
          "Inventory transfer created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}"] = {
    get: {
      tags: ["Inventory"],
      operationId: "getInventoryTransfer",
      summary: "Get one inventory transfer with line, journal, and ownership context detail",
      parameters: [
        pathParam("transferId", "Inventory transfer identifier"),
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
      ],
      responses: withStandardResponses(
        "200",
        "Inventory transfer detail",
        "#/components/schemas/InventoryTransferResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/approve"] = {
    post: {
      tags: ["Inventory"],
      operationId: "approveInventoryTransfer",
      summary: "Approve inventory transfer before shipment",
      parameters: [pathParam("transferId", "Inventory transfer identifier")],
      responses: withStandardResponses(
        "200",
        "Inventory transfer approved",
        "#/components/schemas/InventoryTransferResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/ship"] = {
    post: {
      tags: ["Inventory"],
      operationId: "shipInventoryTransfer",
      summary:
        "Ship inventory transfer, create issue movements, and post shipment self-balancing journal when required",
      parameters: [pathParam("transferId", "Inventory transfer identifier")],
      responses: withStandardResponses(
        "200",
        "Inventory transfer shipped",
        "#/components/schemas/InventoryTransferResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/receive"] = {
    post: {
      tags: ["Inventory"],
      operationId: "receiveInventoryTransfer",
      summary: "Receive inventory transfer and post destination receipt journal",
      parameters: [pathParam("transferId", "Inventory transfer identifier")],
      responses: withStandardResponses(
        "200",
        "Inventory transfer received",
        "#/components/schemas/InventoryTransferResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/cancel"] = {
    post: {
      tags: ["Inventory"],
      operationId: "cancelInventoryTransfer",
      summary: "Cancel inventory transfer before shipment artifacts exist",
      parameters: [pathParam("transferId", "Inventory transfer identifier")],
      requestBody: bodyFromRef("#/components/schemas/InventoryTransferCancelRequest", false),
      responses: withStandardResponses(
        "200",
        "Inventory transfer canceled",
        "#/components/schemas/InventoryTransferResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/reverse"] = {
    post: {
      tags: ["Inventory"],
      operationId: "reverseInventoryTransfer",
      summary: "Reverse shipped and received inventory transfer journals and movements additively",
      parameters: [pathParam("transferId", "Inventory transfer identifier")],
      requestBody: bodyFromRef("#/components/schemas/InventoryTransferReverseRequest", false),
      responses: withStandardResponses(
        "200",
        "Inventory transfer reversed",
        "#/components/schemas/InventoryTransferResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/evidence"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryTransferEvidence",
      summary: "List inventory transfer evidence attachments",
      parameters: [pathParam("transferId", "Inventory transfer identifier")],
      responses: withStandardResponses(
        "200",
        "Inventory transfer evidence list",
        "#/components/schemas/InventoryTransferEvidenceListResponse"
      ),
    },
    post: {
      tags: ["Inventory"],
      operationId: "createInventoryTransferEvidenceDraft",
      summary: "Create inventory transfer evidence draft and return binary upload target",
      parameters: [pathParam("transferId", "Inventory transfer identifier")],
      requestBody: bodyFromRef("#/components/schemas/InventoryTransferEvidenceDraftRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/InventoryTransferEvidenceDraftResponse",
          "Inventory transfer evidence draft created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/evidence/{evidenceId}"] = {
    delete: {
      tags: ["Inventory"],
      operationId: "deleteInventoryTransferEvidence",
      summary: "Delete inventory transfer evidence attachment",
      parameters: [
        pathParam("transferId", "Inventory transfer identifier"),
        pathParam("evidenceId", "Evidence identifier"),
      ],
      responses: withStandardResponses(
        "200",
        "Inventory transfer evidence deleted",
        "#/components/schemas/InventoryTransferEvidenceResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/evidence/{evidenceId}/content"] = {
    put: {
      tags: ["Inventory"],
      operationId: "uploadInventoryTransferEvidenceContent",
      summary: "Upload raw binary content for inventory transfer evidence attachment",
      parameters: [
        pathParam("transferId", "Inventory transfer identifier"),
        pathParam("evidenceId", "Evidence identifier"),
      ],
      requestBody: {
        required: true,
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      responses: withStandardResponses(
        "200",
        "Inventory transfer evidence content uploaded",
        "#/components/schemas/InventoryTransferEvidenceResponse"
      ),
    },
  };

  paths["/api/v1/inventory/transfers/{transferId}/evidence/{evidenceId}/download"] = {
    get: {
      tags: ["Inventory"],
      operationId: "downloadInventoryTransferEvidence",
      summary: "Download inventory transfer evidence binary content",
      parameters: [
        pathParam("transferId", "Inventory transfer identifier"),
        pathParam("evidenceId", "Evidence identifier"),
      ],
      responses: {
        "200": {
          description: "Inventory transfer evidence binary content",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/inventory/cost-layers"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryCostLayers",
      summary: "List receipt cost layers used by FIFO issue valuation",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity filter"),
        queryParamInt("warehouseId", false, "Warehouse filter"),
        queryParamInt("itemCardId", false, "Item-card filter"),
        queryParam(
          "layerStatus",
          { $ref: "#/components/schemas/InventoryCostLayerStatus" },
          false,
          "Layer status filter"
        ),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }, false, "Page size"),
        queryParam("offset", nonNegativeInt, false, "Page offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Inventory cost-layer list",
        "#/components/schemas/InventoryCostLayerListResponse"
      ),
    },
  };

  paths["/api/v1/inventory/landed-cost-vouchers/lookups/source-lines"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryLandedCostSourceLines",
      summary: "List eligible posted AP source lines for landed-cost vouchers",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", true, "Legal entity filter"),
        queryParam("postingDateFrom", { type: "string", format: "date" }, false, "Posted bill date from"),
        queryParam("postingDateTo", { type: "string", format: "date" }, false, "Posted bill date to"),
        queryParam("vendor", { type: "string", maxLength: 255 }, false, "Vendor code/name filter"),
        queryParam("currencyCode", { ...currencyCode, nullable: true }, false, "Source bill currency"),
        queryParam("search", { type: "string", maxLength: 255 }, false, "Bill/document/line search"),
        queryParam("onlyRemainingUnapplied", { type: "boolean" }, false, "Show only source lines with unapplied base amount remaining"),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }, false, "Page size"),
      ],
      responses: withStandardResponses(
        "200",
        "Landed-cost eligible source-line lookup",
        "#/components/schemas/InventoryLandedCostSourceLookupResponse"
      ),
    },
  };

  paths["/api/v1/inventory/landed-cost-vouchers/lookups/receipt-targets"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryLandedCostReceiptTargets",
      summary: "List posted receipt anchors available for landed-cost targeting",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", true, "Legal entity filter"),
        queryParam(
          "ownershipScope",
          { $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" },
          false,
          "Ownership context filter"
        ),
        queryParamInt("operatingUnitId", false, "Operating-unit filter when ownershipScope=OPERATING_UNIT"),
        queryParam("receiptDateFrom", { type: "string", format: "date" }, false, "Receipt date from"),
        queryParam("receiptDateTo", { type: "string", format: "date" }, false, "Receipt date to"),
        queryParamInt("itemCardId", false, "Item-card filter"),
        queryParamInt("warehouseId", false, "Anchor warehouse filter"),
        queryParam("search", { type: "string", maxLength: 255 }, false, "Receipt/item/warehouse search"),
        queryParam("matchSelectedContextOnly", { type: "boolean" }, false, "Restrict rows to the selected ownership context"),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }, false, "Page size"),
      ],
      responses: withStandardResponses(
        "200",
        "Landed-cost receipt target lookup",
        "#/components/schemas/InventoryLandedCostTargetLookupResponse"
      ),
    },
  };

  paths["/api/v1/inventory/landed-cost-vouchers"] = {
    get: {
      tags: ["Inventory"],
      operationId: "listInventoryLandedCostVouchers",
      summary: "List stock landed-cost vouchers with workflow totals and derived reversal state",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity filter"),
        queryParam(
          "ownershipScope",
          { $ref: "#/components/schemas/InventoryWarehouseOwnershipScope" },
          false,
          "Voucher ownership scope filter"
        ),
        queryParamInt("operatingUnitId", false, "Voucher operating-unit filter"),
        queryParam(
          "status",
          { $ref: "#/components/schemas/InventoryLandedCostVoucherStatus" },
          false,
          "Persisted voucher status filter"
        ),
        queryParam("postingDateFrom", { type: "string", format: "date" }, false, "Posting date from"),
        queryParam("postingDateTo", { type: "string", format: "date" }, false, "Posting date to"),
        queryParam("vendor", { type: "string", maxLength: 255 }, false, "Vendor code/name filter"),
        queryParam("search", { type: "string", maxLength: 255 }, false, "Voucher/source/receipt search"),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 500 }, false, "Page size"),
      ],
      responses: withStandardResponses(
        "200",
        "Landed-cost voucher list",
        "#/components/schemas/InventoryLandedCostVoucherListResponse"
      ),
    },
    post: {
      tags: ["Inventory"],
      operationId: "createInventoryLandedCostVoucher",
      summary: "Post a stock landed-cost voucher from AP source lines onto posted receipt targets",
      requestBody: bodyFromRef("#/components/schemas/InventoryLandedCostVoucherCreateRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/InventoryLandedCostVoucherCreateResponse",
          "Landed-cost voucher posted"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/inventory/landed-cost-vouchers/preview"] = {
    post: {
      tags: ["Inventory"],
      operationId: "previewInventoryLandedCostVoucher",
      summary: "Preview landed-cost allocation over posted receipt targets before posting",
      requestBody: bodyFromRef("#/components/schemas/InventoryLandedCostVoucherPreviewRequest"),
      responses: withStandardResponses(
        "200",
        "Landed-cost voucher preview",
        "#/components/schemas/InventoryLandedCostVoucherPreviewResponse"
      ),
    },
  };

  paths["/api/v1/inventory/landed-cost-vouchers/{voucherId}"] = {
    get: {
      tags: ["Inventory"],
      operationId: "getInventoryLandedCostVoucher",
      summary: "Get stock landed-cost voucher detail with source, target, layer, consumption, and journal audit sections",
      parameters: [
        pathParam("voucherId", "Landed-cost voucher identifier"),
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
      ],
      responses: withStandardResponses(
        "200",
        "Landed-cost voucher detail",
        "#/components/schemas/InventoryLandedCostVoucherDetailResponse"
      ),
    },
  };

  paths["/api/v1/inventory/landed-cost-vouchers/{voucherId}/reverse"] = {
    post: {
      tags: ["Inventory"],
      operationId: "reverseInventoryLandedCostVoucher",
      summary: "Reverse a posted stock landed-cost voucher when no downstream dependency remains",
      parameters: [pathParam("voucherId", "Landed-cost voucher identifier")],
      requestBody: bodyFromRef("#/components/schemas/InventoryLandedCostVoucherReverseRequest", false),
      responses: withStandardResponses(
        "200",
        "Landed-cost voucher reversed",
        "#/components/schemas/InventoryLandedCostVoucherReverseResponse"
      ),
    },
  };
}

function applyFixedAssetsOperationOverrides(specObject) {
  ensureTagPresent(specObject, "FixedAssets");
  const paths = specObject.paths || {};

  const assetDetailOperation =
    paths["/api/v1/fixed-assets/{assetId}"]?.get;
  if (assetDetailOperation) {
    assetDetailOperation.tags = ["FixedAssets"];
    assetDetailOperation.summary =
      "Get fixed asset detail with retro correction history and corrected owner timeline";
    assetDetailOperation.parameters = [
      pathParam("assetId", "Fixed asset identifier"),
    ];
    assetDetailOperation.responses = withStandardResponses(
      "200",
      "Fixed asset detail",
      "#/components/schemas/AnyObject"
    );
  }

  const assetTransactionsOperation =
    paths["/api/v1/fixed-assets/{assetId}/transactions"]?.get;
  if (assetTransactionsOperation) {
    assetTransactionsOperation.tags = ["FixedAssets"];
    assetTransactionsOperation.summary =
      "List fixed asset transactions with retro correction linkage metadata and display labels";
    assetTransactionsOperation.parameters = [
      pathParam("assetId", "Fixed asset identifier"),
    ];
    assetTransactionsOperation.responses = withStandardResponses(
      "200",
      "Fixed asset transactions",
      "#/components/schemas/AnyObject"
    );
  }

  const reportBasisParameter = queryParam(
    "reportBasis",
    {
      type: "string",
      enum: ["AS_POSTED", "INCLUDE_RETRO_CORRECTIONS", "OPERATIONALLY_CORRECTED"],
    },
    false,
    "Track 43 report basis. V1 wires AS_POSTED and INCLUDE_RETRO_CORRECTIONS only on depreciation-by-owner-ou; OPERATIONALLY_CORRECTED or unsupported report/reportBasis combinations return 400."
  );

  const reportsOperation =
    paths["/api/v1/fixed-assets/reports/{reportName}"]?.get;
  if (reportsOperation) {
    reportsOperation.tags = ["FixedAssets"];
    reportsOperation.summary =
      "Run fixed asset report with Track 43 reportBasis validation for owner-report modes";
    mergeOperationParameters(reportsOperation, [reportBasisParameter]);
    reportsOperation.responses = withStandardResponses(
      "200",
      "Fixed asset report result",
      "#/components/schemas/AnyObject"
    );
  }

  const exportReportOperation =
    paths["/api/v1/fixed-assets/reports/{reportName}/export"]?.get;
  if (exportReportOperation) {
    exportReportOperation.tags = ["FixedAssets"];
    exportReportOperation.summary =
      "Export fixed asset report with Track 43 reportBasis validation for owner-report modes";
    mergeOperationParameters(exportReportOperation, [reportBasisParameter]);
    exportReportOperation.responses = withStandardResponses(
      "200",
      "Fixed asset report export",
      "#/components/schemas/AnyObject"
    );
  }

  const ownershipTransferOperation =
    paths["/api/v1/fixed-assets/{assetId}/ownership-transfer"]?.post;
  if (ownershipTransferOperation) {
    ownershipTransferOperation.tags = ["FixedAssets"];
    ownershipTransferOperation.summary =
      "Post a plain ownership transfer when chronology is still safe; otherwise return a structured Track 43 reroute/blocker response";
    ownershipTransferOperation.parameters = [
      pathParam("assetId", "Fixed asset identifier"),
    ];
    ownershipTransferOperation.requestBody = bodyFromRef(
      "#/components/schemas/AnyObject",
      false
    );
    ownershipTransferOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/AnyObject",
        "Ownership transfer posted"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
      "409": jsonResponse(
        "#/components/schemas/AnyObject",
        "Ownership transfer blocked or rerouted to retro correction"
      ),
    };
  }

  const retroCorrectionPreviewOperation =
    paths["/api/v1/fixed-assets/{assetId}/retro-ownership-transfer-correction/preview"]?.post;
  if (retroCorrectionPreviewOperation) {
    retroCorrectionPreviewOperation.tags = ["FixedAssets"];
    retroCorrectionPreviewOperation.operationId =
      "previewFixedAssetRetroOwnershipTransferCorrection";
    retroCorrectionPreviewOperation.summary =
      "Preview retro ownership transfer correction deltas, overlap metadata, and blocker/reroute decision";
    retroCorrectionPreviewOperation.parameters = [
      pathParam("assetId", "Fixed asset identifier"),
    ];
    retroCorrectionPreviewOperation.requestBody = bodyFromRef(
      "#/components/schemas/AnyObject"
    );
    retroCorrectionPreviewOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/AnyObject",
        "Retro ownership transfer correction preview with period-by-period delta output"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
      "409": jsonResponse(
        "#/components/schemas/AnyObject",
        "Retro ownership transfer correction preview blocked"
      ),
    };
  }

  const retroCorrectionPostOperation =
    paths["/api/v1/fixed-assets/{assetId}/retro-ownership-transfer-correction"]?.post;
  if (retroCorrectionPostOperation) {
    retroCorrectionPostOperation.tags = ["FixedAssets"];
    retroCorrectionPostOperation.operationId =
      "postFixedAssetRetroOwnershipTransferCorrection";
    retroCorrectionPostOperation.summary =
      "Post a preview-backed retro ownership transfer correction with the current-period true-up, mandatory owner move, and replacement-only overlap handling";
    retroCorrectionPostOperation.parameters = [
      pathParam("assetId", "Fixed asset identifier"),
    ];
    retroCorrectionPostOperation.requestBody = bodyFromRef(
      "#/components/schemas/AnyObject"
    );
    retroCorrectionPostOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/AnyObject",
        "Retro ownership transfer correction posted"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
      "409": jsonResponse(
        "#/components/schemas/AnyObject",
        "Retro ownership transfer correction blocked, stale, or unable to replace an overlapping correction safely"
      ),
    };
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

  const amendOperation = paths["/api/v1/contracts/{contractId}/amend"]?.post;
  if (amendOperation) {
    amendOperation.summary = "Amend ACTIVE/SUSPENDED contract with version increment";
    amendOperation.requestBody = bodyFromRef("#/components/schemas/ContractAmendInput");
    amendOperation.responses = withStandardResponses(
      "200",
      "Contract amended",
      "#/components/schemas/ContractMutationResponse"
    );
  }

  const patchLineOperation = paths["/api/v1/contracts/{contractId}/lines/{lineId}"]?.patch;
  if (patchLineOperation) {
    patchLineOperation.summary = "Patch one contract line (partial update) with version increment";
    patchLineOperation.requestBody = bodyFromRef("#/components/schemas/ContractLinePatchInput");
    patchLineOperation.responses = withStandardResponses(
      "200",
      "Contract line patched",
      "#/components/schemas/ContractLinePatchResponse"
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

  const generateBillingOperation = paths["/api/v1/contracts/{contractId}/generate-billing"]?.post;
  if (generateBillingOperation) {
    generateBillingOperation.summary =
      "Generate contract-driven Cari billing document and auto-create contract-document link";
    generateBillingOperation.requestBody = bodyFromRef(
      "#/components/schemas/ContractGenerateBillingInput"
    );
    generateBillingOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/ContractGenerateBillingResponse",
        "Idempotent replay response"
      ),
      "201": jsonResponse(
        "#/components/schemas/ContractGenerateBillingResponse",
        "Contract billing generation created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const generateRevrecOperation = paths["/api/v1/contracts/{contractId}/generate-revrec"]?.post;
  if (generateRevrecOperation) {
    generateRevrecOperation.summary =
      "Generate draft contract-driven RevRec schedules/lines with source references";
    generateRevrecOperation.requestBody = bodyFromRef(
      "#/components/schemas/ContractGenerateRevrecInput"
    );
    generateRevrecOperation.responses = {
      "200": jsonResponse(
        "#/components/schemas/ContractGenerateRevrecResponse",
        "Idempotent replay response"
      ),
      "201": jsonResponse(
        "#/components/schemas/ContractGenerateRevrecResponse",
        "Contract RevRec schedule generation created"
      ),
      "400": errorResponseRef,
      "401": errorResponseRef,
      "403": errorResponseRef,
    };
  }

  const adjustLinkOperation = paths["/api/v1/contracts/{contractId}/documents/{linkId}/adjust"]?.post;
  if (adjustLinkOperation) {
    adjustLinkOperation.summary = "Adjust contract-document link amount via append-only event";
    adjustLinkOperation.requestBody = bodyFromRef(
      "#/components/schemas/ContractLinkAdjustInput"
    );
    adjustLinkOperation.responses = withStandardResponses(
      "200",
      "Contract-document link adjusted",
      "#/components/schemas/ContractLinkMutationResponse"
    );
  }

  const unlinkLinkOperation = paths["/api/v1/contracts/{contractId}/documents/{linkId}/unlink"]?.post;
  if (unlinkLinkOperation) {
    unlinkLinkOperation.summary = "Unlink contract-document link via append-only event";
    unlinkLinkOperation.requestBody = bodyFromRef(
      "#/components/schemas/ContractLinkUnlinkInput"
    );
    unlinkLinkOperation.responses = withStandardResponses(
      "200",
      "Contract-document link unlinked",
      "#/components/schemas/ContractLinkMutationResponse"
    );
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

  const linkableDocumentsOperation =
    paths["/api/v1/contracts/{contractId}/linkable-documents"]?.get;
  if (linkableDocumentsOperation) {
    linkableDocumentsOperation.summary =
      "List contract-scoped linkable documents (no direct cari.doc.read dependency)";
    mergeOperationParameters(linkableDocumentsOperation, [
      queryParam("q", { type: "string" }, false, "Search by document no or counterparty snapshot"),
      queryParam("limit", { type: "integer", minimum: 1 }, false, "Page size"),
      queryParam("offset", nonNegativeInt, false, "Page offset"),
    ]);
    linkableDocumentsOperation.responses = withStandardResponses(
      "200",
      "Contract-scoped linkable documents",
      "#/components/schemas/ContractLinkableDocumentsResponse"
    );
  }

  const amendmentsOperation = paths["/api/v1/contracts/{contractId}/amendments"]?.get;
  if (amendmentsOperation) {
    amendmentsOperation.summary = "List contract amendment/version history";
    amendmentsOperation.responses = withStandardResponses(
      "200",
      "Contract amendment history",
      "#/components/schemas/ContractAmendmentsResponse"
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

function applyBankAccountOperationOverrides(specObject) {
  ensureTagPresent(specObject, "Bank");
  const paths = specObject.paths || {};
  const schemas = specObject.components?.schemas || {};

  Object.assign(schemas, {
    BankAccountRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        operating_unit_id: { ...intId, nullable: true },
        code: { type: "string" },
        name: { type: "string" },
        currency_code: currencyCode,
        gl_account_id: intId,
        bank_name: { type: "string", nullable: true },
        branch_name: { type: "string", nullable: true },
        iban: { type: "string", nullable: true },
        account_no: { type: "string", nullable: true },
        is_active: { type: "boolean" },
        created_by_user_id: intId,
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        legal_entity_code: { type: "string" },
        legal_entity_name: { type: "string" },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        gl_account_code: { type: "string" },
        gl_account_name: { type: "string" },
        gl_account_type: { type: "string", nullable: true },
        gl_account_allow_posting: { type: "boolean", nullable: true },
        gl_account_is_active: { type: "boolean", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "code",
        "name",
        "currency_code",
        "gl_account_id",
        "is_active",
        "created_by_user_id",
        "created_at",
        "updated_at",
        "legal_entity_code",
        "legal_entity_name",
        "gl_account_code",
        "gl_account_name",
      ],
    },
    BankAccountListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/BankAccountRow" },
        },
        total: nonNegativeInt,
        limit: intId,
        offset: nonNegativeInt,
      },
      required: ["tenantId", "rows", "total", "limit", "offset"],
    },
    BankAccountEnvelopeResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/BankAccountRow" },
      },
      required: ["tenantId", "row"],
    },
    BankAccountUpsertRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        operatingUnitId: { ...intId, nullable: true },
        code: { type: "string", minLength: 1, maxLength: 60 },
        name: { type: "string", minLength: 1, maxLength: 255 },
        currencyCode: { type: "string", minLength: 3, maxLength: 3 },
        glAccountId: intId,
        bankName: { type: "string", maxLength: 255, nullable: true },
        branchName: { type: "string", maxLength: 255, nullable: true },
        iban: { type: "string", maxLength: 64, nullable: true },
        accountNo: { type: "string", maxLength: 80, nullable: true },
        isActive: { type: "boolean", default: true },
      },
      required: ["legalEntityId", "code", "name", "currencyCode", "glAccountId"],
    },
    BankAccountProvisionControlParentChildRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        operatingUnitId: { ...intId, nullable: true },
        code: { type: "string", minLength: 1, maxLength: 60 },
        name: { type: "string", minLength: 1, maxLength: 255 },
        currencyCode: { type: "string", minLength: 3, maxLength: 3 },
        bankName: { type: "string", maxLength: 255, nullable: true },
        branchName: { type: "string", maxLength: 255, nullable: true },
        iban: { type: "string", maxLength: 64, nullable: true },
        accountNo: { type: "string", maxLength: 80, nullable: true },
        isActive: { type: "boolean", default: true },
        glAccountName: {
          type: "string",
          maxLength: 255,
          nullable: true,
          description:
            "Optional display name for the auto-created child GL account under the configured bank control parent",
        },
      },
      required: ["legalEntityId", "code", "name", "currencyCode"],
    },
    BankProvisionedGlAccount: {
      type: "object",
      properties: {
        id: intId,
        code: { type: "string" },
        name: { type: "string" },
        parentAccountId: intId,
        parentAccountCode: { type: "string" },
        allocationSequence: intId,
      },
      required: [
        "id",
        "code",
        "name",
        "parentAccountId",
        "parentAccountCode",
        "allocationSequence",
      ],
    },
    BankAccountProvisionControlParentChildResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/BankAccountRow" },
        glAccount: { $ref: "#/components/schemas/BankProvisionedGlAccount" },
        idempotentReplay: { type: "boolean" },
      },
      required: ["tenantId", "row", "glAccount", "idempotentReplay"],
    },
  });

  paths["/api/v1/bank/accounts"] = {
    get: {
      tags: ["Bank"],
      operationId: "listBankAccounts",
      summary: "List bank accounts",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity identifier"),
        queryParamInt("operatingUnitId", false, "Operating unit identifier"),
        queryParam("isActive", { type: "boolean" }, false, "Filter active/inactive bank accounts"),
        queryParam(
          "q",
          { type: "string" },
          false,
          "Case-insensitive code/name/bank/IBAN/account search text"
        ),
        queryParamInt("limit", false, "Maximum rows to return"),
        queryParam("offset", nonNegativeInt, false, "Row offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Bank account list",
        "#/components/schemas/BankAccountListResponse"
      ),
    },
    post: {
      tags: ["Bank"],
      operationId: "createBankAccount",
      summary: "Create bank account",
      requestBody: bodyFromRef("#/components/schemas/BankAccountUpsertRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/BankAccountEnvelopeResponse",
          "Bank account created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/bank/accounts/{bankAccountId}"] = {
    get: {
      tags: ["Bank"],
      operationId: "getBankAccount",
      summary: "Get bank account",
      parameters: [
        pathParam("bankAccountId", "Bank account identifier"),
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
      ],
      responses: withStandardResponses(
        "200",
        "Bank account detail",
        "#/components/schemas/BankAccountEnvelopeResponse"
      ),
    },
    put: {
      tags: ["Bank"],
      operationId: "updateBankAccount",
      summary: "Update bank account",
      parameters: [pathParam("bankAccountId", "Bank account identifier")],
      requestBody: bodyFromRef("#/components/schemas/BankAccountUpsertRequest"),
      responses: withStandardResponses(
        "200",
        "Bank account updated",
        "#/components/schemas/BankAccountEnvelopeResponse"
      ),
    },
  };

  paths["/api/v1/bank/accounts/{bankAccountId}/activate"] = {
    post: {
      tags: ["Bank"],
      operationId: "activateBankAccount",
      summary: "Activate bank account",
      parameters: [pathParam("bankAccountId", "Bank account identifier")],
      responses: withStandardResponses(
        "200",
        "Bank account activated",
        "#/components/schemas/BankAccountEnvelopeResponse"
      ),
    },
  };

  paths["/api/v1/bank/accounts/{bankAccountId}/deactivate"] = {
    post: {
      tags: ["Bank"],
      operationId: "deactivateBankAccount",
      summary: "Deactivate bank account",
      parameters: [pathParam("bankAccountId", "Bank account identifier")],
      responses: withStandardResponses(
        "200",
        "Bank account deactivated",
        "#/components/schemas/BankAccountEnvelopeResponse"
      ),
    },
  };

  paths["/api/v1/bank/accounts/provision-control-parent-child"] = {
    post: {
      tags: ["Bank"],
      operationId: "provisionBankAccountControlParentChild",
      summary:
        "Provision bank account and auto-create a child GL account under the configured bank control parent",
      parameters: [
        {
          in: "header",
          name: "Idempotency-Key",
          required: false,
          description:
            "Optional idempotency key for replay-safe bank control-parent child provisioning",
          schema: { type: "string", maxLength: 190 },
        },
      ],
      requestBody: bodyFromRef(
        "#/components/schemas/BankAccountProvisionControlParentChildRequest"
      ),
      responses: {
        "200": jsonResponse(
          "#/components/schemas/BankAccountProvisionControlParentChildResponse",
          "Idempotent replay response"
        ),
        "201": jsonResponse(
          "#/components/schemas/BankAccountProvisionControlParentChildResponse",
          "Provisioned bank account created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };
}

function applyShareholderCapitalOperationOverrides(specObject) {
  const paths = specObject.paths || {};
  const schemas = specObject.components?.schemas || {};

  Object.assign(schemas, {
    ShareholderCapitalFulfillmentRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        shareholderId: intId,
        operatingUnitId: { ...intId, nullable: true },
        destinationMode: {
          type: "string",
          enum: ["BANK_ACCOUNT", "ASSET_GL", "CASH_REGISTER"],
        },
        bankAccountId: {
          ...intId,
          nullable: true,
          description: "Required when destinationMode is BANK_ACCOUNT",
        },
        destinationAccountId: {
          ...intId,
          nullable: true,
          description: "Required when destinationMode is ASSET_GL",
        },
        cashRegisterId: {
          ...intId,
          nullable: true,
          description: "Required when destinationMode is CASH_REGISTER",
        },
        cashSessionId: {
          ...intId,
          nullable: true,
          description: "Optional unless the selected cash register requires an open session",
        },
        amount: {
          description: "Contribution amount in legal-entity base currency",
          oneOf: [{ type: "number" }, { type: "string" }],
        },
        contributionDate: { type: "string", format: "date" },
        note: { type: "string", nullable: true },
      },
      required: [
        "legalEntityId",
        "shareholderId",
        "destinationMode",
        "amount",
        "contributionDate",
      ],
    },
    ShareholderCapitalFulfillmentJournalContext: {
      type: "object",
      properties: {
        book_id: intId,
        book_code: { type: "string" },
        fiscal_period_id: intId,
        base_currency_code: currencyCode,
        start_date: { type: "string", format: "date" },
        end_date: { type: "string", format: "date" },
      },
      required: [
        "book_id",
        "book_code",
        "fiscal_period_id",
        "base_currency_code",
        "start_date",
        "end_date",
      ],
    },
    ShareholderCapitalFulfillmentShareholder: {
      type: "object",
      properties: {
        id: intId,
        code: { type: "string" },
        name: { type: "string" },
        commitment_debit_sub_account_id: intId,
        commitment_debit_sub_account_code: { type: "string" },
        commitment_debit_sub_account_name: { type: "string" },
      },
      required: [
        "id",
        "code",
        "name",
        "commitment_debit_sub_account_id",
        "commitment_debit_sub_account_code",
        "commitment_debit_sub_account_name",
      ],
    },
    ShareholderCapitalFulfillmentOperatingUnit: {
      type: "object",
      nullable: true,
      properties: {
        id: intId,
        code: { type: "string" },
        name: { type: "string" },
        has_subledger: { type: "boolean" },
        central_due_from_account_id: intId,
        central_due_from_account_code: { type: "string" },
        central_due_from_account_name: { type: "string" },
        ou_due_to_central_account_id: intId,
        ou_due_to_central_account_code: { type: "string" },
        ou_due_to_central_account_name: { type: "string" },
      },
      required: [
        "id",
        "code",
        "name",
        "has_subledger",
        "central_due_from_account_id",
        "central_due_from_account_code",
        "central_due_from_account_name",
        "ou_due_to_central_account_id",
        "ou_due_to_central_account_code",
        "ou_due_to_central_account_name",
      ],
    },
    ShareholderCapitalFulfillmentDestination: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["BANK_ACCOUNT", "ASSET_GL", "CASH_REGISTER"],
        },
        bank_account_id: { ...intId, nullable: true },
        cash_register_id: { ...intId, nullable: true },
        cash_register_code: { type: "string", nullable: true },
        cash_register_name: { type: "string", nullable: true },
        cash_session_id: { ...intId, nullable: true },
        destination_account_id: { ...intId, nullable: true },
        destination_account_code: { type: "string", nullable: true },
        destination_account_name: { type: "string", nullable: true },
        display_name: { type: "string" },
      },
      required: ["mode", "display_name"],
    },
    ShareholderCapitalFulfillmentTotals: {
      type: "object",
      properties: {
        total_debit_base: { type: "number" },
        total_credit_base: { type: "number" },
        currency_code: currencyCode,
      },
      required: ["total_debit_base", "total_credit_base", "currency_code"],
    },
    ShareholderCapitalFulfillmentPreviewLine: {
      type: "object",
      properties: {
        line_no: intId,
        account_id: intId,
        account_code: { type: "string" },
        account_name: { type: "string" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        description: { type: "string" },
        subledger_reference_no: { type: "string", nullable: true },
        currency_code: currencyCode,
        amount_txn: { type: "number" },
        debit_base: { type: "number" },
        credit_base: { type: "number" },
      },
      required: [
        "line_no",
        "account_id",
        "account_code",
        "account_name",
        "description",
        "currency_code",
        "amount_txn",
        "debit_base",
        "credit_base",
      ],
    },
    ShareholderCapitalFulfillmentPreviewPayload: {
      type: "object",
      properties: {
        operational_model: {
          type: "string",
          enum: ["HQ_FIRST_CENTRAL_ONLY", "DIRECT_OU_TARGETED"],
        },
        contribution_kind: {
          type: "string",
          enum: ["CASH", "IN_KIND"],
        },
        contribution_date: { type: "string", format: "date" },
        amount_base: { type: "number" },
        currency_code: currencyCode,
        journal_context: {
          $ref: "#/components/schemas/ShareholderCapitalFulfillmentJournalContext",
        },
        shareholder: {
          $ref: "#/components/schemas/ShareholderCapitalFulfillmentShareholder",
        },
        operating_unit: {
          $ref: "#/components/schemas/ShareholderCapitalFulfillmentOperatingUnit",
        },
        destination: {
          $ref: "#/components/schemas/ShareholderCapitalFulfillmentDestination",
        },
        totals: {
          $ref: "#/components/schemas/ShareholderCapitalFulfillmentTotals",
        },
        lines: {
          type: "array",
          items: {
            $ref: "#/components/schemas/ShareholderCapitalFulfillmentPreviewLine",
          },
        },
      },
      required: [
        "operational_model",
        "contribution_kind",
        "contribution_date",
        "amount_base",
        "currency_code",
        "journal_context",
        "shareholder",
        "operating_unit",
        "destination",
        "totals",
        "lines",
      ],
    },
    ShareholderCapitalFulfillmentPreviewResponse: {
      allOf: [
        { $ref: "#/components/schemas/ShareholderCapitalFulfillmentPreviewPayload" },
        {
          type: "object",
          properties: {
            ok: {
              type: "boolean",
              enum: [true],
            },
          },
          required: ["ok"],
        },
      ],
    },
    ShareholderCapitalFulfillmentCreateResponse: {
      type: "object",
      properties: {
        ok: { type: "boolean", enum: [true] },
        fulfillmentId: intId,
        status: { type: "string", enum: ["POSTED"] },
        journalEntryId: intId,
        journalNo: { type: "string" },
        cashTransactionId: { ...intId, nullable: true },
        preview: {
          $ref: "#/components/schemas/ShareholderCapitalFulfillmentPreviewPayload",
        },
      },
      required: [
        "ok",
        "fulfillmentId",
        "status",
        "journalEntryId",
        "journalNo",
        "cashTransactionId",
        "preview",
      ],
    },
    ShareholderCapitalFulfillmentRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        shareholder_id: intId,
        operating_unit_id: { ...intId, nullable: true },
        destination_mode: {
          type: "string",
          enum: ["BANK_ACCOUNT", "ASSET_GL", "CASH_REGISTER"],
        },
        bank_account_id: { ...intId, nullable: true },
        cash_register_id: { ...intId, nullable: true },
        cash_session_id: { ...intId, nullable: true },
        cash_transaction_id: { ...intId, nullable: true },
        cash_reversal_transaction_id: { ...intId, nullable: true },
        destination_account_id: { ...intId, nullable: true },
        amount_base: { type: "number" },
        currency_code: currencyCode,
        contribution_kind: { type: "string", enum: ["CASH", "IN_KIND"] },
        status: { type: "string", enum: ["POSTED", "REVERSED"] },
        journal_entry_id: intId,
        reversal_journal_entry_id: { ...intId, nullable: true },
        contribution_date: { type: "string", format: "date" },
        note: { type: "string", nullable: true },
        created_by_user_id: intId,
        posted_by_user_id: intId,
        reversed_by_user_id: { ...intId, nullable: true },
        reversed_at: { type: "string", format: "date-time", nullable: true },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        legal_entity_code: { type: "string" },
        legal_entity_name: { type: "string" },
        shareholder_code: { type: "string" },
        shareholder_name: { type: "string" },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        bank_account_code: { type: "string", nullable: true },
        bank_account_name: { type: "string", nullable: true },
        cash_register_code: { type: "string", nullable: true },
        cash_register_name: { type: "string", nullable: true },
        cash_transaction_no: { type: "string", nullable: true },
        cash_journal_entry_id: { ...intId, nullable: true },
        cash_journal_no: { type: "string", nullable: true },
        cash_reversal_transaction_no: { type: "string", nullable: true },
        cash_reversal_journal_entry_id: { ...intId, nullable: true },
        cash_reversal_journal_no: { type: "string", nullable: true },
        destination_account_code: { type: "string", nullable: true },
        destination_account_name: { type: "string", nullable: true },
        journal_no: { type: "string" },
        reversal_journal_no: { type: "string", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "shareholder_id",
        "destination_mode",
        "amount_base",
        "currency_code",
        "contribution_kind",
        "status",
        "journal_entry_id",
        "contribution_date",
        "created_by_user_id",
        "posted_by_user_id",
        "created_at",
        "updated_at",
        "legal_entity_code",
        "legal_entity_name",
        "shareholder_code",
        "shareholder_name",
        "journal_no",
      ],
    },
    ShareholderCapitalFulfillmentListResponse: {
      type: "object",
      properties: {
        ok: { type: "boolean", enum: [true] },
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/ShareholderCapitalFulfillmentRow" },
        },
      },
      required: ["ok", "tenantId", "rows"],
    },
    ShareholderCapitalFulfillmentReverseRequest: {
      type: "object",
      properties: {
        reason: { type: "string", maxLength: 255, nullable: true },
      },
    },
    ShareholderCapitalFulfillmentReverseResponse: {
      type: "object",
      properties: {
        ok: { type: "boolean", enum: [true] },
        fulfillmentId: intId,
        status: { type: "string", enum: ["REVERSED"] },
        journalEntryId: intId,
        reversalJournalEntryId: { ...intId, nullable: true },
        cashReversalTransactionId: { ...intId, nullable: true },
        reverseReason: { type: "string" },
        idempotentReplay: { type: "boolean" },
      },
      required: [
        "ok",
        "fulfillmentId",
        "status",
        "journalEntryId",
        "reversalJournalEntryId",
        "cashReversalTransactionId",
        "idempotentReplay",
      ],
    },
  });

  paths["/api/v1/org/shareholders/capital-fulfillments"] = {
    get: {
      tags: ["Org"],
      operationId: "listShareholderCapitalFulfillments",
      summary: "List shareholder capital fulfillments",
      parameters: [
        queryParamInt("tenantId", false, "Tenant identifier; optional if available in JWT"),
        queryParamInt("legalEntityId", false, "Legal entity identifier"),
        queryParamInt("shareholderId", false, "Shareholder identifier"),
        queryParamInt("operatingUnitId", false, "Operating unit identifier"),
        {
          in: "query",
          name: "status",
          required: false,
          schema: { type: "string", enum: ["POSTED", "REVERSED"] },
        },
      ],
      responses: withStandardResponses(
        "200",
        "Capital fulfillment list",
        "#/components/schemas/ShareholderCapitalFulfillmentListResponse"
      ),
    },
    post: {
      tags: ["Org"],
      operationId: "createShareholderCapitalFulfillment",
      summary: "Create shareholder capital fulfillment",
      requestBody: bodyFromRef("#/components/schemas/ShareholderCapitalFulfillmentRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/ShareholderCapitalFulfillmentCreateResponse",
          "Capital fulfillment created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/org/shareholders/capital-fulfillments/{id}/reverse"] = {
    post: {
      tags: ["Org"],
      operationId: "reverseShareholderCapitalFulfillment",
      summary: "Reverse shareholder capital fulfillment",
      parameters: [pathParam("id", "Capital fulfillment identifier")],
      requestBody: bodyFromRef(
        "#/components/schemas/ShareholderCapitalFulfillmentReverseRequest",
        false
      ),
      responses: withStandardResponses(
        "200",
        "Capital fulfillment reversed",
        "#/components/schemas/ShareholderCapitalFulfillmentReverseResponse"
      ),
    },
  };

  paths["/api/v1/org/shareholders/capital-fulfillments/preview"] = {
    post: {
      tags: ["Org"],
      operationId: "previewShareholderCapitalFulfillment",
      summary: "Preview shareholder capital fulfillment",
      requestBody: bodyFromRef("#/components/schemas/ShareholderCapitalFulfillmentRequest"),
      responses: withStandardResponses(
        "200",
        "Capital fulfillment preview",
        "#/components/schemas/ShareholderCapitalFulfillmentPreviewResponse"
      ),
    },
  };
}

function applyPaymentsOperationOverrides(specObject) {
  ensureTagPresent(specObject, "Payments");
  const paths = specObject.paths || {};
  const schemas = specObject.components?.schemas || {};

  const paymentBatchStatuses = ["DRAFT", "APPROVED", "EXPORTED", "POSTED", "FAILED", "CANCELLED"];
  const paymentSourceTypes = ["PAYROLL", "AP", "TAX", "MANUAL"];
  const paymentLineStatuses = ["PENDING", "PAID", "FAILED", "CANCELLED"];
  const payrollOwnershipScopes = ["CENTRAL", "OPERATING_UNIT"];
  const payrollLiabilityTypes = [
    "NET_PAY",
    "EMPLOYEE_TAX",
    "EMPLOYEE_SOCIAL_SECURITY",
    "EMPLOYER_TAX",
    "EMPLOYER_SOCIAL_SECURITY",
    "OTHER_DEDUCTIONS",
  ];
  const payrollLiabilityScopeValues = ["NET_PAY", "STATUTORY", "ALL"];
  const payrollLiabilityStatuses = ["OPEN", "IN_BATCH", "PARTIALLY_PAID", "PAID", "CANCELLED"];
  const payrollPaymentSyncActions = [
    "MARK_PARTIAL",
    "MARK_PAID",
    "RELEASE_TO_OPEN",
    "EXCEPTION",
    "NOOP",
  ];
  const payrollManualSettlementStatuses = ["REQUESTED", "APPLIED", "REJECTED"];
  const payrollRunStatuses = ["DRAFT", "IMPORTED", "REVIEWED", "FINALIZED"];
  const payrollOwnershipResolutionStatuses = ["RESOLVED", "UNRESOLVED", "AMBIGUOUS", "MISMATCH"];
  const payrollAssignmentStatuses = ["ACTIVE", "INACTIVE"];

  Object.assign(schemas, {
    PaymentBatchStatus: {
      type: "string",
      enum: paymentBatchStatuses,
    },
    PaymentSourceType: {
      type: "string",
      enum: paymentSourceTypes,
    },
    PaymentBatchLineStatus: {
      type: "string",
      enum: paymentLineStatuses,
    },
    PaymentBatchLineInput: {
      type: "object",
      properties: {
        beneficiaryType: { type: "string", minLength: 1, maxLength: 30 },
        beneficiaryId: { ...intId, nullable: true },
        beneficiaryName: { type: "string", minLength: 1, maxLength: 255 },
        beneficiaryBankRef: { type: "string", maxLength: 255, nullable: true },
        payableEntityType: { type: "string", minLength: 1, maxLength: 40 },
        payableEntityId: { ...intId, nullable: true },
        payableGlAccountId: intId,
        payableRef: { type: "string", maxLength: 120, nullable: true },
        amount: {
          oneOf: [{ type: "number", minimum: 0, exclusiveMinimum: true }, { type: "string" }],
        },
        notes: { type: "string", maxLength: 500, nullable: true },
      },
      required: [
        "beneficiaryType",
        "beneficiaryName",
        "payableEntityType",
        "payableGlAccountId",
        "amount",
      ],
    },
    PaymentBatchCreateRequest: {
      type: "object",
      properties: {
        sourceType: { $ref: "#/components/schemas/PaymentSourceType" },
        sourceId: { ...intId, nullable: true },
        bankAccountId: intId,
        currencyCode: currencyCode,
        idempotencyKey: { type: "string", minLength: 1, maxLength: 120, nullable: true },
        notes: { type: "string", maxLength: 500, nullable: true },
        lines: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/components/schemas/PaymentBatchLineInput" },
        },
      },
      required: ["sourceType", "bankAccountId", "currencyCode", "lines"],
    },
    PaymentBatchApproveRequest: {
      type: "object",
      properties: {
        note: { type: "string", maxLength: 500, nullable: true },
      },
    },
    PaymentBatchExportRequest: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["CSV"], default: "CSV" },
      },
    },
    PaymentBatchPostRequest: {
      type: "object",
      properties: {
        note: { type: "string", maxLength: 500, nullable: true },
        externalPaymentRefPrefix: {
          type: "string",
          maxLength: 60,
          nullable: true,
        },
        postingDate: { type: "string", format: "date", nullable: true },
      },
    },
    PaymentBatchCancelRequest: {
      type: "object",
      properties: {
        reason: { type: "string", maxLength: 500, nullable: true },
      },
    },
    PaymentBatchListRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        batch_no: { type: "string", nullable: true },
        source_type: { $ref: "#/components/schemas/PaymentSourceType" },
        source_id: { ...intId, nullable: true },
        bank_account_id: intId,
        currency_code: { ...currencyCode, nullable: true },
        total_amount: { type: "number", nullable: true },
        status: { $ref: "#/components/schemas/PaymentBatchStatus" },
        governance_approval_status: { type: "string", nullable: true },
        governance_approval_request_id: { ...intId, nullable: true },
        governance_approved_at: { type: "string", nullable: true },
        governance_approved_by_user_id: { ...intId, nullable: true },
        posted_journal_entry_id: { ...intId, nullable: true },
        created_by_user_id: { ...intId, nullable: true },
        approved_by_user_id: { ...intId, nullable: true },
        exported_by_user_id: { ...intId, nullable: true },
        posted_by_user_id: { ...intId, nullable: true },
        approved_at: { type: "string", nullable: true },
        exported_at: { type: "string", nullable: true },
        posted_at: { type: "string", nullable: true },
        created_at: { type: "string", nullable: true },
        bank_account_code: { type: "string", nullable: true },
        bank_account_name: { type: "string", nullable: true },
        bank_operating_unit_id: { ...intId, nullable: true },
        bank_operating_unit_code: { type: "string", nullable: true },
        bank_operating_unit_name: { type: "string", nullable: true },
        legal_entity_code: { type: "string", nullable: true },
        legal_entity_name: { type: "string", nullable: true },
        line_count: { type: "integer", minimum: 0, nullable: true },
        paid_line_count: { type: "integer", minimum: 0, nullable: true },
        pending_line_count: { type: "integer", minimum: 0, nullable: true },
        payer_context_scope: {
          type: "string",
          enum: ["CENTRAL", "OPERATING_UNIT"],
          nullable: true,
        },
        payer_context_label: { type: "string", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "bank_account_id",
        "currency_code",
        "status",
        "payer_context_scope",
        "payer_context_label",
      ],
    },
    PaymentBatchLineRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        batch_id: intId,
        line_no: { type: "integer", minimum: 1, nullable: true },
        beneficiary_type: { type: "string", nullable: true },
        beneficiary_id: { ...intId, nullable: true },
        beneficiary_name: { type: "string", nullable: true },
        beneficiary_bank_ref: { type: "string", nullable: true },
        payable_entity_type: { type: "string", nullable: true },
        payable_entity_id: { ...intId, nullable: true },
        payable_gl_account_id: { ...intId, nullable: true },
        payable_gl_account_code: { type: "string", nullable: true },
        payable_gl_account_name: { type: "string", nullable: true },
        payable_ref: { type: "string", nullable: true },
        amount: { type: "number", nullable: true },
        status: { $ref: "#/components/schemas/PaymentBatchLineStatus" },
        notes: { type: "string", nullable: true },
        external_payment_ref: { type: "string", nullable: true },
        bank_operating_unit_id: { ...intId, nullable: true },
        bank_operating_unit_code: { type: "string", nullable: true },
        bank_operating_unit_name: { type: "string", nullable: true },
        payer_context_scope: {
          type: "string",
          enum: ["CENTRAL", "OPERATING_UNIT"],
          nullable: true,
        },
        payer_context_label: { type: "string", nullable: true },
        liability_ownership_scope: {
          type: "string",
          enum: ["CENTRAL", "OPERATING_UNIT"],
          nullable: true,
        },
        liability_operating_unit_id: { ...intId, nullable: true },
        liability_operating_unit_code: { type: "string", nullable: true },
        liability_operating_unit_name: { type: "string", nullable: true },
        liability_owner_context_label: { type: "string", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "batch_id",
        "line_no",
        "amount",
        "status",
        "payer_context_scope",
        "payer_context_label",
      ],
    },
    PaymentBatchExportRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        batch_id: intId,
        export_format: { type: "string", nullable: true },
        export_status: { type: "string", nullable: true },
        file_name: { type: "string", nullable: true },
        file_checksum: { type: "string", nullable: true },
        export_payload_text: { type: "string", nullable: true },
        raw_meta_json: { $ref: "#/components/schemas/AnyObject" },
        exported_by_user_id: { ...intId, nullable: true },
        created_at: { type: "string", nullable: true },
      },
      required: ["id", "tenant_id", "legal_entity_id", "batch_id"],
    },
    PaymentBatchAuditRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        batch_id: intId,
        action: { type: "string", nullable: true },
        payload_json: { $ref: "#/components/schemas/AnyObject" },
        acted_by_user_id: { ...intId, nullable: true },
        acted_at: { type: "string", nullable: true },
      },
      required: ["id", "tenant_id", "legal_entity_id", "batch_id"],
    },
    PaymentBatchDetailRow: {
      allOf: [
        { $ref: "#/components/schemas/PaymentBatchListRow" },
        {
          type: "object",
          properties: {
            lines: {
              type: "array",
              items: { $ref: "#/components/schemas/PaymentBatchLineRow" },
            },
            exports: {
              type: "array",
              items: { $ref: "#/components/schemas/PaymentBatchExportRow" },
            },
            audit: {
              type: "array",
              items: { $ref: "#/components/schemas/PaymentBatchAuditRow" },
            },
          },
          required: ["lines", "exports", "audit"],
        },
      ],
    },
    PaymentBatchListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/PaymentBatchListRow" },
        },
        total: nonNegativeInt,
        limit: intId,
        offset: nonNegativeInt,
      },
      required: ["tenantId", "rows", "total", "limit", "offset"],
    },
    PaymentBatchEnvelopeResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/PaymentBatchDetailRow" },
      },
      required: ["tenantId", "row"],
    },
    PaymentBatchExportResult: {
      type: "object",
      properties: {
        id: intId,
        format: { type: "string", enum: ["CSV"] },
        file_name: { type: "string" },
        checksum: { type: "string" },
        csv: { type: "string" },
      },
      required: ["id", "format", "file_name", "checksum", "csv"],
    },
    PaymentBatchExportResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/PaymentBatchDetailRow" },
        export: { $ref: "#/components/schemas/PaymentBatchExportResult" },
      },
      required: ["tenantId", "row", "export"],
    },
  });

  Object.assign(schemas, {
    PayrollLiabilityRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        run_id: intId,
        liability_key: { type: "string", nullable: true },
        liability_type: { $ref: "#/components/schemas/PayrollLiabilityType" },
        liability_group: { type: "string", nullable: true },
        source_run_line_id: { ...intId, nullable: true },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        cost_center_code: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        beneficiary_type: { type: "string", nullable: true },
        beneficiary_id: { ...intId, nullable: true },
        beneficiary_name: { type: "string", nullable: true },
        beneficiary_bank_ref: { type: "string", nullable: true },
        payable_component_code: { type: "string", nullable: true },
        payable_gl_account_id: { ...intId, nullable: true },
        payable_gl_account_code: { type: "string", nullable: true },
        payable_gl_account_name: { type: "string", nullable: true },
        payable_ref: { type: "string", nullable: true },
        amount: { type: "number", nullable: true },
        settled_amount: { type: "number", nullable: true },
        outstanding_amount: { type: "number", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        status: { $ref: "#/components/schemas/PayrollLiabilityStatus" },
        reserved_payment_batch_id: { ...intId, nullable: true },
        paid_at: { type: "string", nullable: true },
        payment_link_id: { ...intId, nullable: true },
        beneficiary_bank_snapshot_id: { ...intId, nullable: true },
        beneficiary_snapshot_status: { type: "string", nullable: true },
        beneficiary_ready_for_payment: { type: "boolean", nullable: true },
        created_at: { type: "string", nullable: true },
        updated_at: { type: "string", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "run_id",
        "liability_type",
        "ownership_scope",
        "owner_context_label",
        "amount",
        "currency_code",
        "status",
      ],
    },
    PayrollLiabilityOwnerContextSummaryRow: {
      type: "object",
      properties: {
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        liability_count: { type: "integer", minimum: 0 },
        total_amount: { type: "number" },
        selected_bank_settlement_mode: { type: "string", nullable: true },
        selected_bank_allowed: { type: "boolean", nullable: true },
        selected_bank_requires_self_balancing: { type: "boolean", nullable: true },
      },
      required: ["ownership_scope", "owner_context_label", "liability_count", "total_amount"],
    },
    PayrollLiabilitySummary: {
      type: "object",
      properties: {
        total_count: { type: "integer", minimum: 0 },
        total_amount: { type: "number" },
        total_open: { type: "number" },
        total_in_batch: { type: "number" },
        total_partially_paid: { type: "number" },
        total_paid: { type: "number" },
        total_cancelled: { type: "number" },
        total_partially_paid_outstanding: { type: "number" },
        total_outstanding: { type: "number" },
        total_employee_net: { type: "number" },
        total_statutory: { type: "number" },
      },
      required: [
        "total_count",
        "total_amount",
        "total_open",
        "total_in_batch",
        "total_partially_paid",
        "total_paid",
        "total_cancelled",
        "total_partially_paid_outstanding",
        "total_outstanding",
        "total_employee_net",
        "total_statutory",
      ],
    },
    PayrollLiabilityListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityRow" },
        },
        total: nonNegativeInt,
        limit: intId,
        offset: nonNegativeInt,
        pageMode: { type: "string", nullable: true },
        nextCursor: { type: "string", nullable: true },
      },
      required: ["tenantId", "rows", "total", "limit", "offset"],
    },
    PayrollRunLiabilitiesDetailResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityRow" },
        },
        summary: { $ref: "#/components/schemas/PayrollLiabilitySummary" },
        audit: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollAuditRow" },
        },
      },
      required: ["tenantId", "runId", "run", "items", "summary", "audit"],
    },
    PayrollRunLiabilitiesBuildResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityRow" },
        },
        summary: { $ref: "#/components/schemas/PayrollLiabilitySummary" },
        audit: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollAuditRow" },
        },
        alreadyBuilt: { type: "boolean" },
      },
      required: ["tenantId", "runId", "run", "items", "summary", "audit", "alreadyBuilt"],
    },
    PayrollSelectedBankAccountRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        operating_unit_id: { ...intId, nullable: true },
        code: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        is_active: { type: "boolean", nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        payer_context_scope: {
          type: "string",
          enum: payrollOwnershipScopes,
          nullable: true,
        },
        payer_context_label: { type: "string", nullable: true },
      },
      required: ["id", "tenant_id", "legal_entity_id", "payer_context_scope", "payer_context_label"],
    },
    PayrollPaymentPrepValidationError: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
    PayrollPaymentBatchPreviewSelectedBankEvaluation: {
      type: "object",
      properties: {
        bank_account_id: intId,
        payer_context_scope: {
          type: "string",
          enum: payrollOwnershipScopes,
          nullable: true,
        },
        payer_context_label: { type: "string", nullable: true },
        settlement_mode: {
          type: "string",
          enum: ["NONE", "NOT_ALLOWED", "SAME_CONTEXT", "CROSS_CONTEXT_SELF_BALANCING"],
        },
        mixed_owner_context: { type: "boolean" },
        same_context_liability_count: { type: "integer", minimum: 0 },
        cross_context_liability_count: { type: "integer", minimum: 0 },
        out_of_scope_liability_count: { type: "integer", minimum: 0 },
        requires_self_balancing: { type: "boolean" },
        can_prepare_payment_batch: { type: "boolean" },
        validation_errors: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentPrepValidationError" },
        },
      },
      required: [
        "bank_account_id",
        "payer_context_scope",
        "payer_context_label",
        "settlement_mode",
        "mixed_owner_context",
        "same_context_liability_count",
        "cross_context_liability_count",
        "out_of_scope_liability_count",
        "requires_self_balancing",
        "can_prepare_payment_batch",
        "validation_errors",
      ],
    },
    PayrollPaymentBatchPreviewLiabilityRow: {
      type: "object",
      properties: {
        id: intId,
        liability_type: { $ref: "#/components/schemas/PayrollLiabilityType" },
        liability_group: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        beneficiary_name: { type: "string", nullable: true },
        beneficiary_type: { type: "string", nullable: true },
        payable_gl_account_id: { ...intId, nullable: true },
        amount: { type: "number" },
        status: { type: "string", nullable: true },
        selected_bank_settlement_mode: { type: "string", nullable: true },
        selected_bank_allowed: { type: "boolean", nullable: true },
        selected_bank_requires_self_balancing: { type: "boolean", nullable: true },
      },
      required: ["id", "liability_type", "ownership_scope", "owner_context_label", "amount"],
    },
    PayrollPaymentBatchPayloadTemplate: {
      type: "object",
      properties: {
        sourceType: { type: "string", enum: ["PAYROLL"] },
        sourceId: intId,
        currencyCode: { ...currencyCode, nullable: true },
        lineCount: { type: "integer", minimum: 0 },
        totalAmount: { type: "number" },
        lines: {
          type: "array",
          items: { $ref: "#/components/schemas/PaymentBatchLineInput" },
        },
      },
      required: ["sourceType", "sourceId", "currencyCode", "lineCount", "totalAmount", "lines"],
    },
    PayrollPaymentBatchPreview: {
      type: "object",
      properties: {
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        eligible_liability_count: { type: "integer", minimum: 0 },
        total_amount: { type: "number" },
        can_prepare_payment_batch: { type: "boolean" },
        can_prepare_with_selected_bank: { type: "boolean", nullable: true },
        default_idempotency_key: { type: "string", nullable: true },
        selected_bank_account: {
          allOf: [{ $ref: "#/components/schemas/PayrollSelectedBankAccountRow" }],
          nullable: true,
        },
        owner_context_summary: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityOwnerContextSummaryRow" },
        },
        selected_bank_evaluation: {
          allOf: [{ $ref: "#/components/schemas/PayrollPaymentBatchPreviewSelectedBankEvaluation" }],
          nullable: true,
        },
        eligible_liabilities: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentBatchPreviewLiabilityRow" },
        },
        batch_payload_template: {
          $ref: "#/components/schemas/PayrollPaymentBatchPayloadTemplate",
        },
        summary: { $ref: "#/components/schemas/PayrollLiabilitySummary" },
      },
      required: [
        "run",
        "scope",
        "eligible_liability_count",
        "total_amount",
        "can_prepare_payment_batch",
        "default_idempotency_key",
        "owner_context_summary",
        "eligible_liabilities",
        "batch_payload_template",
        "summary",
      ],
    },
    PayrollPaymentBatchPreviewResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        preview: { $ref: "#/components/schemas/PayrollPaymentBatchPreview" },
      },
      required: ["tenantId", "runId", "preview"],
    },
    PayrollCreateRunPaymentBatchRequest: {
      type: "object",
      properties: {
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        bankAccountId: intId,
        idempotencyKey: { type: "string", maxLength: 120, nullable: true },
        notes: { type: "string", maxLength: 500, nullable: true },
      },
      required: ["bankAccountId"],
    },
    PayrollLiabilityCollection: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityRow" },
        },
        summary: { $ref: "#/components/schemas/PayrollLiabilitySummary" },
        audit: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollAuditRow" },
        },
      },
      required: ["items", "summary", "audit"],
    },
    PayrollPaymentBatchLinkSummary: {
      type: "object",
      properties: {
        linkedCount: { type: "integer", minimum: 0, nullable: true },
        statusUpdatedCount: { type: "integer", minimum: 0, nullable: true },
        paymentBatchId: { ...intId, nullable: true },
        paymentBatchNo: { type: "string", nullable: true },
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        idempotencyKey: { type: "string", nullable: true },
      },
      required: ["scope"],
    },
    PayrollCreateRunPaymentBatchResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        liabilities: { $ref: "#/components/schemas/PayrollLiabilityCollection" },
        batch: { $ref: "#/components/schemas/PaymentBatchDetailRow" },
        preview_before_prepare: { $ref: "#/components/schemas/PayrollPaymentBatchPreview" },
        preview_after_prepare: { $ref: "#/components/schemas/PayrollPaymentBatchPreview" },
        linkSummary: { $ref: "#/components/schemas/PayrollPaymentBatchLinkSummary" },
      },
      required: [
        "tenantId",
        "runId",
        "run",
        "liabilities",
        "batch",
        "preview_before_prepare",
        "preview_after_prepare",
        "linkSummary",
      ],
    },
  });

  Object.assign(schemas, {
    PayrollPaymentSyncVerdict: {
      type: "object",
      properties: {
        action: { $ref: "#/components/schemas/PayrollPaymentSyncAction" },
        amount: { type: "number", nullable: true },
        deltaAmount: { type: "number", nullable: true },
        targetSettledAmount: { type: "number", nullable: true },
        currentSettledAmount: { type: "number", nullable: true },
        currentOutstandingAmount: { type: "number", nullable: true },
        settlementSource: { type: "string", nullable: true },
        bankStatementLineId: { ...intId, nullable: true },
        settledAt: { type: "string", nullable: true },
        reason: { type: "string", nullable: true },
      },
      required: ["action"],
    },
    PayrollPaymentSyncSummary: {
      type: "object",
      properties: {
        total_candidates: { type: "integer", minimum: 0 },
        mark_partial_count: { type: "integer", minimum: 0 },
        mark_partial_amount: { type: "number" },
        mark_paid_count: { type: "integer", minimum: 0 },
        mark_paid_amount: { type: "number" },
        release_count: { type: "integer", minimum: 0 },
        release_amount: { type: "number" },
        exception_count: { type: "integer", minimum: 0 },
        exception_amount: { type: "number" },
        noop_count: { type: "integer", minimum: 0 },
        noop_amount: { type: "number" },
      },
      required: [
        "total_candidates",
        "mark_partial_count",
        "mark_partial_amount",
        "mark_paid_count",
        "mark_paid_amount",
        "release_count",
        "release_amount",
        "exception_count",
        "exception_amount",
        "noop_count",
        "noop_amount",
      ],
    },
    PayrollPaymentSyncOwnerContextSummaryRow: {
      type: "object",
      properties: {
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        candidate_count: { type: "integer", minimum: 0 },
        total_liability_amount: { type: "number" },
        total_allocated_amount: { type: "number" },
        total_outstanding_amount: { type: "number" },
        mark_partial_count: { type: "integer", minimum: 0 },
        mark_partial_amount: { type: "number" },
        mark_paid_count: { type: "integer", minimum: 0 },
        mark_paid_amount: { type: "number" },
        release_count: { type: "integer", minimum: 0 },
        release_amount: { type: "number" },
        exception_count: { type: "integer", minimum: 0 },
        exception_amount: { type: "number" },
        noop_count: { type: "integer", minimum: 0 },
        noop_amount: { type: "number" },
      },
      required: [
        "ownership_scope",
        "owner_context_label",
        "candidate_count",
        "total_liability_amount",
        "total_allocated_amount",
        "total_outstanding_amount",
        "mark_partial_count",
        "mark_partial_amount",
        "mark_paid_count",
        "mark_paid_amount",
        "release_count",
        "release_amount",
        "exception_count",
        "exception_amount",
        "noop_count",
        "noop_amount",
      ],
    },
    PayrollPaymentSyncPreviewItem: {
      type: "object",
      properties: {
        payroll_liability_id: { ...intId, nullable: true },
        link_id: { ...intId, nullable: true },
        payment_batch_id: { ...intId, nullable: true },
        payment_batch_line_id: { ...intId, nullable: true },
        liability_type: { type: "string", nullable: true },
        liability_status: { type: "string", nullable: true },
        liability_amount: { type: "number", nullable: true },
        liability_settled_amount: { type: "number", nullable: true },
        liability_outstanding_amount: { type: "number", nullable: true },
        allocated_amount: { type: "number", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        owner_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
        verdict: { $ref: "#/components/schemas/PayrollPaymentSyncVerdict" },
      },
      required: ["ownership_scope", "owner_context_label", "owner_context", "verdict"],
    },
    PayrollPaymentSyncPreview: {
      type: "object",
      properties: {
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        allow_b04_only_settlement: { type: "boolean" },
        owner_context_summary: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentSyncOwnerContextSummaryRow" },
        },
        mixed_owner_context: { type: "boolean" },
        summary: { $ref: "#/components/schemas/PayrollPaymentSyncSummary" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentSyncPreviewItem" },
        },
      },
      required: [
        "run",
        "scope",
        "allow_b04_only_settlement",
        "owner_context_summary",
        "mixed_owner_context",
        "summary",
        "items",
      ],
    },
    PayrollPaymentSyncPreviewResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        preview: { $ref: "#/components/schemas/PayrollPaymentSyncPreview" },
      },
      required: ["tenantId", "runId", "preview"],
    },
    PayrollPaymentSyncApplyRequest: {
      type: "object",
      properties: {
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        note: { type: "string", maxLength: 500, nullable: true },
        allowB04OnlySettlement: { type: "boolean", nullable: true },
      },
    },
    PayrollPaymentSyncAppliedSummary: {
      type: "object",
      properties: {
        mark_partial_count: { type: "integer", minimum: 0 },
        mark_partial_amount: { type: "number" },
        mark_paid_count: { type: "integer", minimum: 0 },
        mark_paid_amount: { type: "number" },
        release_count: { type: "integer", minimum: 0 },
        release_amount: { type: "number" },
        exception_count: { type: "integer", minimum: 0 },
      },
      required: [
        "mark_partial_count",
        "mark_partial_amount",
        "mark_paid_count",
        "mark_paid_amount",
        "release_count",
        "release_amount",
        "exception_count",
      ],
    },
    PayrollPaymentSyncApplyResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        allow_b04_only_settlement: { type: "boolean" },
        preview_summary: { $ref: "#/components/schemas/PayrollPaymentSyncSummary" },
        preview_owner_context_summary: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentSyncOwnerContextSummaryRow" },
        },
        preview_mixed_owner_context: { type: "boolean" },
        applied: { $ref: "#/components/schemas/PayrollPaymentSyncAppliedSummary" },
      },
      required: [
        "tenantId",
        "runId",
        "run",
        "scope",
        "allow_b04_only_settlement",
        "preview_summary",
        "preview_owner_context_summary",
        "preview_mixed_owner_context",
        "applied",
      ],
    },
    PayrollManualSettlementCreateRequest: {
      type: "object",
      properties: {
        amount: {
          oneOf: [{ type: "number", minimum: 0, exclusiveMinimum: true }, { type: "string" }],
        },
        settledAt: { type: "string", nullable: true },
        reason: { type: "string", minLength: 1, maxLength: 500 },
        externalRef: { type: "string", maxLength: 190, nullable: true },
        idempotencyKey: { type: "string", maxLength: 190, nullable: true },
      },
      required: ["amount", "settledAt", "reason"],
    },
    PayrollManualSettlementDecisionRequest: {
      type: "object",
      properties: {
        decisionNote: { type: "string", maxLength: 500, nullable: true },
      },
    },
    PayrollManualSettlementLiabilityRow: {
      type: "object",
      properties: {
        id: intId,
        run_id: intId,
        legal_entity_id: intId,
        liability_type: { type: "string", nullable: true },
        liability_group: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        owner_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        beneficiary_name: { type: "string", nullable: true },
        amount: { type: "number" },
        currency_code: { ...currencyCode, nullable: true },
        status: { $ref: "#/components/schemas/PayrollLiabilityStatus" },
        settled_amount: { type: "number", nullable: true },
        outstanding_amount: { type: "number", nullable: true },
        payment_link_id: { ...intId, nullable: true },
        payment_batch_id: { ...intId, nullable: true },
        payment_batch_line_id: { ...intId, nullable: true },
        allocated_amount: { type: "number", nullable: true },
        link_status: { type: "string", nullable: true },
        link_settled_amount: { type: "number", nullable: true },
      },
      required: [
        "id",
        "run_id",
        "legal_entity_id",
        "ownership_scope",
        "owner_context_label",
        "owner_context",
        "amount",
        "currency_code",
        "status",
      ],
    },
    PayrollManualSettlementRequestRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        run_id: intId,
        payroll_liability_id: intId,
        payroll_liability_payment_link_id: { ...intId, nullable: true },
        request_type: { type: "string", nullable: true },
        requested_amount: { type: "number" },
        currency_code: { ...currencyCode, nullable: true },
        settled_at: { type: "string", nullable: true },
        reason: { type: "string", nullable: true },
        external_ref: { type: "string", nullable: true },
        status: { $ref: "#/components/schemas/PayrollManualSettlementStatus" },
        idempotency_key: { type: "string", nullable: true },
        requested_by_user_id: { ...intId, nullable: true },
        requested_at: { type: "string", nullable: true },
        approved_by_user_id: { ...intId, nullable: true },
        approved_at: { type: "string", nullable: true },
        rejected_by_user_id: { ...intId, nullable: true },
        rejected_at: { type: "string", nullable: true },
        decision_note: { type: "string", nullable: true },
        applied_settlement_id: { ...intId, nullable: true },
        created_at: { type: "string", nullable: true },
        updated_at: { type: "string", nullable: true },
        liability_type: { type: "string", nullable: true },
        liability_group: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        owner_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        beneficiary_name: { type: "string", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "run_id",
        "payroll_liability_id",
        "requested_amount",
        "currency_code",
        "status",
        "ownership_scope",
        "owner_context_label",
        "owner_context",
      ],
    },
    PayrollManualSettlementSettlementRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenant_id: { ...intId, nullable: true },
        legal_entity_id: { ...intId, nullable: true },
        settlement_key: { type: "string", nullable: true },
        run_id: { ...intId, nullable: true },
        payroll_liability_id: { ...intId, nullable: true },
        payroll_liability_payment_link_id: { ...intId, nullable: true },
        payment_batch_id: { ...intId, nullable: true },
        payment_batch_line_id: { ...intId, nullable: true },
        bank_statement_line_id: { ...intId, nullable: true },
        settlement_source: { type: "string", nullable: true },
        settled_amount: { type: "number", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        settled_at: { type: "string", nullable: true },
        payload_json: { $ref: "#/components/schemas/AnyObject" },
        created_by_user_id: { ...intId, nullable: true },
        created_at: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        owner_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
      },
      required: ["ownership_scope", "owner_context_label", "owner_context"],
    },
    PayrollManualSettlementListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        liabilityId: intId,
        liability: { $ref: "#/components/schemas/PayrollManualSettlementLiabilityRow" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollManualSettlementRequestRow" },
        },
      },
      required: ["tenantId", "liabilityId", "liability", "items"],
    },
    PayrollManualSettlementCreateResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        liabilityId: intId,
        request: { $ref: "#/components/schemas/PayrollManualSettlementRequestRow" },
        idempotent: { type: "boolean" },
      },
      required: ["tenantId", "liabilityId", "request", "idempotent"],
    },
    PayrollManualSettlementApproveResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        requestId: intId,
        request: { $ref: "#/components/schemas/PayrollManualSettlementRequestRow" },
        settlement: {
          allOf: [{ $ref: "#/components/schemas/PayrollManualSettlementSettlementRow" }],
          nullable: true,
        },
        approval_required: { type: "boolean", nullable: true },
        approval_request: { $ref: "#/components/schemas/AnyObject" },
        idempotent: { type: "boolean" },
      },
      required: ["tenantId", "requestId", "request", "idempotent"],
    },
    PayrollManualSettlementRejectResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        requestId: intId,
        request: { $ref: "#/components/schemas/PayrollManualSettlementRequestRow" },
        idempotent: { type: "boolean" },
      },
      required: ["tenantId", "requestId", "request", "idempotent"],
    },
  });

  const tenantIdQueryParam = queryParamInt(
    "tenantId",
    false,
    "Tenant identifier; optional if available in JWT"
  );

  paths["/api/v1/payments/batches"] = {
    get: {
      tags: ["Payments"],
      operationId: "listPaymentBatches",
      summary: "List payment batches",
      parameters: [
        tenantIdQueryParam,
        queryParamInt("legalEntityId", false, "Legal entity identifier"),
        queryParamInt("bankAccountId", false, "Bank account identifier"),
        queryParam(
          "status",
          { type: "string", enum: paymentBatchStatuses },
          false,
          "Payment batch status filter"
        ),
        queryParam(
          "sourceType",
          { type: "string", enum: paymentSourceTypes },
          false,
          "Source module filter"
        ),
        queryParamInt("sourceId", false, "Source record identifier"),
        queryParam("q", { type: "string" }, false, "Case-insensitive batch/bank search text"),
        queryParamInt("limit", false, "Maximum rows to return"),
        queryParam("offset", nonNegativeInt, false, "Row offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Payment batch list",
        "#/components/schemas/PaymentBatchListResponse"
      ),
    },
    post: {
      tags: ["Payments"],
      operationId: "createPaymentBatch",
      summary: "Create payment batch",
      requestBody: bodyFromRef("#/components/schemas/PaymentBatchCreateRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/PaymentBatchEnvelopeResponse",
          "Payment batch created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/payments/batches/{batchId}"] = {
    get: {
      tags: ["Payments"],
      operationId: "getPaymentBatch",
      summary: "Get payment batch detail",
      parameters: [
        pathParam("batchId", "Payment batch identifier"),
        tenantIdQueryParam,
      ],
      responses: withStandardResponses(
        "200",
        "Payment batch detail",
        "#/components/schemas/PaymentBatchEnvelopeResponse"
      ),
    },
  };

  paths["/api/v1/payments/batches/{batchId}/approve"] = {
    post: {
      tags: ["Payments"],
      operationId: "approvePaymentBatch",
      summary: "Approve payment batch",
      parameters: [pathParam("batchId", "Payment batch identifier")],
      requestBody: bodyFromRef("#/components/schemas/PayrollBuildLiabilitiesRequest", false),
      responses: withStandardResponses(
        "200",
        "Payment batch approved",
        "#/components/schemas/PaymentBatchEnvelopeResponse"
      ),
    },
  };

  paths["/api/v1/payments/batches/{batchId}/export"] = {
    post: {
      tags: ["Payments"],
      operationId: "exportPaymentBatch",
      summary: "Export payment batch",
      parameters: [pathParam("batchId", "Payment batch identifier")],
      requestBody: bodyFromRef("#/components/schemas/PaymentBatchExportRequest", false),
      responses: withStandardResponses(
        "200",
        "Payment batch exported",
        "#/components/schemas/PaymentBatchExportResponse"
      ),
    },
  };

  paths["/api/v1/payments/batches/{batchId}/post"] = {
    post: {
      tags: ["Payments"],
      operationId: "postPaymentBatch",
      summary: "Post payment batch settlement",
      parameters: [pathParam("batchId", "Payment batch identifier")],
      requestBody: bodyFromRef("#/components/schemas/PaymentBatchPostRequest", false),
      responses: withStandardResponses(
        "200",
        "Payment batch posted",
        "#/components/schemas/PaymentBatchEnvelopeResponse"
      ),
    },
  };

  paths["/api/v1/payments/batches/{batchId}/cancel"] = {
    post: {
      tags: ["Payments"],
      operationId: "cancelPaymentBatch",
      summary: "Cancel payment batch",
      parameters: [pathParam("batchId", "Payment batch identifier")],
      requestBody: bodyFromRef("#/components/schemas/PaymentBatchCancelRequest", false),
      responses: withStandardResponses(
        "200",
        "Payment batch cancelled",
        "#/components/schemas/PaymentBatchEnvelopeResponse"
      ),
    },
  };
}


function applyPayrollOperationOverrides(specObject) {
  ensureTagPresent(specObject, "Payroll");
  const paths = specObject.paths || {};
  const schemas = specObject.components?.schemas || {};

  const payrollOwnershipScopes = ["CENTRAL", "OPERATING_UNIT"];
  const payrollAssignmentStatuses = ["ACTIVE", "INACTIVE"];
  const payrollRunStatuses = ["DRAFT", "IMPORTED", "REVIEWED", "FINALIZED"];
  const payrollOwnershipResolutionStatuses = ["RESOLVED", "UNRESOLVED", "AMBIGUOUS", "MISMATCH"];
  const payrollLiabilityStatuses = ["OPEN", "IN_BATCH", "PARTIALLY_PAID", "PAID", "CANCELLED"];
  const payrollLiabilityTypes = [
    "NET_PAY",
    "EMPLOYEE_TAX",
    "EMPLOYEE_SOCIAL_SECURITY",
    "EMPLOYER_TAX",
    "EMPLOYER_SOCIAL_SECURITY",
    "OTHER_DEDUCTIONS",
  ];
  const payrollLiabilityScopeValues = ["NET_PAY", "STATUTORY", "ALL"];
  const payrollManualSettlementStatuses = ["REQUESTED", "APPLIED", "REJECTED"];
  const payrollPaymentSyncActions = [
    "MARK_PARTIAL",
    "MARK_PAID",
    "RELEASE_TO_OPEN",
    "EXCEPTION",
    "NOOP",
  ];

  Object.assign(schemas, {
    PayrollOwnershipScope: {
      type: "string",
      enum: payrollOwnershipScopes,
    },
    PayrollAssignmentStatus: {
      type: "string",
      enum: payrollAssignmentStatuses,
    },
    PayrollRunStatus: {
      type: "string",
      enum: payrollRunStatuses,
    },
    PayrollOwnershipResolutionStatus: {
      type: "string",
      enum: payrollOwnershipResolutionStatuses,
    },
    PayrollLiabilityStatus: {
      type: "string",
      enum: payrollLiabilityStatuses,
    },
    PayrollLiabilityType: {
      type: "string",
      enum: payrollLiabilityTypes,
    },
    PayrollLiabilityScopeParam: {
      type: "string",
      enum: payrollLiabilityScopeValues,
    },
    PayrollManualSettlementStatus: {
      type: "string",
      enum: payrollManualSettlementStatuses,
    },
    PayrollPaymentSyncAction: {
      type: "string",
      enum: payrollPaymentSyncActions,
    },
    PayrollOwnerContext: {
      type: "object",
      properties: {
        ownership_scope: {
          $ref: "#/components/schemas/PayrollOwnershipScope",
        },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
      },
      required: ["ownership_scope", "owner_context_label"],
    },
    PayrollOwnershipAssignmentRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        employeeCode: { type: "string", minLength: 1, maxLength: 100 },
        employeeNameSnapshot: { type: "string", maxLength: 255, nullable: true },
        ownershipScope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operatingUnitId: { ...intId, nullable: true },
        effectiveFrom: { type: "string", format: "date" },
        effectiveTo: { type: "string", format: "date", nullable: true },
        status: { $ref: "#/components/schemas/PayrollAssignmentStatus" },
        expectedCostCenterCode: { type: "string", maxLength: 100, nullable: true },
        sourceType: { type: "string", maxLength: 40, nullable: true },
        notes: { type: "string", maxLength: 500, nullable: true },
      },
      required: [
        "legalEntityId",
        "employeeCode",
        "ownershipScope",
        "effectiveFrom",
        "status",
      ],
    },
    PayrollOwnershipAssignmentPatchRequest: {
      type: "object",
      properties: {
        legalEntityId: intId,
        employeeCode: { type: "string", minLength: 1, maxLength: 100 },
        employeeNameSnapshot: { type: "string", maxLength: 255, nullable: true },
        ownershipScope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operatingUnitId: { ...intId, nullable: true },
        effectiveFrom: { type: "string", format: "date" },
        effectiveTo: { type: "string", format: "date", nullable: true },
        status: { $ref: "#/components/schemas/PayrollAssignmentStatus" },
        expectedCostCenterCode: { type: "string", maxLength: 100, nullable: true },
        sourceType: { type: "string", maxLength: 40, nullable: true },
        notes: { type: "string", maxLength: 500, nullable: true },
      },
    },
    PayrollOwnershipAssignmentRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        legal_entity_code: { type: "string", nullable: true },
        legal_entity_name: { type: "string", nullable: true },
        employee_code: { type: "string", nullable: true },
        employee_name_snapshot: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        effective_from: { type: "string", format: "date", nullable: true },
        effective_to: { type: "string", format: "date", nullable: true },
        status: { $ref: "#/components/schemas/PayrollAssignmentStatus" },
        expected_cost_center_code: { type: "string", nullable: true },
        source_type: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
        created_by_user_id: { ...intId, nullable: true },
        updated_by_user_id: { ...intId, nullable: true },
        deactivated_by_user_id: { ...intId, nullable: true },
        deactivated_at: { type: "string", nullable: true },
        created_at: { type: "string", nullable: true },
        updated_at: { type: "string", nullable: true },
        ownership_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "employee_code",
        "ownership_scope",
        "effective_from",
        "status",
        "ownership_context",
      ],
    },
    PayrollOwnershipAssignmentListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollOwnershipAssignmentRow" },
        },
        total: nonNegativeInt,
        limit: intId,
        offset: nonNegativeInt,
      },
      required: ["tenantId", "rows", "total", "limit", "offset"],
    },
    PayrollOwnershipAssignmentResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        assignmentId: { ...intId, nullable: true },
        legalEntityId: { ...intId, nullable: true },
        item: { $ref: "#/components/schemas/PayrollOwnershipAssignmentRow" },
        alreadyInactive: { type: "boolean", nullable: true },
      },
      required: ["tenantId", "item"],
    },
    PayrollRunRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        legal_entity_code: { type: "string", nullable: true },
        legal_entity_name: { type: "string", nullable: true },
        run_no: { type: "string", nullable: true },
        provider_code: { type: "string", nullable: true },
        entity_code: { type: "string", nullable: true },
        payroll_period: { type: "string", format: "date", nullable: true },
        pay_date: { type: "string", format: "date", nullable: true },
        ownership_as_of_date: { type: "string", format: "date", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        status: { $ref: "#/components/schemas/PayrollRunStatus" },
        source_type: { type: "string", nullable: true },
        source_provider_code: { type: "string", nullable: true },
        source_provider_import_job_id: { ...intId, nullable: true },
        run_type: { type: "string", nullable: true },
        correction_of_run_id: { ...intId, nullable: true },
        is_reversed: { type: "boolean", nullable: true },
        reversed_by_run_id: { ...intId, nullable: true },
        line_count_total: { type: "integer", minimum: 0, nullable: true },
        line_count_inserted: { type: "integer", minimum: 0, nullable: true },
        line_count_duplicates: { type: "integer", minimum: 0, nullable: true },
        employee_count: { type: "integer", minimum: 0, nullable: true },
        total_gross_pay: { type: "number", nullable: true },
        total_net_pay: { type: "number", nullable: true },
        total_employee_tax: { type: "number", nullable: true },
        total_employee_social_security: { type: "number", nullable: true },
        total_other_deductions: { type: "number", nullable: true },
        total_employer_tax: { type: "number", nullable: true },
        total_employer_social_security: { type: "number", nullable: true },
        accrual_journal_entry_id: { ...intId, nullable: true },
        reviewed_at: { type: "string", nullable: true },
        finalized_at: { type: "string", nullable: true },
        imported_at: { type: "string", nullable: true },
        liabilities_built_by_user_id: { ...intId, nullable: true },
        liabilities_built_at: { type: "string", nullable: true },
        payment_sync_last_preview_at: { type: "string", nullable: true },
        payment_sync_last_applied_at: { type: "string", nullable: true },
        created_at: { type: "string", nullable: true },
      },
      required: ["id", "tenant_id", "legal_entity_id", "currency_code", "status"],
    },
    PayrollRunLineRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        run_id: intId,
        line_no: { type: "integer", minimum: 1, nullable: true },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        cost_center_code: { type: "string", nullable: true },
        ownership_scope: {
          allOf: [{ $ref: "#/components/schemas/PayrollOwnershipScope" }],
          nullable: true,
        },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        ownership_assignment_id: { ...intId, nullable: true },
        ownership_resolution_status: {
          $ref: "#/components/schemas/PayrollOwnershipResolutionStatus",
        },
        ownership_resolution_note: { type: "string", nullable: true },
        base_salary: { type: "number", nullable: true },
        overtime_pay: { type: "number", nullable: true },
        bonus_pay: { type: "number", nullable: true },
        allowances_total: { type: "number", nullable: true },
        gross_pay: { type: "number", nullable: true },
        employee_tax: { type: "number", nullable: true },
        employee_social_security: { type: "number", nullable: true },
        other_deductions: { type: "number", nullable: true },
        net_pay: { type: "number", nullable: true },
        employer_tax: { type: "number", nullable: true },
        employer_social_security: { type: "number", nullable: true },
        line_hash: { type: "string", nullable: true },
        raw_row_json: { $ref: "#/components/schemas/AnyObject" },
        created_at: { type: "string", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "run_id",
        "line_no",
        "employee_code",
        "ownership_resolution_status",
      ],
    },
    PayrollRunOwnershipSummaryBreakdownRow: {
      type: "object",
      properties: {
        ownership_scope: {
          allOf: [{ $ref: "#/components/schemas/PayrollOwnershipScope" }],
          nullable: true,
        },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        line_count: { type: "integer", minimum: 0 },
        resolved_line_count: { type: "integer", minimum: 0 },
        mismatch_line_count: { type: "integer", minimum: 0 },
      },
      required: ["line_count", "resolved_line_count", "mismatch_line_count"],
    },
    PayrollRunOwnershipSummary: {
      type: "object",
      properties: {
        total_line_count: { type: "integer", minimum: 0 },
        resolved_line_count: { type: "integer", minimum: 0 },
        unresolved_line_count: { type: "integer", minimum: 0 },
        ambiguous_line_count: { type: "integer", minimum: 0 },
        mismatch_line_count: { type: "integer", minimum: 0 },
        owner_context_count: { type: "integer", minimum: 0 },
        mixed_ou_count: { type: "integer", minimum: 0 },
        has_mixed_owner_contexts: { type: "boolean" },
        breakdown: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollRunOwnershipSummaryBreakdownRow" },
        },
      },
      required: [
        "total_line_count",
        "resolved_line_count",
        "unresolved_line_count",
        "ambiguous_line_count",
        "mismatch_line_count",
        "owner_context_count",
        "mixed_ou_count",
        "has_mixed_owner_contexts",
        "breakdown",
      ],
    },
    PayrollAuditRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        run_id: intId,
        action: { type: "string", nullable: true },
        payload_json: { $ref: "#/components/schemas/AnyObject" },
        acted_by_user_id: { ...intId, nullable: true },
        acted_at: { type: "string", nullable: true },
      },
      required: ["id", "tenant_id", "legal_entity_id", "run_id"],
    },
    PayrollRunDetailRow: {
      allOf: [
        { $ref: "#/components/schemas/PayrollRunRow" },
        {
          type: "object",
          properties: {
            lines: {
              type: "array",
              items: { $ref: "#/components/schemas/PayrollRunLineRow" },
            },
            ownership_summary: {
              $ref: "#/components/schemas/PayrollRunOwnershipSummary",
            },
            audit: {
              type: "array",
              items: { $ref: "#/components/schemas/PayrollAuditRow" },
            },
          },
          required: ["lines", "ownership_summary", "audit"],
        },
      ],
    },
    PayrollRunListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollRunRow" },
        },
        total: nonNegativeInt,
        limit: intId,
        offset: nonNegativeInt,
      },
      required: ["tenantId", "rows", "total", "limit", "offset"],
    },
    PayrollRunEnvelopeResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        row: { $ref: "#/components/schemas/PayrollRunDetailRow" },
      },
      required: ["tenantId", "row"],
    },
    PayrollRunLinesResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollRunLineRow" },
        },
        total: nonNegativeInt,
        limit: intId,
        offset: nonNegativeInt,
      },
      required: ["tenantId", "runId", "rows", "total", "limit", "offset"],
    },
    PayrollRunImportRequest: {
      type: "object",
      properties: {
        legalEntityId: { ...intId, nullable: true },
        targetRunId: { ...intId, nullable: true },
        providerCode: { type: "string", minLength: 1, maxLength: 60 },
        payrollPeriod: { type: "string", format: "date" },
        payDate: { type: "string", format: "date" },
        currencyCode: currencyCode,
        sourceBatchRef: { type: "string", maxLength: 120, nullable: true },
        originalFilename: { type: "string", maxLength: 255, nullable: true },
        csvText: { type: "string", minLength: 1 },
      },
      required: ["providerCode", "payrollPeriod", "payDate", "currencyCode", "csvText"],
    },
    PayrollBuildLiabilitiesRequest: {
      type: "object",
      properties: {
        note: { type: "string", maxLength: 500, nullable: true },
      },
    },
    PayrollLiabilityRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        run_id: intId,
        liability_key: { type: "string", nullable: true },
        liability_type: { $ref: "#/components/schemas/PayrollLiabilityType" },
        liability_group: { type: "string", nullable: true },
        source_run_line_id: { ...intId, nullable: true },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        cost_center_code: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        beneficiary_type: { type: "string", nullable: true },
        beneficiary_id: { ...intId, nullable: true },
        beneficiary_name: { type: "string", nullable: true },
        beneficiary_bank_ref: { type: "string", nullable: true },
        payable_component_code: { type: "string", nullable: true },
        payable_gl_account_id: { ...intId, nullable: true },
        payable_gl_account_code: { type: "string", nullable: true },
        payable_gl_account_name: { type: "string", nullable: true },
        payable_ref: { type: "string", nullable: true },
        amount: { type: "number", nullable: true },
        settled_amount: { type: "number", nullable: true },
        outstanding_amount: { type: "number", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        status: { $ref: "#/components/schemas/PayrollLiabilityStatus" },
        reserved_payment_batch_id: { ...intId, nullable: true },
        paid_at: { type: "string", nullable: true },
        payment_link_id: { ...intId, nullable: true },
        beneficiary_bank_snapshot_id: { ...intId, nullable: true },
        beneficiary_snapshot_status: { type: "string", nullable: true },
        beneficiary_ready_for_payment: { type: "boolean", nullable: true },
        created_at: { type: "string", nullable: true },
        updated_at: { type: "string", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "run_id",
        "liability_type",
        "ownership_scope",
        "owner_context_label",
        "amount",
        "currency_code",
        "status",
      ],
    },
    PayrollLiabilityOwnerContextSummaryRow: {
      type: "object",
      properties: {
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        liability_count: { type: "integer", minimum: 0 },
        total_amount: { type: "number" },
        selected_bank_settlement_mode: { type: "string", nullable: true },
        selected_bank_allowed: { type: "boolean", nullable: true },
        selected_bank_requires_self_balancing: { type: "boolean", nullable: true },
      },
      required: ["ownership_scope", "owner_context_label", "liability_count", "total_amount"],
    },
    PayrollLiabilitySummary: {
      type: "object",
      properties: {
        total_count: { type: "integer", minimum: 0 },
        total_amount: { type: "number" },
        total_open: { type: "number" },
        total_in_batch: { type: "number" },
        total_partially_paid: { type: "number" },
        total_paid: { type: "number" },
        total_cancelled: { type: "number" },
        total_partially_paid_outstanding: { type: "number" },
        total_outstanding: { type: "number" },
        total_employee_net: { type: "number" },
        total_statutory: { type: "number" },
      },
      required: [
        "total_count",
        "total_amount",
        "total_open",
        "total_in_batch",
        "total_partially_paid",
        "total_paid",
        "total_cancelled",
        "total_partially_paid_outstanding",
        "total_outstanding",
        "total_employee_net",
        "total_statutory",
      ],
    },
    PayrollLiabilityListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        rows: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityRow" },
        },
        total: nonNegativeInt,
        limit: intId,
        offset: nonNegativeInt,
        pageMode: { type: "string", nullable: true },
        nextCursor: { type: "string", nullable: true },
      },
      required: ["tenantId", "rows", "total", "limit", "offset"],
    },
    PayrollRunLiabilitiesDetailResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityRow" },
        },
        summary: { $ref: "#/components/schemas/PayrollLiabilitySummary" },
        audit: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollAuditRow" },
        },
      },
      required: ["tenantId", "runId", "run", "items", "summary", "audit"],
    },
    PayrollRunLiabilitiesBuildResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityRow" },
        },
        summary: { $ref: "#/components/schemas/PayrollLiabilitySummary" },
        audit: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollAuditRow" },
        },
        alreadyBuilt: { type: "boolean" },
      },
      required: ["tenantId", "runId", "run", "items", "summary", "audit", "alreadyBuilt"],
    },
    PayrollSelectedBankAccountRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        operating_unit_id: { ...intId, nullable: true },
        code: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        is_active: { type: "boolean", nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        payer_context_scope: {
          type: "string",
          enum: payrollOwnershipScopes,
          nullable: true,
        },
        payer_context_label: { type: "string", nullable: true },
      },
      required: ["id", "tenant_id", "legal_entity_id", "payer_context_scope", "payer_context_label"],
    },
    PayrollPaymentPrepValidationError: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
    PayrollPaymentBatchPreviewSelectedBankEvaluation: {
      type: "object",
      properties: {
        bank_account_id: intId,
        payer_context_scope: {
          type: "string",
          enum: payrollOwnershipScopes,
          nullable: true,
        },
        payer_context_label: { type: "string", nullable: true },
        settlement_mode: {
          type: "string",
          enum: ["NONE", "NOT_ALLOWED", "SAME_CONTEXT", "CROSS_CONTEXT_SELF_BALANCING"],
        },
        mixed_owner_context: { type: "boolean" },
        same_context_liability_count: { type: "integer", minimum: 0 },
        cross_context_liability_count: { type: "integer", minimum: 0 },
        out_of_scope_liability_count: { type: "integer", minimum: 0 },
        requires_self_balancing: { type: "boolean" },
        can_prepare_payment_batch: { type: "boolean" },
        validation_errors: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentPrepValidationError" },
        },
      },
      required: [
        "bank_account_id",
        "payer_context_scope",
        "payer_context_label",
        "settlement_mode",
        "mixed_owner_context",
        "same_context_liability_count",
        "cross_context_liability_count",
        "out_of_scope_liability_count",
        "requires_self_balancing",
        "can_prepare_payment_batch",
        "validation_errors",
      ],
    },
    PayrollPaymentBatchPreviewLiabilityRow: {
      type: "object",
      properties: {
        id: intId,
        liability_type: { $ref: "#/components/schemas/PayrollLiabilityType" },
        liability_group: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        beneficiary_name: { type: "string", nullable: true },
        beneficiary_type: { type: "string", nullable: true },
        payable_gl_account_id: { ...intId, nullable: true },
        amount: { type: "number" },
        status: { type: "string", nullable: true },
        selected_bank_settlement_mode: { type: "string", nullable: true },
        selected_bank_allowed: { type: "boolean", nullable: true },
        selected_bank_requires_self_balancing: { type: "boolean", nullable: true },
      },
      required: ["id", "liability_type", "ownership_scope", "owner_context_label", "amount"],
    },
    PayrollPaymentBatchPayloadTemplate: {
      type: "object",
      properties: {
        sourceType: { type: "string", enum: ["PAYROLL"] },
        sourceId: intId,
        currencyCode: { ...currencyCode, nullable: true },
        lineCount: { type: "integer", minimum: 0 },
        totalAmount: { type: "number" },
        lines: {
          type: "array",
          items: { $ref: "#/components/schemas/PaymentBatchLineInput" },
        },
      },
      required: ["sourceType", "sourceId", "currencyCode", "lineCount", "totalAmount", "lines"],
    },
    PayrollPaymentBatchPreview: {
      type: "object",
      properties: {
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        eligible_liability_count: { type: "integer", minimum: 0 },
        total_amount: { type: "number" },
        can_prepare_payment_batch: { type: "boolean" },
        can_prepare_with_selected_bank: { type: "boolean", nullable: true },
        default_idempotency_key: { type: "string", nullable: true },
        selected_bank_account: {
          allOf: [{ $ref: "#/components/schemas/PayrollSelectedBankAccountRow" }],
          nullable: true,
        },
        owner_context_summary: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityOwnerContextSummaryRow" },
        },
        selected_bank_evaluation: {
          allOf: [{ $ref: "#/components/schemas/PayrollPaymentBatchPreviewSelectedBankEvaluation" }],
          nullable: true,
        },
        eligible_liabilities: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentBatchPreviewLiabilityRow" },
        },
        batch_payload_template: {
          $ref: "#/components/schemas/PayrollPaymentBatchPayloadTemplate",
        },
        summary: { $ref: "#/components/schemas/PayrollLiabilitySummary" },
      },
      required: [
        "run",
        "scope",
        "eligible_liability_count",
        "total_amount",
        "can_prepare_payment_batch",
        "default_idempotency_key",
        "owner_context_summary",
        "eligible_liabilities",
        "batch_payload_template",
        "summary",
      ],
    },
    PayrollPaymentBatchPreviewResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        preview: { $ref: "#/components/schemas/PayrollPaymentBatchPreview" },
      },
      required: ["tenantId", "runId", "preview"],
    },
    PayrollCreateRunPaymentBatchRequest: {
      type: "object",
      properties: {
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        bankAccountId: intId,
        idempotencyKey: { type: "string", maxLength: 120, nullable: true },
        notes: { type: "string", maxLength: 500, nullable: true },
      },
      required: ["bankAccountId"],
    },
    PayrollLiabilityCollection: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollLiabilityRow" },
        },
        summary: { $ref: "#/components/schemas/PayrollLiabilitySummary" },
        audit: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollAuditRow" },
        },
      },
      required: ["items", "summary", "audit"],
    },
    PayrollPaymentBatchLinkSummary: {
      type: "object",
      properties: {
        linkedCount: { type: "integer", minimum: 0, nullable: true },
        statusUpdatedCount: { type: "integer", minimum: 0, nullable: true },
        paymentBatchId: { ...intId, nullable: true },
        paymentBatchNo: { type: "string", nullable: true },
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        idempotencyKey: { type: "string", nullable: true },
      },
      required: ["scope"],
    },
    PayrollCreateRunPaymentBatchResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        liabilities: { $ref: "#/components/schemas/PayrollLiabilityCollection" },
        batch: { $ref: "#/components/schemas/PaymentBatchDetailRow" },
        preview_before_prepare: { $ref: "#/components/schemas/PayrollPaymentBatchPreview" },
        preview_after_prepare: { $ref: "#/components/schemas/PayrollPaymentBatchPreview" },
        linkSummary: { $ref: "#/components/schemas/PayrollPaymentBatchLinkSummary" },
      },
      required: [
        "tenantId",
        "runId",
        "run",
        "liabilities",
        "batch",
        "preview_before_prepare",
        "preview_after_prepare",
        "linkSummary",
      ],
    },
    PayrollPaymentSyncVerdict: {
      type: "object",
      properties: {
        action: { $ref: "#/components/schemas/PayrollPaymentSyncAction" },
        amount: { type: "number", nullable: true },
        deltaAmount: { type: "number", nullable: true },
        targetSettledAmount: { type: "number", nullable: true },
        currentSettledAmount: { type: "number", nullable: true },
        currentOutstandingAmount: { type: "number", nullable: true },
        settlementSource: { type: "string", nullable: true },
        bankStatementLineId: { ...intId, nullable: true },
        settledAt: { type: "string", nullable: true },
        reason: { type: "string", nullable: true },
      },
      required: ["action"],
    },
    PayrollPaymentSyncSummary: {
      type: "object",
      properties: {
        total_candidates: { type: "integer", minimum: 0 },
        mark_partial_count: { type: "integer", minimum: 0 },
        mark_partial_amount: { type: "number" },
        mark_paid_count: { type: "integer", minimum: 0 },
        mark_paid_amount: { type: "number" },
        release_count: { type: "integer", minimum: 0 },
        release_amount: { type: "number" },
        exception_count: { type: "integer", minimum: 0 },
        exception_amount: { type: "number" },
        noop_count: { type: "integer", minimum: 0 },
        noop_amount: { type: "number" },
      },
      required: [
        "total_candidates",
        "mark_partial_count",
        "mark_partial_amount",
        "mark_paid_count",
        "mark_paid_amount",
        "release_count",
        "release_amount",
        "exception_count",
        "exception_amount",
        "noop_count",
        "noop_amount",
      ],
    },
    PayrollPaymentSyncOwnerContextSummaryRow: {
      type: "object",
      properties: {
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        candidate_count: { type: "integer", minimum: 0 },
        total_liability_amount: { type: "number" },
        total_allocated_amount: { type: "number" },
        total_outstanding_amount: { type: "number" },
        mark_partial_count: { type: "integer", minimum: 0 },
        mark_partial_amount: { type: "number" },
        mark_paid_count: { type: "integer", minimum: 0 },
        mark_paid_amount: { type: "number" },
        release_count: { type: "integer", minimum: 0 },
        release_amount: { type: "number" },
        exception_count: { type: "integer", minimum: 0 },
        exception_amount: { type: "number" },
        noop_count: { type: "integer", minimum: 0 },
        noop_amount: { type: "number" },
      },
      required: [
        "ownership_scope",
        "owner_context_label",
        "candidate_count",
        "total_liability_amount",
        "total_allocated_amount",
        "total_outstanding_amount",
        "mark_partial_count",
        "mark_partial_amount",
        "mark_paid_count",
        "mark_paid_amount",
        "release_count",
        "release_amount",
        "exception_count",
        "exception_amount",
        "noop_count",
        "noop_amount",
      ],
    },
    PayrollPaymentSyncPreviewItem: {
      type: "object",
      properties: {
        payroll_liability_id: { ...intId, nullable: true },
        link_id: { ...intId, nullable: true },
        payment_batch_id: { ...intId, nullable: true },
        payment_batch_line_id: { ...intId, nullable: true },
        liability_type: { type: "string", nullable: true },
        liability_status: { type: "string", nullable: true },
        liability_amount: { type: "number", nullable: true },
        liability_settled_amount: { type: "number", nullable: true },
        liability_outstanding_amount: { type: "number", nullable: true },
        allocated_amount: { type: "number", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        owner_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
        verdict: { $ref: "#/components/schemas/PayrollPaymentSyncVerdict" },
      },
      required: ["ownership_scope", "owner_context_label", "owner_context", "verdict"],
    },
    PayrollPaymentSyncPreview: {
      type: "object",
      properties: {
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        allow_b04_only_settlement: { type: "boolean" },
        owner_context_summary: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentSyncOwnerContextSummaryRow" },
        },
        mixed_owner_context: { type: "boolean" },
        summary: { $ref: "#/components/schemas/PayrollPaymentSyncSummary" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentSyncPreviewItem" },
        },
      },
      required: [
        "run",
        "scope",
        "allow_b04_only_settlement",
        "owner_context_summary",
        "mixed_owner_context",
        "summary",
        "items",
      ],
    },
    PayrollPaymentSyncPreviewResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        preview: { $ref: "#/components/schemas/PayrollPaymentSyncPreview" },
      },
      required: ["tenantId", "runId", "preview"],
    },
    PayrollPaymentSyncApplyRequest: {
      type: "object",
      properties: {
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        note: { type: "string", maxLength: 500, nullable: true },
        allowB04OnlySettlement: { type: "boolean", nullable: true },
      },
    },
    PayrollPaymentSyncAppliedSummary: {
      type: "object",
      properties: {
        mark_partial_count: { type: "integer", minimum: 0 },
        mark_partial_amount: { type: "number" },
        mark_paid_count: { type: "integer", minimum: 0 },
        mark_paid_amount: { type: "number" },
        release_count: { type: "integer", minimum: 0 },
        release_amount: { type: "number" },
        exception_count: { type: "integer", minimum: 0 },
      },
      required: [
        "mark_partial_count",
        "mark_partial_amount",
        "mark_paid_count",
        "mark_paid_amount",
        "release_count",
        "release_amount",
        "exception_count",
      ],
    },
    PayrollPaymentSyncApplyResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        runId: intId,
        run: { $ref: "#/components/schemas/PayrollRunRow" },
        scope: { $ref: "#/components/schemas/PayrollLiabilityScopeParam" },
        allow_b04_only_settlement: { type: "boolean" },
        preview_summary: { $ref: "#/components/schemas/PayrollPaymentSyncSummary" },
        preview_owner_context_summary: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollPaymentSyncOwnerContextSummaryRow" },
        },
        preview_mixed_owner_context: { type: "boolean" },
        applied: { $ref: "#/components/schemas/PayrollPaymentSyncAppliedSummary" },
      },
      required: [
        "tenantId",
        "runId",
        "run",
        "scope",
        "allow_b04_only_settlement",
        "preview_summary",
        "preview_owner_context_summary",
        "preview_mixed_owner_context",
        "applied",
      ],
    },
    PayrollManualSettlementCreateRequest: {
      type: "object",
      properties: {
        amount: {
          oneOf: [{ type: "number", minimum: 0, exclusiveMinimum: true }, { type: "string" }],
        },
        settledAt: { type: "string", nullable: true },
        reason: { type: "string", minLength: 1, maxLength: 500 },
        externalRef: { type: "string", maxLength: 190, nullable: true },
        idempotencyKey: { type: "string", maxLength: 190, nullable: true },
      },
      required: ["amount", "settledAt", "reason"],
    },
    PayrollManualSettlementDecisionRequest: {
      type: "object",
      properties: {
        decisionNote: { type: "string", maxLength: 500, nullable: true },
      },
    },
    PayrollManualSettlementLiabilityRow: {
      type: "object",
      properties: {
        id: intId,
        run_id: intId,
        legal_entity_id: intId,
        liability_type: { type: "string", nullable: true },
        liability_group: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        owner_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        beneficiary_name: { type: "string", nullable: true },
        amount: { type: "number" },
        currency_code: { ...currencyCode, nullable: true },
        status: { $ref: "#/components/schemas/PayrollLiabilityStatus" },
        settled_amount: { type: "number", nullable: true },
        outstanding_amount: { type: "number", nullable: true },
        payment_link_id: { ...intId, nullable: true },
        payment_batch_id: { ...intId, nullable: true },
        payment_batch_line_id: { ...intId, nullable: true },
        allocated_amount: { type: "number", nullable: true },
        link_status: { type: "string", nullable: true },
        link_settled_amount: { type: "number", nullable: true },
      },
      required: [
        "id",
        "run_id",
        "legal_entity_id",
        "ownership_scope",
        "owner_context_label",
        "owner_context",
        "amount",
        "currency_code",
        "status",
      ],
    },
    PayrollManualSettlementRequestRow: {
      type: "object",
      properties: {
        id: intId,
        tenant_id: intId,
        legal_entity_id: intId,
        run_id: intId,
        payroll_liability_id: intId,
        payroll_liability_payment_link_id: { ...intId, nullable: true },
        request_type: { type: "string", nullable: true },
        requested_amount: { type: "number" },
        currency_code: { ...currencyCode, nullable: true },
        settled_at: { type: "string", nullable: true },
        reason: { type: "string", nullable: true },
        external_ref: { type: "string", nullable: true },
        status: { $ref: "#/components/schemas/PayrollManualSettlementStatus" },
        idempotency_key: { type: "string", nullable: true },
        requested_by_user_id: { ...intId, nullable: true },
        requested_at: { type: "string", nullable: true },
        approved_by_user_id: { ...intId, nullable: true },
        approved_at: { type: "string", nullable: true },
        rejected_by_user_id: { ...intId, nullable: true },
        rejected_at: { type: "string", nullable: true },
        decision_note: { type: "string", nullable: true },
        applied_settlement_id: { ...intId, nullable: true },
        created_at: { type: "string", nullable: true },
        updated_at: { type: "string", nullable: true },
        liability_type: { type: "string", nullable: true },
        liability_group: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        owner_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
        employee_code: { type: "string", nullable: true },
        employee_name: { type: "string", nullable: true },
        beneficiary_name: { type: "string", nullable: true },
      },
      required: [
        "id",
        "tenant_id",
        "legal_entity_id",
        "run_id",
        "payroll_liability_id",
        "requested_amount",
        "currency_code",
        "status",
        "ownership_scope",
        "owner_context_label",
        "owner_context",
      ],
    },
    PayrollManualSettlementSettlementRow: {
      type: "object",
      properties: {
        id: { ...intId, nullable: true },
        tenant_id: { ...intId, nullable: true },
        legal_entity_id: { ...intId, nullable: true },
        settlement_key: { type: "string", nullable: true },
        run_id: { ...intId, nullable: true },
        payroll_liability_id: { ...intId, nullable: true },
        payroll_liability_payment_link_id: { ...intId, nullable: true },
        payment_batch_id: { ...intId, nullable: true },
        payment_batch_line_id: { ...intId, nullable: true },
        bank_statement_line_id: { ...intId, nullable: true },
        settlement_source: { type: "string", nullable: true },
        settled_amount: { type: "number", nullable: true },
        currency_code: { ...currencyCode, nullable: true },
        settled_at: { type: "string", nullable: true },
        payload_json: { $ref: "#/components/schemas/AnyObject" },
        created_by_user_id: { ...intId, nullable: true },
        created_at: { type: "string", nullable: true },
        ownership_scope: { $ref: "#/components/schemas/PayrollOwnershipScope" },
        operating_unit_id: { ...intId, nullable: true },
        operating_unit_code: { type: "string", nullable: true },
        operating_unit_name: { type: "string", nullable: true },
        owner_context_label: { type: "string", nullable: true },
        owner_context: { $ref: "#/components/schemas/PayrollOwnerContext" },
      },
      required: ["ownership_scope", "owner_context_label", "owner_context"],
    },
    PayrollManualSettlementListResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        liabilityId: intId,
        liability: { $ref: "#/components/schemas/PayrollManualSettlementLiabilityRow" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/PayrollManualSettlementRequestRow" },
        },
      },
      required: ["tenantId", "liabilityId", "liability", "items"],
    },
    PayrollManualSettlementCreateResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        liabilityId: intId,
        request: { $ref: "#/components/schemas/PayrollManualSettlementRequestRow" },
        idempotent: { type: "boolean" },
      },
      required: ["tenantId", "liabilityId", "request", "idempotent"],
    },
    PayrollManualSettlementApproveResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        requestId: intId,
        request: { $ref: "#/components/schemas/PayrollManualSettlementRequestRow" },
        settlement: {
          allOf: [{ $ref: "#/components/schemas/PayrollManualSettlementSettlementRow" }],
          nullable: true,
        },
        approval_required: { type: "boolean", nullable: true },
        approval_request: { $ref: "#/components/schemas/AnyObject" },
        idempotent: { type: "boolean" },
      },
      required: ["tenantId", "requestId", "request", "idempotent"],
    },
    PayrollManualSettlementRejectResponse: {
      type: "object",
      properties: {
        tenantId: intId,
        requestId: intId,
        request: { $ref: "#/components/schemas/PayrollManualSettlementRequestRow" },
        idempotent: { type: "boolean" },
      },
      required: ["tenantId", "requestId", "request", "idempotent"],
    },
  });

  const tenantIdQueryParam = queryParamInt(
    "tenantId",
    false,
    "Tenant identifier; optional if available in JWT"
  );

  paths["/api/v1/payroll/ownership/assignments"] = {
    get: {
      tags: ["Payroll"],
      operationId: "listPayrollOwnershipAssignments",
      summary: "List payroll ownership assignments",
      parameters: [
        tenantIdQueryParam,
        queryParamInt("legalEntityId", false, "Legal entity identifier"),
        queryParam("employeeCode", { type: "string" }, false, "Normalized employee code"),
        queryParamInt("operatingUnitId", false, "Operating unit identifier"),
        queryParam(
          "status",
          { type: "string", enum: payrollAssignmentStatuses },
          false,
          "Assignment status filter"
        ),
        queryParam("q", { type: "string" }, false, "Case-insensitive assignment search text"),
        queryParamInt("limit", false, "Maximum rows to return"),
        queryParam("offset", nonNegativeInt, false, "Row offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Payroll ownership assignments",
        "#/components/schemas/PayrollOwnershipAssignmentListResponse"
      ),
    },
    post: {
      tags: ["Payroll"],
      operationId: "createPayrollOwnershipAssignment",
      summary: "Create payroll ownership assignment",
      requestBody: bodyFromRef("#/components/schemas/PayrollOwnershipAssignmentRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/PayrollOwnershipAssignmentResponse",
          "Payroll ownership assignment created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/payroll/ownership/assignments/{assignmentId}"] = {
    get: {
      tags: ["Payroll"],
      operationId: "getPayrollOwnershipAssignment",
      summary: "Get payroll ownership assignment",
      parameters: [
        pathParam("assignmentId", "Payroll ownership assignment identifier"),
        tenantIdQueryParam,
      ],
      responses: withStandardResponses(
        "200",
        "Payroll ownership assignment detail",
        "#/components/schemas/PayrollOwnershipAssignmentResponse"
      ),
    },
    patch: {
      tags: ["Payroll"],
      operationId: "updatePayrollOwnershipAssignment",
      summary: "Update payroll ownership assignment",
      parameters: [pathParam("assignmentId", "Payroll ownership assignment identifier")],
      requestBody: bodyFromRef("#/components/schemas/PayrollOwnershipAssignmentPatchRequest"),
      responses: withStandardResponses(
        "200",
        "Payroll ownership assignment updated",
        "#/components/schemas/PayrollOwnershipAssignmentResponse"
      ),
    },
  };

  paths["/api/v1/payroll/ownership/assignments/{assignmentId}/deactivate"] = {
    post: {
      tags: ["Payroll"],
      operationId: "deactivatePayrollOwnershipAssignment",
      summary: "Deactivate payroll ownership assignment",
      parameters: [pathParam("assignmentId", "Payroll ownership assignment identifier")],
      responses: withStandardResponses(
        "200",
        "Payroll ownership assignment deactivated",
        "#/components/schemas/PayrollOwnershipAssignmentResponse"
      ),
    },
  };

  paths["/api/v1/payroll/runs"] = {
    get: {
      tags: ["Payroll"],
      operationId: "listPayrollRuns",
      summary: "List payroll runs",
      parameters: [
        tenantIdQueryParam,
        queryParamInt("legalEntityId", false, "Legal entity identifier"),
        queryParam("entityCode", { type: "string" }, false, "Imported payroll entity code"),
        queryParam("providerCode", { type: "string" }, false, "Payroll provider code"),
        queryParam("payrollPeriod", { type: "string", format: "date" }, false, "Payroll period"),
        queryParam(
          "status",
          { type: "string", enum: payrollRunStatuses },
          false,
          "Payroll run status filter"
        ),
        queryParam("q", { type: "string" }, false, "Case-insensitive payroll run search text"),
        queryParamInt("limit", false, "Maximum rows to return"),
        queryParam("offset", nonNegativeInt, false, "Row offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Payroll run list",
        "#/components/schemas/PayrollRunListResponse"
      ),
    },
  };

  paths["/api/v1/payroll/runs/import"] = {
    post: {
      tags: ["Payroll"],
      operationId: "importPayrollRunCsv",
      summary: "Import payroll run CSV",
      requestBody: bodyFromRef("#/components/schemas/PayrollRunImportRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/PayrollRunEnvelopeResponse",
          "Payroll run imported"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/payroll/runs/{runId}"] = {
    get: {
      tags: ["Payroll"],
      operationId: "getPayrollRun",
      summary: "Get payroll run detail",
      parameters: [pathParam("runId", "Payroll run identifier"), tenantIdQueryParam],
      responses: withStandardResponses(
        "200",
        "Payroll run detail",
        "#/components/schemas/PayrollRunEnvelopeResponse"
      ),
    },
  };

  paths["/api/v1/payroll/runs/{runId}/lines"] = {
    get: {
      tags: ["Payroll"],
      operationId: "listPayrollRunLines",
      summary: "List payroll run lines",
      parameters: [
        pathParam("runId", "Payroll run identifier"),
        tenantIdQueryParam,
        queryParam("q", { type: "string" }, false, "Case-insensitive employee search text"),
        queryParam("costCenterCode", { type: "string" }, false, "Imported cost center code"),
        queryParamInt("operatingUnitId", false, "Resolved operating unit identifier"),
        queryParam(
          "ownershipResolutionStatus",
          { type: "string", enum: payrollOwnershipResolutionStatuses },
          false,
          "Ownership resolution status filter"
        ),
        queryParamInt("limit", false, "Maximum rows to return"),
        queryParam("offset", nonNegativeInt, false, "Row offset"),
      ],
      responses: withStandardResponses(
        "200",
        "Payroll run lines",
        "#/components/schemas/PayrollRunLinesResponse"
      ),
    },
  };

  paths["/api/v1/payroll/liabilities"] = {
    get: {
      tags: ["Payroll"],
      operationId: "listPayrollLiabilities",
      summary: "List payroll liabilities",
      parameters: [
        tenantIdQueryParam,
        queryParamInt("runId", false, "Payroll run identifier"),
        queryParamInt("legalEntityId", false, "Legal entity identifier"),
        queryParam(
          "status",
          { type: "string", enum: payrollLiabilityStatuses },
          false,
          "Liability status filter"
        ),
        queryParam(
          "liabilityType",
          { type: "string", enum: payrollLiabilityTypes },
          false,
          "Liability type filter"
        ),
        queryParam(
          "ownershipScope",
          { type: "string", enum: payrollOwnershipScopes },
          false,
          "Owner context scope filter"
        ),
        queryParamInt("operatingUnitId", false, "Owner context operating unit identifier"),
        queryParam(
          "scope",
          { type: "string", enum: payrollLiabilityScopeValues },
          false,
          "Liability scope filter"
        ),
        queryParam("q", { type: "string" }, false, "Case-insensitive liability search text"),
        queryParam("cursor", { type: "string" }, false, "Opaque pagination cursor"),
        queryParamInt("limit", false, "Maximum rows to return"),
        queryParam("offset", nonNegativeInt, false, "Offset when cursor is not used"),
      ],
      responses: withStandardResponses(
        "200",
        "Payroll liability list",
        "#/components/schemas/PayrollLiabilityListResponse"
      ),
    },
  };

  paths["/api/v1/payroll/runs/{runId}/liabilities/build"] = {
    post: {
      tags: ["Payroll"],
      operationId: "buildPayrollRunLiabilities",
      summary: "Build payroll run liabilities",
      parameters: [pathParam("runId", "Payroll run identifier")],
      requestBody: bodyFromRef("#/components/schemas/PayrollBuildLiabilitiesRequest", false),
      responses: withStandardResponses(
        "200",
        "Payroll run liabilities built",
        "#/components/schemas/PayrollRunLiabilitiesBuildResponse"
      ),
    },
  };

  paths["/api/v1/payroll/runs/{runId}/liabilities"] = {
    get: {
      tags: ["Payroll"],
      operationId: "getPayrollRunLiabilities",
      summary: "Get payroll run liabilities detail",
      parameters: [pathParam("runId", "Payroll run identifier"), tenantIdQueryParam],
      responses: withStandardResponses(
        "200",
        "Payroll run liabilities detail",
        "#/components/schemas/PayrollRunLiabilitiesDetailResponse"
      ),
    },
  };

  paths["/api/v1/payroll/runs/{runId}/payment-batch-preview"] = {
    get: {
      tags: ["Payroll"],
      operationId: "getPayrollRunPaymentBatchPreview",
      summary: "Preview payroll payment batch preparation",
      parameters: [
        pathParam("runId", "Payroll run identifier"),
        tenantIdQueryParam,
        queryParam(
          "scope",
          { type: "string", enum: payrollLiabilityScopeValues },
          false,
          "Liability scope to prepare"
        ),
        queryParamInt("bankAccountId", false, "Selected payer bank account identifier"),
      ],
      responses: withStandardResponses(
        "200",
        "Payroll payment batch preview",
        "#/components/schemas/PayrollPaymentBatchPreviewResponse"
      ),
    },
  };

  paths["/api/v1/payroll/runs/{runId}/payment-batches"] = {
    post: {
      tags: ["Payroll"],
      operationId: "createPayrollRunPaymentBatch",
      summary: "Create payroll payment batch from liabilities",
      parameters: [pathParam("runId", "Payroll run identifier")],
      requestBody: bodyFromRef("#/components/schemas/PayrollCreateRunPaymentBatchRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/PayrollCreateRunPaymentBatchResponse",
          "Payroll payment batch created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/payroll/runs/{runId}/payment-sync-preview"] = {
    get: {
      tags: ["Payroll"],
      operationId: "getPayrollRunPaymentSyncPreview",
      summary: "Preview payroll payment sync reconciliation",
      parameters: [
        pathParam("runId", "Payroll run identifier"),
        tenantIdQueryParam,
        queryParam(
          "scope",
          { type: "string", enum: payrollLiabilityScopeValues },
          false,
          "Sync scope"
        ),
        queryParam(
          "allowB04OnlySettlement",
          { type: "boolean" },
          false,
          "Allow payment-line paid status to settle without B03 bank evidence"
        ),
      ],
      responses: withStandardResponses(
        "200",
        "Payroll payment sync preview",
        "#/components/schemas/PayrollPaymentSyncPreviewResponse"
      ),
    },
  };

  paths["/api/v1/payroll/runs/{runId}/payment-sync-apply"] = {
    post: {
      tags: ["Payroll"],
      operationId: "applyPayrollRunPaymentSync",
      summary: "Apply payroll payment sync reconciliation",
      parameters: [pathParam("runId", "Payroll run identifier")],
      requestBody: bodyFromRef("#/components/schemas/PayrollPaymentSyncApplyRequest", false),
      responses: withStandardResponses(
        "200",
        "Payroll payment sync applied",
        "#/components/schemas/PayrollPaymentSyncApplyResponse"
      ),
    },
  };

  paths["/api/v1/payroll/liabilities/{liabilityId}/manual-settlement-requests"] = {
    get: {
      tags: ["Payroll"],
      operationId: "listPayrollManualSettlementRequests",
      summary: "List payroll manual settlement requests",
      parameters: [
        pathParam("liabilityId", "Payroll liability identifier"),
        tenantIdQueryParam,
      ],
      responses: withStandardResponses(
        "200",
        "Payroll manual settlement requests",
        "#/components/schemas/PayrollManualSettlementListResponse"
      ),
    },
    post: {
      tags: ["Payroll"],
      operationId: "createPayrollManualSettlementRequest",
      summary: "Create payroll manual settlement request",
      parameters: [pathParam("liabilityId", "Payroll liability identifier")],
      requestBody: bodyFromRef("#/components/schemas/PayrollManualSettlementCreateRequest"),
      responses: {
        "201": jsonResponse(
          "#/components/schemas/PayrollManualSettlementCreateResponse",
          "Payroll manual settlement request created"
        ),
        "400": errorResponseRef,
        "401": errorResponseRef,
        "403": errorResponseRef,
      },
    },
  };

  paths["/api/v1/payroll/manual-settlement-requests/{requestId}/approve-apply"] = {
    post: {
      tags: ["Payroll"],
      operationId: "approveApplyPayrollManualSettlementRequest",
      summary: "Approve and apply payroll manual settlement request",
      parameters: [pathParam("requestId", "Manual settlement request identifier")],
      requestBody: bodyFromRef("#/components/schemas/PayrollManualSettlementDecisionRequest", false),
      responses: withStandardResponses(
        "200",
        "Payroll manual settlement request approved/applied",
        "#/components/schemas/PayrollManualSettlementApproveResponse"
      ),
    },
  };

  paths["/api/v1/payroll/manual-settlement-requests/{requestId}/reject"] = {
    post: {
      tags: ["Payroll"],
      operationId: "rejectPayrollManualSettlementRequest",
      summary: "Reject payroll manual settlement request",
      parameters: [pathParam("requestId", "Manual settlement request identifier")],
      requestBody: bodyFromRef("#/components/schemas/PayrollManualSettlementDecisionRequest", false),
      responses: withStandardResponses(
        "200",
        "Payroll manual settlement request rejected",
        "#/components/schemas/PayrollManualSettlementRejectResponse"
      ),
    },
  };
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
    {
      name: "Inventory",
      description: "Warehouse, stock-link materialization, valuation, and inventory movement endpoints.",
    },
    {
      name: "Items",
      description: "Item-card master data endpoints used by CARI and inventory flows.",
    },
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
        summary: "List operating units with central current-account readiness",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
          queryParamInt("operatingUnitId", false, "Operating unit identifier"),
        ],
        responses: withStandardResponses(
          "200",
          "Operating unit list",
          "#/components/schemas/OperatingUnitListResponse"
        ),
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
    "/api/v1/org/operating-unit-partner-current-accounts": {
      get: {
        tags: ["Org"],
        operationId: "listOperatingUnitPartnerCurrentAccounts",
        summary: "List directional branch-pair current-account mappings",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
          queryParamInt("operatingUnitId", false, "Source operating unit identifier"),
          queryParamInt(
            "partnerOperatingUnitId",
            false,
            "Partner operating unit identifier"
          ),
        ],
        responses: withStandardResponses(
          "200",
          "Operating unit partner current-account mapping list",
          "#/components/schemas/OperatingUnitPartnerCurrentAccountListResponse"
        ),
      },
      post: {
        tags: ["Org"],
        operationId: "upsertOperatingUnitPartnerCurrentAccount",
        summary: "Create or update a directional branch-pair current-account mapping",
        requestBody: bodyFromRef(
          "#/components/schemas/OperatingUnitPartnerCurrentAccountInput"
        ),
        responses: {
          "201": createdResponseRef,
          "400": errorResponseRef,
          "401": errorResponseRef,
          "403": errorResponseRef,
        },
      },
    },
    "/api/v1/org/operating-unit-current-account-config": {
      get: {
        tags: ["Org"],
        operationId: "listOperatingUnitCurrentAccountConfigs",
        summary: "List saved legal-entity OU current-account configs",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("legalEntityId", false, "Legal entity identifier"),
        ],
        responses: withStandardResponses(
          "200",
          "Operating unit current-account config list",
          "#/components/schemas/OperatingUnitCurrentAccountConfigListResponse"
        ),
      },
      post: {
        tags: ["Org"],
        operationId: "upsertOperatingUnitCurrentAccountConfig",
        summary: "Create or update saved legal-entity OU current-account config",
        requestBody: bodyFromRef(
          "#/components/schemas/OperatingUnitCurrentAccountConfigInput"
        ),
        responses: withStandardResponses(
          "201",
          "Operating unit current-account config saved",
          "#/components/schemas/OperatingUnitCurrentAccountConfigResponse"
        ),
      },
    },
    "/api/v1/org/operating-unit-current-account-config/apply": {
      post: {
        tags: ["Org"],
        operationId: "applyOperatingUnitCurrentAccountConfig",
        summary: "Apply saved legal-entity OU current-account config",
        description:
          "Runs repair-missing-only provisioning from the saved legal-entity config for one legal entity or one selected operating unit.",
        requestBody: bodyFromRef(
          "#/components/schemas/OperatingUnitCurrentAccountConfigApplyInput"
        ),
        responses: withStandardResponses(
          "201",
          "Operating unit current-account config apply summary",
          "#/components/schemas/OperatingUnitCurrentAccountApplyResponse"
        ),
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
    "/api/v1/rbac/raw-audit-logs": {
      get: {
        tags: ["Security"],
        operationId: "listRawAuditLogs",
        summary: "List raw audit logs",
        parameters: [
          queryParamInt("tenantId", false, "Tenant identifier"),
          queryParamInt("page", false, "Page number"),
          queryParamInt("pageSize", false, "Page size"),
          queryParamInt("scopeId", false, "Scope identifier"),
          queryParamInt("userId", false, "Audit actor user identifier"),
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
            name: "resourceId",
            required: false,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "requestId",
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
        responses: withStandardResponses("200", "Raw audit log list"),
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
            name: "q",
            required: false,
            schema: { type: "string" },
            description: "Case-insensitive account code/name search text",
          },
          queryParamInt("limit", false, "Maximum rows to return"),
          queryParamInt("offset", false, "Row offset"),
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
        requestBody: bodyFromRef(
          "#/components/schemas/OnboardingCompanyBootstrapInput"
        ),
        responses: withStandardResponses(
          "201",
          "Company bootstrap result",
          "#/components/schemas/OnboardingCompanyBootstrapResponse"
        ),
      },
    },
    "/api/v1/onboarding/company-bootstrap/current-account-eligibility-preview": {
      post: {
        tags: ["Onboarding"],
        operationId: "previewCompanyBootstrapCurrentAccountEligibility",
        summary:
          "Preview OU current-account setup recommendation for onboarding draft legal entities",
        requestBody: bodyFromRef(
          "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewInput",
          false
        ),
        responses: withStandardResponses(
          "200",
          "Current-account eligibility preview",
          "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewResponse"
        ),
      },
    },
    "/api/v1/onboarding/readiness": {
      get: {
        tags: ["Onboarding"],
        operationId: "getTenantReadiness",
        summary: "Get tenant bootstrap readiness snapshot",
        parameters: [
          queryParamInt(
            "tenantId",
            false,
            "Tenant identifier; optional if available in JWT"
          ),
        ],
        responses: withStandardResponses(
          "200",
          "Tenant bootstrap readiness snapshot",
          "#/components/schemas/TenantReadinessResponse"
        ),
      },
    },
    "/api/v1/onboarding/module-readiness": {
      get: {
        tags: ["Onboarding"],
        operationId: "getModuleReadiness",
        summary: "Get module readiness snapshot by legal entity",
        parameters: [
          queryParamInt(
            "tenantId",
            false,
            "Tenant identifier; optional if available in JWT"
          ),
          queryParamInt(
            "legalEntityId",
            false,
            "Optional legal entity filter"
          ),
        ],
        responses: withStandardResponses(
          "200",
          "Module readiness snapshot",
          "#/components/schemas/ModuleReadinessResponse"
        ),
      },
    },
    "/api/v1/onboarding/legal-entity-activation": {
      get: {
        tags: ["Onboarding"],
        operationId: "getLegalEntityActivationReadiness",
        summary: "Get legal-entity activation readiness snapshot",
        parameters: [
          queryParamInt(
            "tenantId",
            false,
            "Tenant identifier; optional if available in JWT"
          ),
          queryParamInt(
            "legalEntityId",
            false,
            "Optional legal entity filter"
          ),
        ],
        responses: withStandardResponses(
          "200",
          "Legal-entity activation readiness snapshot",
          "#/components/schemas/LegalEntityActivationReadinessResponse"
        ),
      },
    },
    "/api/v1/onboarding/readiness/bootstrap-baseline": {
      post: {
        tags: ["Onboarding"],
        operationId: "bootstrapTenantReadinessBaseline",
        summary: "Create missing baseline setup for tenant bootstrap readiness",
        requestBody: bodyFromRef(
          "#/components/schemas/TenantReadinessBootstrapInput",
          false
        ),
        responses: withStandardResponses(
          "201",
          "Tenant bootstrap baseline result",
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
      CashRegisterOwnershipScope: {
        type: "string",
        description:
          "Explicit ownership scope for a cash register. CENTRAL keeps operating_unit_id empty and preserves the central/no-OU posting context.",
        enum: CASH_REGISTER_OWNERSHIP_SCOPES,
      },
      CashRegisterType: {
        type: "string",
        enum: CASH_REGISTER_TYPES,
      },
      CashSessionMode: {
        type: "string",
        enum: CASH_SESSION_MODES,
      },
      CashRegisterStatus: {
        type: "string",
        enum: CASH_REGISTER_STATUSES,
      },
      CashSessionStatus: {
        type: "string",
        enum: CASH_SESSION_STATUSES,
      },
      CashSessionCloseReason: {
        type: "string",
        enum: CASH_SESSION_CLOSE_REASONS,
      },
      CashTransactionType: {
        type: "string",
        enum: CASH_TRANSACTION_TYPES,
      },
      CashTransactionStatus: {
        type: "string",
        enum: CASH_TRANSACTION_STATUSES,
      },
      CashSourceDocType: {
        type: "string",
        enum: CASH_SOURCE_DOC_TYPES,
      },
      CashCounterpartyType: {
        type: "string",
        enum: CASH_COUNTERPARTY_TYPES,
      },
      CashSourceModule: {
        type: "string",
        enum: CASH_SOURCE_MODULES,
      },
      CashIntegrationLinkStatus: {
        type: "string",
        enum: CASH_INTEGRATION_LINK_STATUSES,
      },
      CashFxFallbackMode: {
        type: "string",
        enum: CASH_FX_FALLBACK_MODES,
      },
      CashTransitStatus: {
        type: "string",
        enum: CASH_TRANSIT_STATUSES,
      },
      CashRegisterRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          tenant_id: { ...intId, nullable: true },
          legal_entity_id: { ...intId, nullable: true },
          ownership_scope: { $ref: "#/components/schemas/CashRegisterOwnershipScope" },
          operating_unit_id: { ...intId, nullable: true },
          account_id: { ...intId, nullable: true },
          code: { type: "string", nullable: true },
          name: { type: "string", nullable: true },
          register_type: { $ref: "#/components/schemas/CashRegisterType" },
          session_mode: { $ref: "#/components/schemas/CashSessionMode" },
          currency_code: { type: "string", maxLength: 3, nullable: true },
          status: { $ref: "#/components/schemas/CashRegisterStatus" },
          allow_negative: { type: "boolean", nullable: true },
          variance_gain_account_id: { ...intId, nullable: true },
          variance_loss_account_id: { ...intId, nullable: true },
          max_txn_amount: { type: "number", nullable: true },
          requires_approval_over_amount: { type: "number", nullable: true },
          created_by_user_id: { ...intId, nullable: true },
          created_at: { type: "string", format: "date-time", nullable: true },
          updated_at: { type: "string", format: "date-time", nullable: true },
          legal_entity_code: { type: "string", nullable: true },
          legal_entity_name: { type: "string", nullable: true },
          operating_unit_code: { type: "string", nullable: true },
          operating_unit_name: { type: "string", nullable: true },
          ownership_context_label: {
            type: "string",
            description:
              "Operator-facing ownership label rendered as Central or OU code/name context.",
            nullable: true,
          },
          account_code: { type: "string", nullable: true },
          account_name: { type: "string", nullable: true },
          account_allow_posting: { type: "boolean", nullable: true },
          account_parent_account_id: { ...intId, nullable: true },
          account_is_active: { type: "boolean", nullable: true },
          account_is_cash_controlled: { type: "boolean", nullable: true },
          account_scope: { type: "string", nullable: true },
          account_legal_entity_id: { ...intId, nullable: true },
          variance_gain_account_code: { type: "string", nullable: true },
          variance_gain_account_name: { type: "string", nullable: true },
          variance_loss_account_code: { type: "string", nullable: true },
          variance_loss_account_name: { type: "string", nullable: true },
        },
      },
      CashRegisterListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/CashRegisterRow" },
          },
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
        },
        required: ["tenantId", "rows", "total", "limit", "offset"],
      },
      CashRegisterResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: {
            allOf: [{ $ref: "#/components/schemas/CashRegisterRow" }],
            nullable: true,
          },
        },
        required: ["tenantId", "row"],
      },
      CashRegisterUpsertRequest: {
        type: "object",
        description:
          "Create or update a cash register with explicit ownership scope. CENTRAL remains a central/no-OU posting context and OPERATING_UNIT requires an operating unit.",
        properties: {
          tenantId: { ...intId, nullable: true },
          id: { ...intId, nullable: true },
          legalEntityId: intId,
          ownershipScope: { $ref: "#/components/schemas/CashRegisterOwnershipScope" },
          operatingUnitId: {
            ...intId,
            nullable: true,
            description:
              "Must be empty for CENTRAL ownership and required for OPERATING_UNIT ownership.",
          },
          accountId: intId,
          code: { type: "string", maxLength: 60 },
          name: { type: "string", maxLength: 255 },
          registerType: {
            allOf: [{ $ref: "#/components/schemas/CashRegisterType" }],
            nullable: true,
          },
          sessionMode: {
            allOf: [{ $ref: "#/components/schemas/CashSessionMode" }],
            nullable: true,
          },
          currencyCode: currencyCode,
          status: {
            allOf: [{ $ref: "#/components/schemas/CashRegisterStatus" }],
            nullable: true,
          },
          allowNegative: { type: "boolean", nullable: true },
          varianceGainAccountId: { ...intId, nullable: true },
          varianceLossAccountId: { ...intId, nullable: true },
          maxTxnAmount: { type: "number", nullable: true },
          requiresApprovalOverAmount: { type: "number", nullable: true },
        },
        required: [
          "legalEntityId",
          "ownershipScope",
          "accountId",
          "code",
          "name",
          "currencyCode",
        ],
      },
      CashRegisterStatusUpdateRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          status: { $ref: "#/components/schemas/CashRegisterStatus" },
        },
        required: ["status"],
      },
      CashSessionRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          tenant_id: { ...intId, nullable: true },
          cash_register_id: { ...intId, nullable: true },
          status: { $ref: "#/components/schemas/CashSessionStatus" },
          opening_amount: { type: "number", nullable: true },
          expected_closing_amount: { type: "number", nullable: true },
          counted_closing_amount: { type: "number", nullable: true },
          variance_amount: { type: "number", nullable: true },
          opened_at: { type: "string", format: "date-time", nullable: true },
          opened_by_user_id: { ...intId, nullable: true },
          closed_at: { type: "string", format: "date-time", nullable: true },
          closed_by_user_id: { ...intId, nullable: true },
          closed_reason: {
            allOf: [{ $ref: "#/components/schemas/CashSessionCloseReason" }],
            nullable: true,
          },
          close_note: { type: "string", nullable: true },
          approved_by_user_id: { ...intId, nullable: true },
          approved_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time", nullable: true },
          updated_at: { type: "string", format: "date-time", nullable: true },
          legal_entity_id: { ...intId, nullable: true },
          ownership_scope: { $ref: "#/components/schemas/CashRegisterOwnershipScope" },
          operating_unit_id: { ...intId, nullable: true },
          register_account_id: { ...intId, nullable: true },
          variance_gain_account_id: { ...intId, nullable: true },
          variance_loss_account_id: { ...intId, nullable: true },
          requires_approval_over_amount: { type: "number", nullable: true },
          cash_register_code: { type: "string", nullable: true },
          cash_register_name: { type: "string", nullable: true },
          register_session_mode: { $ref: "#/components/schemas/CashSessionMode" },
          register_currency_code: { type: "string", maxLength: 3, nullable: true },
          register_status: { $ref: "#/components/schemas/CashRegisterStatus" },
          legal_entity_code: { type: "string", nullable: true },
          legal_entity_name: { type: "string", nullable: true },
          operating_unit_code: { type: "string", nullable: true },
          operating_unit_name: { type: "string", nullable: true },
          ownership_context_label: {
            type: "string",
            description: "Operator-facing ownership label rendered as Central or OU: <code>.",
            nullable: true,
          },
          opened_by_email: { type: "string", nullable: true },
          closed_by_email: { type: "string", nullable: true },
          approved_by_email: { type: "string", nullable: true },
        },
      },
      CashSessionListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/CashSessionRow" },
          },
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
        },
        required: ["tenantId", "rows", "total", "limit", "offset"],
      },
      CashSessionResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: {
            allOf: [{ $ref: "#/components/schemas/CashSessionRow" }],
            nullable: true,
          },
        },
        required: ["tenantId", "row"],
      },
      CashSessionOpenRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          registerId: intId,
          openingAmount: { type: "number", minimum: 0, nullable: true },
        },
        required: ["registerId"],
      },
      CashSessionCloseRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          countedClosingAmount: { type: "number", minimum: 0 },
          closedReason: {
            allOf: [{ $ref: "#/components/schemas/CashSessionCloseReason" }],
            nullable: true,
          },
          closeNote: { type: "string", maxLength: 500, nullable: true },
          approveVariance: { type: "boolean", nullable: true },
        },
        required: ["countedClosingAmount"],
      },
      CashTransactionRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          tenant_id: { ...intId, nullable: true },
          cash_register_id: { ...intId, nullable: true },
          cash_session_id: { ...intId, nullable: true },
          txn_no: { type: "string", nullable: true },
          txn_type: { $ref: "#/components/schemas/CashTransactionType" },
          status: { $ref: "#/components/schemas/CashTransactionStatus" },
          txn_datetime: { type: "string", format: "date-time", nullable: true },
          book_date: { type: "string", format: "date", nullable: true },
          amount: { type: "number", nullable: true },
          amount_base: { type: "number", nullable: true },
          currency_code: { type: "string", maxLength: 3, nullable: true },
          fx_rate: { type: "number", nullable: true },
          fx_rate_source: { type: "string", nullable: true },
          fx_rate_date: { type: "string", format: "date", nullable: true },
          fx_fallback_mode: {
            allOf: [{ $ref: "#/components/schemas/CashFxFallbackMode" }],
            nullable: true,
          },
          fx_fallback_max_days: { type: "integer", minimum: 0, nullable: true },
          description: { type: "string", nullable: true },
          reference_no: { type: "string", nullable: true },
          source_doc_type: {
            allOf: [{ $ref: "#/components/schemas/CashSourceDocType" }],
            nullable: true,
          },
          source_doc_id: { type: "string", nullable: true },
          source_module: {
            allOf: [{ $ref: "#/components/schemas/CashSourceModule" }],
            nullable: true,
          },
          source_entity_type: { type: "string", nullable: true },
          source_entity_id: { type: "string", nullable: true },
          integration_link_status: {
            allOf: [{ $ref: "#/components/schemas/CashIntegrationLinkStatus" }],
            nullable: true,
          },
          counterparty_type: {
            allOf: [{ $ref: "#/components/schemas/CashCounterpartyType" }],
            nullable: true,
          },
          counterparty_id: { ...intId, nullable: true },
          counter_account_id: { ...intId, nullable: true },
          counter_cash_register_id: { ...intId, nullable: true },
          linked_cari_settlement_batch_id: { ...intId, nullable: true },
          linked_cari_unapplied_cash_id: { ...intId, nullable: true },
          posted_journal_entry_id: { ...intId, nullable: true },
          reversal_of_transaction_id: { ...intId, nullable: true },
          cancel_reason: { type: "string", nullable: true },
          override_cash_control: { type: "boolean", nullable: true },
          override_reason: { type: "string", nullable: true },
          idempotency_key: { type: "string", nullable: true },
          integration_event_uid: { type: "string", nullable: true },
          created_by_user_id: { ...intId, nullable: true },
          submitted_by_user_id: { ...intId, nullable: true },
          approved_by_user_id: { ...intId, nullable: true },
          posted_by_user_id: { ...intId, nullable: true },
          reversed_by_user_id: { ...intId, nullable: true },
          cancelled_by_user_id: { ...intId, nullable: true },
          submitted_at: { type: "string", format: "date-time", nullable: true },
          approved_at: { type: "string", format: "date-time", nullable: true },
          posted_at: { type: "string", format: "date-time", nullable: true },
          reversed_at: { type: "string", format: "date-time", nullable: true },
          cancelled_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time", nullable: true },
          updated_at: { type: "string", format: "date-time", nullable: true },
          legal_entity_id: { ...intId, nullable: true },
          ownership_scope: { $ref: "#/components/schemas/CashRegisterOwnershipScope" },
          operating_unit_id: { ...intId, nullable: true },
          register_account_id: { ...intId, nullable: true },
          register_variance_gain_account_id: { ...intId, nullable: true },
          register_variance_loss_account_id: { ...intId, nullable: true },
          legal_entity_code: { type: "string", nullable: true },
          legal_entity_name: { type: "string", nullable: true },
          operating_unit_code: { type: "string", nullable: true },
          operating_unit_name: { type: "string", nullable: true },
          ownership_context_label: {
            type: "string",
            description: "Operator-facing ownership label rendered as Central or OU: <code>.",
            nullable: true,
          },
          cash_register_code: { type: "string", nullable: true },
          cash_register_name: { type: "string", nullable: true },
          register_session_mode: { $ref: "#/components/schemas/CashSessionMode" },
          register_currency_code: { type: "string", maxLength: 3, nullable: true },
          register_status: { $ref: "#/components/schemas/CashRegisterStatus" },
          cash_session_status: {
            allOf: [{ $ref: "#/components/schemas/CashSessionStatus" }],
            nullable: true,
          },
          counter_account_code: { type: "string", nullable: true },
          counter_account_name: { type: "string", nullable: true },
          counter_cash_register_id_resolved: { ...intId, nullable: true },
          counter_cash_register_legal_entity_id: { ...intId, nullable: true },
          counter_cash_register_ownership_scope: {
            allOf: [{ $ref: "#/components/schemas/CashRegisterOwnershipScope" }],
            nullable: true,
          },
          counter_cash_register_operating_unit_id: { ...intId, nullable: true },
          counter_cash_register_account_id: { ...intId, nullable: true },
          counter_cash_register_currency_code: {
            type: "string",
            maxLength: 3,
            nullable: true,
          },
          counter_cash_register_code: { type: "string", nullable: true },
          counter_cash_register_name: { type: "string", nullable: true },
          counter_cash_register_operating_unit_code: { type: "string", nullable: true },
          counter_cash_register_operating_unit_name: { type: "string", nullable: true },
          counter_cash_register_ownership_context_label: { type: "string", nullable: true },
          cash_transit_transfer_id: { ...intId, nullable: true },
          cash_transit_status: {
            allOf: [{ $ref: "#/components/schemas/CashTransitStatus" }],
            nullable: true,
          },
          cash_transit_source_register_id: { ...intId, nullable: true },
          cash_transit_target_register_id: { ...intId, nullable: true },
          cash_transit_transfer_out_transaction_id: { ...intId, nullable: true },
          cash_transit_transfer_in_transaction_id: { ...intId, nullable: true },
          cash_transit_initiated_at: { type: "string", format: "date-time", nullable: true },
          cash_transit_in_transit_at: { type: "string", format: "date-time", nullable: true },
          cash_transit_received_at: { type: "string", format: "date-time", nullable: true },
          cash_transit_canceled_at: { type: "string", format: "date-time", nullable: true },
          cash_transit_reversed_at: { type: "string", format: "date-time", nullable: true },
          cash_transit_cancel_reason: { type: "string", nullable: true },
          cash_transit_reverse_reason: { type: "string", nullable: true },
          cash_transit_note: { type: "string", nullable: true },
        },
      },
      CashTransactionListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/CashTransactionRow" },
          },
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
          hasMore: { type: "boolean" },
          pagination: { $ref: "#/components/schemas/OffsetPaginationMeta" },
        },
        required: ["tenantId", "rows", "total", "limit", "offset", "hasMore", "pagination"],
      },
      CashTransactionResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: {
            allOf: [{ $ref: "#/components/schemas/CashTransactionRow" }],
            nullable: true,
          },
        },
        required: ["tenantId", "row"],
      },
      CashTransactionMutationResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: {
            allOf: [{ $ref: "#/components/schemas/CashTransactionRow" }],
            nullable: true,
          },
          idempotentReplay: { type: "boolean" },
        },
        required: ["tenantId", "row", "idempotentReplay"],
      },
      CashTransactionReverseResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          original: {
            allOf: [{ $ref: "#/components/schemas/CashTransactionRow" }],
            nullable: true,
          },
          reversal: {
            allOf: [{ $ref: "#/components/schemas/CashTransactionRow" }],
            nullable: true,
          },
          idempotentReplay: { type: "boolean" },
        },
        required: ["tenantId", "original", "reversal", "idempotentReplay"],
      },
      CashTransactionCreateRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          registerId: intId,
          cashSessionId: { ...intId, nullable: true },
          txnType: { $ref: "#/components/schemas/CashTransactionType" },
          txnDatetime: { type: "string", format: "date-time", nullable: true },
          bookDate: { type: "string", format: "date", nullable: true },
          amount: positiveNumber(),
          amountBase: positiveNumber(true),
          currencyCode: currencyCode,
          fxRate: positiveNumber(true),
          fxRateSource: { type: "string", maxLength: 40, nullable: true },
          fxRateDate: { type: "string", format: "date", nullable: true },
          fxFallbackMode: {
            allOf: [{ $ref: "#/components/schemas/CashFxFallbackMode" }],
            nullable: true,
          },
          fxFallbackMaxDays: { type: "integer", minimum: 0, nullable: true },
          description: { type: "string", maxLength: 500, nullable: true },
          referenceNo: { type: "string", maxLength: 100, nullable: true },
          sourceDocType: {
            allOf: [{ $ref: "#/components/schemas/CashSourceDocType" }],
            nullable: true,
          },
          sourceDocId: { type: "string", maxLength: 80, nullable: true },
          counterpartyType: {
            allOf: [{ $ref: "#/components/schemas/CashCounterpartyType" }],
            nullable: true,
          },
          counterpartyId: { ...intId, nullable: true },
          counterAccountId: { ...intId, nullable: true },
          counterCashRegisterId: { ...intId, nullable: true },
          linkedCariSettlementBatchId: { ...intId, nullable: true },
          linkedCariUnappliedCashId: { ...intId, nullable: true },
          sourceModule: {
            allOf: [{ $ref: "#/components/schemas/CashSourceModule" }],
            nullable: true,
          },
          sourceEntityType: { type: "string", maxLength: 60, nullable: true },
          sourceEntityId: { type: "string", maxLength: 120, nullable: true },
          integrationLinkStatus: {
            allOf: [{ $ref: "#/components/schemas/CashIntegrationLinkStatus" }],
            nullable: true,
          },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
          idempotencyKey: { type: "string", maxLength: 100 },
        },
        required: ["registerId", "txnType", "amount", "currencyCode", "idempotencyKey"],
      },
      CashTransactionCancelRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          cancelReason: { type: "string", maxLength: 255 },
        },
        required: ["cancelReason"],
      },
      CashTransactionPostRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          overrideCashControl: { type: "boolean", nullable: true },
          overrideReason: {
            type: "string",
            maxLength: 500,
            nullable: true,
            description: "Required when overrideCashControl=true.",
          },
        },
      },
      CashTransactionReverseRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          reverseReason: { type: "string", maxLength: 255 },
        },
        required: ["reverseReason"],
      },
      CashExchangePostingMode: {
        type: "string",
        enum: ["CLEARING", "DIRECT"],
      },
      CashExchangeStatus: {
        type: "string",
        enum: ["DRAFT", "POSTED", "REVERSED", "CANCELLED"],
      },
      CashExchangeBatch: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          legalEntityId: { ...intId, nullable: true },
          legalEntityCode: { type: "string", nullable: true },
          sourceRegisterId: { ...intId, nullable: true },
          sourceRegisterCode: { type: "string", nullable: true },
          sourceRegisterName: { type: "string", nullable: true },
          sourceOperatingUnitId: { ...intId, nullable: true },
          targetRegisterId: { ...intId, nullable: true },
          targetRegisterCode: { type: "string", nullable: true },
          targetRegisterName: { type: "string", nullable: true },
          targetOperatingUnitId: { ...intId, nullable: true },
          sourceCurrencyCode: { type: "string", maxLength: 3, nullable: true },
          targetCurrencyCode: { type: "string", maxLength: 3, nullable: true },
          sourceAmountTxn: { type: "number", nullable: true },
          targetAmountTxn: { type: "number", nullable: true },
          sourceAmountBase: { type: "number", nullable: true },
          targetAmountBase: { type: "number", nullable: true },
          realizedFxBase: { type: "number", nullable: true },
          reversalRealizedFxBase: { type: "number", nullable: true },
          feeAmountTxn: { type: "number", nullable: true },
          feeAmountBase: { type: "number", nullable: true },
          clearingAccountId: { ...intId, nullable: true },
          clearingAccountCode: { type: "string", nullable: true },
          clearingAccountName: { type: "string", nullable: true },
          postingMode: { $ref: "#/components/schemas/CashExchangePostingMode" },
          feeAccountId: { ...intId, nullable: true },
          feeAccountCode: { type: "string", nullable: true },
          feeAccountName: { type: "string", nullable: true },
          fxRate: { type: "number", nullable: true },
          fxRateSource: { type: "string", nullable: true },
          fxRateDate: { type: "string", format: "date", nullable: true },
          providerRef: { type: "string", nullable: true },
          spreadReferenceRate: { type: "number", nullable: true },
          spreadRateDelta: { type: "number", nullable: true },
          spreadAmountBase: { type: "number", nullable: true },
          status: { $ref: "#/components/schemas/CashExchangeStatus" },
          exchangeOutCashTransactionId: { ...intId, nullable: true },
          exchangeInCashTransactionId: { ...intId, nullable: true },
          feeCashTransactionId: { ...intId, nullable: true },
          reversalOutCashTransactionId: { ...intId, nullable: true },
          reversalInCashTransactionId: { ...intId, nullable: true },
          reversalFeeCashTransactionId: { ...intId, nullable: true },
          postedByUserId: { ...intId, nullable: true },
          reversedByUserId: { ...intId, nullable: true },
          postedAt: { type: "string", format: "date-time", nullable: true },
          reversedAt: { type: "string", format: "date-time", nullable: true },
          reverseReason: { type: "string", nullable: true },
          idempotencyKey: { type: "string", nullable: true },
          integrationEventUid: { type: "string", nullable: true },
          note: { type: "string", nullable: true },
          createdByUserId: { ...intId, nullable: true },
          createdAt: { type: "string", format: "date-time", nullable: true },
          updatedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      CashExchangeTransaction: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          txnNo: { type: "string", nullable: true },
          txnType: { type: "string", nullable: true },
          status: { type: "string", nullable: true },
          legalEntityId: { ...intId, nullable: true },
          cashRegisterId: { ...intId, nullable: true },
          cashSessionId: { ...intId, nullable: true },
          operatingUnitId: { ...intId, nullable: true },
          currencyCode: { type: "string", maxLength: 3, nullable: true },
          amount: { type: "number", nullable: true },
          amountBase: { type: "number", nullable: true },
          counterAccountId: { ...intId, nullable: true },
          counterCashRegisterId: { ...intId, nullable: true },
          postedJournalEntryId: { ...intId, nullable: true },
          reversalOfTransactionId: { ...intId, nullable: true },
          txnDatetime: { type: "string", format: "date-time", nullable: true },
          bookDate: { type: "string", format: "date", nullable: true },
          description: { type: "string", nullable: true },
          referenceNo: { type: "string", nullable: true },
        },
      },
      CashFxLotMovementSummary: {
        type: "object",
        properties: {
          movementCount: nonNegativeInt,
          totalInTxn: { type: "number", nullable: true },
          totalOutTxn: { type: "number", nullable: true },
          totalMovementBase: { type: "number", nullable: true },
          totalCarryingBase: { type: "number", nullable: true },
          realizedFxBase: { type: "number", nullable: true },
        },
        required: [
          "movementCount",
          "totalInTxn",
          "totalOutTxn",
          "totalMovementBase",
          "totalCarryingBase",
          "realizedFxBase",
        ],
      },
      CashExchangeFxLotEnvelope: {
        type: "object",
        properties: {
          exchangeOut: {
            allOf: [{ $ref: "#/components/schemas/CashFxLotMovementSummary" }],
            nullable: true,
          },
          exchangeIn: {
            allOf: [{ $ref: "#/components/schemas/CashFxLotMovementSummary" }],
            nullable: true,
          },
          fee: {
            allOf: [{ $ref: "#/components/schemas/CashFxLotMovementSummary" }],
            nullable: true,
          },
          reversalOut: {
            allOf: [{ $ref: "#/components/schemas/CashFxLotMovementSummary" }],
            nullable: true,
          },
          reversalIn: {
            allOf: [{ $ref: "#/components/schemas/CashFxLotMovementSummary" }],
            nullable: true,
          },
          reversalFee: {
            allOf: [{ $ref: "#/components/schemas/CashFxLotMovementSummary" }],
            nullable: true,
          },
        },
      },
      OffsetPaginationMeta: {
        type: "object",
        properties: {
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
          rowCount: nonNegativeInt,
          hasMore: { type: "boolean" },
          nextOffset: { ...nonNegativeInt, nullable: true },
        },
        required: ["total", "limit", "offset", "rowCount", "hasMore", "nextOffset"],
      },
      CashExchangeListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/CashExchangeBatch" },
          },
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
          hasMore: { type: "boolean" },
          pagination: { $ref: "#/components/schemas/OffsetPaginationMeta" },
        },
        required: ["tenantId", "rows", "total", "limit", "offset", "hasMore", "pagination"],
      },
      CashExchangeEnvelope: {
        type: "object",
        properties: {
          tenantId: intId,
          batch: {
            allOf: [{ $ref: "#/components/schemas/CashExchangeBatch" }],
            nullable: true,
          },
          exchangeOutTransaction: {
            allOf: [{ $ref: "#/components/schemas/CashExchangeTransaction" }],
            nullable: true,
          },
          exchangeInTransaction: {
            allOf: [{ $ref: "#/components/schemas/CashExchangeTransaction" }],
            nullable: true,
          },
          feeTransaction: {
            allOf: [{ $ref: "#/components/schemas/CashExchangeTransaction" }],
            nullable: true,
          },
          reversalOutTransaction: {
            allOf: [{ $ref: "#/components/schemas/CashExchangeTransaction" }],
            nullable: true,
          },
          reversalInTransaction: {
            allOf: [{ $ref: "#/components/schemas/CashExchangeTransaction" }],
            nullable: true,
          },
          reversalFeeTransaction: {
            allOf: [{ $ref: "#/components/schemas/CashExchangeTransaction" }],
            nullable: true,
          },
          fxLot: {
            allOf: [{ $ref: "#/components/schemas/CashExchangeFxLotEnvelope" }],
            nullable: true,
          },
          idempotentReplay: { type: "boolean" },
        },
        required: ["tenantId", "idempotentReplay"],
      },
      CashExchangeCreateRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          postingMode: { $ref: "#/components/schemas/CashExchangePostingMode" },
          sourceRegisterId: intId,
          targetRegisterId: intId,
          sourceCashSessionId: { ...intId, nullable: true },
          targetCashSessionId: { ...intId, nullable: true },
          clearingAccountId: {
            ...intId,
            nullable: true,
            description:
              "Required for CLEARING mode when no CASH_EXCHANGE_CLEARING mapping is available. Must be omitted in DIRECT mode.",
          },
          txnDatetime: { type: "string", format: "date-time", nullable: true },
          bookDate: { type: "string", format: "date", nullable: true },
          sourceAmountTxn: positiveNumber(),
          targetAmountTxn: positiveNumber(),
          feeAmountTxn: positiveNumber(true),
          feeAmountBase: positiveNumber(true),
          feeAccountId: {
            ...intId,
            nullable: true,
            description: "Required when feeAmountTxn is provided.",
          },
          fxRate: positiveNumber(true),
          fxRateSource: { type: "string", maxLength: 40, nullable: true },
          fxRateDate: { type: "string", format: "date", nullable: true },
          providerRef: { type: "string", maxLength: 120, nullable: true },
          spreadReferenceRate: positiveNumber(true),
          spreadRateDelta: { type: "number", nullable: true },
          spreadAmountBase: positiveNumber(true),
          description: { type: "string", maxLength: 500, nullable: true },
          referenceNo: { type: "string", maxLength: 100, nullable: true },
          note: { type: "string", maxLength: 500, nullable: true },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
          idempotencyKey: { type: "string", maxLength: 100 },
        },
        required: [
          "sourceRegisterId",
          "targetRegisterId",
          "sourceAmountTxn",
          "targetAmountTxn",
          "idempotencyKey",
        ],
      },
      CashExchangePostRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          sourceCashSessionId: { ...intId, nullable: true },
          targetCashSessionId: { ...intId, nullable: true },
          txnDatetime: { type: "string", format: "date-time", nullable: true },
          bookDate: { type: "string", format: "date", nullable: true },
        },
      },
      CashExchangeReverseRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          reverseReason: { type: "string", maxLength: 255 },
        },
        required: ["reverseReason"],
      },
      CashTransactionApplyCariApplicationInput: {
        oneOf: [
          {
            type: "object",
            properties: {
              openItemId: intId,
              amountTxn: positiveNumber(),
            },
            required: ["openItemId", "amountTxn"],
          },
          {
            type: "object",
            properties: {
              openItemId: intId,
              amount: positiveNumber(),
            },
            required: ["openItemId", "amount"],
          },
          {
            type: "object",
            properties: {
              cariDocumentId: intId,
              amountTxn: positiveNumber(),
            },
            required: ["cariDocumentId", "amountTxn"],
          },
          {
            type: "object",
            properties: {
              cariDocumentId: intId,
              amount: positiveNumber(),
            },
            required: ["cariDocumentId", "amount"],
          },
        ],
      },
      CashTransactionApplyCariRequest: {
        type: "object",
        properties: {
          settlementDate: { type: "string", format: "date", nullable: true },
          idempotencyKey: { type: "string", maxLength: 100 },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
          autoAllocate: { type: "boolean", default: false },
          useUnappliedCash: { type: "boolean", default: true },
          note: { type: "string", maxLength: 500, nullable: true },
          fxRate: positiveNumber(true),
          applications: {
            type: "array",
            items: { $ref: "#/components/schemas/CashTransactionApplyCariApplicationInput" },
          },
        },
        required: ["idempotencyKey"],
      },
      CashTransactionApplyCariFxSummary: {
        type: "object",
        properties: {
          settlementFxRate: { type: "number", nullable: true },
          settlementFxSource: { type: "string", nullable: true },
          settlementFxFallbackMode: {
            type: "string",
            enum: ["EXACT_ONLY", "PRIOR_DATE"],
            nullable: true,
          },
          settlementFxFallbackMaxDays: { type: "integer", minimum: 0, nullable: true },
          fxRateDate: { type: "string", format: "date", nullable: true },
          realizedGainLossBase: { type: "number", nullable: true },
        },
        required: [
          "settlementFxRate",
          "settlementFxSource",
          "settlementFxFallbackMode",
          "settlementFxFallbackMaxDays",
          "fxRateDate",
          "realizedGainLossBase",
        ],
      },
      CashTransactionApplyCariUnappliedConsumedRow: {
        type: "object",
        properties: {
          unappliedCashId: { ...intId, nullable: true },
          consumeTxn: { type: "number", nullable: true },
          consumeBase: { type: "number", nullable: true },
        },
        required: ["unappliedCashId", "consumeTxn", "consumeBase"],
      },
      CashTransactionApplyCariUnappliedSummary: {
        type: "object",
        properties: {
          createdUnappliedCashId: { ...intId, nullable: true },
          consumed: {
            type: "array",
            items: { $ref: "#/components/schemas/CashTransactionApplyCariUnappliedConsumedRow" },
          },
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/AnyObject" },
          },
        },
        required: ["createdUnappliedCashId", "consumed", "rows"],
      },
      CashTransactionApplyCariResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          cashTransaction: { type: "object", additionalProperties: true, nullable: true },
          row: { type: "object", additionalProperties: true, nullable: true },
          allocations: { type: "array", items: { $ref: "#/components/schemas/AnyObject" } },
          journal: { type: "object", additionalProperties: true, nullable: true },
          fx: { $ref: "#/components/schemas/CashTransactionApplyCariFxSummary" },
          unapplied: { $ref: "#/components/schemas/CashTransactionApplyCariUnappliedSummary" },
          unappliedCash: { type: "array", items: { $ref: "#/components/schemas/AnyObject" } },
          metrics: { type: "object", additionalProperties: true, nullable: true },
          idempotentReplay: { type: "boolean" },
          followUpRisks: { type: "array", items: { type: "string" } },
        },
        required: [
          "tenantId",
          "cashTransaction",
          "row",
          "allocations",
          "journal",
          "fx",
          "unapplied",
          "unappliedCash",
          "metrics",
          "idempotentReplay",
          "followUpRisks",
        ],
      },
      CashTransitTransferInitiateRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          registerId: intId,
          targetRegisterId: intId,
          cashSessionId: { ...intId, nullable: true },
          txnDatetime: { type: "string", format: "date-time", nullable: true },
          bookDate: { type: "string", format: "date", nullable: true },
          amount: positiveNumber(),
          currencyCode,
          description: { type: "string", maxLength: 500, nullable: true },
          referenceNo: { type: "string", maxLength: 100, nullable: true },
          note: { type: "string", maxLength: 500, nullable: true },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
          idempotencyKey: { type: "string", maxLength: 100 },
        },
        required: [
          "registerId",
          "targetRegisterId",
          "amount",
          "currencyCode",
          "idempotencyKey",
        ],
      },
      CashTransitTransferReceiveRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          cashSessionId: { ...intId, nullable: true },
          txnDatetime: { type: "string", format: "date-time", nullable: true },
          bookDate: { type: "string", format: "date", nullable: true },
          description: { type: "string", maxLength: 500, nullable: true },
          referenceNo: { type: "string", maxLength: 100, nullable: true },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
          idempotencyKey: { type: "string", maxLength: 100 },
        },
        required: ["idempotencyKey"],
      },
      CashTransitTransferCancelRequest: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          cancelReason: { type: "string", maxLength: 255 },
        },
        required: ["cancelReason"],
      },
      CashTransitTransferRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          tenant_id: { ...intId, nullable: true },
          legal_entity_id: { ...intId, nullable: true },
          source_cash_register_id: { ...intId, nullable: true },
          target_cash_register_id: { ...intId, nullable: true },
          source_operating_unit_id: { ...intId, nullable: true },
          target_operating_unit_id: { ...intId, nullable: true },
          transfer_out_cash_transaction_id: { ...intId, nullable: true },
          transfer_in_cash_transaction_id: { ...intId, nullable: true },
          status: { $ref: "#/components/schemas/CashTransitStatus" },
          amount: { type: "number", nullable: true },
          currency_code: { type: "string", maxLength: 3, nullable: true },
          initiated_by_user_id: { ...intId, nullable: true },
          received_by_user_id: { ...intId, nullable: true },
          canceled_by_user_id: { ...intId, nullable: true },
          reversed_by_user_id: { ...intId, nullable: true },
          initiated_at: { type: "string", format: "date-time", nullable: true },
          in_transit_at: { type: "string", format: "date-time", nullable: true },
          received_at: { type: "string", format: "date-time", nullable: true },
          canceled_at: { type: "string", format: "date-time", nullable: true },
          reversed_at: { type: "string", format: "date-time", nullable: true },
          cancel_reason: { type: "string", nullable: true },
          reverse_reason: { type: "string", nullable: true },
          idempotency_key: { type: "string", nullable: true },
          integration_event_uid: { type: "string", nullable: true },
          source_module: {
            allOf: [{ $ref: "#/components/schemas/CashSourceModule" }],
            nullable: true,
          },
          source_entity_type: { type: "string", nullable: true },
          source_entity_id: { type: "string", nullable: true },
          note: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time", nullable: true },
          updated_at: { type: "string", format: "date-time", nullable: true },
          legal_entity_code: { type: "string", nullable: true },
          legal_entity_name: { type: "string", nullable: true },
          source_cash_register_code: { type: "string", nullable: true },
          source_cash_register_name: { type: "string", nullable: true },
          source_cash_register_ownership_scope: {
            allOf: [{ $ref: "#/components/schemas/CashRegisterOwnershipScope" }],
            nullable: true,
          },
          source_operating_unit_code: { type: "string", nullable: true },
          source_operating_unit_name: { type: "string", nullable: true },
          source_ownership_context_label: { type: "string", nullable: true },
          target_cash_register_code: { type: "string", nullable: true },
          target_cash_register_name: { type: "string", nullable: true },
          target_cash_register_ownership_scope: {
            allOf: [{ $ref: "#/components/schemas/CashRegisterOwnershipScope" }],
            nullable: true,
          },
          target_operating_unit_code: { type: "string", nullable: true },
          target_operating_unit_name: { type: "string", nullable: true },
          target_ownership_context_label: { type: "string", nullable: true },
          transfer_out_txn_no: { type: "string", nullable: true },
          transfer_out_book_date: { type: "string", format: "date", nullable: true },
          transfer_out_posted_at: { type: "string", format: "date-time", nullable: true },
          transfer_out_txn_status: {
            allOf: [{ $ref: "#/components/schemas/CashTransactionStatus" }],
            nullable: true,
          },
          transfer_out_posted_journal_entry_id: { ...intId, nullable: true },
          transfer_in_txn_no: { type: "string", nullable: true },
          transfer_in_book_date: { type: "string", format: "date", nullable: true },
          transfer_in_posted_at: { type: "string", format: "date-time", nullable: true },
          transfer_in_txn_status: {
            allOf: [{ $ref: "#/components/schemas/CashTransactionStatus" }],
            nullable: true,
          },
          transfer_in_posted_journal_entry_id: { ...intId, nullable: true },
        },
      },
      CashTransitTransferResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          transfer: {
            allOf: [{ $ref: "#/components/schemas/CashTransitTransferRow" }],
            nullable: true,
          },
          transferOutTransaction: {
            allOf: [{ $ref: "#/components/schemas/CashTransactionRow" }],
            nullable: true,
          },
          transferInTransaction: {
            allOf: [{ $ref: "#/components/schemas/CashTransactionRow" }],
            nullable: true,
          },
          idempotentReplay: { type: "boolean" },
        },
        required: [
          "tenantId",
          "transfer",
          "transferOutTransaction",
          "transferInTransaction",
          "idempotentReplay",
        ],
      },
      CashTransitTransferListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/CashTransitTransferRow" },
          },
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
          hasMore: { type: "boolean" },
          pagination: { $ref: "#/components/schemas/OffsetPaginationMeta" },
        },
        required: ["tenantId", "rows", "total", "limit", "offset", "hasMore", "pagination"],
      },
      CariSettlementApplyAllocationInput: {
        type: "object",
        properties: {
          openItemId: intId,
          amountTxn: positiveNumber(),
        },
        required: ["openItemId", "amountTxn"],
      },
      CariSettlementLinkedCashTransactionInput: {
        type: "object",
        properties: {
          registerId: intId,
          cashSessionId: { ...intId, nullable: true },
          counterAccountId: intId,
          txnDatetime: { type: "string", format: "date-time", nullable: true },
          bookDate: { type: "string", format: "date", nullable: true },
          referenceNo: { type: "string", maxLength: 100, nullable: true },
          description: { type: "string", maxLength: 500, nullable: true },
          idempotencyKey: { type: "string", maxLength: 100, nullable: true },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
        },
        required: ["registerId", "counterAccountId"],
      },
      CariSettlementApplyRequest: {
        type: "object",
        properties: {
          legalEntityId: intId,
          counterpartyId: intId,
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          settlementDate: { type: "string", format: "date", nullable: true },
          cashTransactionId: { ...intId, nullable: true },
          paymentChannel: {
            type: "string",
            enum: ["CASH", "MANUAL"],
            default: "MANUAL",
          },
          linkedCashTransaction: {
            $ref: "#/components/schemas/CariSettlementLinkedCashTransactionInput",
          },
          currencyCode,
          incomingAmountTxn: { type: "number", minimum: 0 },
          idempotencyKey: { type: "string", maxLength: 100 },
          autoAllocate: { type: "boolean", default: false },
          useUnappliedCash: { type: "boolean", default: true },
          allocations: {
            type: "array",
            items: { $ref: "#/components/schemas/CariSettlementApplyAllocationInput" },
          },
          fxRate: positiveNumber(true),
          fxFallbackMode: {
            type: "string",
            enum: ["EXACT_ONLY", "PRIOR_DATE"],
            nullable: true,
          },
          fxFallbackMaxDays: { type: "integer", minimum: 0, nullable: true },
          note: { type: "string", maxLength: 500, nullable: true },
          sourceModule: {
            type: "string",
            enum: ["MANUAL", "CARI", "CONTRACTS", "REVREC", "CASH", "SYSTEM", "OTHER"],
            nullable: true,
          },
          sourceEntityType: { type: "string", maxLength: 60, nullable: true },
          sourceEntityId: { type: "string", maxLength: 120, nullable: true },
          integrationLinkStatus: {
            type: "string",
            enum: ["UNLINKED", "PENDING", "LINKED", "PARTIALLY_LINKED", "FAILED"],
            nullable: true,
          },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
          bankApplyIdempotencyKey: { type: "string", maxLength: 100, nullable: true },
          bankStatementLineId: { ...intId, nullable: true },
          bankTransactionRef: { type: "string", maxLength: 100, nullable: true },
        },
        required: ["legalEntityId", "counterpartyId", "currencyCode", "idempotencyKey"],
      },
      CariBankApplyRequest: {
        type: "object",
        properties: {
          legalEntityId: intId,
          counterpartyId: intId,
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          settlementDate: { type: "string", format: "date", nullable: true },
          cashTransactionId: { ...intId, nullable: true },
          currencyCode,
          incomingAmountTxn: { type: "number", minimum: 0 },
          idempotencyKey: { type: "string", maxLength: 100, nullable: true },
          bankApplyIdempotencyKey: { type: "string", maxLength: 100 },
          autoAllocate: { type: "boolean", default: false },
          useUnappliedCash: { type: "boolean", default: true },
          allocations: {
            type: "array",
            items: { $ref: "#/components/schemas/CariSettlementApplyAllocationInput" },
          },
          fxRate: positiveNumber(true),
          fxFallbackMode: {
            type: "string",
            enum: ["EXACT_ONLY", "PRIOR_DATE"],
            nullable: true,
          },
          fxFallbackMaxDays: { type: "integer", minimum: 0, nullable: true },
          note: { type: "string", maxLength: 500, nullable: true },
          sourceModule: {
            type: "string",
            enum: ["MANUAL", "CARI", "CONTRACTS", "REVREC", "CASH", "SYSTEM", "OTHER"],
            nullable: true,
          },
          sourceEntityType: { type: "string", maxLength: 60, nullable: true },
          sourceEntityId: { type: "string", maxLength: 120, nullable: true },
          integrationLinkStatus: {
            type: "string",
            enum: ["UNLINKED", "PENDING", "LINKED", "PARTIALLY_LINKED", "FAILED"],
            nullable: true,
          },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
          bankStatementLineId: { ...intId, nullable: true },
          bankTransactionRef: { type: "string", maxLength: 100, nullable: true },
        },
        required: [
          "legalEntityId",
          "counterpartyId",
          "currencyCode",
          "bankApplyIdempotencyKey",
        ],
      },
      CariSettlementBatchRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          tenantId: { ...intId, nullable: true },
          legalEntityId: { ...intId, nullable: true },
          counterpartyId: { ...intId, nullable: true },
          ownerOperatingUnitId: { ...intId, nullable: true },
          collectorOperatingUnitId: { ...intId, nullable: true },
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          cashTransactionId: { ...intId, nullable: true },
          sequenceNamespace: { type: "string", nullable: true },
          fiscalYear: { type: "integer", nullable: true },
          sequenceNo: { type: "integer", nullable: true },
          settlementNo: { type: "string", nullable: true },
          settlementDate: { type: "string", format: "date", nullable: true },
          status: { type: "string", nullable: true },
          totalAllocatedTxn: { type: "number", nullable: true },
          totalAllocatedBase: { type: "number", nullable: true },
          realizedFxNetBase: { type: "number", nullable: true },
          currencyCode: { type: "string", maxLength: 3, nullable: true },
          settlementFxRate: { type: "number", nullable: true },
          settlementFxSource: { type: "string", nullable: true },
          settlementFxRateDate: { type: "string", format: "date", nullable: true },
          settlementFxFallbackMode: {
            type: "string",
            enum: ["EXACT_ONLY", "PRIOR_DATE"],
            nullable: true,
          },
          settlementFxFallbackMaxDays: { type: "integer", minimum: 0, nullable: true },
          postedJournalEntryId: { ...intId, nullable: true },
          reversalOfSettlementBatchId: { ...intId, nullable: true },
          originatingCrossContextSettlementBatchId: { ...intId, nullable: true },
          bankStatementLineId: { ...intId, nullable: true },
          bankTransactionRef: { type: "string", nullable: true },
          bankAttachIdempotencyKey: { type: "string", nullable: true },
          bankApplyIdempotencyKey: { type: "string", nullable: true },
          sourceModule: { type: "string", nullable: true },
          sourceEntityType: { type: "string", nullable: true },
          sourceEntityId: { type: "string", nullable: true },
          integrationLinkStatus: { type: "string", nullable: true },
          integrationEventUid: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time", nullable: true },
          updatedAt: { type: "string", format: "date-time", nullable: true },
          postedAt: { type: "string", format: "date-time", nullable: true },
          reversedAt: { type: "string", format: "date-time", nullable: true },
        },
        required: ["id", "tenantId", "legalEntityId"],
      },
      CariSettlementReverseRequest: {
        type: "object",
        properties: {
          reversalDate: { type: "string", format: "date", nullable: true },
          reason: { type: "string", maxLength: 255, nullable: true },
        },
      },
      CariSettlementReverseResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/CariSettlementBatchRow" },
          original: { $ref: "#/components/schemas/CariSettlementBatchRow" },
          journal: { type: "object", additionalProperties: true, nullable: true },
          followUpRisks: { type: "array", items: { type: "string" } },
        },
        required: ["tenantId", "row", "original", "journal", "followUpRisks"],
      },
      CariSettlementReferenceRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          settlementBatchId: { ...intId, nullable: true },
          settlementNo: { type: "string", nullable: true },
          settlementDate: { type: "string", format: "date", nullable: true },
          settlementStatusCurrent: { type: "string", nullable: true },
          activeAsOf: { type: "boolean", nullable: true },
          reversalSettlementBatchId: { ...intId, nullable: true },
          reversalSettlementNo: { type: "string", nullable: true },
          reversalSettlementDate: { type: "string", format: "date", nullable: true },
          bankStatementLineId: { ...intId, nullable: true },
          bankTransactionRef: { type: "string", nullable: true },
          bankApplyIdempotencyKey: { type: "string", nullable: true },
          ownerOperatingUnitId: { ...intId, nullable: true },
          ownerOperatingUnitCode: { type: "string", nullable: true },
          ownerOperatingUnitName: { type: "string", nullable: true },
          ownerContextLabel: { type: "string", nullable: true },
          collectorOperatingUnitId: { ...intId, nullable: true },
          collectorOperatingUnitCode: { type: "string", nullable: true },
          collectorOperatingUnitName: { type: "string", nullable: true },
          collectorContextLabel: { type: "string", nullable: true },
          originatingCrossContextSettlementBatchId: { ...intId, nullable: true },
          isCrossContext: { type: "boolean", nullable: true },
        },
        required: ["settlementBatchId"],
      },
      CariOpenItemReportRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          openItemId: { ...intId, nullable: true },
          asOfStatus: { type: "string", nullable: true },
          settlementReferences: {
            type: "array",
            items: { $ref: "#/components/schemas/CariSettlementReferenceRow" },
          },
        },
        required: ["openItemId", "settlementReferences"],
      },
      CariOpenItemsReportResponse: {
        type: "object",
        additionalProperties: true,
        properties: {
          tenantId: intId,
          asOfDate: { type: "string", format: "date", nullable: true },
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          legalEntityId: { ...intId, nullable: true },
          counterpartyId: { ...intId, nullable: true },
          role: { type: "string", nullable: true },
          statusFilter: { type: "string", nullable: true },
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1, nullable: true },
          offset: nonNegativeInt,
          summary: { type: "object", additionalProperties: true, nullable: true },
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/CariOpenItemReportRow" },
          },
          unapplied: { type: "object", additionalProperties: true, nullable: true },
        },
        required: ["tenantId", "total", "limit", "offset", "rows"],
      },
      CariStatementAllocationRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          allocationId: { ...intId, nullable: true },
          settlementBatchId: { ...intId, nullable: true },
          settlementNo: { type: "string", nullable: true },
          settlementDate: { type: "string", format: "date", nullable: true },
          activeAsOf: { type: "boolean", nullable: true },
          documentId: { ...intId, nullable: true },
          documentNo: { type: "string", nullable: true },
          documentDate: { type: "string", format: "date", nullable: true },
          openItemId: { ...intId, nullable: true },
          allocationDate: { type: "string", format: "date", nullable: true },
          allocationAmountTxn: { type: "number", nullable: true },
          allocationAmountDocTxn: { type: "number", nullable: true },
          allocationAmountSettlementTxn: { type: "number", nullable: true },
          allocationAmountBase: { type: "number", nullable: true },
          documentCurrencyCode: { type: "string", maxLength: 3, nullable: true },
          settlementCurrencyCode: { type: "string", maxLength: 3, nullable: true },
          ownerOperatingUnitId: { ...intId, nullable: true },
          ownerOperatingUnitCode: { type: "string", nullable: true },
          ownerOperatingUnitName: { type: "string", nullable: true },
          ownerContextLabel: { type: "string", nullable: true },
          collectorOperatingUnitId: { ...intId, nullable: true },
          collectorOperatingUnitCode: { type: "string", nullable: true },
          collectorOperatingUnitName: { type: "string", nullable: true },
          collectorContextLabel: { type: "string", nullable: true },
          originatingCrossContextSettlementBatchId: { ...intId, nullable: true },
          isCrossContext: { type: "boolean", nullable: true },
        },
        required: ["allocationId", "settlementBatchId"],
      },
      CariStatementDocumentRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          documentId: { ...intId, nullable: true },
          documentNo: { type: "string", nullable: true },
          asOfStatus: { type: "string", nullable: true },
          settlementLinks: {
            type: "array",
            items: { $ref: "#/components/schemas/CariStatementAllocationRow" },
          },
        },
        required: ["documentId"],
      },
      CariStatementSettlementRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          settlementBatchId: { ...intId, nullable: true },
          settlementNo: { type: "string", nullable: true },
          settlementDate: { type: "string", format: "date", nullable: true },
          statusCurrent: { type: "string", nullable: true },
          ownerOperatingUnitId: { ...intId, nullable: true },
          ownerOperatingUnitCode: { type: "string", nullable: true },
          ownerOperatingUnitName: { type: "string", nullable: true },
          ownerContextLabel: { type: "string", nullable: true },
          collectorOperatingUnitId: { ...intId, nullable: true },
          collectorOperatingUnitCode: { type: "string", nullable: true },
          collectorOperatingUnitName: { type: "string", nullable: true },
          collectorContextLabel: { type: "string", nullable: true },
          originatingCrossContextSettlementBatchId: { ...intId, nullable: true },
          isCrossContext: { type: "boolean", nullable: true },
          reversalOfSettlementBatchId: { ...intId, nullable: true },
          reversedBySettlementBatchId: { ...intId, nullable: true },
          reversedBySettlementDate: { type: "string", format: "date", nullable: true },
          totalAllocatedTxn: { type: "number", nullable: true },
          totalAllocatedBase: { type: "number", nullable: true },
          realizedFxNetBase: { type: "number", nullable: true },
          currencyCode: { type: "string", maxLength: 3, nullable: true },
        },
        required: ["settlementBatchId"],
      },
      CariCounterpartyStatementReportResponse: {
        type: "object",
        additionalProperties: true,
        properties: {
          tenantId: intId,
          asOfDate: { type: "string", format: "date", nullable: true },
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          legalEntityId: { ...intId, nullable: true },
          counterpartyId: { ...intId, nullable: true },
          role: { type: "string", nullable: true },
          statusFilter: { type: "string", nullable: true },
          summary: { type: "object", additionalProperties: true, nullable: true },
          documents: {
            type: "object",
            additionalProperties: true,
            properties: {
              total: nonNegativeInt,
              limit: { type: "integer", minimum: 1, nullable: true },
              offset: nonNegativeInt,
              rows: {
                type: "array",
                items: { $ref: "#/components/schemas/CariStatementDocumentRow" },
              },
            },
            required: ["total", "limit", "offset", "rows"],
          },
          settlements: {
            type: "object",
            additionalProperties: true,
            properties: {
              total: nonNegativeInt,
              limit: { type: "integer", minimum: 1, nullable: true },
              offset: nonNegativeInt,
              rows: {
                type: "array",
                items: { $ref: "#/components/schemas/CariStatementSettlementRow" },
              },
            },
            required: ["total", "limit", "offset", "rows"],
          },
          allocations: {
            type: "object",
            additionalProperties: true,
            properties: {
              total: nonNegativeInt,
              limit: { type: "integer", minimum: 1, nullable: true },
              offset: nonNegativeInt,
              rows: {
                type: "array",
                items: { $ref: "#/components/schemas/CariStatementAllocationRow" },
              },
            },
            required: ["total", "limit", "offset", "rows"],
          },
          unapplied: { type: "object", additionalProperties: true, nullable: true },
        },
        required: ["tenantId", "documents", "settlements", "allocations", "unapplied"],
      },
      CariSettlementRealizedFxReportRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          period: { type: "string", nullable: true },
          legalEntityId: { ...intId, nullable: true },
          legalEntityCode: { type: "string", nullable: true },
          legalEntityName: { type: "string", nullable: true },
          counterpartyId: { ...intId, nullable: true },
          counterpartyCode: { type: "string", nullable: true },
          counterpartyName: { type: "string", nullable: true },
          counterpartyType: { type: "string", nullable: true },
          currencyCode: { type: "string", maxLength: 3, nullable: true },
          settlementCount: { type: "integer", minimum: 0, nullable: true },
          crossContextSettlementCount: { type: "integer", minimum: 0, nullable: true },
          sameContextSettlementCount: { type: "integer", minimum: 0, nullable: true },
          totalAllocatedTxn: { type: "number", nullable: true },
          totalAllocatedBase: { type: "number", nullable: true },
          realizedFxNetBase: { type: "number", nullable: true },
          realizedFxGainBase: { type: "number", nullable: true },
          realizedFxLossBase: { type: "number", nullable: true },
        },
      },
      CariSettlementRealizedFxReportResponse: {
        type: "object",
        additionalProperties: true,
        properties: {
          tenantId: intId,
          legalEntityId: { ...intId, nullable: true },
          counterpartyId: { ...intId, nullable: true },
          role: { type: "string", nullable: true },
          direction: { type: "string", nullable: true },
          currencyCode: { type: "string", maxLength: 3, nullable: true },
          periodFrom: { type: "string", format: "date", nullable: true },
          periodTo: { type: "string", format: "date", nullable: true },
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1, nullable: true },
          offset: nonNegativeInt,
          summary: { type: "object", additionalProperties: true, nullable: true },
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/CariSettlementRealizedFxReportRow" },
          },
        },
        required: ["tenantId", "total", "limit", "offset", "rows"],
      },
      CariSettlementApplyResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          cashTransaction: { type: "object", additionalProperties: true, nullable: true },
          row: { $ref: "#/components/schemas/CariSettlementBatchRow" },
          allocations: { type: "array", items: { type: "object", additionalProperties: true } },
          journal: { type: "object", additionalProperties: true, nullable: true },
          fx: { $ref: "#/components/schemas/CashTransactionApplyCariFxSummary" },
          unapplied: { $ref: "#/components/schemas/CashTransactionApplyCariUnappliedSummary" },
          unappliedCash: { type: "array", items: { type: "object", additionalProperties: true } },
          metrics: { type: "object", additionalProperties: true, nullable: true },
          idempotentReplay: { type: "boolean" },
          followUpRisks: { type: "array", items: { type: "string" } },
        },
        required: [
          "tenantId",
          "cashTransaction",
          "row",
          "allocations",
          "journal",
          "fx",
          "unapplied",
          "unappliedCash",
          "metrics",
          "idempotentReplay",
          "followUpRisks",
        ],
      },
      CounterpartyContactInput: {
        type: "object",
        properties: {
          id: { ...intId, nullable: true },
          contactName: shortText,
          email: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          title: { type: "string", nullable: true },
          isPrimary: { type: "boolean" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
        },
        required: ["contactName", "isPrimary", "status"],
      },
      CounterpartyAddressInput: {
        type: "object",
        properties: {
          id: { ...intId, nullable: true },
          addressType: { type: "string", enum: ["BILLING", "SHIPPING", "REGISTERED", "OTHER"] },
          addressLine1: shortText,
          addressLine2: { type: "string", nullable: true },
          city: { type: "string", nullable: true },
          stateRegion: { type: "string", nullable: true },
          postalCode: { type: "string", nullable: true },
          countryId: { ...intId, nullable: true },
          isPrimary: { type: "boolean" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
        },
        required: ["addressType", "addressLine1", "isPrimary", "status"],
      },
      CounterpartyUpsertInput: {
        type: "object",
        properties: {
          legalEntityId: intId,
          code: { type: "string", minLength: 1, maxLength: 60 },
          name: { type: "string", minLength: 1, maxLength: 255 },
          isCustomer: { type: "boolean" },
          isVendor: { type: "boolean" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          taxId: { type: "string", nullable: true },
          email: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          notes: { type: "string", nullable: true },
          defaultCurrencyCode: { type: "string", minLength: 3, maxLength: 3, nullable: true },
          defaultPaymentTermId: { ...intId, nullable: true },
          arAccountId: { ...intId, nullable: true },
          apAccountId: { ...intId, nullable: true },
          defaultContactId: { ...intId, nullable: true },
          defaultAddressId: { ...intId, nullable: true },
          contacts: {
            type: "array",
            items: { $ref: "#/components/schemas/CounterpartyContactInput" },
          },
          addresses: {
            type: "array",
            items: { $ref: "#/components/schemas/CounterpartyAddressInput" },
          },
        },
        required: ["legalEntityId", "code", "name", "isCustomer", "isVendor"],
      },
      CounterpartyContactRow: {
        type: "object",
        properties: {
          id: intId,
          tenantId: intId,
          legalEntityId: intId,
          counterpartyId: intId,
          contactName: { type: "string" },
          email: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          title: { type: "string", nullable: true },
          isPrimary: { type: "boolean" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
        },
        required: [
          "id",
          "tenantId",
          "legalEntityId",
          "counterpartyId",
          "contactName",
          "isPrimary",
          "status",
        ],
      },
      CounterpartyAddressRow: {
        type: "object",
        properties: {
          id: intId,
          tenantId: intId,
          legalEntityId: intId,
          counterpartyId: intId,
          addressType: {
            type: "string",
            enum: ["BILLING", "SHIPPING", "REGISTERED", "OTHER"],
          },
          addressLine1: { type: "string" },
          addressLine2: { type: "string", nullable: true },
          city: { type: "string", nullable: true },
          stateRegion: { type: "string", nullable: true },
          postalCode: { type: "string", nullable: true },
          countryId: { ...intId, nullable: true },
          isPrimary: { type: "boolean" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
        },
        required: [
          "id",
          "tenantId",
          "legalEntityId",
          "counterpartyId",
          "addressType",
          "addressLine1",
          "isPrimary",
          "status",
        ],
      },
      CounterpartySummaryRow: {
        type: "object",
        properties: {
          id: intId,
          tenantId: intId,
          legalEntityId: intId,
          code: { type: "string" },
          name: { type: "string" },
          counterpartyType: { type: "string", enum: ["CUSTOMER", "VENDOR", "BOTH", "OTHER"] },
          isCustomer: { type: "boolean" },
          isVendor: { type: "boolean" },
          taxId: { type: "string", nullable: true },
          email: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          defaultCurrencyCode: { type: "string", nullable: true },
          defaultPaymentTermId: { ...intId, nullable: true },
          defaultPaymentTermCode: { type: "string", nullable: true },
          defaultPaymentTermName: { type: "string", nullable: true },
          arAccountId: { ...intId, nullable: true },
          arAccountCode: { type: "string", nullable: true },
          arAccountName: { type: "string", nullable: true },
          apAccountId: { ...intId, nullable: true },
          apAccountCode: { type: "string", nullable: true },
          apAccountName: { type: "string", nullable: true },
          defaultContactId: { ...intId, nullable: true },
          defaultAddressId: { ...intId, nullable: true },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          notes: { type: "string", nullable: true },
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
        },
        required: [
          "id",
          "tenantId",
          "legalEntityId",
          "code",
          "name",
          "counterpartyType",
          "isCustomer",
          "isVendor",
          "status",
        ],
      },
      CounterpartyDetailRow: {
        allOf: [
          { $ref: "#/components/schemas/CounterpartySummaryRow" },
          {
            type: "object",
            properties: {
              contacts: {
                type: "array",
                items: { $ref: "#/components/schemas/CounterpartyContactRow" },
              },
              addresses: {
                type: "array",
                items: { $ref: "#/components/schemas/CounterpartyAddressRow" },
              },
              defaults: {
                type: "object",
                properties: {
                  paymentTermId: { ...intId, nullable: true },
                  contactId: { ...intId, nullable: true },
                  addressId: { ...intId, nullable: true },
                },
                required: ["paymentTermId", "contactId", "addressId"],
              },
            },
            required: ["contacts", "addresses", "defaults"],
          },
        ],
      },
      CounterpartyListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/CounterpartySummaryRow" },
          },
          total: nonNegativeInt,
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
        },
        required: ["tenantId", "rows", "total", "limit", "offset"],
      },
      CounterpartyDetailResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/CounterpartyDetailRow" },
        },
        required: ["tenantId", "row"],
      },
      CounterpartyMutationResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/CounterpartyDetailRow" },
        },
        required: ["tenantId", "row"],
      },
      TenantReadinessCheck: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          minimum: nonNegativeInt,
          count: nonNegativeInt,
          ready: { type: "boolean" },
          details: {
            nullable: true,
            type: "object",
            additionalProperties: true,
          },
        },
        required: ["key", "label", "minimum", "count", "ready", "details"],
      },
      TenantReadinessCounts: {
        type: "object",
        properties: {
          groupCompanies: nonNegativeInt,
          legalEntities: nonNegativeInt,
          fiscalCalendars: nonNegativeInt,
          fiscalPeriods: nonNegativeInt,
          books: nonNegativeInt,
          openBookPeriods: nonNegativeInt,
          chartsOfAccounts: nonNegativeInt,
          accounts: nonNegativeInt,
        },
        required: [
          "groupCompanies",
          "legalEntities",
          "fiscalCalendars",
          "fiscalPeriods",
          "books",
          "openBookPeriods",
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
      OnboardingCompanyBootstrapCurrentAccountConfigInput: {
        type: "object",
        properties: {
          skipForNow: { type: "boolean", nullable: true },
          dueFromParentAccountCode: { type: "string", nullable: true },
          dueToParentAccountCode: { type: "string", nullable: true },
        },
      },
      OnboardingCompanyBootstrapBranchInput: {
        type: "object",
        additionalProperties: true,
        properties: {
          code: shortText,
          name: shortText,
          status: {
            type: "string",
            enum: ["ACTIVE", "INACTIVE"],
            nullable: true,
          },
        },
      },
      OnboardingCompanyBootstrapLegalEntityInput: {
        type: "object",
        additionalProperties: true,
        properties: {
          code: shortText,
          name: shortText,
          functionalCurrencyCode: currencyCode,
          currentAccountConfig: {
            $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountConfigInput",
          },
          branches: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingCompanyBootstrapBranchInput",
            },
          },
          policyPackId: { ...intId, nullable: true },
        },
        required: ["code", "name", "functionalCurrencyCode"],
      },
      OnboardingCompanyBootstrapInput: {
        type: "object",
        additionalProperties: true,
        properties: {
          groupCompany: {
            $ref: "#/components/schemas/GroupCompanyInput",
          },
          groupCoa: {
            type: "object",
            additionalProperties: true,
          },
          fiscalCalendar: {
            $ref: "#/components/schemas/FiscalCalendarInput",
          },
          fiscalYear: { type: "integer", minimum: 1 },
          legalEntities: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingCompanyBootstrapLegalEntityInput",
            },
          },
        },
        required: ["groupCompany", "fiscalCalendar", "fiscalYear", "legalEntities"],
      },
      OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewLegalEntityInput: {
        type: "object",
        additionalProperties: true,
        properties: {
          code: shortText,
          name: shortText,
          branches: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingCompanyBootstrapBranchInput",
            },
          },
        },
      },
      OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewInput: {
        type: "object",
        properties: {
          legalEntities: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewLegalEntityInput",
            },
          },
        },
      },
      OperatingUnitCurrentAccountEligibilityPreviewOperatingUnit: {
        type: "object",
        properties: {
          code: { type: "string" },
          name: { type: "string" },
          status: { type: "string" },
        },
        required: ["code", "name", "status"],
      },
      OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewRow: {
        type: "object",
        properties: {
          index: nonNegativeInt,
          legalEntityCode: { type: "string" },
          legalEntityName: { type: "string" },
          effectiveActiveOperatingUnitCount: nonNegativeInt,
          currentAccountSetupRecommended: { type: "boolean" },
          recommendationCode: { type: "string" },
          eligibleOperatingUnits: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountEligibilityPreviewOperatingUnit",
            },
          },
        },
        required: [
          "index",
          "legalEntityCode",
          "legalEntityName",
          "effectiveActiveOperatingUnitCount",
          "currentAccountSetupRecommended",
          "recommendationCode",
          "eligibleOperatingUnits",
        ],
      },
      OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean", enum: [true] },
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewRow",
            },
          },
        },
        required: ["ok", "rows"],
      },
      OnboardingCompanyBootstrapCurrentAccountEligibilitySummary: {
        type: "object",
        properties: {
          effectiveActiveOperatingUnitCount: nonNegativeInt,
          currentAccountSetupRecommended: { type: "boolean" },
          recommendationCode: { type: "string" },
          eligibleOperatingUnits: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountEligibilityPreviewOperatingUnit",
            },
          },
        },
        required: [
          "effectiveActiveOperatingUnitCount",
          "currentAccountSetupRecommended",
          "recommendationCode",
          "eligibleOperatingUnits",
        ],
      },
      OnboardingCompanyBootstrapCurrentAccountSavedConfig: {
        type: "object",
        properties: {
          dueFromParentAccountCode: { type: "string" },
          dueToParentAccountCode: { type: "string" },
          autoProvisionOnOperatingUnitCreate: { type: "boolean" },
          lastAppliedAt: { type: "string", format: "date-time", nullable: true },
          updatedAt: { type: "string", format: "date-time", nullable: true },
        },
        required: [
          "dueFromParentAccountCode",
          "dueToParentAccountCode",
          "autoProvisionOnOperatingUnitCreate",
          "lastAppliedAt",
          "updatedAt",
        ],
      },
      OnboardingCompanyBootstrapCurrentAccountProvisioningSummary: {
        type: "object",
        properties: {
          createdAccountCount: nonNegativeInt,
          reusedAccountCount: nonNegativeInt,
          updatedOperatingUnitCount: nonNegativeInt,
          updatedPartnerMappingCount: nonNegativeInt,
          warningCount: nonNegativeInt,
          lastAppliedAt: { type: "string", format: "date-time", nullable: true },
        },
        required: [
          "createdAccountCount",
          "reusedAccountCount",
          "updatedOperatingUnitCount",
          "updatedPartnerMappingCount",
          "warningCount",
          "lastAppliedAt",
        ],
      },
      OnboardingCompanyBootstrapCurrentAccountWarning: {
        type: "object",
        properties: {
          code: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "error"] },
          message: { type: "string" },
        },
        required: ["code", "severity", "message"],
      },
      OnboardingCompanyBootstrapCurrentAccountReadinessWarning: {
        type: "object",
        properties: {
          legalEntityCode: { type: "string" },
          legalEntityId: intId,
          code: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "error"] },
          message: { type: "string" },
        },
        required: ["legalEntityCode", "legalEntityId", "code", "severity", "message"],
      },
      OnboardingCompanyBootstrapCurrentAccountSetupResult: {
        type: "object",
        properties: {
          configured: { type: "boolean" },
          skipped: { type: "boolean" },
          eligibility: {
            $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountEligibilitySummary",
          },
          savedConfig: {
            allOf: [
              {
                $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountSavedConfig",
              },
            ],
            nullable: true,
          },
          provisioningSummary: {
            allOf: [
              {
                $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountProvisioningSummary",
              },
            ],
            nullable: true,
          },
          warning: {
            allOf: [
              {
                $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountWarning",
              },
            ],
            nullable: true,
          },
        },
        required: [
          "configured",
          "skipped",
          "eligibility",
          "savedConfig",
          "provisioningSummary",
          "warning",
        ],
      },
      OnboardingCompanyBootstrapLegalEntityResult: {
        type: "object",
        additionalProperties: true,
        properties: {
          code: { type: "string" },
          legalEntityId: intId,
          coaCode: { type: "string" },
          coaId: intId,
          branchCount: nonNegativeInt,
          currentAccountSetup: {
            $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountSetupResult",
          },
        },
        required: [
          "code",
          "legalEntityId",
          "coaCode",
          "coaId",
          "branchCount",
          "currentAccountSetup",
        ],
      },
      OnboardingCompanyBootstrapPaymentTermsSummary: {
        type: "object",
        properties: {
          defaultsUsed: { type: "boolean" },
          templateCount: nonNegativeInt,
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
          "defaultsUsed",
          "templateCount",
          "createdCount",
          "skippedCount",
          "perLegalEntity",
        ],
      },
      OnboardingCompanyBootstrapResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean", enum: [true] },
          groupCompanyId: intId,
          calendarId: intId,
          periodsGenerated: nonNegativeInt,
          legalEntities: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingCompanyBootstrapLegalEntityResult",
            },
          },
          currentAccountReadinessWarnings: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountReadinessWarning",
            },
          },
          paymentTerms: {
            $ref: "#/components/schemas/OnboardingCompanyBootstrapPaymentTermsSummary",
          },
        },
        required: [
          "ok",
          "groupCompanyId",
          "calendarId",
          "periodsGenerated",
          "legalEntities",
          "currentAccountReadinessWarnings",
          "paymentTerms",
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
          centralDueFromAccountId: { ...intId, nullable: true },
          centralDueToAccountId: { ...intId, nullable: true },
          ouDueFromCentralAccountId: { ...intId, nullable: true },
          ouDueToCentralAccountId: { ...intId, nullable: true },
        },
        required: ["legalEntityId", "code", "name"],
      },
      OperatingUnitRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          tenant_id: { ...intId, nullable: true },
          legal_entity_id: { ...intId, nullable: true },
          code: { type: "string", nullable: true },
          name: { type: "string", nullable: true },
          unit_type: {
            type: "string",
            enum: ["BRANCH", "PLANT", "STORE", "DEPARTMENT", "OTHER"],
            nullable: true,
          },
          has_subledger: { type: "boolean", nullable: true },
          status: {
            type: "string",
            enum: ["ACTIVE", "INACTIVE"],
            nullable: true,
          },
          created_at: { type: "string", format: "date-time", nullable: true },
          central_due_from_account_id: { ...intId, nullable: true },
          central_due_from_account_code: { type: "string", nullable: true },
          central_due_from_account_name: { type: "string", nullable: true },
          central_due_to_account_id: { ...intId, nullable: true },
          central_due_to_account_code: { type: "string", nullable: true },
          central_due_to_account_name: { type: "string", nullable: true },
          ou_due_from_central_account_id: { ...intId, nullable: true },
          ou_due_from_central_account_code: { type: "string", nullable: true },
          ou_due_from_central_account_name: { type: "string", nullable: true },
          ou_due_to_central_account_id: { ...intId, nullable: true },
          ou_due_to_central_account_code: { type: "string", nullable: true },
          ou_due_to_central_account_name: { type: "string", nullable: true },
          capital_self_balancing_ready: { type: "boolean", nullable: true },
        },
      },
      OperatingUnitListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/OperatingUnitRow" },
          },
        },
        required: ["tenantId", "rows"],
      },
      OperatingUnitPartnerCurrentAccountInput: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          legalEntityId: intId,
          operatingUnitId: intId,
          partnerOperatingUnitId: intId,
          dueFromAccountId: intId,
          dueToAccountId: intId,
        },
        required: [
          "legalEntityId",
          "operatingUnitId",
          "partnerOperatingUnitId",
          "dueFromAccountId",
          "dueToAccountId",
        ],
      },
      OperatingUnitPartnerCurrentAccountRow: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { ...intId, nullable: true },
          tenant_id: { ...intId, nullable: true },
          legal_entity_id: { ...intId, nullable: true },
          operating_unit_id: { ...intId, nullable: true },
          operating_unit_code: { type: "string", nullable: true },
          operating_unit_name: { type: "string", nullable: true },
          partner_operating_unit_id: { ...intId, nullable: true },
          partner_operating_unit_code: { type: "string", nullable: true },
          partner_operating_unit_name: { type: "string", nullable: true },
          due_from_account_id: { ...intId, nullable: true },
          due_from_account_code: { type: "string", nullable: true },
          due_from_account_name: { type: "string", nullable: true },
          due_to_account_id: { ...intId, nullable: true },
          due_to_account_code: { type: "string", nullable: true },
          due_to_account_name: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time", nullable: true },
          updated_at: { type: "string", format: "date-time", nullable: true },
        },
      },
      OperatingUnitPartnerCurrentAccountListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitPartnerCurrentAccountRow",
            },
          },
        },
        required: ["tenantId", "rows"],
      },
      OperatingUnitCurrentProvisionedAccount: {
        type: "object",
        properties: {
          id: intId,
          code: { type: "string" },
          name: { type: "string" },
          role: {
            type: "string",
            enum: [
              "CENTRAL_DUE_FROM",
              "CENTRAL_DUE_TO",
              "OU_DUE_FROM_CENTRAL",
              "OU_DUE_TO_CENTRAL",
              "DUE_FROM",
              "DUE_TO",
            ],
          },
          operatingUnitId: intId,
          partnerOperatingUnitId: { ...intId, nullable: true },
        },
        required: ["id", "code", "name", "role", "operatingUnitId"],
      },
      OperatingUnitPartnerCurrentAccountMappingResult: {
        type: "object",
        properties: {
          id: intId,
          operatingUnitId: intId,
          partnerOperatingUnitId: intId,
          dueFromAccountId: intId,
          dueFromAccountCode: { type: "string" },
          dueFromAccountName: { type: "string" },
          dueToAccountId: intId,
          dueToAccountCode: { type: "string" },
          dueToAccountName: { type: "string" },
          created: { type: "boolean" },
          updated: { type: "boolean" },
        },
        required: [
          "id",
          "operatingUnitId",
          "partnerOperatingUnitId",
          "dueFromAccountId",
          "dueFromAccountCode",
          "dueFromAccountName",
          "dueToAccountId",
          "dueToAccountCode",
          "dueToAccountName",
          "created",
          "updated",
        ],
      },
      OperatingUnitCurrentAccountApplyOperatingUnitResult: {
        type: "object",
        properties: {
          id: intId,
          code: { type: "string" },
          name: { type: "string" },
          centralDueFromAccountId: intId,
          centralDueFromAccountCode: { type: "string" },
          centralDueFromAccountName: { type: "string" },
          centralDueToAccountId: intId,
          centralDueToAccountCode: { type: "string" },
          centralDueToAccountName: { type: "string" },
          ouDueFromCentralAccountId: intId,
          ouDueFromCentralAccountCode: { type: "string" },
          ouDueFromCentralAccountName: { type: "string" },
          ouDueToCentralAccountId: intId,
          ouDueToCentralAccountCode: { type: "string" },
          ouDueToCentralAccountName: { type: "string" },
          capitalSelfBalancingReady: { type: "boolean" },
          currentAccountProvisioningReady: { type: "boolean" },
        },
        required: [
          "id",
          "code",
          "name",
          "centralDueFromAccountId",
          "centralDueFromAccountCode",
          "centralDueFromAccountName",
          "centralDueToAccountId",
          "centralDueToAccountCode",
          "centralDueToAccountName",
          "ouDueFromCentralAccountId",
          "ouDueFromCentralAccountCode",
          "ouDueFromCentralAccountName",
          "ouDueToCentralAccountId",
          "ouDueToCentralAccountCode",
          "ouDueToCentralAccountName",
          "capitalSelfBalancingReady",
          "currentAccountProvisioningReady",
        ],
      },
      OperatingUnitCurrentAccountConfigRow: {
        type: "object",
        properties: {
          legal_entity_id: { ...intId, nullable: true },
          legal_entity_code: { type: "string", nullable: true },
          legal_entity_name: { type: "string", nullable: true },
          operating_unit_current_account_config_id: { ...intId, nullable: true },
          due_from_parent_account_id: { ...intId, nullable: true },
          due_from_parent_account_code: { type: "string", nullable: true },
          due_from_parent_account_name: { type: "string", nullable: true },
          due_to_parent_account_id: { ...intId, nullable: true },
          due_to_parent_account_code: { type: "string", nullable: true },
          due_to_parent_account_name: { type: "string", nullable: true },
          auto_provision_on_operating_unit_create: { type: "boolean", nullable: true },
          last_applied_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time", nullable: true },
          updated_at: { type: "string", format: "date-time", nullable: true },
        },
      },
      OperatingUnitCurrentAccountConfigListResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          rows: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountConfigRow",
            },
          },
        },
        required: ["tenantId", "rows"],
      },
      OperatingUnitCurrentAccountConfigInput: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          legalEntityId: intId,
          dueFromParentAccountId: intId,
          dueToParentAccountId: intId,
          autoProvisionOnOperatingUnitCreate: { type: "boolean", nullable: true },
        },
        required: ["legalEntityId", "dueFromParentAccountId", "dueToParentAccountId"],
      },
      OperatingUnitCurrentAccountConfigResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean", enum: [true] },
          row: {
            $ref: "#/components/schemas/OperatingUnitCurrentAccountConfigRow",
          },
        },
        required: ["ok", "row"],
      },
      OperatingUnitCurrentAccountConfigApplyInput: {
        type: "object",
        properties: {
          tenantId: { ...intId, nullable: true },
          legalEntityId: intId,
          operatingUnitId: intId,
          repairMissingOnly: { type: "boolean", nullable: true },
        },
        required: ["legalEntityId"],
      },
      OperatingUnitCurrentAccountProvisionWarning: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
        },
        additionalProperties: true,
        required: ["code", "message"],
      },
      OperatingUnitCurrentAccountApplyResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean", enum: [true] },
          legalEntityId: intId,
          operatingUnitId: { ...intId, nullable: true },
          dueFromParentAccountId: intId,
          dueToParentAccountId: intId,
          repairMissingOnly: { type: "boolean" },
          createdAccounts: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentProvisionedAccount",
            },
          },
          reusedAccounts: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentProvisionedAccount",
            },
          },
          updatedOperatingUnits: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountApplyOperatingUnitResult",
            },
          },
          updatedPartnerMappings: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitPartnerCurrentAccountMappingResult",
            },
          },
          partnerMappings: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitPartnerCurrentAccountMappingResult",
            },
          },
          warnings: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountProvisionWarning",
            },
          },
          lastAppliedAt: { type: "string", format: "date-time", nullable: true },
        },
        required: [
          "ok",
          "legalEntityId",
          "operatingUnitId",
          "dueFromParentAccountId",
          "dueToParentAccountId",
          "repairMissingOnly",
          "createdAccounts",
          "reusedAccounts",
          "updatedOperatingUnits",
          "updatedPartnerMappings",
          "partnerMappings",
          "warnings",
          "lastAppliedAt",
        ],
      },
      OperatingUnitCurrentAccountReadinessOperatingUnit: {
        type: "object",
        properties: {
          id: intId,
          code: { type: "string" },
          name: { type: "string" },
          label: { type: "string" },
          status: { type: "string", nullable: true },
        },
        required: ["id", "code", "name", "label"],
      },
      OperatingUnitCurrentAccountReadinessDirection: {
        type: "object",
        properties: {
          operatingUnitId: intId,
          operatingUnitCode: { type: "string" },
          operatingUnitName: { type: "string" },
          partnerOperatingUnitId: intId,
          partnerOperatingUnitCode: { type: "string" },
          partnerOperatingUnitName: { type: "string" },
        },
        required: [
          "operatingUnitId",
          "operatingUnitCode",
          "operatingUnitName",
          "partnerOperatingUnitId",
          "partnerOperatingUnitCode",
          "partnerOperatingUnitName",
        ],
      },
      OperatingUnitCurrentAccountReadinessRow: {
        type: "object",
        properties: {
          legalEntityId: intId,
          legalEntityCode: { type: "string" },
          legalEntityName: { type: "string" },
          ready: { type: "boolean" },
          applicable: { type: "boolean" },
          blockerCode: { type: "string", nullable: true },
          setupPath: { type: "string", nullable: true },
          effectiveActiveOperatingUnitCount: nonNegativeInt,
          currentAccountSetupRecommended: { type: "boolean" },
          recommendationCode: { type: "string", nullable: true },
          configPresent: { type: "boolean" },
          configApplied: { type: "boolean" },
          autoProvisionOnOperatingUnitCreate: { type: "boolean" },
          lastAppliedAt: { type: "string", format: "date-time", nullable: true },
          configChangedSinceLastApply: { type: "boolean" },
          eligibleOperatingUnits: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountReadinessOperatingUnit",
            },
          },
          missingCentralOperatingUnits: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountReadinessOperatingUnit",
            },
          },
          expectedPartnerDirectionCount: nonNegativeInt,
          missingPartnerDirectionCount: nonNegativeInt,
          missingPartnerDirections: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountReadinessDirection",
            },
          },
        },
        required: [
          "legalEntityId",
          "legalEntityCode",
          "legalEntityName",
          "ready",
          "applicable",
          "blockerCode",
          "setupPath",
          "effectiveActiveOperatingUnitCount",
          "currentAccountSetupRecommended",
          "recommendationCode",
          "configPresent",
          "configApplied",
          "autoProvisionOnOperatingUnitCreate",
          "lastAppliedAt",
          "configChangedSinceLastApply",
          "eligibleOperatingUnits",
          "missingCentralOperatingUnits",
          "expectedPartnerDirectionCount",
          "missingPartnerDirectionCount",
          "missingPartnerDirections",
        ],
      },
      ModuleReadinessBucket: {
        type: "object",
        properties: {
          byLegalEntity: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
        required: ["byLegalEntity"],
      },
      OperatingUnitCurrentAccountModuleReadinessBucket: {
        type: "object",
        properties: {
          byLegalEntity: {
            type: "array",
            items: {
              $ref: "#/components/schemas/OperatingUnitCurrentAccountReadinessRow",
            },
          },
        },
        required: ["byLegalEntity"],
      },
      ModuleReadinessResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          legalEntityId: { ...intId, nullable: true },
          modules: {
            type: "object",
            properties: {
              cariPosting: {
                $ref: "#/components/schemas/ModuleReadinessBucket",
              },
              shareholderCommitment: {
                $ref: "#/components/schemas/ModuleReadinessBucket",
              },
              cashClearing: {
                $ref: "#/components/schemas/ModuleReadinessBucket",
              },
              bankControlParent: {
                $ref: "#/components/schemas/ModuleReadinessBucket",
              },
              operatingUnitCurrentAccounts: {
                $ref: "#/components/schemas/OperatingUnitCurrentAccountModuleReadinessBucket",
              },
              closeConsolidationWorkflow: {
                $ref: "#/components/schemas/ModuleReadinessBucket",
              },
            },
            required: [
              "cariPosting",
              "shareholderCommitment",
              "cashClearing",
              "bankControlParent",
              "operatingUnitCurrentAccounts",
              "closeConsolidationWorkflow",
            ],
          },
        },
        required: ["tenantId", "legalEntityId", "modules"],
      },
      LegalEntityActivationReadinessCheck: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          ready: { type: "boolean" },
          applicable: { type: "boolean" },
          blockerCode: { type: "string", nullable: true },
          details: {
            nullable: true,
            type: "object",
            additionalProperties: true,
          },
        },
        required: ["key", "label", "ready", "applicable", "blockerCode", "details"],
      },
      LegalEntityActivationReadinessSummary: {
        type: "object",
        properties: {
          readyCheckCount: nonNegativeInt,
          totalCheckCount: nonNegativeInt,
          blockingCheckCount: nonNegativeInt,
        },
        required: ["readyCheckCount", "totalCheckCount", "blockingCheckCount"],
      },
      LegalEntityActivationReadinessRow: {
        type: "object",
        properties: {
          legalEntityId: intId,
          legalEntityCode: { type: "string" },
          legalEntityName: { type: "string" },
          status: { type: "string", enum: ["READY", "IN_PROGRESS", "NOT_STARTED"] },
          ready: { type: "boolean" },
          summary: {
            $ref: "#/components/schemas/LegalEntityActivationReadinessSummary",
          },
          checks: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LegalEntityActivationReadinessCheck",
            },
          },
        },
        required: [
          "legalEntityId",
          "legalEntityCode",
          "legalEntityName",
          "status",
          "ready",
          "summary",
          "checks",
        ],
      },
      LegalEntityActivationReadinessResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          stage: { type: "string", enum: ["LEGAL_ENTITY_ACTIVATION"] },
          byLegalEntity: {
            type: "array",
            items: {
              $ref: "#/components/schemas/LegalEntityActivationReadinessRow",
            },
          },
          generatedAt: { type: "string", format: "date-time" },
        },
        required: ["tenantId", "stage", "byLegalEntity", "generatedAt"],
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
          fxRate: positiveNumber(true),
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
          fxRate: positiveNumber(true),
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
          fxRate: positiveNumber(true),
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
          lineAmountTxn: {
            type: "number",
            description: "Signed non-zero amount; negative values model credit/adjustment lines.",
          },
          lineAmountBase: {
            type: "number",
            description: "Signed non-zero amount; negative values model credit/adjustment lines.",
          },
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
      ContractAmendInput: {
        allOf: [
          { $ref: "#/components/schemas/ContractUpsertInput" },
          {
            type: "object",
            properties: {
              reason: { type: "string", minLength: 1, maxLength: 500 },
            },
            required: ["reason"],
          },
        ],
      },
      ContractLinePatchInput: {
        type: "object",
        properties: {
          description: { type: "string", minLength: 1, maxLength: 255 },
          lineAmountTxn: {
            type: "number",
            description: "Signed non-zero amount; negative values model credit/adjustment lines.",
          },
          lineAmountBase: {
            type: "number",
            description: "Signed non-zero amount; negative values model credit/adjustment lines.",
          },
          recognitionMethod: {
            type: "string",
            enum: ["STRAIGHT_LINE", "MILESTONE", "MANUAL"],
            description:
              "STRAIGHT_LINE requires start/end dates; MILESTONE requires start=end (single milestone date); MANUAL requires both dates omitted.",
          },
          recognitionStartDate: {
            type: "string",
            format: "date",
            nullable: true,
            description:
              "STRAIGHT_LINE: required. MILESTONE: required and must equal recognitionEndDate. MANUAL: must be null.",
          },
          recognitionEndDate: {
            type: "string",
            format: "date",
            nullable: true,
            description:
              "STRAIGHT_LINE: required. MILESTONE: required and must equal recognitionStartDate. MANUAL: must be null.",
          },
          deferredAccountId: { ...intId, nullable: true },
          revenueAccountId: { ...intId, nullable: true },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          reason: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["reason"],
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
          versionNo: { type: "integer", minimum: 1 },
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
          "versionNo",
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
            description:
              "STRAIGHT_LINE requires start/end dates; MILESTONE requires start=end (single milestone date); MANUAL requires both dates omitted.",
          },
          recognitionStartDate: {
            type: "string",
            format: "date",
            nullable: true,
            description:
              "STRAIGHT_LINE: required. MILESTONE: required and must equal recognitionEndDate. MANUAL: must be null.",
          },
          recognitionEndDate: {
            type: "string",
            format: "date",
            nullable: true,
            description:
              "STRAIGHT_LINE: required. MILESTONE: required and must equal recognitionStartDate. MANUAL: must be null.",
          },
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
      ContractFinancialRollup: {
        type: "object",
        properties: {
          currencyCode: { type: "string", nullable: true },
          linkedDocumentCount: { type: "integer", minimum: 0 },
          activeLinkedDocumentCount: { type: "integer", minimum: 0 },
          revrecScheduleLineCount: { type: "integer", minimum: 0 },
          revrecRecognizedRunLineCount: { type: "integer", minimum: 0 },
          billedAmountTxn: { type: "number" },
          billedAmountBase: { type: "number" },
          collectedAmountTxn: { type: "number" },
          collectedAmountBase: { type: "number" },
          uncollectedAmountTxn: { type: "number" },
          uncollectedAmountBase: { type: "number" },
          revrecScheduledAmountTxn: { type: "number" },
          revrecScheduledAmountBase: { type: "number" },
          recognizedToDateTxn: { type: "number" },
          recognizedToDateBase: { type: "number" },
          deferredBalanceTxn: { type: "number" },
          deferredBalanceBase: { type: "number" },
          openReceivableTxn: { type: "number" },
          openReceivableBase: { type: "number" },
          openPayableTxn: { type: "number" },
          openPayableBase: { type: "number" },
          collectedCoveragePct: { type: "number" },
          recognizedCoveragePct: { type: "number" },
        },
        required: [
          "currencyCode",
          "linkedDocumentCount",
          "activeLinkedDocumentCount",
          "revrecScheduleLineCount",
          "revrecRecognizedRunLineCount",
          "billedAmountTxn",
          "billedAmountBase",
          "collectedAmountTxn",
          "collectedAmountBase",
          "uncollectedAmountTxn",
          "uncollectedAmountBase",
          "revrecScheduledAmountTxn",
          "revrecScheduledAmountBase",
          "recognizedToDateTxn",
          "recognizedToDateBase",
          "deferredBalanceTxn",
          "deferredBalanceBase",
          "openReceivableTxn",
          "openReceivableBase",
          "openPayableTxn",
          "openPayableBase",
          "collectedCoveragePct",
          "recognizedCoveragePct",
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
              financialRollup: {
                $ref: "#/components/schemas/ContractFinancialRollup",
              },
            },
            required: ["lines", "financialRollup"],
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
      ContractLinePatchResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/ContractSummaryRow" },
          line: { $ref: "#/components/schemas/ContractLineRow" },
        },
        required: ["tenantId", "row", "line"],
      },
      ContractAmendmentRow: {
        type: "object",
        properties: {
          amendmentId: intId,
          contractId: intId,
          versionNo: { type: "integer", minimum: 1 },
          amendmentType: { type: "string", enum: ["FULL_REPLACE", "LINE_PATCH"] },
          reason: { type: "string" },
          payload: { type: "object", nullable: true, additionalProperties: true },
          createdByUserId: intId,
          createdAt: { type: "string", nullable: true },
        },
        required: [
          "amendmentId",
          "contractId",
          "versionNo",
          "amendmentType",
          "reason",
          "createdByUserId",
        ],
      },
      ContractAmendmentsResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          contractId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/ContractAmendmentRow" },
          },
        },
        required: ["tenantId", "contractId", "rows"],
      },
      ContractLinkDocumentInput: {
        type: "object",
        properties: {
          cariDocumentId: intId,
          linkType: { type: "string", enum: ["BILLING", "ADVANCE", "ADJUSTMENT"] },
          linkedAmountTxn: positiveNumber(),
          linkedAmountBase: positiveNumber(),
          linkFxRate: positiveNumber(true),
        },
        required: ["cariDocumentId", "linkType", "linkedAmountTxn", "linkedAmountBase"],
      },
      ContractGenerateBillingInput: {
        type: "object",
        properties: {
          docType: { type: "string", enum: ["INVOICE", "ADVANCE", "ADJUSTMENT"] },
          amountStrategy: {
            type: "string",
            enum: ["FULL", "PARTIAL", "MILESTONE"],
          },
          billingDate: { type: "string", format: "date" },
          dueDate: { type: "string", format: "date", nullable: true },
          amountTxn: positiveNumber(true),
          amountBase: positiveNumber(true),
          idempotencyKey: { type: "string", minLength: 1, maxLength: 100 },
          integrationEventUid: { type: "string", maxLength: 100, nullable: true },
          note: { type: "string", maxLength: 500, nullable: true },
          selectedLineIds: {
            type: "array",
            items: intId,
          },
        },
        required: ["docType", "amountStrategy", "billingDate", "idempotencyKey"],
      },
      ContractGenerateRevrecInput: {
        type: "object",
        properties: {
          fiscalPeriodId: intId,
          generationMode: {
            type: "string",
            enum: ["BY_CONTRACT_LINE", "BY_LINKED_DOCUMENT"],
          },
          sourceCariDocumentId: { ...intId, nullable: true },
          regenerateMissingOnly: { type: "boolean" },
          contractLineIds: {
            type: "array",
            items: intId,
          },
        },
        required: ["fiscalPeriodId"],
      },
      ContractLinkAdjustInput: {
        type: "object",
        properties: {
          nextLinkedAmountTxn: positiveNumber(),
          nextLinkedAmountBase: positiveNumber(),
          reason: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["nextLinkedAmountTxn", "nextLinkedAmountBase", "reason"],
      },
      ContractLinkUnlinkInput: {
        type: "object",
        properties: {
          reason: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["reason"],
      },
      ContractDocumentLinkRow: {
        type: "object",
        properties: {
          linkId: intId,
          contractId: intId,
          linkType: { type: "string", enum: ["BILLING", "ADVANCE", "ADJUSTMENT"] },
          linkedAmountTxn: { type: "number" },
          linkedAmountBase: { type: "number" },
          originalLinkedAmountTxn: { type: "number" },
          originalLinkedAmountBase: { type: "number" },
          adjustmentsDeltaTxn: { type: "number" },
          adjustmentsDeltaBase: { type: "number" },
          adjustmentCount: { type: "integer", minimum: 0 },
          isUnlinked: { type: "boolean" },
          createdAt: { type: "string", nullable: true },
          createdByUserId: intId,
          cariDocumentId: intId,
          contractCurrencyCodeSnapshot: { type: "string", nullable: true },
          documentCurrencyCodeSnapshot: { type: "string", nullable: true },
          linkFxRateSnapshot: { type: "number", nullable: true },
          documentNo: { type: "string", nullable: true },
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          status: { type: "string", nullable: true },
          documentDate: { type: "string", format: "date", nullable: true },
          amountTxn: { type: "number", nullable: true },
          amountBase: { type: "number", nullable: true },
        },
        required: [
          "linkId",
          "contractId",
          "linkType",
          "linkedAmountTxn",
          "linkedAmountBase",
          "originalLinkedAmountTxn",
          "originalLinkedAmountBase",
          "adjustmentsDeltaTxn",
          "adjustmentsDeltaBase",
          "adjustmentCount",
          "isUnlinked",
          "createdByUserId",
          "cariDocumentId",
          "contractCurrencyCodeSnapshot",
          "documentCurrencyCodeSnapshot",
          "linkFxRateSnapshot",
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
      ContractLinkableDocumentRow: {
        type: "object",
        properties: {
          id: intId,
          documentNo: { type: "string", nullable: true },
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          status: { type: "string", nullable: true },
          documentDate: { type: "string", format: "date", nullable: true },
          currencyCode: { type: "string", nullable: true },
          amountTxn: { type: "number", nullable: true },
          amountBase: { type: "number", nullable: true },
          openAmountTxn: { type: "number", nullable: true },
          openAmountBase: { type: "number", nullable: true },
          fxRate: { type: "number", nullable: true },
        },
        required: ["id"],
      },
      ContractLinkableDocumentsResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          contractId: intId,
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/ContractLinkableDocumentRow" },
          },
          limit: { type: "integer", minimum: 1 },
          offset: nonNegativeInt,
        },
        required: ["tenantId", "contractId", "rows", "limit", "offset"],
      },
      ContractLinkMutationResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          row: { $ref: "#/components/schemas/ContractDocumentLinkRow" },
        },
        required: ["tenantId", "row"],
      },
      ContractBillingBatchRow: {
        type: "object",
        properties: {
          batchId: intId,
          tenantId: intId,
          legalEntityId: intId,
          contractId: intId,
          idempotencyKey: { type: "string", nullable: true },
          integrationEventUid: { type: "string", nullable: true },
          sourceModule: { type: "string", nullable: true },
          sourceEntityType: { type: "string", nullable: true },
          sourceEntityId: { type: "string", nullable: true },
          docType: { type: "string", enum: ["INVOICE", "ADVANCE", "ADJUSTMENT"], nullable: true },
          amountStrategy: {
            type: "string",
            enum: ["FULL", "PARTIAL", "MILESTONE"],
            nullable: true,
          },
          billingDate: { type: "string", format: "date", nullable: true },
          dueDate: { type: "string", format: "date", nullable: true },
          amountTxn: { type: "number", nullable: true },
          amountBase: { type: "number", nullable: true },
          currencyCode: { type: "string", nullable: true },
          selectedLineIds: {
            type: "array",
            items: intId,
          },
          status: { type: "string", enum: ["PENDING", "COMPLETED", "FAILED"], nullable: true },
          generatedDocumentId: { ...intId, nullable: true },
          generatedLinkId: { ...intId, nullable: true },
          payload: { type: "object", additionalProperties: true, nullable: true },
          createdByUserId: intId,
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
        },
        required: [
          "batchId",
          "tenantId",
          "legalEntityId",
          "contractId",
          "selectedLineIds",
          "createdByUserId",
        ],
      },
      ContractGeneratedBillingDocumentRow: {
        type: "object",
        properties: {
          id: intId,
          tenantId: intId,
          legalEntityId: intId,
          contractId: intId,
          counterpartyId: intId,
          direction: { type: "string", enum: ["AR", "AP"], nullable: true },
          documentType: { type: "string", nullable: true },
          status: { type: "string", nullable: true },
          documentNo: { type: "string", nullable: true },
          documentDate: { type: "string", format: "date", nullable: true },
          dueDate: { type: "string", format: "date", nullable: true },
          amountTxn: { type: "number", nullable: true },
          amountBase: { type: "number", nullable: true },
          openAmountTxn: { type: "number", nullable: true },
          openAmountBase: { type: "number", nullable: true },
          currencyCode: { type: "string", nullable: true },
          fxRate: { type: "number", nullable: true },
          sourceModule: { type: "string", nullable: true },
          sourceEntityType: { type: "string", nullable: true },
          sourceEntityId: { type: "string", nullable: true },
          integrationLinkStatus: { type: "string", nullable: true },
          integrationEventUid: { type: "string", nullable: true },
          createdAt: { type: "string", nullable: true },
          updatedAt: { type: "string", nullable: true },
        },
        required: [
          "id",
          "tenantId",
          "legalEntityId",
          "contractId",
          "counterpartyId",
        ],
      },
      ContractGenerateBillingResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          idempotentReplay: { type: "boolean" },
          billingBatch: { $ref: "#/components/schemas/ContractBillingBatchRow" },
          document: { $ref: "#/components/schemas/ContractGeneratedBillingDocumentRow" },
          link: { $ref: "#/components/schemas/ContractDocumentLinkRow" },
        },
        required: ["tenantId", "idempotentReplay", "billingBatch", "document", "link"],
      },
      ContractGenerateRevrecResponse: {
        type: "object",
        properties: {
          tenantId: intId,
          contractId: intId,
          legalEntityId: intId,
          idempotentReplay: { type: "boolean" },
          generationMode: {
            type: "string",
            enum: ["BY_CONTRACT_LINE", "BY_LINKED_DOCUMENT"],
          },
          accountFamily: {
            type: "string",
            enum: ["DEFREV", "PREPAID_EXPENSE"],
          },
          sourceCariDocumentId: { ...intId, nullable: true },
          generatedScheduleCount: { type: "integer", minimum: 0 },
          generatedLineCount: { type: "integer", minimum: 0 },
          skippedLineCount: { type: "integer", minimum: 0 },
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/RevenueScheduleRow" },
          },
        },
        required: [
          "tenantId",
          "contractId",
          "legalEntityId",
          "idempotentReplay",
          "generationMode",
          "accountFamily",
          "generatedScheduleCount",
          "generatedLineCount",
          "skippedLineCount",
          "rows",
        ],
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
applyCashOperationOverrides(spec);
applyInventoryOperationOverrides(spec);
applyFixedAssetsOperationOverrides(spec);
applyContractsOperationOverrides(spec);
applyRevenueRecognitionOperationOverrides(spec);
applyBankAccountOperationOverrides(spec);
applyShareholderCapitalOperationOverrides(spec);
applyPaymentsOperationOverrides(spec);
applyPayrollOperationOverrides(spec);

const targetPath = path.resolve(backendRoot, "openapi.yaml");
fs.writeFileSync(targetPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
console.log(
  `Generated ${targetPath} (auto-documented operations added: ${autoDocumentedOperationCount})`
);
