import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import {
  apiRequest,
  assert,
  bootstrapOrgBookCoa,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.ORG_OU17_TEST_PORT || 3143);
const BASE_URL = process.env.ORG_OU17_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

async function createGlAccount({
  token,
  coaId,
  code,
  name,
  accountType,
  normalSide,
  allowPosting = false,
}) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/gl/accounts",
    body: {
      coaId,
      code,
      name,
      accountType,
      normalSide,
      allowPosting,
    },
    expectedStatus: 201,
  });
  const accountId = toNumber(response.json?.id);
  assert(accountId > 0, `GL account create failed for ${code}`);
  return accountId;
}

async function saveCurrentAccountConfig({
  token,
  legalEntityId,
  dueFromParentAccountId,
  dueToParentAccountId,
  autoProvisionOnOperatingUnitCreate = true,
}) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-unit-current-account-config",
    body: {
      legalEntityId,
      dueFromParentAccountId,
      dueToParentAccountId,
      autoProvisionOnOperatingUnitCreate,
    },
    expectedStatus: 201,
  });
}

async function upsertOperatingUnit({
  token,
  legalEntityId,
  code,
  name,
  expectedStatus = 201,
}) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-units",
    body: {
      legalEntityId,
      code,
      name,
      unitType: "BRANCH",
      hasSubledger: true,
    },
    expectedStatus,
  });
}

async function applyCurrentAccountConfig({
  token,
  legalEntityId,
  operatingUnitId,
  repairMissingOnly = true,
}) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-unit-current-account-config/apply",
    body: {
      legalEntityId,
      operatingUnitId: operatingUnitId || undefined,
      repairMissingOnly,
    },
    expectedStatus: 201,
  });
}

async function fetchOperatingUnitsByIds(operatingUnitIds) {
  const ids = Array.from(new Set((operatingUnitIds || []).map((id) => toNumber(id)).filter(Boolean)));
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(",");
  const result = await query(
    `SELECT
       id,
       code,
       central_due_from_account_id,
       central_due_to_account_id,
       ou_due_from_central_account_id,
       ou_due_to_central_account_id
     FROM operating_units
     WHERE id IN (${placeholders})
     ORDER BY id`,
    ids
  );
  return result.rows || [];
}

async function fetchPartnerMappings(tenantId, legalEntityId) {
  const result = await query(
    `SELECT
       operating_unit_id,
       partner_operating_unit_id,
       due_from_account_id,
       due_to_account_id
     FROM operating_unit_partner_current_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY operating_unit_id, partner_operating_unit_id`,
    [tenantId, legalEntityId]
  );
  return result.rows || [];
}

function assertAllFourCentralFields(row, label) {
  assert(toNumber(row?.central_due_from_account_id) > 0, `${label} missing central_due_from_account_id`);
  assert(toNumber(row?.central_due_to_account_id) > 0, `${label} missing central_due_to_account_id`);
  assert(
    toNumber(row?.ou_due_from_central_account_id) > 0,
    `${label} missing ou_due_from_central_account_id`
  );
  assert(toNumber(row?.ou_due_to_central_account_id) > 0, `${label} missing ou_due_to_central_account_id`);
}

function snapshotOperatingUnit(row) {
  return {
    centralDueFromAccountId: toNumber(row?.central_due_from_account_id),
    centralDueToAccountId: toNumber(row?.central_due_to_account_id),
    ouDueFromCentralAccountId: toNumber(row?.ou_due_from_central_account_id),
    ouDueToCentralAccountId: toNumber(row?.ou_due_to_central_account_id),
  };
}

function mappingKey(row) {
  return `${toNumber(row?.operating_unit_id)}:${toNumber(row?.partner_operating_unit_id)}`;
}

function snapshotMappings(rows) {
  return new Map(
    (rows || []).map((row) => [
      mappingKey(row),
      {
        dueFromAccountId: toNumber(row?.due_from_account_id),
        dueToAccountId: toNumber(row?.due_to_account_id),
      },
    ])
  );
}

function assertSnapshotEqual(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} changed unexpectedly. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
  );
}

async function main() {
  const stamp = Date.now();
  const suffix = String(stamp).slice(-6);
  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode: `OU17_${stamp}`,
    tenantName: `OU17 ${stamp}`,
    adminEmail: `ou17_admin_${stamp}@example.com`,
    adminPassword: "OU17#12345",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const adminToken = await login({
      baseUrl: BASE_URL,
      email: `ou17_admin_${stamp}@example.com`,
      password: "OU17#12345",
    });

    const configuredOrg = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token: adminToken,
      stamp,
      baseCurrencyCode: "USD",
    });
    const noConfigOrg = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token: adminToken,
      stamp: stamp + 1,
      baseCurrencyCode: "USD",
    });

    const dueFromParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: configuredOrg.coaId,
      code: "132",
      name: `Due From Parent ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const dueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: configuredOrg.coaId,
      code: "331",
      name: `Due To Parent ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });

    await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: configuredOrg.legalEntityId,
      dueFromParentAccountId,
      dueToParentAccountId,
      autoProvisionOnOperatingUnitCreate: true,
    });

    const branchAId = configuredOrg.operatingUnitId;
    const branchBResponse = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: configuredOrg.legalEntityId,
      code: `BRB${suffix}`,
      name: `Branch B ${suffix}`,
    });
    const branchBId = toNumber(branchBResponse.json?.id);
    assert(branchBId > 0, "Second branch save should succeed");
    assert(
      branchBResponse.json?.currentAccountProvisioning?.status === "applied",
      "Second branch save should auto-apply current-account delta when config exists"
    );

    await sleep(1100);
    const initialApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: configuredOrg.legalEntityId,
    });
    assert(
      Array.isArray(initialApply.json?.updatedOperatingUnits) &&
        initialApply.json.updatedOperatingUnits.length === 1,
      "Initial repair should only backfill the pre-config bootstrap branch"
    );

    const initialRows = await fetchOperatingUnitsByIds([branchAId, branchBId]);
    const branchAInitial = initialRows.find((row) => toNumber(row.id) === branchAId);
    const branchBInitial = initialRows.find((row) => toNumber(row.id) === branchBId);
    assertAllFourCentralFields(branchAInitial, "Initial branch A");
    assertAllFourCentralFields(branchBInitial, "Initial branch B");

    const initialMappings = await fetchPartnerMappings(identity.tenantId, configuredOrg.legalEntityId);
    assert(initialMappings.length === 2, "Initial two-branch setup should have two directional partner mappings");

    const branchASnapshot = snapshotOperatingUnit(branchAInitial);
    const branchBSnapshot = snapshotOperatingUnit(branchBInitial);
    const initialMappingSnapshot = snapshotMappings(initialMappings);

    const branchCResponse = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: configuredOrg.legalEntityId,
      code: `BRC${suffix}`,
      name: `Branch C ${suffix}`,
    });
    const branchCId = toNumber(branchCResponse.json?.id);
    assert(branchCId > 0, "Third branch save should succeed");
    assert(
      branchCResponse.json?.currentAccountProvisioning?.status === "applied",
      "Third branch save should auto-apply missing current-account delta"
    );
    assert(
      Array.isArray(branchCResponse.json?.currentAccountProvisioning?.summary?.createdAccounts) &&
        branchCResponse.json.currentAccountProvisioning.summary.createdAccounts.length === 12,
      "Third branch delta should create 12 child accounts for the new branch and its two peer directions"
    );
    assert(
      Array.isArray(branchCResponse.json?.currentAccountProvisioning?.summary?.updatedOperatingUnits) &&
        branchCResponse.json.currentAccountProvisioning.summary.updatedOperatingUnits.length === 1,
      "Third branch delta should update only the new branch OU row"
    );
    assert(
      Array.isArray(branchCResponse.json?.currentAccountProvisioning?.summary?.updatedPartnerMappings) &&
        branchCResponse.json.currentAccountProvisioning.summary.updatedPartnerMappings.length === 4,
      "Third branch delta should create only the four missing directional partner mappings"
    );
    assert(
      Array.isArray(branchCResponse.json?.currentAccountProvisioning?.warnings) &&
        branchCResponse.json.currentAccountProvisioning.warnings.length === 0,
      "Third branch delta should not emit warnings in the happy path"
    );

    const afterThirdRows = await fetchOperatingUnitsByIds([branchAId, branchBId, branchCId]);
    const branchAAfterThird = afterThirdRows.find((row) => toNumber(row.id) === branchAId);
    const branchBAfterThird = afterThirdRows.find((row) => toNumber(row.id) === branchBId);
    const branchCAfterThird = afterThirdRows.find((row) => toNumber(row.id) === branchCId);
    assertAllFourCentralFields(branchCAfterThird, "Third branch after delta apply");
    assertSnapshotEqual(snapshotOperatingUnit(branchAAfterThird), branchASnapshot, "Branch A snapshot");
    assertSnapshotEqual(snapshotOperatingUnit(branchBAfterThird), branchBSnapshot, "Branch B snapshot");

    const mappingsAfterThird = await fetchPartnerMappings(identity.tenantId, configuredOrg.legalEntityId);
    assert(mappingsAfterThird.length === 6, "Third branch delta should add four directional mappings to the existing two");
    const afterThirdSnapshot = snapshotMappings(mappingsAfterThird);
    for (const [key, value] of initialMappingSnapshot.entries()) {
      assertSnapshotEqual(afterThirdSnapshot.get(key), value, `Existing partner mapping ${key}`);
    }
    for (const key of [
      `${branchAId}:${branchCId}`,
      `${branchBId}:${branchCId}`,
      `${branchCId}:${branchAId}`,
      `${branchCId}:${branchBId}`,
    ]) {
      assert(afterThirdSnapshot.has(key), `Missing new partner mapping ${key}`);
    }

    await query(
      `DELETE FROM operating_unit_current_account_configs
       WHERE tenant_id = ?
         AND legal_entity_id = ?`,
      [identity.tenantId, noConfigOrg.legalEntityId]
    );

    const noConfigResponse = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: noConfigOrg.legalEntityId,
      code: `NCB${suffix}`,
      name: `No Config Branch ${suffix}`,
    });
    const noConfigBranchId = toNumber(noConfigResponse.json?.id);
    assert(noConfigBranchId > 0, "Branch save without config should still succeed");
    assert(
      noConfigResponse.json?.currentAccountProvisioning?.status === "skipped_missing_config",
      "Branch save without config should return skipped_missing_config status"
    );
    assert(
      Array.isArray(noConfigResponse.json?.currentAccountProvisioning?.warnings) &&
        noConfigResponse.json.currentAccountProvisioning.warnings.some(
          (warning) => String(warning?.code || "") === "MISSING_SAVED_CURRENT_ACCOUNT_CONFIG"
        ),
      "Branch save without config should return a clear missing-config warning"
    );

    console.log("OU17 incremental branch delta provisioning checks passed.");
  } finally {
    if (!serverStopped) {
      server.kill("SIGTERM");
      serverStopped = true;
      await sleep(250);
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error("OU17 incremental branch delta provisioning test failed.");
  console.error(error);
  process.exitCode = 1;
});
