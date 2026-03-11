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

  const reverseHelperSource = await readFile(
    path.resolve(root, "backend/src/services/gl.journal-reversal.service.js"),
    "utf8"
  );
  assert(
    reverseHelperSource.includes("export async function reverseJournalEntryTx"),
    "shared GL journal reversal helper should exist"
  );

  const glRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/gl.write.journal.routes.js"),
    "utf8"
  );
  assert(
    glRouteSource.includes('from "../services/gl.journal-reversal.service.js"') &&
      glRouteSource.includes("return reverseJournalEntryTx(tx, {"),
    "GL write route should use the shared journal reversal helper"
  );

  const capitalFulfillmentSource = await readFile(
    path.resolve(root, "backend/src/services/org.capital-fulfillment.service.js"),
    "utf8"
  );
  assert(
    capitalFulfillmentSource.includes('from "./gl.journal-reversal.service.js"') &&
      capitalFulfillmentSource.includes("idempotentOnAlreadyReversed: true"),
    "capital fulfillment service should reuse shared GL reverse behavior"
  );

  const readQueriesSource = await readFile(
    path.resolve(root, "backend/src/services/org.read.queries.js"),
    "utf8"
  );
  assert(
    readQueriesSource.includes("AS unpaid_capital") &&
      readQueriesSource.includes("FROM shareholder_capital_fulfillments scf") &&
      readQueriesSource.includes("WHERE scf.status = 'POSTED'") &&
      readQueriesSource.includes("SUM(scf.amount_base) AS paid_capital_calculated"),
    "shareholder read query should derive paid/unpaid capital from posted fulfillment rows"
  );

  const orgAdminSource = await readFile(
    path.resolve(root, "frontend/src/api/orgAdmin.js"),
    "utf8"
  );
  assert(
    orgAdminSource.includes("listShareholderCapitalFulfillments") &&
      orgAdminSource.includes("reverseShareholderCapitalFulfillment"),
    "orgAdmin API should expose capital fulfillment list and reverse calls"
  );

  const frontendSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/OrganizationManagementPage.jsx"),
    "utf8"
  );
  assert(
    frontendSource.includes("Capital fulfillment history") &&
      frontendSource.includes("handleReverseCapitalFulfillment") &&
      frontendSource.includes("row.unpaid_capital") &&
      frontendSource.includes("Ters cevir"),
    "OrganizationManagementPage should show unpaid capital, fulfillment history, and reverse action"
  );

  console.log("PR-CF04 reversal and reporting smoke checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
