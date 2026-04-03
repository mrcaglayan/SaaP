import assert from "node:assert/strict";
import {
  getUserRoleScopeEffectiveDateGuard,
  loadUserPermissionCodes,
} from "../src/services/authz.scope.service.js";
import {
  canBootstrapTenant,
  canManageOps,
  canManageSecurity,
} from "../src/services/systemRoles.service.js";
import migration162TemporalRoleAssignments from "../src/migrations/m162_temporal_role_assignments.js";
import "../src/routes/me.js";
import "../src/routes/security.js";
import "../src/routes/gl.period-closing.routes.js";

function createEffectiveDateAwareRunQuery() {
  return async (sql, params = []) => {
    const normalizedSql = String(sql);

    if (normalizedSql.includes("information_schema.columns")) {
      return { rows: [{ column_count: 2 }] };
    }

    if (
      normalizedSql.includes("SUM(CASE WHEN urs.effect = 'ALLOW' THEN 1 ELSE 0 END)") &&
      normalizedSql.includes("GROUP BY p.code")
    ) {
      assert(
        normalizedSql.includes("urs.effective_from IS NULL OR urs.effective_from <= ?"),
        "loadUserPermissionCodes should apply effective_from filtering"
      );
      assert(
        normalizedSql.includes("urs.effective_to IS NULL OR urs.effective_to >= ?"),
        "loadUserPermissionCodes should apply effective_to filtering"
      );
      assert.equal(params[2], "2026-04-02");
      assert.equal(params[3], "2026-04-02");
      return {
        rows: [{ code: "gl.journal.read", allow_count: 1, tenant_deny_count: 0 }],
      };
    }

    if (
      normalizedSql.includes("FROM user_role_scopes urs") &&
      normalizedSql.includes("JOIN roles r ON r.id = urs.role_id") &&
      normalizedSql.includes("r.code IN")
    ) {
      assert(
        normalizedSql.includes("urs.effective_from IS NULL OR urs.effective_from <= ?"),
        "system role helpers should apply effective_from filtering"
      );
      assert(
        normalizedSql.includes("urs.effective_to IS NULL OR urs.effective_to >= ?"),
        "system role helpers should apply effective_to filtering"
      );
      return { rows: [{ 1: 1 }] };
    }

    throw new Error(
      `Unexpected SQL in test-authz-pr2c-temporal-role-assignments: ${normalizedSql}`
    );
  };
}

async function main() {
  const noSupportGuard = await getUserRoleScopeEffectiveDateGuard(async (sql) => {
    if (String(sql).includes("information_schema.columns")) {
      return { rows: [{ column_count: 0 }] };
    }
    throw new Error(`Unexpected SQL in noSupportGuard branch: ${sql}`);
  });
  assert.deepEqual(noSupportGuard, { sql: "", params: [] });

  const supportedGuard = await getUserRoleScopeEffectiveDateGuard(
    createEffectiveDateAwareRunQuery(),
    "2026-04-02"
  );
  assert.equal(
    supportedGuard.sql,
    " AND (urs.effective_from IS NULL OR urs.effective_from <= ?)" +
      " AND (urs.effective_to IS NULL OR urs.effective_to >= ?)"
  );
  assert.deepEqual(supportedGuard.params, ["2026-04-02", "2026-04-02"]);

  const permissionCodes = await loadUserPermissionCodes({
    tenantId: 77,
    userId: 88,
    asOfDate: "2026-04-02",
    runQuery: createEffectiveDateAwareRunQuery(),
  });
  assert.deepEqual(permissionCodes, ["gl.journal.read"]);

  assert.equal(
    await canManageSecurity(88, 77, createEffectiveDateAwareRunQuery()),
    true
  );
  assert.equal(await canManageOps(88, 77, createEffectiveDateAwareRunQuery()), true);
  assert.equal(
    await canBootstrapTenant(88, 77, createEffectiveDateAwareRunQuery()),
    true
  );

  assert.equal(migration162TemporalRoleAssignments.key, "m162_temporal_role_assignments");

  console.log("test-authz-pr2c-temporal-role-assignments passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
