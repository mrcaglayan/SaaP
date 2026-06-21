import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConsolidationReadinessOwner } from "../src/services/consolidation.ready-to-start.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function buildOwnerRunQuery(roleAssignments = {}) {
  return async (sql, params = []) => {
    const normalizedSql = String(sql).replace(/\s+/g, " ");
    if (normalizedSql.includes("FROM information_schema.columns")) {
      return { rows: [{ column_count: 2 }] };
    }
    if (normalizedSql.includes("SELECT DISTINCT urs.user_id")) {
      const [, scopeType, scopeId, roleCode] = params;
      const key = `${scopeType}:${scopeId}:${roleCode}`;
      return {
        rows: (roleAssignments[key] || []).map((userId) => ({ user_id: userId })),
      };
    }
    if (
      normalizedSql.includes("FROM user_role_scopes urs") &&
      normalizedSql.includes("JOIN role_permissions rp")
    ) {
      return { rows: [] };
    }
    throw new Error(`Unexpected owner resolver SQL: ${sql}`);
  };
}

async function readSource(relativePath) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

async function main() {
  {
    const owner = await resolveConsolidationReadinessOwner({
      tenantId: 10,
      groupCompanyId: 20,
      runQuery: buildOwnerRunQuery({
        "GROUP:20:GroupReportingController": [501],
        "GROUP:20:ConsolidationRunPreparer": [502],
      }),
    });
    assert.equal(owner.ownerUserId, 501);
    assert.equal(owner.ownerRoleHint, "GroupReportingController");
    assert.equal(owner.ownerResolutionSource, "ROLE");
  }

  {
    const owner = await resolveConsolidationReadinessOwner({
      tenantId: 10,
      groupCompanyId: 20,
      runQuery: buildOwnerRunQuery({
        "GROUP:20:ConsolidationRunPreparer": [502],
      }),
    });
    assert.equal(owner.ownerUserId, 502);
    assert.equal(owner.ownerRoleHint, "ConsolidationRunPreparer");
    assert.equal(owner.ownerResolutionSource, "ROLE");
  }

  {
    const owner = await resolveConsolidationReadinessOwner({
      tenantId: 10,
      groupCompanyId: 20,
      runQuery: buildOwnerRunQuery({
        "TENANT:10:SystemAdmin": [900],
      }),
    });
    assert.equal(owner.ownerUserId, 900);
    assert.equal(owner.ownerRoleHint, "Tenant/System admin");
    assert.equal(owner.ownerResolutionSource, "ADMIN");
  }

  const serviceSource = await readSource("backend/src/services/consolidation.ready-to-start.service.js");
  for (const contract of [
    "OWNER_PRIMARY_ROLE_CODES",
    "GroupReportingController",
    "ConsolidationRunPreparer",
    "findUsersWithPermissionAtScope",
    "SECURITY_ADMIN_ROLE_CODE",
    "SYSTEM_ADMIN_ROLE_CODE",
    "ownerResolutionSource",
    "ownerResolver",
  ]) {
    assert(serviceSource.includes(contract), `Missing owner RBAC contract: ${contract}`);
  }

  const monitorSource = await readSource("frontend/src/pages/GroupCloseMonitorPage.jsx");
  const readinessSummarySource = await readSource(
    "frontend/src/components/close/ConsolidationReadinessSummary.jsx",
  );
  const readinessUtilsSource = await readSource(
    "frontend/src/components/close/consolidationReadinessUtils.js",
  );
  assert(monitorSource.includes("<ConsolidationReadinessSection"));
  assert(readinessSummarySource.includes("getOwnerHint(readiness, l)"));
  assert(readinessUtilsSource.includes("readiness?.ownerUserId"));
  assert(readinessUtilsSource.includes("Group reporting controller / consolidation preparer"));
  assert(readinessUtilsSource.includes("Kullanici"));

  console.log(
    "Consolidation ready-to-start RBAC checks passed (owner role priority + permission-aware payload).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
