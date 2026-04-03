import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_CANONICAL_PERMISSIONS = Object.freeze([
  "consolidation.coa_mapping.read",
  "consolidation.coa_mapping.upsert",
  "consolidation.run.read",
  "consolidation.run.execute",
]);

const FINANCE_OPS_ROLES = Object.freeze([
  {
    roleCode: "GroupReportingController",
    permissionContainer: "GROUP_REPORTING_CONTROLLER_PERMISSION_CODES",
  },
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractRoleBlock(source, roleCode) {
  const marker = `code: "${roleCode}"`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return null;
  }
  const nextRoleStart = source.indexOf('\n  {\n    code: "', start + marker.length);
  const listEnd = source.indexOf("\n];", start);
  const end =
    nextRoleStart >= 0
      ? nextRoleStart
      : listEnd >= 0
        ? listEnd
        : source.length;
  return source.slice(start, end);
}

function extractConstBlock(source, constName) {
  const marker = `const ${constName} =`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return null;
  }
  const end = source.indexOf("});", start);
  if (end < 0) {
    return null;
  }
  return source.slice(start, end + 3);
}

function assertRoleIncludesPermissions(seedCoreSource, roleCode, permissions, permissionContainer) {
  const roleBlock = extractRoleBlock(seedCoreSource, roleCode);
  assert(roleBlock, `Role definition missing in seedCore: ${roleCode}`);
  if (permissionContainer) {
    assert(
      roleBlock.includes(`permissions: ${permissionContainer}`),
      `${roleCode} must bind permissions through ${permissionContainer}`
    );
  }
  const permissionSource = permissionContainer
    ? extractConstBlock(seedCoreSource, permissionContainer)
    : roleBlock;
  assert(
    permissionSource,
    `Permission source missing for ${roleCode}${permissionContainer ? ` (${permissionContainer})` : ""}`
  );
  for (const permissionCode of permissions) {
    assert(
      permissionSource.includes(`"${permissionCode}"`),
      `${roleCode} is missing required permission ${permissionCode}`
    );
  }
}

function assertRoutePermission(routeSource, method, routePath, permissionCode) {
  const escapedRoutePath = routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedPermission = permissionCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `router\\.${method}\\(\\s*"${escapedRoutePath}"[\\s\\S]*?requirePermission\\("${escapedPermission}"`,
    "m"
  );
  assert(
    pattern.test(routeSource),
    `Route guard missing: ${method.toUpperCase()} ${routePath} must require ${permissionCode}`
  );
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  const seedCoreSource = await readFile(
    path.resolve(root, "backend/src/seedCore.js"),
    "utf8"
  );
  for (const permissionCode of REQUIRED_CANONICAL_PERMISSIONS) {
    assert(
      seedCoreSource.includes(`"${permissionCode}"`),
      `Permission catalog missing required canonical permission ${permissionCode}`
    );
  }
  for (const role of FINANCE_OPS_ROLES) {
    assertRoleIncludesPermissions(
      seedCoreSource,
      role.roleCode,
      REQUIRED_CANONICAL_PERMISSIONS,
      role.permissionContainer
    );
  }

  const routeSource = await readFile(
    path.resolve(root, "backend/src/routes/consolidation.js"),
    "utf8"
  );
  assertRoutePermission(
    routeSource,
    "get",
    "/groups/:groupId/canonical-mappings",
    "consolidation.coa_mapping.read"
  );
  assertRoutePermission(
    routeSource,
    "get",
    "/groups/:groupId/canonical-mappings/candidates",
    "consolidation.coa_mapping.read"
  );
  assertRoutePermission(
    routeSource,
    "post",
    "/groups/:groupId/canonical-mappings/candidates/apply",
    "consolidation.coa_mapping.upsert"
  );
  assertRoutePermission(
    routeSource,
    "post",
    "/groups/:groupId/canonical-mappings/local",
    "consolidation.coa_mapping.upsert"
  );
  assertRoutePermission(
    routeSource,
    "post",
    "/groups/:groupId/canonical-mappings/group",
    "consolidation.coa_mapping.upsert"
  );

  console.log(
    "FUP-CM02 RBAC active-role parity + canonical route guard checks passed."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
