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

  const exportServiceSource = await readFile(
    path.resolve(root, "backend/src/services/ops.exports.service.js"),
    "utf8"
  );
  const opsRoutesSource = await readFile(
    path.resolve(root, "backend/src/routes/ops.dashboard.routes.js"),
    "utf8"
  );
  const opsApiSource = await readFile(
    path.resolve(root, "frontend/src/api/opsDashboard.js"),
    "utf8"
  );
  const opsPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/OpsDashboardPage.jsx"),
    "utf8"
  );
  const messagesSource = await readFile(
    path.resolve(root, "frontend/src/i18n/messages.js"),
    "utf8"
  );

  assert(
    exportServiceSource.includes("export async function buildUsageExportCsv") &&
      exportServiceSource.includes("export async function buildAuditExportCsv") &&
      exportServiceSource.includes("audit_logs"),
    "Ops export service should expose usage + audit CSV builders"
  );

  assert(
    opsRoutesSource.includes('router.get(\n  "/exports/usage.csv"') &&
      opsRoutesSource.includes('router.get(\n  "/exports/audit.csv"') &&
      opsRoutesSource.includes('requirePermission("ops.dashboard.read"'),
    "Ops routes should expose guarded usage/audit CSV export endpoints"
  );

  assert(
    opsApiSource.includes("export async function downloadOpsUsageExportCsv") &&
      opsApiSource.includes("export async function downloadOpsAuditExportCsv"),
    "Frontend ops API should expose usage/audit CSV download clients"
  );

  assert(
    opsPageSource.includes("handleUsageExport") &&
      opsPageSource.includes("handleAuditExport") &&
      opsPageSource.includes("downloadOpsUsageExportCsv") &&
      opsPageSource.includes("downloadOpsAuditExportCsv"),
    "Ops dashboard page should wire usage/audit export actions"
  );

  assert(
    messagesSource.includes("exportUsageCsv") &&
      messagesSource.includes("exportAuditCsv"),
    "i18n should include usage/audit export labels"
  );

  console.log("PR-UX35 smoke test passed (usage + audit export endpoints/UI wiring).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
