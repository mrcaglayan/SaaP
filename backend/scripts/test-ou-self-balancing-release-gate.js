import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

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

    child.on("error", (error) => reject(error));
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

function assertTaggedExplicitOperation(spec, routePath, method, expectedTag) {
  const operation = findOperation(spec, routePath, method);
  assert(operation, `OpenAPI path missing: ${method.toUpperCase()} ${routePath}`);

  const tags = Array.isArray(operation.tags) ? operation.tags : [];
  assert(
    tags.includes(expectedTag),
    `OpenAPI operation must be tagged ${expectedTag}: ${method.toUpperCase()} ${routePath}`
  );
  assert(
    !String(operation.summary || "").startsWith("Auto-generated:"),
    `OpenAPI operation must have explicit summary: ${method.toUpperCase()} ${routePath}`
  );
}

function requireSchema(spec, schemaName) {
  const schema = spec?.components?.schemas?.[schemaName] || null;
  assert(schema, `OpenAPI schema missing: ${schemaName}`);
  return schema;
}

function assertSchemaProperty(schema, propertyName, message) {
  assert(
    schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, propertyName),
    message
  );
}

function assertManifestAndPackage(packageSource, manifestSource) {
  const pkg = JSON.parse(packageSource);
  const manifest = JSON.parse(manifestSource);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];

  const inventoryOuScripts = [
    "test:inventory:ou01",
    "test:inventory:ou02",
    "test:inventory:ou03",
    "test:inventory:ou04",
    "test:inventory:ou05",
    "test:inventory:ou06",
    "test:inventory:ou07",
    "test:inventory:ou12",
    "test:cari:ou08",
    "test:cari:ou09",
    "test:cari:ou10",
    "test:cari:ou11",
    "test:ou:self-balancing:release-gate",
  ];
  for (const scriptName of inventoryOuScripts) {
    assert(typeof scripts[scriptName] === "string", `package.json script missing: ${scriptName}`);
  }

  assert(
    String(scripts["test:release-gate:core"] || "").includes("test:ou:self-balancing:release-gate"),
    "Core release gate must include test:ou:self-balancing:release-gate"
  );

  const transferManifestEntry = entries.find(
    (entry) => String(entry?.routePath || "").trim() === "/app/stok-transferleri"
  );
  assert(
    transferManifestEntry,
    "Release-gate manifest must include /app/stok-transferleri"
  );
  assert(
    transferManifestEntry.smokeScriptPath === "backend/scripts/test-ou-self-balancing-release-gate.js",
    "Transfer route manifest smokeScriptPath must point to backend/scripts/test-ou-self-balancing-release-gate.js"
  );
  assert(
    transferManifestEntry.packageScriptName === "test:ou:self-balancing:release-gate",
    "Transfer route manifest packageScriptName must be test:ou:self-balancing:release-gate"
  );
}

function assertOpenApi(spec) {
  const inventoryTaggedPaths = [
    ["/api/v1/inventory/transfers", "get"],
    ["/api/v1/inventory/transfers", "post"],
    ["/api/v1/inventory/transfers/{transferId}", "get"],
    ["/api/v1/inventory/transfers/{transferId}/approve", "post"],
    ["/api/v1/inventory/transfers/{transferId}/ship", "post"],
    ["/api/v1/inventory/transfers/{transferId}/receive", "post"],
    ["/api/v1/inventory/transfers/{transferId}/cancel", "post"],
    ["/api/v1/inventory/transfers/{transferId}/reverse", "post"],
    ["/api/v1/inventory/transfers/{transferId}/evidence", "get"],
    ["/api/v1/inventory/transfers/{transferId}/evidence", "post"],
    ["/api/v1/inventory/transfers/{transferId}/evidence/{evidenceId}", "delete"],
    ["/api/v1/inventory/transfers/{transferId}/evidence/{evidenceId}/content", "put"],
    ["/api/v1/inventory/transfers/{transferId}/evidence/{evidenceId}/download", "get"],
  ];
  for (const [routePath, method] of inventoryTaggedPaths) {
    assertTaggedExplicitOperation(spec, routePath, method, "Inventory");
  }

  assertTaggedExplicitOperation(
    spec,
    "/api/v1/cari/settlements/{settlementBatchId}/reverse",
    "post",
    "Cari"
  );
  assertTaggedExplicitOperation(spec, "/api/v1/cari/reports/open-items", "get", "Cari");
  assertTaggedExplicitOperation(spec, "/api/v1/cari/reports/statement", "get", "Cari");
  assertTaggedExplicitOperation(
    spec,
    "/api/v1/cari/reports/settlement-realized-fx",
    "get",
    "Cari"
  );

  const itemCardRow = requireSchema(spec, "ItemCardRow");
  const itemCardUpsertRequest = requireSchema(spec, "ItemCardUpsertRequest");
  const warehouseRow = requireSchema(spec, "InventoryWarehouseRow");
  const warehouseCreateRequest = requireSchema(spec, "InventoryWarehouseCreateRequest");
  const movementRow = requireSchema(spec, "InventoryMovementRow");
  const transferRow = requireSchema(spec, "InventoryTransferRow");
  const transferEvidenceRow = requireSchema(spec, "InventoryTransferEvidenceRow");
  const settlementBatchRow = requireSchema(spec, "CariSettlementBatchRow");
  const openItemsResponse = requireSchema(spec, "CariOpenItemsReportResponse");
  const statementResponse = requireSchema(spec, "CariCounterpartyStatementReportResponse");
  const realizedFxResponse = requireSchema(spec, "CariSettlementRealizedFxReportResponse");
  const operatingUnitInput = requireSchema(spec, "OperatingUnitInput");
  const operatingUnitRow = requireSchema(spec, "OperatingUnitRow");

  assertSchemaProperty(
    itemCardRow,
    "inventoryTransitAccountId",
    "ItemCardRow must expose inventoryTransitAccountId"
  );
  assertSchemaProperty(
    itemCardUpsertRequest,
    "inventoryTransitAccountId",
    "ItemCardUpsertRequest must expose inventoryTransitAccountId"
  );
  assertSchemaProperty(
    warehouseRow,
    "ownershipScope",
    "InventoryWarehouseRow must expose ownershipScope"
  );
  assertSchemaProperty(
    warehouseRow,
    "operatingUnitId",
    "InventoryWarehouseRow must expose operatingUnitId"
  );
  assertSchemaProperty(
    warehouseCreateRequest,
    "ownershipScope",
    "InventoryWarehouseCreateRequest must expose ownershipScope"
  );
  assertSchemaProperty(
    warehouseCreateRequest,
    "operatingUnitId",
    "InventoryWarehouseCreateRequest must expose operatingUnitId"
  );
  assertSchemaProperty(
    movementRow,
    "sourceTransferNo",
    "InventoryMovementRow must expose sourceTransferNo"
  );
  assertSchemaProperty(
    movementRow,
    "sourceTransferStatus",
    "InventoryMovementRow must expose sourceTransferStatus"
  );
  assertSchemaProperty(
    transferRow,
    "sourceOwnershipScope",
    "InventoryTransferRow must expose sourceOwnershipScope"
  );
  assertSchemaProperty(
    transferRow,
    "targetOwnershipScope",
    "InventoryTransferRow must expose targetOwnershipScope"
  );
  assertSchemaProperty(
    transferRow,
    "shipmentJournalNo",
    "InventoryTransferRow must expose shipmentJournalNo"
  );
  assertSchemaProperty(
    transferEvidenceRow,
    "status",
    "InventoryTransferEvidenceRow must expose status"
  );
  assertSchemaProperty(
    settlementBatchRow,
    "ownerOperatingUnitId",
    "CariSettlementBatchRow must expose ownerOperatingUnitId"
  );
  assertSchemaProperty(
    settlementBatchRow,
    "collectorOperatingUnitId",
    "CariSettlementBatchRow must expose collectorOperatingUnitId"
  );
  assertSchemaProperty(
    settlementBatchRow,
    "originatingCrossContextSettlementBatchId",
    "CariSettlementBatchRow must expose originatingCrossContextSettlementBatchId"
  );
  assertSchemaProperty(
    openItemsResponse,
    "rows",
    "CariOpenItemsReportResponse must expose rows"
  );
  assertSchemaProperty(
    statementResponse,
    "settlements",
    "CariCounterpartyStatementReportResponse must expose settlements"
  );
  assertSchemaProperty(
    realizedFxResponse,
    "summary",
    "CariSettlementRealizedFxReportResponse must expose summary"
  );
  assertSchemaProperty(
    operatingUnitInput,
    "centralDueToAccountId",
    "OperatingUnitInput must expose centralDueToAccountId"
  );
  assertSchemaProperty(
    operatingUnitInput,
    "ouDueFromCentralAccountId",
    "OperatingUnitInput must expose ouDueFromCentralAccountId"
  );
  assertSchemaProperty(
    operatingUnitRow,
    "central_due_to_account_id",
    "OperatingUnitRow must expose central_due_to_account_id"
  );
  assertSchemaProperty(
    operatingUnitRow,
    "ou_due_from_central_account_id",
    "OperatingUnitRow must expose ou_due_from_central_account_id"
  );
}

function assertRunbook(runbookSource) {
  const requiredHeadings = [
    "# OU Self-Balancing Inventory Transfers and Cross-Context Settlements",
    "## Warehouse Ownership Setup",
    "## Transfer Approval Requirement",
    "## Item Transit Account Requirement",
    "## Missing OU Current-Account Mapping Failures",
    "## Transfer Lifecycle Runbook",
    "## Accounting Examples",
    "## Cross-Context Settlement Examples",
    "## Troubleshooting: Blocked Generic Cross-Context Stock Movement",
  ];

  for (const heading of requiredHeadings) {
    assert(runbookSource.includes(heading), `Runbook heading missing: ${heading}`);
  }

  const requiredTokens = [
    "/app/stok-transferleri",
    "/app/cari-settlements",
    "inventoryTransitAccountId",
    "central_due_to_account_id",
    "ou_due_from_central_account_id",
    "first-class cross-context collection document is still future scope",
    "Approve -> Ship -> Receive",
    "Cross-context stock movement must use inventory transfer workflow",
  ];

  for (const token of requiredTokens) {
    assert(runbookSource.includes(token), `Runbook token missing: ${token}`);
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(backendRoot, "..");
  const openapiPath = path.resolve(backendRoot, "openapi.yaml");
  const openapiSourceBeforeGenerate = await readFile(openapiPath, "utf8");

  await runNpmScript("openapi:generate", backendRoot);
  const openapiSourceAfterGenerate = await readFile(openapiPath, "utf8");
  assert(
    openapiSourceBeforeGenerate === openapiSourceAfterGenerate,
    "OpenAPI drift detected: regenerate backend/openapi.yaml and re-run the release gate"
  );
  await runNpmScript("check:openapi:parse", backendRoot);
  await runNpmScript("check:openapi", backendRoot);

  const [
    openapiSource,
    packageSource,
    manifestSource,
    runbookSource,
  ] = await Promise.all([
    readFile(path.resolve(backendRoot, "openapi.yaml"), "utf8"),
    readFile(path.resolve(backendRoot, "package.json"), "utf8"),
    readFile(
      path.resolve(backendRoot, "scripts/fixtures/rswire03-release-gate-manifest.json"),
      "utf8"
    ),
    readFile(
      path.resolve(repoRoot, "docs/runbooks/ou-self-balancing-transfers-and-settlements.md"),
      "utf8"
    ),
  ]);

  const spec = parseYaml(openapiSource);
  assertManifestAndPackage(packageSource, manifestSource);
  assertOpenApi(spec);
  assertRunbook(runbookSource);

  const releaseGateScripts = [
    "test:ux:rswire01",
    "test:ux:rswire03",
    "test:inventory:ou01",
    "test:inventory:ou02",
    "test:inventory:ou03",
    "test:inventory:ou04",
    "test:inventory:ou05",
    "test:inventory:ou06",
    "test:inventory:ou07",
    "test:inventory:ou12",
    "test:cari:ou08",
    "test:cari:ou09",
    "test:cari:ou10",
    "test:cari:ou11",
  ];

  for (const scriptName of releaseGateScripts) {
    // Keep deterministic order so failures map cleanly to one regression at a time.
    // eslint-disable-next-line no-await-in-loop
    await runNpmScript(scriptName, backendRoot);
  }

  console.log("OU self-balancing release gate passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
