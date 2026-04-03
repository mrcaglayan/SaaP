import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import securityRouter from "../src/routes/security.js";

function hasRoute(router, routePath, method) {
  return (router?.stack || []).some(
    (layer) =>
      layer?.route?.path === routePath &&
      Boolean(layer.route.methods?.[String(method || "").toLowerCase()])
  );
}

async function main() {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(backendRoot, "..");

  const pageSource = await readFile(
    path.resolve(repoRoot, "frontend/src/pages/security/BranchOperatorManagementPage.jsx"),
    "utf8"
  );
  const apiSource = await readFile(
    path.resolve(repoRoot, "frontend/src/api/rbacAdmin.js"),
    "utf8"
  );
  const appSource = await readFile(path.resolve(repoRoot, "frontend/src/App.jsx"), "utf8");
  const sidebarSource = await readFile(
    path.resolve(repoRoot, "frontend/src/layouts/sidebarConfig.js"),
    "utf8"
  );

  assert(
    appSource.includes('appPath: "/app/ayarlar/sube-operatorleri"'),
    "App router must register /app/ayarlar/sube-operatorleri"
  );
  assert(
    sidebarSource.includes('to: "/app/ayarlar/sube-operatorleri"'),
    "sidebarConfig must expose /app/ayarlar/sube-operatorleri"
  );

  assert(
    pageSource.includes("getEntityBranchOperatorAdminData") &&
      pageSource.includes("assignEntityBranchOperator") &&
      pageSource.includes("deleteEntityBranchOperatorAssignment"),
    "Branch operator page must use the branch operator admin API client helpers"
  );
  assert(
    pageSource.includes('"security.user_admin.entity"'),
    "Branch operator page must gate actions with security.user_admin.entity"
  );
  assert(
    pageSource.includes('scopeType: "OPERATING_UNIT"'),
    "Branch operator page must resolve per-operating-unit scope for delegated admins"
  );

  assert(
    apiSource.includes('api.get("/api/v1/security/entity-branch-operators")') &&
      apiSource.includes('api.post("/api/v1/security/entity-branch-operators", payload)') &&
      apiSource.includes('`/api/v1/security/entity-branch-operators/${assignmentId}`'),
    "RBAC admin API client must expose branch operator list/create/delete helpers"
  );

  assert(
    hasRoute(securityRouter, "/entity-branch-operators", "get"),
    "Security router must expose GET /entity-branch-operators"
  );
  assert(
    hasRoute(securityRouter, "/entity-branch-operators", "post"),
    "Security router must expose POST /entity-branch-operators"
  );
  assert(
    hasRoute(securityRouter, "/entity-branch-operators/:assignmentId", "delete"),
    "Security router must expose DELETE /entity-branch-operators/:assignmentId"
  );

  console.log("Branch operator management smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
