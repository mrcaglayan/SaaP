import assert from "node:assert/strict";
import {
  CLOSE_TASK_RBAC_SCOPE_TYPES,
  isCloseTaskScopeAllowed,
  normalizeCloseTaskRbacScope,
  resolveCloseTaskRbacScope,
} from "../src/services/authz.scope.service.js";

const sampleScopeContext = {
  tenantId: 77,
  sourceRows: 4,
  tenantWide: false,
  groups: new Set([10]),
  countries: new Set([20]),
  legalEntities: new Set([30]),
  operatingUnits: new Set([40]),
};

function expectThrow(fn, status) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, "Expected function to throw");
  assert.equal(thrown.status, status);
  return thrown;
}

async function main() {
  assert.deepEqual(CLOSE_TASK_RBAC_SCOPE_TYPES, [
    "OPERATING_UNIT",
    "LEGAL_ENTITY",
    "COUNTRY",
    "GROUP",
  ]);

  assert.deepEqual(
    normalizeCloseTaskRbacScope({ scopeType: "operating_unit", scopeId: 40 }, 77),
    { scopeType: "OPERATING_UNIT", scopeId: 40 },
  );
  assert.deepEqual(
    normalizeCloseTaskRbacScope({ scopeType: "legal_entity", scopeId: 30 }, 77),
    { scopeType: "LEGAL_ENTITY", scopeId: 30 },
  );
  assert.deepEqual(
    normalizeCloseTaskRbacScope({ scopeType: "country", scopeId: 20 }, 77),
    { scopeType: "COUNTRY", scopeId: 20 },
  );
  assert.deepEqual(
    normalizeCloseTaskRbacScope({ scopeType: "group", scopeId: 10 }, 77),
    { scopeType: "GROUP", scopeId: 10 },
  );

  assert.equal(isCloseTaskScopeAllowed(sampleScopeContext, "OPERATING_UNIT", 40, 77), true);
  assert.equal(isCloseTaskScopeAllowed(sampleScopeContext, "LEGAL_ENTITY", 30, 77), true);
  assert.equal(isCloseTaskScopeAllowed(sampleScopeContext, "COUNTRY", 20, 77), true);
  assert.equal(isCloseTaskScopeAllowed(sampleScopeContext, "GROUP", 10, 77), true);
  assert.equal(isCloseTaskScopeAllowed(sampleScopeContext, "OPERATING_UNIT", 999, 77), false);
  assert.equal(isCloseTaskScopeAllowed(sampleScopeContext, "LEGAL_ENTITY", 999, 77), false);
  assert.equal(isCloseTaskScopeAllowed(sampleScopeContext, "COUNTRY", 999, 77), false);
  assert.equal(isCloseTaskScopeAllowed(sampleScopeContext, "GROUP", 999, 77), false);

  assert.deepEqual(
    resolveCloseTaskRbacScope({ rbac_scope_type: "COUNTRY", rbac_scope_id: 20 }, 77),
    { scopeType: "COUNTRY", scopeId: 20 },
  );
  assert.deepEqual(
    resolveCloseTaskRbacScope({ rbacScopeType: "GROUP", rbacScopeId: 10 }, 77),
    { scopeType: "GROUP", scopeId: 10 },
  );

  const tenantError = expectThrow(
    () => normalizeCloseTaskRbacScope({ scopeType: "TENANT", scopeId: 77 }, 77),
    400,
  );
  assert(
    String(tenantError.message).includes("Close task RBAC scopeType"),
    "tenant scope rejection should mention close task RBAC scope",
  );

  console.log("test-close-task-scope-access passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
