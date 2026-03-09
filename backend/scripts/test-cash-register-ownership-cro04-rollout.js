import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getSchemaRef(operation, statusCode = "200") {
  return operation?.responses?.[statusCode]?.content?.["application/json"]?.schema?.$ref || null;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const packageJson = JSON.parse(
    await readFile(path.resolve(root, "backend/package.json"), "utf8")
  );
  const scripts = packageJson?.scripts || {};

  assert(
    scripts["test:cash-register-ownership:rollout"] ===
      "node scripts/test-cash-register-ownership-cro04-rollout.js",
    "backend/package.json missing test:cash-register-ownership:rollout script"
  );
  assert(
    scripts["test:cash-register-ownership"]?.includes(
      "test-cash-register-ownership-cro01.js"
    ) &&
      scripts["test:cash-register-ownership"]?.includes(
        "test-cash-register-ownership-cro02-frontend-smoke.js"
      ) &&
      scripts["test:cash-register-ownership"]?.includes(
        "test-cash-register-ownership-cro03-workflow-routing.js"
      ) &&
      scripts["test:cash-register-ownership"]?.includes(
        "test:cash-register-ownership:rollout"
      ),
    "backend/package.json should aggregate CRO01-CRO04 ownership smoke coverage"
  );
  assert(
    scripts["test:release-gate:core"]?.includes("npm run test:cash-register-ownership"),
    "Core release gate should include cash register ownership smoke coverage"
  );

  const releaseGateSource = await readFile(
    path.resolve(root, "backend/scripts/test-release-gate.js"),
    "utf8"
  );
  assert(
    releaseGateSource.includes("cash ownership rollout gates"),
    "Unified release gate stage title should mention cash ownership rollout coverage"
  );

  const openapiPath = path.resolve(root, "backend/openapi.yaml");
  const openapiSource = await readFile(openapiPath, "utf8");
  const spec = JSON.parse(openapiSource);
  const schemas = spec?.components?.schemas || {};

  const registerListOp = spec?.paths?.["/api/v1/cash/registers"]?.get;
  const registerUpsertOp = spec?.paths?.["/api/v1/cash/registers"]?.post;
  const registerDetailOp = spec?.paths?.["/api/v1/cash/registers/{registerId}"]?.get;
  const registerStatusOp =
    spec?.paths?.["/api/v1/cash/registers/{registerId}/status"]?.post;
  const transitInitiateOp =
    spec?.paths?.["/api/v1/cash/transactions/transit/initiate"]?.post;

  assert(registerListOp, "OpenAPI missing GET /api/v1/cash/registers");
  assert(registerUpsertOp, "OpenAPI missing POST /api/v1/cash/registers");
  assert(registerDetailOp, "OpenAPI missing GET /api/v1/cash/registers/{registerId}");
  assert(
    registerStatusOp,
    "OpenAPI missing POST /api/v1/cash/registers/{registerId}/status"
  );
  assert(
    transitInitiateOp,
    "OpenAPI missing POST /api/v1/cash/transactions/transit/initiate"
  );

  assert(
    String(registerListOp.summary || "").includes("Central / HQ vs Operating Unit"),
    "Cash register list summary should document explicit ownership context"
  );
  const registerListParams = new Set(
    (registerListOp.parameters || []).map((parameter) =>
      String(parameter?.name || "").trim()
    )
  );
  for (const name of [
    "legalEntityId",
    "operatingUnitId",
    "ownershipScope",
    "status",
    "q",
    "limit",
    "offset",
  ]) {
    assert(registerListParams.has(name), `Cash register list query param missing: ${name}`);
  }
  assert(
    getSchemaRef(registerListOp) === "#/components/schemas/CashRegisterListResponse",
    "Cash register list response should use CashRegisterListResponse"
  );
  assert(
    registerUpsertOp?.requestBody?.content?.["application/json"]?.schema?.$ref ===
      "#/components/schemas/CashRegisterUpsertRequest",
    "Cash register upsert request should use CashRegisterUpsertRequest"
  );
  assert(
    getSchemaRef(registerUpsertOp) === "#/components/schemas/CashRegisterResponse",
    "Cash register upsert response should use CashRegisterResponse"
  );
  assert(
    getSchemaRef(registerDetailOp) === "#/components/schemas/CashRegisterResponse",
    "Cash register detail response should use CashRegisterResponse"
  );
  assert(
    registerStatusOp?.requestBody?.content?.["application/json"]?.schema?.$ref ===
      "#/components/schemas/CashRegisterStatusUpdateRequest",
    "Cash register status request should use CashRegisterStatusUpdateRequest"
  );
  assert(
    getSchemaRef(registerStatusOp) === "#/components/schemas/CashRegisterResponse",
    "Cash register status response should use CashRegisterResponse"
  );

  assert(
    schemas.CashRegisterOwnershipScope?.enum?.includes("CENTRAL") &&
      schemas.CashRegisterOwnershipScope?.enum?.includes("OPERATING_UNIT"),
    "OpenAPI must define CashRegisterOwnershipScope enum"
  );
  assert(
    schemas.CashRegisterRow?.properties?.ownership_scope?.$ref ===
      "#/components/schemas/CashRegisterOwnershipScope",
    "CashRegisterRow should expose ownership_scope"
  );
  assert(
    String(schemas.CashRegisterRow?.properties?.ownership_context_label?.description || "").includes(
      "Central / HQ"
    ),
    "CashRegisterRow should document ownership_context_label"
  );
  assert(
    String(schemas.CashRegisterUpsertRequest?.description || "").includes(
      "ownershipScope may be omitted"
    ),
    "CashRegisterUpsertRequest should document rollout compatibility for ownershipScope"
  );
  assert(
    String(schemas.CashRegisterUpsertRequest?.properties?.operatingUnitId?.description || "").includes(
      "CENTRAL"
    ) &&
      String(
        schemas.CashRegisterUpsertRequest?.properties?.operatingUnitId?.description || ""
      ).includes("OPERATING_UNIT"),
    "CashRegisterUpsertRequest should document operatingUnitId ownership rules"
  );
  assert(
    openapiSource.includes("ownership_scope") &&
      openapiSource.includes("ownership_context_label") &&
      openapiSource.includes("Central / HQ"),
    "OpenAPI should expose ownership fields and Central / HQ copy"
  );
  assert(
    String(transitInitiateOp.summary || "").includes("different operating-unit contexts"),
    "Transit initiate summary should use different operating-unit contexts wording"
  );
  assert(
    String(transitInitiateOp.description || "").includes("Central / HQ"),
    "Transit initiate description should explain Central / HQ vs OU routing"
  );
  assert(
    !openapiSource.includes("Initiate cross-OU cash transit transfer"),
    "OpenAPI should remove cross-OU wording from transit initiate summary"
  );

  const cariRunbook = await readFile(
    path.resolve(root, "docs/runbooks/cari-v1-operations.md"),
    "utf8"
  );
  for (const requiredToken of [
    "## Cash Register Ownership Context",
    "`Central / HQ`",
    "blank operating-unit selector",
    "different operating-unit contexts",
    "`CASH_IN_TRANSIT`",
  ]) {
    assert(
      cariRunbook.includes(requiredToken),
      `docs/runbooks/cari-v1-operations.md missing: ${requiredToken}`
    );
  }

  const shareholderRunbook = await readFile(
    path.resolve(root, "docs/runbooks/shareholder-capital-fulfillment-operations.md"),
    "utf8"
  );
  for (const requiredToken of [
    "## Cash Register Ownership Context",
    "`Central / HQ`",
    "`OU: <code>`",
    "different operating-unit contexts",
    "no synthetic HQ operating unit",
  ]) {
    assert(
      shareholderRunbook.includes(requiredToken),
      `docs/runbooks/shareholder-capital-fulfillment-operations.md missing: ${requiredToken}`
    );
  }
  assert(
    !shareholderRunbook.includes("cross-OU"),
    "Shareholder-capital runbook should not use cross-OU wording"
  );

  console.log("Cash register ownership CRO04 rollout smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
