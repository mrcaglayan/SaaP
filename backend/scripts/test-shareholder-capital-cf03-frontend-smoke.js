import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const orgAdminSource = await readFile(
    path.resolve(root, "frontend/src/api/orgAdmin.js"),
    "utf8"
  );
  assert(
    orgAdminSource.includes("previewShareholderCapitalFulfillment") &&
      orgAdminSource.includes("createShareholderCapitalFulfillment") &&
      orgAdminSource.includes("/api/v1/org/shareholders/capital-fulfillments/preview") &&
      orgAdminSource.includes("/api/v1/org/shareholders/capital-fulfillments"),
    "orgAdmin API should expose shareholder capital fulfillment preview/create calls"
  );

  const pageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );
  assert(
    pageSource.includes("listBankAccounts") &&
      pageSource.includes("createBankAccount") &&
      pageSource.includes("provisionBankAccount102Child") &&
      pageSource.includes("capitalFulfillmentModalOpen") &&
      pageSource.includes("Record capital fulfillment") &&
      pageSource.includes("Create bank") &&
      pageSource.includes("handleCapitalFulfillmentCreateBank") &&
      pageSource.includes("handlePreviewCapitalFulfillment") &&
      pageSource.includes("handleCreateCapitalFulfillment") &&
      pageSource.includes("Preview fulfillment") &&
      pageSource.includes("Post fulfillment"),
    "OrganizationManagementPage should provide bank-backed capital fulfillment modal with inline bank creation plus preview/post actions"
  );

  const openapiSource = await readFile(path.resolve(root, "backend/openapi.yaml"), "utf8");
  assert(
    openapiSource.includes('"summary": "List bank accounts"') &&
      openapiSource.includes('"summary": "Provision bank account and auto-create 102 child GL account"') &&
      openapiSource.includes('"summary": "List shareholder capital fulfillments"') &&
      openapiSource.includes('"summary": "Preview shareholder capital fulfillment"') &&
      openapiSource.includes('"summary": "Create shareholder capital fulfillment"') &&
      openapiSource.includes('"summary": "Reverse shareholder capital fulfillment"') &&
      openapiSource.includes("#/components/schemas/BankAccountProvision102ChildResponse") &&
      openapiSource.includes("#/components/schemas/ShareholderCapitalFulfillmentPreviewResponse") &&
      !openapiSource.includes('Auto-generated: GET /api/v1/bank/accounts') &&
      !openapiSource.includes('Auto-generated: POST /api/v1/org/shareholders/capital-fulfillments') &&
      !openapiSource.includes('Auto-generated: POST /api/v1/org/shareholders/capital-fulfillments/preview'),
    "OpenAPI should document bank-account provisioning and shareholder capital fulfillment endpoints with concrete schemas"
  );

  const runbookSource = await readFile(
    path.resolve(root, "docs/runbooks/shareholder-capital-fulfillment-operations.md"),
    "utf8"
  );
  assert(
    runbookSource.includes("Bank destinations can be preconfigured in `bank_accounts`.") &&
      runbookSource.includes(
        "Organization Management can create it inline during capital fulfillment without leaving the modal."
      ) &&
      !runbookSource.includes("Bank destinations must be configured in `bank_accounts`."),
    "Shareholder capital fulfillment runbook should document inline bank creation instead of forcing bank preconfiguration"
  );

  console.log("PR-CF03 frontend capital fulfillment smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
