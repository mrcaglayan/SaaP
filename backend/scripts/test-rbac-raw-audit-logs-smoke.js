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
  const appSource = await readFile(path.resolve(root, "frontend/src/App.jsx"), "utf8");
  const sidebarSource = await readFile(
    path.resolve(root, "frontend/src/layouts/sidebarConfig.js"),
    "utf8"
  );
  const messagesSource = await readFile(
    path.resolve(root, "frontend/src/i18n/messages.js"),
    "utf8"
  );
  const pageSource = await readFile(
    path.resolve(root, "frontend/src/pages/security/RawAuditLogsPage.jsx"),
    "utf8"
  );
  const apiClientSource = await readFile(
    path.resolve(root, "frontend/src/api/rbacAdmin.js"),
    "utf8"
  );
  const routeSource = await readFile(path.resolve(root, "backend/src/routes/rbac.js"), "utf8");
  const openApiSource = await readFile(path.resolve(root, "backend/openapi.yaml"), "utf8");

  assert(
    appSource.includes('appPath: "/app/ayarlar/rbac/raw-audit-logs"'),
    "Raw audit logs route is missing from frontend/src/App.jsx"
  );
  assert(
    sidebarSource.includes('to: "/app/ayarlar/rbac/raw-audit-logs"'),
    "Raw audit logs sidebar entry is missing from frontend/src/layouts/sidebarConfig.js"
  );
  assert(
    messagesSource.includes('"/app/ayarlar/rbac/raw-audit-logs": "Ham Denetim Loglari"'),
    "Turkish sidebar label is missing for raw audit logs route"
  );
  assert(
    messagesSource.includes('"/app/ayarlar/rbac/raw-audit-logs": "Raw Audit Logs"'),
    "English sidebar label is missing for raw audit logs route"
  );
  assert(
    pageSource.includes("listRawAuditLogs"),
    "RawAuditLogsPage must use listRawAuditLogs API client"
  );
  assert(
    apiClientSource.includes("/api/v1/rbac/raw-audit-logs"),
    "rbacAdmin API client is missing /api/v1/rbac/raw-audit-logs"
  );
  assert(
    routeSource.includes('"/raw-audit-logs"'),
    "RBAC route is missing /raw-audit-logs backend handler"
  );
  assert(
    openApiSource.includes('"/api/v1/rbac/raw-audit-logs":'),
    "OpenAPI spec is missing /api/v1/rbac/raw-audit-logs"
  );

  console.log("Raw audit logs smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
