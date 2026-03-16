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

function getAnySchemaRef(operation, statusCodes = ["200", "201"]) {
  for (const statusCode of statusCodes) {
    const schemaRef = getSchemaRef(operation, statusCode);
    if (schemaRef) {
      return schemaRef;
    }
  }
  return null;
}

function getRequestBodyRef(operation) {
  return operation?.requestBody?.content?.["application/json"]?.schema?.$ref || null;
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
    scripts["test:cash-register-ownership:cro06"] ===
      "node scripts/test-cash-register-ownership-cro06-auto-provision.js",
    "backend/package.json missing test:cash-register-ownership:cro06 script"
  );
  assert(
    scripts["test:cash-register-ownership:cro07"] ===
      "node scripts/test-cash-register-ownership-cro07-central-auto-provision.js",
    "backend/package.json missing test:cash-register-ownership:cro07 script"
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
        "test:cash-register-ownership:cro06"
      ) &&
      scripts["test:cash-register-ownership"]?.includes(
        "test:cash-register-ownership:cro07"
      ) &&
      scripts["test:cash-register-ownership"]?.includes(
        "test:cash-register-ownership:rollout"
      ),
    "backend/package.json should aggregate CRO01-CRO07 ownership smoke coverage"
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
    releaseGateSource.includes("cash ownership") &&
      releaseGateSource.includes("strict inventory rollout gates"),
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
  const sessionListOp = spec?.paths?.["/api/v1/cash/sessions"]?.get;
  const sessionOpenOp = spec?.paths?.["/api/v1/cash/sessions/open"]?.post;
  const sessionDetailOp = spec?.paths?.["/api/v1/cash/sessions/{sessionId}"]?.get;
  const sessionCloseOp = spec?.paths?.["/api/v1/cash/sessions/{sessionId}/close"]?.post;
  const transactionListOp = spec?.paths?.["/api/v1/cash/transactions"]?.get;
  const transactionCreateOp = spec?.paths?.["/api/v1/cash/transactions"]?.post;
  const transactionDetailOp =
    spec?.paths?.["/api/v1/cash/transactions/{transactionId}"]?.get;
  const transactionCancelOp =
    spec?.paths?.["/api/v1/cash/transactions/{transactionId}/cancel"]?.post;
  const transactionPostOp =
    spec?.paths?.["/api/v1/cash/transactions/{transactionId}/post"]?.post;
  const transactionReverseOp =
    spec?.paths?.["/api/v1/cash/transactions/{transactionId}/reverse"]?.post;
  const transitListOp = spec?.paths?.["/api/v1/cash/transactions/transit"]?.get;
  const transitDetailOp =
    spec?.paths?.["/api/v1/cash/transactions/transit/{transitTransferId}"]?.get;
  const transitCancelOp =
    spec?.paths?.["/api/v1/cash/transactions/transit/{transitTransferId}/cancel"]?.post;
  const transitReceiveOp =
    spec?.paths?.["/api/v1/cash/transactions/transit/{transitTransferId}/receive"]?.post;
  const transitInitiateOp =
    spec?.paths?.["/api/v1/cash/transactions/transit/initiate"]?.post;
  const operatingUnitListOp = spec?.paths?.["/api/v1/org/operating-units"]?.get;
  const currentAccountConfigListOp =
    spec?.paths?.["/api/v1/org/operating-unit-current-account-config"]?.get;
  const currentAccountConfigUpsertOp =
    spec?.paths?.["/api/v1/org/operating-unit-current-account-config"]?.post;
  const currentAccountConfigApplyOp =
    spec?.paths?.["/api/v1/org/operating-unit-current-account-config/apply"]?.post;
  const partnerCurrentListOp =
    spec?.paths?.["/api/v1/org/operating-unit-partner-current-accounts"]?.get;
  const partnerCurrentUpsertOp =
    spec?.paths?.["/api/v1/org/operating-unit-partner-current-accounts"]?.post;
  const centralCurrentAutoProvisionOp =
    spec?.paths?.["/api/v1/org/operating-units/central-current-accounts/auto-provision"]?.post;
  const partnerCurrentAutoProvisionOp =
    spec?.paths?.["/api/v1/org/operating-unit-partner-current-accounts/auto-provision"]?.post;

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
  assert(sessionListOp, "OpenAPI missing GET /api/v1/cash/sessions");
  assert(sessionOpenOp, "OpenAPI missing POST /api/v1/cash/sessions/open");
  assert(
    sessionDetailOp,
    "OpenAPI missing GET /api/v1/cash/sessions/{sessionId}"
  );
  assert(
    sessionCloseOp,
    "OpenAPI missing POST /api/v1/cash/sessions/{sessionId}/close"
  );
  assert(transactionListOp, "OpenAPI missing GET /api/v1/cash/transactions");
  assert(transactionCreateOp, "OpenAPI missing POST /api/v1/cash/transactions");
  assert(
    transactionDetailOp,
    "OpenAPI missing GET /api/v1/cash/transactions/{transactionId}"
  );
  assert(
    transactionCancelOp,
    "OpenAPI missing POST /api/v1/cash/transactions/{transactionId}/cancel"
  );
  assert(
    transactionPostOp,
    "OpenAPI missing POST /api/v1/cash/transactions/{transactionId}/post"
  );
  assert(
    transactionReverseOp,
    "OpenAPI missing POST /api/v1/cash/transactions/{transactionId}/reverse"
  );
  assert(transitListOp, "OpenAPI missing GET /api/v1/cash/transactions/transit");
  assert(
    transitDetailOp,
    "OpenAPI missing GET /api/v1/cash/transactions/transit/{transitTransferId}"
  );
  assert(
    transitCancelOp,
    "OpenAPI missing POST /api/v1/cash/transactions/transit/{transitTransferId}/cancel"
  );
  assert(
    transitReceiveOp,
    "OpenAPI missing POST /api/v1/cash/transactions/transit/{transitTransferId}/receive"
  );
  assert(operatingUnitListOp, "OpenAPI missing GET /api/v1/org/operating-units");
  assert(
    partnerCurrentListOp,
    "OpenAPI missing GET /api/v1/org/operating-unit-partner-current-accounts"
  );
  assert(
    partnerCurrentUpsertOp,
    "OpenAPI missing POST /api/v1/org/operating-unit-partner-current-accounts"
  );
  assert(
    currentAccountConfigListOp,
    "OpenAPI missing GET /api/v1/org/operating-unit-current-account-config"
  );
  assert(
    currentAccountConfigUpsertOp,
    "OpenAPI missing POST /api/v1/org/operating-unit-current-account-config"
  );
  assert(
    currentAccountConfigApplyOp,
    "OpenAPI missing POST /api/v1/org/operating-unit-current-account-config/apply"
  );
  assert(
    !centralCurrentAutoProvisionOp,
    "OpenAPI should remove legacy POST /api/v1/org/operating-units/central-current-accounts/auto-provision"
  );
  assert(
    !partnerCurrentAutoProvisionOp,
    "OpenAPI should remove legacy POST /api/v1/org/operating-unit-partner-current-accounts/auto-provision"
  );

  assert(
    String(registerListOp.summary || "").includes("Central vs Operating Unit"),
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
      "Central"
    ),
    "CashRegisterRow should document ownership_context_label"
  );
  assert(
    Array.isArray(schemas.CashRegisterUpsertRequest?.required) &&
      schemas.CashRegisterUpsertRequest.required.includes("ownershipScope"),
    "CashRegisterUpsertRequest should require ownershipScope"
  );
  assert(
    !String(schemas.CashRegisterUpsertRequest?.description || "").includes(
      "ownershipScope may be omitted"
    ),
    "CashRegisterUpsertRequest should no longer document omitted ownershipScope compatibility"
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
      openapiSource.includes("Central"),
    "OpenAPI should expose ownership fields and Central copy"
  );
  const operatingUnitListParams = new Set(
    (operatingUnitListOp.parameters || []).map((parameter) =>
      String(parameter?.name || "").trim()
    )
  );
  for (const name of ["tenantId", "legalEntityId", "operatingUnitId"]) {
    assert(
      operatingUnitListParams.has(name),
      `Operating unit list query param missing: ${name}`
    );
  }
  assert(
    getSchemaRef(operatingUnitListOp) === "#/components/schemas/OperatingUnitListResponse",
    "Operating unit list response should use OperatingUnitListResponse"
  );
  const partnerCurrentListParams = new Set(
    (partnerCurrentListOp.parameters || []).map((parameter) =>
      String(parameter?.name || "").trim()
    )
  );
  for (const name of [
    "tenantId",
    "legalEntityId",
    "operatingUnitId",
    "partnerOperatingUnitId",
  ]) {
    assert(
      partnerCurrentListParams.has(name),
      `Partner current-account list query param missing: ${name}`
    );
  }
  assert(
    getSchemaRef(partnerCurrentListOp) ===
      "#/components/schemas/OperatingUnitPartnerCurrentAccountListResponse",
    "Partner current-account list response should use OperatingUnitPartnerCurrentAccountListResponse"
  );
  assert(
    getRequestBodyRef(partnerCurrentUpsertOp) ===
      "#/components/schemas/OperatingUnitPartnerCurrentAccountInput",
    "Partner current-account upsert request should use OperatingUnitPartnerCurrentAccountInput"
  );
  assert(
    getSchemaRef(currentAccountConfigListOp) ===
      "#/components/schemas/OperatingUnitCurrentAccountConfigListResponse",
    "Current-account config list response should use OperatingUnitCurrentAccountConfigListResponse"
  );
  assert(
    getRequestBodyRef(currentAccountConfigUpsertOp) ===
      "#/components/schemas/OperatingUnitCurrentAccountConfigInput",
    "Current-account config upsert request should use OperatingUnitCurrentAccountConfigInput"
  );
  assert(
    getAnySchemaRef(currentAccountConfigUpsertOp, ["201"]) ===
      "#/components/schemas/OperatingUnitCurrentAccountConfigResponse",
    "Current-account config upsert response should use OperatingUnitCurrentAccountConfigResponse"
  );
  assert(
    getRequestBodyRef(currentAccountConfigApplyOp) ===
      "#/components/schemas/OperatingUnitCurrentAccountConfigApplyInput",
    "Current-account config apply request should use OperatingUnitCurrentAccountConfigApplyInput"
  );
  assert(
    getAnySchemaRef(currentAccountConfigApplyOp, ["201"]) ===
      "#/components/schemas/OperatingUnitCurrentAccountApplyResponse",
    "Current-account config apply response should use OperatingUnitCurrentAccountApplyResponse"
  );
  assert(
    String(transitInitiateOp.summary || "").includes("different operating-unit contexts"),
    "Transit initiate summary should use different operating-unit contexts wording"
  );
  assert(
    String(transitInitiateOp.description || "").includes("Central"),
    "Transit initiate description should explain Central vs OU routing"
  );
  assert(
    !openapiSource.includes("Initiate cross-OU cash transit transfer"),
    "OpenAPI should remove cross-OU wording from transit initiate summary"
  );
  assert(
    getSchemaRef(sessionListOp) === "#/components/schemas/CashSessionListResponse",
    "Cash session list response should use CashSessionListResponse"
  );
  assert(
    getRequestBodyRef(sessionOpenOp) === "#/components/schemas/CashSessionOpenRequest",
    "Cash session open request should use CashSessionOpenRequest"
  );
  assert(
    getAnySchemaRef(sessionOpenOp) === "#/components/schemas/CashSessionResponse",
    "Cash session open response should use CashSessionResponse"
  );
  assert(
    getSchemaRef(sessionDetailOp) === "#/components/schemas/CashSessionResponse",
    "Cash session detail response should use CashSessionResponse"
  );
  assert(
    getRequestBodyRef(sessionCloseOp) === "#/components/schemas/CashSessionCloseRequest",
    "Cash session close request should use CashSessionCloseRequest"
  );
  assert(
    getAnySchemaRef(sessionCloseOp) === "#/components/schemas/CashSessionResponse",
    "Cash session close response should use CashSessionResponse"
  );
  assert(
    getSchemaRef(transactionListOp) === "#/components/schemas/CashTransactionListResponse",
    "Cash transaction list response should use CashTransactionListResponse"
  );
  assert(
    getRequestBodyRef(transactionCreateOp) === "#/components/schemas/CashTransactionCreateRequest",
    "Cash transaction create request should use CashTransactionCreateRequest"
  );
  assert(
    getAnySchemaRef(transactionCreateOp) ===
      "#/components/schemas/CashTransactionMutationResponse",
    "Cash transaction create response should use CashTransactionMutationResponse"
  );
  assert(
    getSchemaRef(transactionDetailOp) === "#/components/schemas/CashTransactionResponse",
    "Cash transaction detail response should use CashTransactionResponse"
  );
  assert(
    getRequestBodyRef(transactionCancelOp) === "#/components/schemas/CashTransactionCancelRequest",
    "Cash transaction cancel request should use CashTransactionCancelRequest"
  );
  assert(
    getAnySchemaRef(transactionCancelOp) === "#/components/schemas/CashTransactionResponse",
    "Cash transaction cancel response should use CashTransactionResponse"
  );
  assert(
    getRequestBodyRef(transactionPostOp) === "#/components/schemas/CashTransactionPostRequest",
    "Cash transaction post request should use CashTransactionPostRequest"
  );
  assert(
    getAnySchemaRef(transactionPostOp) ===
      "#/components/schemas/CashTransactionMutationResponse",
    "Cash transaction post response should use CashTransactionMutationResponse"
  );
  assert(
    getRequestBodyRef(transactionReverseOp) ===
      "#/components/schemas/CashTransactionReverseRequest",
    "Cash transaction reverse request should use CashTransactionReverseRequest"
  );
  assert(
    getAnySchemaRef(transactionReverseOp) ===
      "#/components/schemas/CashTransactionReverseResponse",
    "Cash transaction reverse response should use CashTransactionReverseResponse"
  );
  assert(
    getSchemaRef(transitListOp) === "#/components/schemas/CashTransitTransferListResponse",
    "Cash transit list response should use CashTransitTransferListResponse"
  );
  assert(
    getSchemaRef(transitDetailOp) === "#/components/schemas/CashTransitTransferResponse",
    "Cash transit detail response should use CashTransitTransferResponse"
  );
  assert(
    getRequestBodyRef(transitCancelOp) ===
      "#/components/schemas/CashTransitTransferCancelRequest",
    "Cash transit cancel request should use CashTransitTransferCancelRequest"
  );
  assert(
    getAnySchemaRef(transitCancelOp) === "#/components/schemas/CashTransitTransferResponse",
    "Cash transit cancel response should use CashTransitTransferResponse"
  );
  assert(
    getRequestBodyRef(transitReceiveOp) ===
      "#/components/schemas/CashTransitTransferReceiveRequest",
    "Cash transit receive request should use CashTransitTransferReceiveRequest"
  );
  assert(
    getAnySchemaRef(transitReceiveOp) === "#/components/schemas/CashTransitTransferResponse",
    "Cash transit receive response should use CashTransitTransferResponse"
  );
  assert(
    schemas.CashSessionListResponse?.properties?.rows?.items?.$ref ===
      "#/components/schemas/CashSessionRow",
    "CashSessionListResponse rows should use CashSessionRow"
  );
  assert(
    schemas.CashTransactionListResponse?.properties?.rows?.items?.$ref ===
      "#/components/schemas/CashTransactionRow",
    "CashTransactionListResponse rows should use CashTransactionRow"
  );
  assert(
    schemas.CashTransitTransferListResponse?.properties?.rows?.items?.$ref ===
      "#/components/schemas/CashTransitTransferRow",
    "CashTransitTransferListResponse rows should use CashTransitTransferRow"
  );
  assert(
    schemas.CashTransitTransferResponse?.properties?.transfer?.allOf?.[0]?.$ref ===
      "#/components/schemas/CashTransitTransferRow",
    "CashTransitTransferResponse transfer should use CashTransitTransferRow"
  );
  assert(
    schemas.CashTransitTransferResponse?.properties?.transferOutTransaction?.allOf?.[0]?.$ref ===
      "#/components/schemas/CashTransactionRow",
    "CashTransitTransferResponse transferOutTransaction should use CashTransactionRow"
  );
  assert(
    schemas.CashTransitTransferResponse?.properties?.transferInTransaction?.allOf?.[0]?.$ref ===
      "#/components/schemas/CashTransactionRow",
    "CashTransitTransferResponse transferInTransaction should use CashTransactionRow"
  );
  assert(
    Object.prototype.hasOwnProperty.call(
      schemas.OperatingUnitInput?.properties || {},
      "centralDueFromAccountId"
    ) &&
      Object.prototype.hasOwnProperty.call(
        schemas.OperatingUnitInput?.properties || {},
        "ouDueToCentralAccountId"
      ),
    "OperatingUnitInput should document central current-account mapping fields"
  );
  assert(
    schemas.OperatingUnitListResponse?.properties?.rows?.items?.$ref ===
      "#/components/schemas/OperatingUnitRow",
    "OperatingUnitListResponse rows should use OperatingUnitRow"
  );
  assert(
    schemas.OperatingUnitPartnerCurrentAccountListResponse?.properties?.rows?.items?.$ref ===
      "#/components/schemas/OperatingUnitPartnerCurrentAccountRow",
    "OperatingUnitPartnerCurrentAccountListResponse rows should use OperatingUnitPartnerCurrentAccountRow"
  );

  const cariRunbook = await readFile(
    path.resolve(root, "docs/runbooks/cari-v1-operations.md"),
    "utf8"
  );
  for (const requiredToken of [
    "## Cash Register Ownership Context",
    "`Central`",
    "blank operating-unit selector",
    "different operating-unit contexts",
    "`CASH_IN_TRANSIT`",
    "`Kasa Islemleri`",
    "`Transfer Out`",
    "Center / Branch Current Accounts",
    "Branch Pair Current Accounts",
    "saved current-account config",
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
    "`Central`",
    "`OU: <code>`",
    "different operating-unit contexts",
    "no synthetic central operating unit",
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

  const organizationManagementSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );
  assert(
    !organizationManagementSource.includes("No OU (central / HQ first)"),
    "OrganizationManagementPage should not present Central as a missing OU label"
  );
  assert(
    !organizationManagementSource.includes("No OU means central cash-register fulfillment"),
    "OrganizationManagementPage should not explain fulfillment through a No OU label"
  );
  assert(
    !organizationManagementSource.includes("No OU means central fulfillment first"),
    "OrganizationManagementPage should not explain central fulfillment through a No OU label"
  );
  assert(
    organizationManagementSource.includes("Central means central cash-register fulfillment"),
    "OrganizationManagementPage should use Central wording for shareholder-capital cash fulfillment"
  );
  assert(
    organizationManagementSource.includes("Central means central fulfillment first"),
    "OrganizationManagementPage should use Central wording for shareholder-capital central-first guidance"
  );

  const prStepsSource = await readFile(
    path.resolve(root, "PR-STEPS/22-CASH-REGISTER-OWNERSHIP-EXPLICITNESS.md"),
    "utf8"
  );
  for (const requiredToken of [
    "`PR-CRO06`",
    "`PR-CRO07`",
    "`Kasa Islemleri`",
    "Branch Pair Current Accounts",
    "Center / Branch Current Accounts",
    "saved-config",
  ]) {
    assert(
      prStepsSource.includes(requiredToken),
      `PR-STEPS/22-CASH-REGISTER-OWNERSHIP-EXPLICITNESS.md missing: ${requiredToken}`
    );
  }

  console.log("Cash register ownership CRO04 rollout smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
