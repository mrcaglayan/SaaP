import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCariDocumentsFeatureSource } from "./_cariDocumentsFeatureSource.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCommand(command, args, cwd, label = command, useShell = false) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: "inherit",
      shell: useShell,
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function runNpmScript(scriptName, cwd) {
  if (process.platform === "win32") {
    await runCommand(
      "cmd.exe",
      ["/d", "/s", "/c", `npm run ${scriptName}`],
      cwd,
      `npm run ${scriptName}`
    );
    return;
  }
  await runCommand("npm", ["run", scriptName], cwd, `npm run ${scriptName}`);
}

function findOperation(spec, routePath, method) {
  return spec?.paths?.[routePath]?.[method] || null;
}

function getResponseSchemaRef(operation, statusCode) {
  return (
    operation?.responses?.[statusCode]?.content?.["application/json"]?.schema?.$ref || null
  );
}

function getRequestBodySchemaRef(operation) {
  return (
    operation?.requestBody?.content?.["application/json"]?.schema?.$ref || null
  );
}

function assertTaggedOperation(spec, routePath, method, expectedTag) {
  const operation = findOperation(spec, routePath, method);
  assert(operation, `Missing OpenAPI operation: ${method.toUpperCase()} ${routePath}`);
  const tags = Array.isArray(operation.tags) ? operation.tags : [];
  assert(
    tags.includes(expectedTag),
    `OpenAPI operation must be tagged ${expectedTag}: ${method.toUpperCase()} ${routePath}`
  );
  assert(
    !tags.includes("System"),
    `OpenAPI operation must not fall back to System tag: ${method.toUpperCase()} ${routePath}`
  );
  assert(
    !String(operation.summary || "").startsWith("Auto-generated:"),
    `OpenAPI operation must have explicit summary: ${method.toUpperCase()} ${routePath}`
  );
}

function assertOpenApiContracts(spec) {
  const tagNames = new Set((spec.tags || []).map((tag) => String(tag?.name || "")));
  assert(tagNames.has("Inventory"), "OpenAPI must define Inventory tag");
  assert(tagNames.has("Items"), "OpenAPI must define Items tag");

  assertTaggedOperation(spec, "/api/v1/items/cards", "get", "Items");
  assertTaggedOperation(spec, "/api/v1/items/cards", "post", "Items");
  assertTaggedOperation(spec, "/api/v1/items/cards/{itemCardId}", "get", "Items");
  assertTaggedOperation(spec, "/api/v1/items/cards/{itemCardId}", "patch", "Items");
  assertTaggedOperation(spec, "/api/v1/inventory/warehouses", "get", "Inventory");
  assertTaggedOperation(spec, "/api/v1/inventory/warehouses", "post", "Inventory");
  assertTaggedOperation(spec, "/api/v1/inventory/work-queue-summary", "get", "Inventory");
  assertTaggedOperation(spec, "/api/v1/inventory/cari-stock-links", "get", "Inventory");
  assertTaggedOperation(
    spec,
    "/api/v1/inventory/cari-stock-links/{stockLinkId}/materialize",
    "post",
    "Inventory"
  );
  assertTaggedOperation(spec, "/api/v1/inventory/movements", "get", "Inventory");
  assertTaggedOperation(spec, "/api/v1/inventory/movements", "post", "Inventory");
  assertTaggedOperation(spec, "/api/v1/inventory/movements/{movementId}/reverse", "post", "Inventory");
  assertTaggedOperation(spec, "/api/v1/inventory/cost-layers", "get", "Inventory");
  assertTaggedOperation(spec, "/api/v1/cari/documents", "get", "Cari");
  assertTaggedOperation(spec, "/api/v1/cari/documents", "post", "Cari");
  assertTaggedOperation(spec, "/api/v1/cari/documents/warehouse-options", "get", "Cari");
  assertTaggedOperation(spec, "/api/v1/cari/documents/{documentId}", "get", "Cari");
  assertTaggedOperation(spec, "/api/v1/cari/documents/{documentId}", "put", "Cari");
  assertTaggedOperation(spec, "/api/v1/cari/documents/{documentId}/cancel", "post", "Cari");
  assertTaggedOperation(spec, "/api/v1/cari/documents/{documentId}/open-items", "get", "Cari");
  assertTaggedOperation(spec, "/api/v1/cari/documents/{documentId}/post", "post", "Cari");
  assertTaggedOperation(spec, "/api/v1/cari/documents/{documentId}/reverse", "post", "Cari");

  const requiredSchemas = [
    "CariDocumentLineTaxRow",
    "CariDocumentLineStockLinkRow",
    "CariDocumentLineRow",
    "CariDocumentRow",
    "CariDocumentListResponse",
    "CariDocumentResponse",
    "CariDocumentWarehouseLookupRow",
    "CariDocumentWarehouseLookupResponse",
    "CariDocumentOpenItemRow",
    "CariDocumentOpenItemListResponse",
    "CariDocumentCreateRequest",
    "CariDocumentUpdateRequest",
    "CariDocumentPostRequest",
    "CariDocumentPostResponse",
    "CariDocumentReverseRequest",
    "CariDocumentReverseResponse",
    "ItemCardRow",
    "ItemCardListResponse",
    "ItemCardResponse",
    "ItemCardUpsertRequest",
    "InventoryWarehouseRow",
    "InventoryWarehouseListResponse",
    "InventoryWarehouseCreateRequest",
    "InventoryStockLinkQueueState",
    "InventoryStockLinkQueueScope",
    "InventoryPendingStockLinkRow",
    "InventoryPendingStockLinkListResponse",
    "InventoryWorkQueueSummaryResponse",
    "InventoryMovementRow",
    "InventoryMovementResponse",
    "InventoryStockLinkMaterializeRequest",
    "InventoryMovementCreateRequest",
    "InventoryMovementReverseRequest",
    "InventoryCostLayerRow",
    "InventoryCostLayerListResponse",
    "InventoryIssueLayerConsumptionRow",
  ];
  for (const schemaName of requiredSchemas) {
    assert(
      spec?.components?.schemas?.[schemaName],
      `OpenAPI schema missing: ${schemaName}`
    );
  }

  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents", "get"), "200") ===
      "#/components/schemas/CariDocumentListResponse",
    "GET /api/v1/cari/documents must return CariDocumentListResponse"
  );
  assert(
    getRequestBodySchemaRef(findOperation(spec, "/api/v1/cari/documents", "post")) ===
      "#/components/schemas/CariDocumentCreateRequest",
    "POST /api/v1/cari/documents must use CariDocumentCreateRequest"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents", "post"), "201") ===
      "#/components/schemas/CariDocumentResponse",
    "POST /api/v1/cari/documents must return CariDocumentResponse"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents/warehouse-options", "get"), "200") ===
      "#/components/schemas/CariDocumentWarehouseLookupResponse",
    "GET /api/v1/cari/documents/warehouse-options must return CariDocumentWarehouseLookupResponse"
  );
  assert(
    Array.isArray(findOperation(spec, "/api/v1/cari/documents/warehouse-options", "get")?.parameters) &&
      findOperation(spec, "/api/v1/cari/documents/warehouse-options", "get").parameters.some(
        (parameter) => String(parameter?.name || "") === "legalEntityId"
      ) &&
      findOperation(spec, "/api/v1/cari/documents/warehouse-options", "get").parameters.some(
        (parameter) => String(parameter?.name || "") === "operatingUnitId"
      ),
    "GET /api/v1/cari/documents/warehouse-options must document legalEntityId and operatingUnitId filters"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}", "get"), "200") ===
      "#/components/schemas/CariDocumentResponse",
    "GET /api/v1/cari/documents/{documentId} must return CariDocumentResponse"
  );
  assert(
    getRequestBodySchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}", "put")) ===
      "#/components/schemas/CariDocumentUpdateRequest",
    "PUT /api/v1/cari/documents/{documentId} must use CariDocumentUpdateRequest"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}", "put"), "200") ===
      "#/components/schemas/CariDocumentResponse",
    "PUT /api/v1/cari/documents/{documentId} must return CariDocumentResponse"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}/cancel", "post"), "200") ===
      "#/components/schemas/CariDocumentResponse",
    "POST /api/v1/cari/documents/{documentId}/cancel must return CariDocumentResponse"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}/open-items", "get"), "200") ===
      "#/components/schemas/CariDocumentOpenItemListResponse",
    "GET /api/v1/cari/documents/{documentId}/open-items must return CariDocumentOpenItemListResponse"
  );
  assert(
    getRequestBodySchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}/post", "post")) ===
      "#/components/schemas/CariDocumentPostRequest",
    "POST /api/v1/cari/documents/{documentId}/post must use CariDocumentPostRequest"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}/post", "post"), "200") ===
      "#/components/schemas/CariDocumentPostResponse",
    "POST /api/v1/cari/documents/{documentId}/post must return CariDocumentPostResponse"
  );
  assert(
    getRequestBodySchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}/reverse", "post")) ===
      "#/components/schemas/CariDocumentReverseRequest",
    "POST /api/v1/cari/documents/{documentId}/reverse must use CariDocumentReverseRequest"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/cari/documents/{documentId}/reverse", "post"), "201") ===
      "#/components/schemas/CariDocumentReverseResponse",
    "POST /api/v1/cari/documents/{documentId}/reverse must return CariDocumentReverseResponse"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/items/cards", "get"), "200") ===
      "#/components/schemas/ItemCardListResponse",
    "GET /api/v1/items/cards must return ItemCardListResponse"
  );
  assert(
    getRequestBodySchemaRef(findOperation(spec, "/api/v1/items/cards", "post")) ===
      "#/components/schemas/ItemCardUpsertRequest",
    "POST /api/v1/items/cards must use ItemCardUpsertRequest"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/inventory/work-queue-summary", "get"), "200") ===
      "#/components/schemas/InventoryWorkQueueSummaryResponse",
    "GET /api/v1/inventory/work-queue-summary must return InventoryWorkQueueSummaryResponse"
  );
  assert(
    getResponseSchemaRef(
      findOperation(spec, "/api/v1/inventory/cari-stock-links/{stockLinkId}/materialize", "post"),
      "201"
    ) === "#/components/schemas/InventoryMovementResponse",
    "POST /api/v1/inventory/cari-stock-links/{stockLinkId}/materialize must return InventoryMovementResponse"
  );
  assert(
    getRequestBodySchemaRef(
      findOperation(spec, "/api/v1/inventory/cari-stock-links/{stockLinkId}/materialize", "post")
    ) === "#/components/schemas/InventoryStockLinkMaterializeRequest",
    "POST /api/v1/inventory/cari-stock-links/{stockLinkId}/materialize must use InventoryStockLinkMaterializeRequest"
  );
  assert(
    /bound warehouse/i.test(
      String(
        findOperation(spec, "/api/v1/inventory/cari-stock-links/{stockLinkId}/materialize", "post")
          ?.summary || ""
      )
    ),
    "Strict stock-link materialize route summary must describe bound-warehouse execution"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/inventory/movements", "post"), "201") ===
      "#/components/schemas/InventoryMovementResponse",
    "POST /api/v1/inventory/movements must return InventoryMovementResponse"
  );
  assert(
    getRequestBodySchemaRef(findOperation(spec, "/api/v1/inventory/movements", "post")) ===
      "#/components/schemas/InventoryMovementCreateRequest",
    "POST /api/v1/inventory/movements must use InventoryMovementCreateRequest"
  );
  assert(
    /legacy-only non-strict/i.test(
      String(findOperation(spec, "/api/v1/inventory/movements", "post")?.summary || "")
    ),
    "POST /api/v1/inventory/movements summary must document the legacy-only non-strict role"
  );
  assert(
    spec?.components?.schemas?.CariDocumentLineRow?.properties?.warehouseId,
    "CariDocumentLineRow must expose warehouseId"
  );
  assert(
    spec?.components?.schemas?.CariDocumentLineRow?.properties?.warehouseCode,
    "CariDocumentLineRow must expose warehouseCode"
  );
  assert(
    spec?.components?.schemas?.CariDocumentLineRow?.properties?.warehouseName,
    "CariDocumentLineRow must expose warehouseName"
  );
  assert(
    spec?.components?.schemas?.CariDocumentLineInput?.properties?.warehouseId,
    "CariDocumentLineInput must accept warehouseId"
  );
  assert(
    !spec?.components?.schemas?.CariDocumentLineInput?.properties?.warehouseCode,
    "CariDocumentLineInput must not accept warehouseCode"
  );
  assert(
    !spec?.components?.schemas?.CariDocumentLineInput?.properties?.warehouseName,
    "CariDocumentLineInput must not accept warehouseName"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.blockedReasonCode,
    "InventoryPendingStockLinkRow must expose blockedReasonCode"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.boundWarehouseId,
    "InventoryPendingStockLinkRow must expose boundWarehouseId"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.boundWarehouseCode,
    "InventoryPendingStockLinkRow must expose boundWarehouseCode"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.boundWarehouseName,
    "InventoryPendingStockLinkRow must expose boundWarehouseName"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.queueState,
    "InventoryPendingStockLinkRow must expose queueState"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.canMaterialize,
    "InventoryPendingStockLinkRow must expose canMaterialize"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.isStrictMode,
    "InventoryPendingStockLinkRow must expose isStrictMode"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.isRepairOnly,
    "InventoryPendingStockLinkRow must expose isRepairOnly"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.isLegacyRow,
    "InventoryPendingStockLinkRow must expose isLegacyRow"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.boundAvailableQuantity,
    "InventoryPendingStockLinkRow must expose boundAvailableQuantity"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.crossContextAvailableQuantity,
    "InventoryPendingStockLinkRow must expose crossContextAvailableQuantity"
  );
  assert(
    spec?.components?.schemas?.InventoryPendingStockLinkRow?.properties?.transferSourceWarehouseId,
    "InventoryPendingStockLinkRow must expose transferSourceWarehouseId"
  );
  assert(
    spec?.components?.schemas?.InventoryWorkQueueSummaryResponse?.properties?.stockLinks?.properties
      ?.completed_total,
    "InventoryWorkQueueSummaryResponse must expose completed_total"
  );
  assert(
    spec?.components?.schemas?.InventoryWorkQueueSummaryResponse?.properties?.stockLinks?.properties
      ?.void_total,
    "InventoryWorkQueueSummaryResponse must expose void_total"
  );
  assert(
    Array.isArray(findOperation(spec, "/api/v1/inventory/cari-stock-links", "get")?.parameters) &&
      findOperation(spec, "/api/v1/inventory/cari-stock-links", "get").parameters.some(
        (parameter) => String(parameter?.name || "") === "queueScope"
      ),
    "GET /api/v1/inventory/cari-stock-links must document the queueScope parameter"
  );
  assert(
    getRequestBodySchemaRef(
      findOperation(spec, "/api/v1/inventory/movements/{movementId}/reverse", "post")
    ) === "#/components/schemas/InventoryMovementReverseRequest",
    "POST /api/v1/inventory/movements/{movementId}/reverse must use InventoryMovementReverseRequest"
  );
  assert(
    getResponseSchemaRef(findOperation(spec, "/api/v1/inventory/cost-layers", "get"), "200") ===
      "#/components/schemas/InventoryCostLayerListResponse",
    "GET /api/v1/inventory/cost-layers must return InventoryCostLayerListResponse"
  );
}

function assertContains(source, expected, message) {
  assert(source.includes(expected), message);
}

function assertNotContains(source, unexpected, message) {
  assert(!source.includes(unexpected), message);
}

function assertDocs(runbookSource, supportGuideSource, rolloutSource, regressionSource) {
  assertContains(
    runbookSource,
    "## Inventory and Item-Card Permissions",
    "Cari runbook must document inventory/item-card permissions"
  );
  assertContains(
    runbookSource,
    "## Issue Valuation and COGS Posting Lifecycle",
    "Cari runbook must document issue valuation lifecycle"
  );
  assertContains(
    runbookSource,
    "`ISSUE` -> `VALUED` when stock is available and FIFO consumption succeeds",
    "Cari runbook must reflect valued issue flow"
  );
  assertContains(
    runbookSource,
    "`cd backend && npm run db:seed:core`",
    "Cari runbook must include permission backfill command"
  );
  assertContains(
    runbookSource,
    "choose warehouse on each stock-affecting CARI line before posting",
    "Cari runbook must describe upstream warehouse choice before post"
  );
  assertContains(
    runbookSource,
    "## Inventory Unwind Order Before CARI Reverse",
    "Cari runbook must document the inventory unwind order before CARI reverse"
  );
  assertContains(
    runbookSource,
    "/app/stok-yansitma-islemleri",
    "Cari runbook must point operators to the inventory movements route"
  );
  assertContains(
    runbookSource,
    "retry CARI reverse only after the blocking inventory movement is no longer active",
    "Cari runbook must document when CARI reverse can be retried"
  );

  assertContains(
    supportGuideSource,
    "issue movement -> `VALUED`",
    "Support guide must reflect valued issue materialization"
  );
  assertContains(
    supportGuideSource,
    "COGS journal",
    "Support guide must mention COGS journal behavior"
  );
  assertContains(
    supportGuideSource,
    "Reverse valued issue",
    "Support guide must mention issue reversal workflow"
  );
  assertContains(
    supportGuideSource,
    "inventory.read",
    "Support guide must mention inventory permissions"
  );
  assertContains(
    supportGuideSource,
    "Queue Scope",
    "Support guide must explain queue-scope behavior"
  );
  assertContains(
    supportGuideSource,
    "`ACTIONABLE`",
    "Support guide must document the actionable queue scope"
  );
  assertContains(
    supportGuideSource,
    "## CARI Reverse Blocked By Inventory",
    "Support guide must explain the inventory reverse blocker"
  );
  assertContains(
    supportGuideSource,
    "reopened successor pending stock link",
    "Support guide must explain successor stock-link rematerialization"
  );
  assertContains(
    supportGuideSource,
    "## Undo Materialized Receipt",
    "Support guide must explain receipt undo flow"
  );

  assertContains(
    rolloutSource,
    "# Inventory and Item-Card Rollout Runbook",
    "Inventory rollout runbook heading missing"
  );
  assertContains(
    rolloutSource,
    "`item.card.read`",
    "Inventory rollout runbook must mention item-card permissions"
  );
  assertContains(
    rolloutSource,
    "`inventory.read`",
    "Inventory rollout runbook must mention inventory permissions"
  );
  assertContains(
    rolloutSource,
    "Choose warehouse on each stock-affecting CARI line in CARI, then post the document.",
    "Inventory rollout runbook must describe upstream warehouse choice in CARI"
  );
  assertContains(
    rolloutSource,
    "FIFO outbound issue valuation",
    "Inventory rollout runbook must mention FIFO issue valuation"
  );
  assertContains(
    rolloutSource,
    "Dr COGS",
    "Inventory rollout runbook must mention COGS posting"
  );
  assertContains(
    rolloutSource,
    "Reverse one valued outbound issue",
    "Inventory rollout runbook must mention issue reversal"
  );
  assertContains(
    rolloutSource,
    "base currency",
    "Inventory rollout runbook must mention base-currency valuation"
  );
  assertContains(
    rolloutSource,
    "successor pending stock link",
    "Inventory rollout runbook must mention successor rematerialization"
  );
  assertContains(
    rolloutSource,
    "CARI reverse stays blocked until the linked issue/receipt effect is no longer active",
    "Inventory rollout runbook must document the CARI reverse blocker lifecycle"
  );
  assertContains(
    rolloutSource,
    "receipt can be undone only when no later issue chronology still depends on its remaining layer history",
    "Inventory rollout runbook must document receipt undo chronology"
  );
  assertContains(
    rolloutSource,
    "Queue Scope",
    "Inventory rollout runbook must explain queue-scope behavior"
  );
  assertContains(
    rolloutSource,
    "npm run test:inventory:release-gate",
    "Inventory rollout runbook must include release-gate command"
  );

  assertContains(
    regressionSource,
    "stock-affecting lines require warehouse binding before post",
    "Regression matrix must document strict warehouse binding before post"
  );
  assertContains(
    regressionSource,
    "### 5. Inventory materialization",
    "Regression matrix must keep inventory materialization scenario"
  );
  assertContains(
    regressionSource,
    "strict materialization uses the already-bound warehouse instead of a caller-selected queue warehouse",
    "Regression matrix must describe bound-warehouse materialization"
  );
  assertContains(
    regressionSource,
    "issue movement becomes `VALUED`",
    "Regression matrix must reflect valued issue"
  );
  assertContains(
    regressionSource,
    "outbound issue posts one `Dr COGS / Cr Inventory` journal",
    "Regression matrix must include COGS posting"
  );
  assertContains(
    regressionSource,
    "### 6. Line-tax UX and RBAC split",
    "Regression matrix must include line-tax/RBAC scenario"
  );
  assertContains(
    regressionSource,
    "### 7. Valued issue reversal",
    "Regression matrix must include issue reversal scenario"
  );
  assertContains(
    regressionSource,
    "### 8. Mixed-currency FIFO issue valuation",
    "Regression matrix must include mixed-currency valuation scenario"
  );
  assertContains(
    regressionSource,
    "### 9. CARI reverse blocked by active linked issue",
    "Regression matrix must include blocked issue reverse scenario"
  );
  assertContains(
    regressionSource,
    "### 10. Successor rematerialization after issue reverse",
    "Regression matrix must include successor rematerialization scenario"
  );
  assertContains(
    regressionSource,
    "### 11. CARI reverse blocked by active linked receipt",
    "Regression matrix must include blocked receipt reverse scenario"
  );
  assertContains(
    regressionSource,
    "### 12. Receipt undo chronology and blocker clear",
    "Regression matrix must include receipt undo chronology scenario"
  );
}

function assertSourceGuards(
  cariRouteSource,
  cariApiSource,
  cariPageSource,
  inventoryPageSource,
  inventoryRouteSource,
  itemRouteSource,
  seedSource,
  regressionScriptSource
) {
  assertContains(
    cariRouteSource,
    '"/warehouse-options"',
    "CARI routes must define the warehouse-options endpoint"
  );
  assertContains(
    cariRouteSource,
    'requirePermission("cari.doc.read"',
    "CARI warehouse lookup route must stay under cari.doc.read"
  );
  assertContains(
    cariApiSource,
    "/api/v1/cari/documents/warehouse-options",
    "CARI API client must use the warehouse-options endpoint"
  );
  assertContains(
    cariPageSource,
    "Split posting is disabled because this draft already stores line-level taxes.",
    "CARI page must keep split-posting disable message for stored-tax drafts"
  );
  assertContains(
    cariPageSource,
    "Use the inventory movement links below, then retry the document reverse.",
    "CARI page must guide operators to inventory movement links before retrying reverse"
  );
  assertContains(
    cariPageSource,
    "/app/stok-yansitma-islemleri",
    "CARI page must link blocked reverse rows to the inventory movements route"
  );
  assertContains(
    inventoryPageSource,
    "Focused from CARI reverse blocker",
    "Inventory page must surface deep-link focus guidance from blocked CARI reverse"
  );
  assertContains(
    inventoryPageSource,
    'searchParams.get("movementId")',
    "Inventory page must understand deep-linked movement ids"
  );
  assertContains(
    inventoryPageSource,
    "Queue Scope",
    "Inventory page must expose explicit queue-scope controls"
  );
  assertNotContains(
    inventoryPageSource,
    "Select pending link",
    "Inventory page must not keep the old pending-link dropdown workflow"
  );
  assertContains(
    inventoryRouteSource,
    'requirePermission("inventory.read"',
    "Inventory routes must guard reads with inventory.read"
  );
  assertContains(
    inventoryRouteSource,
    'requirePermission("inventory.upsert"',
    "Inventory routes must guard writes with inventory.upsert"
  );
  assertContains(
    itemRouteSource,
    'requirePermission("item.card.read"',
    "Item-card routes must guard reads with item.card.read"
  );
  assertContains(
    itemRouteSource,
    'requirePermission("item.card.upsert"',
    "Item-card routes must guard writes with item.card.upsert"
  );
  assertContains(
    seedSource,
    '["item.card.read", "Read item cards"]',
    "seedCore must define item.card.read"
  );
  assertContains(
    seedSource,
    '["inventory.read", "Read inventory warehouses, stock links, movements, and cost layers"]',
    "seedCore must define inventory.read"
  );
  assertContains(
    regressionScriptSource,
    "Issue COGS journal must debit the item card COGS account",
    "Rollout regression must assert COGS debit account"
  );
  assertContains(
    regressionScriptSource,
    "Replaying the same issue materialization must reuse the existing COGS journal",
    "Rollout regression must assert idempotent COGS journal reuse"
  );
  assertContains(
    regressionScriptSource,
    "Document reverse should be blocked by linked inventory movement",
    "Rollout regression must assert blocked CARI reverse by inventory"
  );
  assertContains(
    regressionScriptSource,
    "Issue reversal must create one reopened successor stock link",
    "Rollout regression must assert successor stock-link creation"
  );
  assertContains(
    regressionScriptSource,
    "Partially consumed receipt undo must fail while later issue consumption is still active",
    "Rollout regression must assert receipt undo chronology block"
  );
  assertContains(
    regressionScriptSource,
    "Receipt undo must clear the inventory blocker so the AP document can reverse",
    "Rollout regression must assert blocker clear after receipt undo"
  );
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(backendRoot, "..");

  await runNpmScript("test:permission-matrix", backendRoot);
  await runNpmScript("test:cari:line-model-rollout", backendRoot);
  await runNpmScript("openapi:generate", backendRoot);
  await runNpmScript("check:openapi:parse", backendRoot);
  await runNpmScript("check:openapi", backendRoot);

  const openapiSource = await readFile(path.resolve(backendRoot, "openapi.yaml"), "utf8");
  const spec = JSON.parse(openapiSource);
  assertOpenApiContracts(spec);

  const cariRunbookSource = await readFile(
    path.resolve(repoRoot, "docs", "runbooks", "cari-v1-operations.md"),
    "utf8"
  );
  const inventoryRolloutSource = await readFile(
    path.resolve(repoRoot, "docs", "runbooks", "inventory-item-card-rollout.md"),
    "utf8"
  );
  const supportGuideSource = await readFile(
    path.resolve(repoRoot, "docs", "runbooks", "cari-v1-support-finance-ui-guide.md"),
    "utf8"
  );
  const regressionSource = await readFile(
    path.resolve(repoRoot, "docs", "specs", "cari-line-model-regression-matrix.md"),
    "utf8"
  );
  assertDocs(cariRunbookSource, supportGuideSource, inventoryRolloutSource, regressionSource);

  const cariPageSource = await readCariDocumentsFeatureSource(repoRoot);
  const cariRouteSource = await readFile(
    path.resolve(repoRoot, "backend", "src", "routes", "cari.document.routes.js"),
    "utf8"
  );
  const cariApiSource = await readFile(
    path.resolve(repoRoot, "frontend", "src", "api", "cariDocuments.js"),
    "utf8"
  );
  const inventoryPageSource = await readFile(
    path.resolve(repoRoot, "frontend", "src", "pages", "inventory", "InventoryMovementsPage.jsx"),
    "utf8"
  );
  const inventoryRouteSource = await readFile(
    path.resolve(repoRoot, "backend", "src", "routes", "inventory.routes.js"),
    "utf8"
  );
  const itemRouteSource = await readFile(
    path.resolve(repoRoot, "backend", "src", "routes", "item.card.routes.js"),
    "utf8"
  );
  const seedSource = await readFile(
    path.resolve(repoRoot, "backend", "src", "seedCore.js"),
    "utf8"
  );
  const regressionScriptSource = await readFile(
    path.resolve(
      repoRoot,
      "backend",
      "scripts",
      "test-cari-line-model-rollout-regression.js"
    ),
    "utf8"
  );
  assertSourceGuards(
    cariRouteSource,
    cariApiSource,
    cariPageSource,
    inventoryPageSource,
    inventoryRouteSource,
    itemRouteSource,
    seedSource,
    regressionScriptSource
  );

  await runCommand(
    "git",
    ["diff", "--exit-code", "--", "backend/openapi.yaml"],
    repoRoot,
    "git diff --exit-code -- backend/openapi.yaml"
  );

  console.log("Inventory release gate passed.");
  console.log(
    JSON.stringify(
      {
        documentedPaths: [
          "/api/v1/cari/documents/warehouse-options",
          "/api/v1/items/cards",
          "/api/v1/items/cards/{itemCardId}",
          "/api/v1/inventory/warehouses",
          "/api/v1/inventory/cari-stock-links",
          "/api/v1/inventory/cari-stock-links/{stockLinkId}/materialize",
          "/api/v1/inventory/movements",
          "/api/v1/inventory/cost-layers",
        ],
        docsChecked: [
          "docs/runbooks/cari-v1-operations.md",
          "docs/runbooks/cari-v1-support-finance-ui-guide.md",
          "docs/runbooks/inventory-item-card-rollout.md",
          "docs/specs/cari-line-model-regression-matrix.md",
        ],
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
