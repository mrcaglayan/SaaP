import assert from "node:assert/strict";
import { closePool } from "../src/db.js";
import { buildScopeFilter, assertScopeAccess } from "../src/middleware/rbac.js";
import { getOpsFixedAssetActivationAttention } from "../src/services/ops.dashboard.service.js";

function createScopeReq({ tenantWide = false, legalEntityIds = [], operatingUnitIds = [] }) {
  const legalEntities = new Set(legalEntityIds);
  const operatingUnits = new Set(operatingUnitIds);
  return {
    rbac: {
      visibilityScopeContext: {
        tenantWide,
        groups: new Set(),
        countries: new Set(),
        legalEntities,
        operatingUnits,
      },
      permissionScopeContext: {
        tenantWide,
        groups: new Set(),
        countries: new Set(),
        legalEntities,
        operatingUnits,
      },
    },
  };
}

async function main() {
  const tenantWideReq = createScopeReq({ tenantWide: true });
  const legalEntityReq = createScopeReq({ legalEntityIds: [1], operatingUnitIds: [1] });
  const operatingUnitReq = createScopeReq({ operatingUnitIds: [1] });

  const tenantWide = await getOpsFixedAssetActivationAttention({
    req: tenantWideReq,
    tenantId: 1,
    filters: {},
    buildScopeFilter,
    assertScopeAccess,
  });
  assert.equal(tenantWide.affected_assets.pending_activation_assets, 2);

  const legalEntity = await getOpsFixedAssetActivationAttention({
    req: legalEntityReq,
    tenantId: 1,
    filters: { legalEntityId: 1 },
    buildScopeFilter,
    assertScopeAccess,
  });
  assert.equal(legalEntity.affected_assets.pending_activation_assets, 2);

  const operatingUnit = await getOpsFixedAssetActivationAttention({
    req: operatingUnitReq,
    tenantId: 1,
    filters: { legalEntityId: 1, operatingUnitId: 1 },
    buildScopeFilter,
    assertScopeAccess,
  });
  assert.equal(operatingUnit.affected_assets.pending_activation_assets, 2);

  console.log("test-ops-dashboard-fixed-asset-scope passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
