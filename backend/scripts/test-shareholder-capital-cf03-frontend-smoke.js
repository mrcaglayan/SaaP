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
      pageSource.includes("capitalFulfillmentModalOpen") &&
      pageSource.includes("Record capital fulfillment") &&
      pageSource.includes("handlePreviewCapitalFulfillment") &&
      pageSource.includes("handleCreateCapitalFulfillment") &&
      pageSource.includes("Preview fulfillment") &&
      pageSource.includes("Post fulfillment"),
    "OrganizationManagementPage should provide bank-backed capital fulfillment modal with preview and post actions"
  );

  console.log("PR-CF03 frontend capital fulfillment smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
