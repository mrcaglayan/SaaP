import assert from "node:assert/strict";
import {
  buildEmptyEntitlementsResponse,
  getPermissionScopeContext,
  getVisibilityScopeContext,
  loadUserEntitlements,
} from "../src/services/authz.scope.service.js";
import "../src/routes/me.js";

function createRunQuery({ dataScopes = [] } = {}) {
  return async (sql, params = []) => {
    const normalizedSql = String(sql);

    if (normalizedSql.includes("information_schema.columns")) {
      return { rows: [{ column_count: 0 }] };
    }

    if (
      normalizedSql.includes("SELECT") &&
      normalizedSql.includes("SUM(CASE WHEN urs.effect = 'ALLOW' THEN 1 ELSE 0 END)") &&
      normalizedSql.includes("GROUP BY p.code")
    ) {
      return {
        rows: [{ code: "gl.journal.read", allow_count: 1, tenant_deny_count: 0 }],
      };
    }

    if (
      normalizedSql.includes("SELECT p.code, urs.effect, urs.scope_type, urs.scope_id") &&
      normalizedSql.includes("FROM user_role_scopes urs")
    ) {
      return {
        rows: [
          {
            code: "gl.journal.read",
            effect: "ALLOW",
            scope_type: "LEGAL_ENTITY",
            scope_id: 11,
          },
        ],
      };
    }

    if (normalizedSql.includes("FROM data_scopes")) {
      return {
        rows: dataScopes,
      };
    }

    if (normalizedSql.includes("SELECT id FROM group_companies")) {
      return { rows: [{ id: 1 }] };
    }

    if (
      normalizedSql.includes("FROM legal_entities") &&
      normalizedSql.includes("group_company_id")
    ) {
      return {
        rows: [{ id: 11, group_company_id: 1, country_id: 2 }],
      };
    }

    if (
      normalizedSql.includes("FROM operating_units") &&
      normalizedSql.includes("legal_entity_id")
    ) {
      return {
        rows: [{ id: 21, legal_entity_id: 11 }],
      };
    }

    throw new Error(`Unexpected SQL in test-authz-pr2a-explicit-scope-model: ${normalizedSql}`);
  };
}

async function main() {
  const emptyEntitlements = buildEmptyEntitlementsResponse(77, 88);
  assert.deepEqual(emptyEntitlements, {
    tenantId: 77,
    userId: 88,
    permissions: [],
    visibilityOverrides: [],
    scopeSummary: {
      permissionScopeContext: null,
      visibilityScopeContext: null,
    },
    isVisibilityNarrowed: false,
    maskedFields: [],
  });

  const explicitVisibilityReq = {
    rbac: {
      scopeContext: { tenantWide: true },
      visibilityScopeContext: null,
    },
  };
  assert.equal(getVisibilityScopeContext(explicitVisibilityReq), null);
  assert.equal(getPermissionScopeContext(explicitVisibilityReq), null);

  const baseEntitlements = await loadUserEntitlements({
    tenantId: 77,
    userId: 88,
    runQuery: createRunQuery(),
  });
  assert.equal(baseEntitlements.isVisibilityNarrowed, false);
  assert.equal(baseEntitlements.scopeSummary.visibilityScopeContext, null);
  assert(
    baseEntitlements.permissions.some(
      (row) =>
        row.code === "gl.journal.read" &&
        row.scopeType === "LEGAL_ENTITY" &&
        row.scopeIds.includes(11)
    ),
    "expected legal-entity permission scope row"
  );

  const narrowedEntitlements = await loadUserEntitlements({
    tenantId: 77,
    userId: 88,
    runQuery: createRunQuery({
      dataScopes: [{ effect: "ALLOW", scope_type: "OPERATING_UNIT", scope_id: 21 }],
    }),
  });
  assert.equal(narrowedEntitlements.isVisibilityNarrowed, true);
  assert.deepEqual(narrowedEntitlements.visibilityOverrides, [
    { scopeType: "OPERATING_UNIT", scopeId: 21, effect: "ALLOW" },
  ]);
  assert.deepEqual(narrowedEntitlements.scopeSummary.visibilityScopeContext?.scopeTypes, [
    "OPERATING_UNIT",
  ]);

  console.log("test-authz-pr2a-explicit-scope-model passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
