import assert from "node:assert/strict";
import {
  buildScopeFilterFromContext,
  buildVisibilityScopeWhereClause,
  checkUserHasPermissionAtScope,
  findUsersWithPermissionAtScope,
  getPermissionScopeContext,
  getVisibilityScopeContext,
  hasScopeAccessForContext,
  isScopeAllowed,
  loadUserPermissionCodes,
  normalizeAuthzScope,
  resolveRequestScope,
  resolveRowScope,
} from "../src/services/authz.scope.service.js";
import { requirePermission } from "../src/middleware/rbac.js";

const sampleScopeContext = {
  tenantId: 77,
  sourceRows: 2,
  tenantWide: false,
  groups: new Set([10]),
  countries: new Set([20]),
  legalEntities: new Set([30, 31]),
  operatingUnits: new Set([40]),
};

async function main() {
  assert.deepEqual(
    normalizeAuthzScope({ scopeType: "legal_entity", scopeId: 30 }, 77),
    { scopeType: "LEGAL_ENTITY", scopeId: 30 }
  );

  assert.deepEqual(resolveRowScope({ operatingUnitId: 40 }), {
    scopeType: "OPERATING_UNIT",
    scopeId: 40,
    scopeKind: "operating_unit",
  });
  assert.deepEqual(resolveRowScope({ legalEntityId: 30 }), {
    scopeType: "LEGAL_ENTITY",
    scopeId: 30,
    scopeKind: "legal_entity",
  });
  assert.deepEqual(resolveRowScope({ groupCompanyId: 10 }), {
    scopeType: "GROUP",
    scopeId: 10,
    scopeKind: "group",
  });

  const requestScope = resolveRequestScope(
    {
      user: { tenantId: 77 },
      rbac: { requestedScope: { scopeType: "LEGAL_ENTITY", scopeId: 30 } },
    },
    77
  );
  assert.deepEqual(requestScope, {
    scopeType: "LEGAL_ENTITY",
    scopeId: 30,
  });

  assert.equal(
    getVisibilityScopeContext({ rbac: { scopeContext: sampleScopeContext } }),
    null
  );
  assert.equal(
    getPermissionScopeContext({ rbac: { scopeContext: sampleScopeContext } }),
    null
  );
  assert.equal(
    getPermissionScopeContext({ rbac: { permissionScopeContext: sampleScopeContext } }),
    sampleScopeContext
  );

  assert.equal(
    isScopeAllowed(sampleScopeContext, { scopeType: "LEGAL_ENTITY", scopeId: 30 }),
    true
  );
  assert.equal(
    isScopeAllowed(sampleScopeContext, { scopeType: "LEGAL_ENTITY", scopeId: 999 }),
    false
  );
  assert.equal(hasScopeAccessForContext(sampleScopeContext, "legal_entity", 31), true);
  assert.equal(hasScopeAccessForContext(sampleScopeContext, "operating_unit", 999), false);

  const filterParams = [];
  const filterSql = buildScopeFilterFromContext(
    sampleScopeContext,
    "legal_entity",
    "t.legal_entity_id",
    filterParams
  );
  assert.equal(filterSql, "t.legal_entity_id IN (?, ?)");
  assert.deepEqual(filterParams, [30, 31]);

  const visibilityParams = [];
  const visibilitySql = buildVisibilityScopeWhereClause(sampleScopeContext, visibilityParams, {
    LEGAL_ENTITY: { idColumn: "r.legal_entity_id" },
    OPERATING_UNIT: { idColumn: "r.operating_unit_id" },
  });
  assert.equal(
    visibilitySql,
    "((r.legal_entity_id IN (?, ?)) OR (r.operating_unit_id IN (?)))"
  );
  assert.deepEqual(visibilityParams, [30, 31, 40]);

  assert.deepEqual(await loadUserPermissionCodes({ tenantId: null, userId: null }), []);
  assert.equal(
    await checkUserHasPermissionAtScope(null, null, "", "LEGAL_ENTITY", 30),
    false
  );
  assert.deepEqual(
    await findUsersWithPermissionAtScope(null, "", "LEGAL_ENTITY", 30),
    []
  );

  const middleware = requirePermission("org.tree.read");
  assert.equal(typeof middleware, "function");

  console.log("test-authz-pr2d-shared-scope-utils passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
