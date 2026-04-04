import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeGeneratedText(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

async function runCommand(command, args, cwd, label = command) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
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

function getRequestBodyRef(operation) {
  return operation?.requestBody?.content?.["application/json"]?.schema?.$ref || null;
}

function getResponseRef(operation, statusCode = "200") {
  return operation?.responses?.[statusCode]?.content?.["application/json"]?.schema?.$ref || null;
}

function assertTaggedExplicitOperation(spec, routePath, method, expectedTag) {
  const operation = findOperation(spec, routePath, method);
  assert(operation, `Missing OpenAPI operation: ${method.toUpperCase()} ${routePath}`);
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

function assertSchema(spec, schemaName) {
  const schema = spec?.components?.schemas?.[schemaName] || null;
  assert(schema, `OpenAPI schema missing: ${schemaName}`);
  return schema;
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(backendRoot, "..");
  const openapiPath = path.resolve(backendRoot, "openapi.yaml");

  await runNpmScript("test:inventory:lcv07", backendRoot);
  await runNpmScript("test:cari:lc40", backendRoot);

  const openapiSourceBeforeGenerate = await readFile(openapiPath, "utf8");
  await runNpmScript("openapi:generate", backendRoot);
  const openapiSourceAfterGenerate = await readFile(openapiPath, "utf8");
  assert(
    normalizeGeneratedText(openapiSourceBeforeGenerate) ===
      normalizeGeneratedText(openapiSourceAfterGenerate),
    "OpenAPI drift detected: regenerate backend/openapi.yaml and re-run the release gate"
  );
  await runNpmScript("check:openapi:parse", backendRoot);
  await runNpmScript("check:openapi", backendRoot);

  const [openapiSource, packageSource, manifestSource] = await Promise.all([
    readFile(openapiPath, "utf8"),
    readFile(path.resolve(backendRoot, "package.json"), "utf8"),
    readFile(
      path.resolve(backendRoot, "scripts", "fixtures", "rswire03-release-gate-manifest.json"),
      "utf8"
    ),
  ]);

  const spec = JSON.parse(openapiSource);
  const pkg = JSON.parse(packageSource);
  const manifest = JSON.parse(manifestSource);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const manifestEntries = Array.isArray(manifest?.entries) ? manifest.entries : [];

  assert(typeof scripts["test:inventory:lcv07"] === "string", "package.json missing test:inventory:lcv07");
  assert(
    typeof scripts["test:inventory:lcv07-release-gate"] === "string",
    "package.json missing test:inventory:lcv07-release-gate"
  );
  assert(
    String(scripts["test:inventory:lcv07"] || "").includes("test-inventory-lcv07-landed-cost-smoke.js"),
    "test:inventory:lcv07 must reference test-inventory-lcv07-landed-cost-smoke.js"
  );
  assert(
    String(scripts["test:inventory:lcv07-release-gate"] || "").includes("test-inventory-lcv07-release-gate.js"),
    "test:inventory:lcv07-release-gate must reference test-inventory-lcv07-release-gate.js"
  );
  assert(
    String(scripts["test:release-gate:core"] || "").includes("test:inventory:lcv07-release-gate"),
    "test:release-gate:core must include test:inventory:lcv07-release-gate"
  );

  for (const routePath of ["/app/stok-maliyet-voucherleri", "/app/stok-maliyet-voucherleri/yeni"]) {
    const entry = manifestEntries.find((row) => String(row?.routePath || "").trim() === routePath);
    assert(entry, `RS-WIRE-03 manifest entry missing: ${routePath}`);
    assert(
      String(entry?.smokeScriptPath || "") === "backend/scripts/test-inventory-lcv07-release-gate.js",
      `${routePath} must point to backend/scripts/test-inventory-lcv07-release-gate.js`
    );
    assert(
      String(entry?.packageScriptName || "") === "test:inventory:lcv07-release-gate",
      `${routePath} must point to test:inventory:lcv07-release-gate`
    );
  }

  for (const [routePath, method, expectedTag] of [
    ["/api/v1/inventory/landed-cost-vouchers/lookups/source-lines", "get", "Inventory"],
    ["/api/v1/inventory/landed-cost-vouchers/lookups/receipt-targets", "get", "Inventory"],
    ["/api/v1/inventory/landed-cost-vouchers", "get", "Inventory"],
    ["/api/v1/inventory/landed-cost-vouchers", "post", "Inventory"],
    ["/api/v1/inventory/landed-cost-vouchers/preview", "post", "Inventory"],
    ["/api/v1/inventory/landed-cost-vouchers/{voucherId}", "get", "Inventory"],
    ["/api/v1/inventory/landed-cost-vouchers/{voucherId}/reverse", "post", "Inventory"],
  ]) {
    assertTaggedExplicitOperation(spec, routePath, method, expectedTag);
  }

  assert(
    getResponseRef(
      findOperation(spec, "/api/v1/inventory/landed-cost-vouchers/lookups/source-lines", "get")
    ) === "#/components/schemas/InventoryLandedCostSourceLookupResponse",
    "Source-line lookup must return InventoryLandedCostSourceLookupResponse"
  );
  assert(
    getResponseRef(
      findOperation(spec, "/api/v1/inventory/landed-cost-vouchers/lookups/receipt-targets", "get")
    ) === "#/components/schemas/InventoryLandedCostTargetLookupResponse",
    "Receipt-target lookup must return InventoryLandedCostTargetLookupResponse"
  );
  assert(
    getResponseRef(findOperation(spec, "/api/v1/inventory/landed-cost-vouchers", "get")) ===
      "#/components/schemas/InventoryLandedCostVoucherListResponse",
    "Voucher list must return InventoryLandedCostVoucherListResponse"
  );
  assert(
    getRequestBodyRef(findOperation(spec, "/api/v1/inventory/landed-cost-vouchers", "post")) ===
      "#/components/schemas/InventoryLandedCostVoucherCreateRequest",
    "Voucher create must use InventoryLandedCostVoucherCreateRequest"
  );
  assert(
    getResponseRef(findOperation(spec, "/api/v1/inventory/landed-cost-vouchers", "post"), "201") ===
      "#/components/schemas/InventoryLandedCostVoucherCreateResponse",
    "Voucher create must return InventoryLandedCostVoucherCreateResponse"
  );
  assert(
    getRequestBodyRef(findOperation(spec, "/api/v1/inventory/landed-cost-vouchers/preview", "post")) ===
      "#/components/schemas/InventoryLandedCostVoucherPreviewRequest",
    "Voucher preview must use InventoryLandedCostVoucherPreviewRequest"
  );
  assert(
    getResponseRef(findOperation(spec, "/api/v1/inventory/landed-cost-vouchers/preview", "post")) ===
      "#/components/schemas/InventoryLandedCostVoucherPreviewResponse",
    "Voucher preview must return InventoryLandedCostVoucherPreviewResponse"
  );
  assert(
    getResponseRef(findOperation(spec, "/api/v1/inventory/landed-cost-vouchers/{voucherId}", "get")) ===
      "#/components/schemas/InventoryLandedCostVoucherDetailResponse",
    "Voucher detail must return InventoryLandedCostVoucherDetailResponse"
  );
  assert(
    getRequestBodyRef(findOperation(spec, "/api/v1/inventory/landed-cost-vouchers/{voucherId}/reverse", "post")) ===
      "#/components/schemas/InventoryLandedCostVoucherReverseRequest",
    "Voucher reverse must use InventoryLandedCostVoucherReverseRequest"
  );
  assert(
    getResponseRef(
      findOperation(spec, "/api/v1/inventory/landed-cost-vouchers/{voucherId}/reverse", "post")
    ) === "#/components/schemas/InventoryLandedCostVoucherReverseResponse",
    "Voucher reverse must return InventoryLandedCostVoucherReverseResponse"
  );

  const listRowSchema = assertSchema(spec, "InventoryLandedCostVoucherListRow");
  const detailSchema = assertSchema(spec, "InventoryLandedCostVoucherDetailResponse");
  const sourceLookupRow = assertSchema(spec, "InventoryLandedCostSourceLookupRow");
  const targetLookupRow = assertSchema(spec, "InventoryLandedCostTargetLookupRow");
  const previewRequestSchema = assertSchema(spec, "InventoryLandedCostVoucherPreviewRequest");
  assertSchema(spec, "InventoryLandedCostVoucherStatus");
  assertSchema(spec, "InventoryLandedCostVoucherUiStatus");
  assertSchema(spec, "InventoryLandedCostAllocationMethod");

  assert(
    listRowSchema?.properties?.uiStatus,
    "InventoryLandedCostVoucherListRow must expose uiStatus"
  );
  assert(
    detailSchema?.properties?.journalAudit,
    "InventoryLandedCostVoucherDetailResponse must expose journalAudit"
  );
  assert(
    detailSchema?.properties?.layerAllocations,
    "InventoryLandedCostVoucherDetailResponse must expose layerAllocations"
  );
  assert(
    detailSchema?.properties?.landedCostConsumptions,
    "InventoryLandedCostVoucherDetailResponse must expose landedCostConsumptions"
  );
  assert(
    sourceLookupRow?.properties?.disabledReasonCode,
    "InventoryLandedCostSourceLookupRow must expose disabledReasonCode"
  );
  assert(
    targetLookupRow?.properties?.blockedReasonCodes,
    "InventoryLandedCostTargetLookupRow must expose blockedReasonCodes"
  );
  assert(
    previewRequestSchema?.properties?.allocationMethod,
    "InventoryLandedCostVoucherPreviewRequest must expose allocationMethod"
  );
  assert(
    previewRequestSchema?.properties?.sourceLines,
    "InventoryLandedCostVoucherPreviewRequest must expose sourceLines"
  );
  assert(
    previewRequestSchema?.properties?.targets,
    "InventoryLandedCostVoucherPreviewRequest must expose targets"
  );

  console.log("LCV07 landed-cost release gate passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
