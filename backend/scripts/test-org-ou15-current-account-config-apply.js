import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import {
  apiRequest,
  assert,
  bootstrapOrgBookCoa,
  login,
  seedAndCreateTenantAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.ORG_OU15_TEST_PORT || 3141);
const BASE_URL = process.env.ORG_OU15_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

function toErrorText(jsonPayload) {
  if (jsonPayload === null || jsonPayload === undefined) {
    return "";
  }
  if (typeof jsonPayload === "string") {
    return jsonPayload;
  }
  if (typeof jsonPayload.message === "string") {
    return jsonPayload.message;
  }
  if (typeof jsonPayload.error === "string") {
    return jsonPayload.error;
  }
  try {
    return JSON.stringify(jsonPayload);
  } catch {
    return String(jsonPayload);
  }
}

async function createGlAccount({
  token,
  coaId,
  code,
  name,
  accountType,
  normalSide,
  allowPosting = true,
  parentAccountId = null,
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
      parentAccountId: parentAccountId || undefined,
    },
    expectedStatus: 201,
  });
  const accountId = toNumber(response.json?.id);
  assert(accountId > 0, `GL account create failed for ${code}`);
  return accountId;
}

async function upsertOperatingUnit({
  token,
  legalEntityId,
  code,
  name,
  ouDueFromCentralAccountId,
}) {
  const response = await apiRequest({
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
      ouDueFromCentralAccountId: ouDueFromCentralAccountId || undefined,
    },
    expectedStatus: 201,
  });
  const operatingUnitId = toNumber(response.json?.id);
  assert(operatingUnitId > 0, `Operating unit upsert failed for ${code}`);
  return operatingUnitId;
}

async function upsertPartnerCurrentAccount({
  token,
  legalEntityId,
  operatingUnitId,
  partnerOperatingUnitId,
  dueFromAccountId,
  dueToAccountId,
}) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-unit-partner-current-accounts",
    body: {
      legalEntityId,
      operatingUnitId,
      partnerOperatingUnitId,
      dueFromAccountId,
      dueToAccountId,
    },
    expectedStatus: 201,
  });
  const id = toNumber(response.json?.id);
  assert(id > 0, "Partner current-account upsert failed");
  return id;
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

async function applyCurrentAccountConfig({
  token,
  legalEntityId,
  operatingUnitId,
  repairMissingOnly = true,
  expectedStatus = 201,
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
    expectedStatus,
  });
}

async function fetchConfigRow(tenantId, legalEntityId) {
  const result = await query(
    `SELECT
       due_from_parent_account_id,
       due_to_parent_account_id,
       auto_provision_on_operating_unit_create,
       last_applied_at
     FROM operating_unit_current_account_configs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  return result.rows?.[0] || null;
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
       name,
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
  const identity = await seedAndCreateTenantAdmin({
    tenantCode: `OU15_${stamp}`,
    tenantName: `OU15 ${stamp}`,
    adminEmail: `ou15_admin_${stamp}@example.com`,
    adminPassword: "OU15#12345",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const adminToken = await login({
      baseUrl: BASE_URL,
      email: `ou15_admin_${stamp}@example.com`,
      password: "OU15#12345",
    });

    const orgA = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token: adminToken,
      stamp,
      baseCurrencyCode: "USD",
    });
    const orgB = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token: adminToken,
      stamp: stamp + 1,
      baseCurrencyCode: "USD",
    });

    const oldDueFromParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "132",
      name: `Due From Parent ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const oldDueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "331",
      name: `Due To Parent ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });
    const newDueFromParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "133",
      name: `Due From Parent New ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const newDueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "332",
      name: `Due To Parent New ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });

    await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      dueFromParentAccountId: oldDueFromParentAccountId,
      dueToParentAccountId: oldDueToParentAccountId,
      autoProvisionOnOperatingUnitCreate: false,
    });
    const configBeforeApply = await fetchConfigRow(identity.tenantId, orgA.legalEntityId);
    assert(configBeforeApply, "Config row should exist before apply");
    assert(configBeforeApply.last_applied_at === null, "last_applied_at should start null");

    const branchAId = orgA.operatingUnitId;
    const branchBId = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      code: `BRB${suffix}`,
      name: `Branch B ${suffix}`,
    });

    const firstApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      expectedStatus: 201,
    });
    assert(
      Array.isArray(firstApply.json?.createdAccounts) &&
        firstApply.json.createdAccounts.length === 12,
      "First full apply should create 12 accounts for two OUs plus both partner directions"
    );
    assert(
      Array.isArray(firstApply.json?.updatedOperatingUnits) &&
        firstApply.json.updatedOperatingUnits.length === 2,
      "First full apply should update both operating-unit central mapping rows"
    );
    assert(
      Array.isArray(firstApply.json?.updatedPartnerMappings) &&
        firstApply.json.updatedPartnerMappings.length === 2,
      "First full apply should create both OU-pair directions"
    );
    assert(firstApply.json?.lastAppliedAt, "First full apply should return lastAppliedAt");

    const firstApplyRows = await fetchOperatingUnitsByIds([branchAId, branchBId]);
    const branchAAfterFirstApply = firstApplyRows.find((row) => toNumber(row.id) === branchAId);
    const branchBAfterFirstApply = firstApplyRows.find((row) => toNumber(row.id) === branchBId);
    assertAllFourCentralFields(branchAAfterFirstApply, "Branch A after first apply");
    assertAllFourCentralFields(branchBAfterFirstApply, "Branch B after first apply");

    const firstMappings = await fetchPartnerMappings(identity.tenantId, orgA.legalEntityId);
    assert(firstMappings.length === 2, "First full apply should create two directional partner mappings");
    assert(
      firstMappings.some(
        (row) =>
          toNumber(row.operating_unit_id) === branchAId &&
          toNumber(row.partner_operating_unit_id) === branchBId
      ),
      "A -> B mapping should exist after first apply"
    );
    assert(
      firstMappings.some(
        (row) =>
          toNumber(row.operating_unit_id) === branchBId &&
          toNumber(row.partner_operating_unit_id) === branchAId
      ),
      "B -> A mapping should exist after first apply"
    );

    const branchASnapshot = snapshotOperatingUnit(branchAAfterFirstApply);
    const branchBSnapshot = snapshotOperatingUnit(branchBAfterFirstApply);
    const firstMappingSnapshot = snapshotMappings(firstMappings);
    const firstAppliedAt = String(firstApply.json.lastAppliedAt);

    await sleep(1100);
    const rerunApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      expectedStatus: 201,
    });
    assert(
      Array.isArray(rerunApply.json?.createdAccounts) &&
        rerunApply.json.createdAccounts.length === 0,
      "Rerun apply should be idempotent and create no accounts"
    );
    assert(
      Array.isArray(rerunApply.json?.updatedOperatingUnits) &&
        rerunApply.json.updatedOperatingUnits.length === 0,
      "Rerun apply should not rewrite valid OU rows"
    );
    assert(
      Array.isArray(rerunApply.json?.updatedPartnerMappings) &&
        rerunApply.json.updatedPartnerMappings.length === 0,
      "Rerun apply should not rewrite valid partner rows"
    );
    assert(
      Array.isArray(rerunApply.json?.reusedAccounts) &&
        rerunApply.json.reusedAccounts.length >= 12,
      "Rerun apply should report reused accounts"
    );
    assert(
      String(rerunApply.json?.lastAppliedAt || "") !== firstAppliedAt,
      "Successful rerun should advance lastAppliedAt"
    );

    const manualOuDueFromCentralId = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "132.90",
      name: `Branch C Due From Central Manual ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      parentAccountId: oldDueFromParentAccountId,
    });
    const branchCId = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      code: `BRC${suffix}`,
      name: `Branch C ${suffix}`,
      ouDueFromCentralAccountId: manualOuDueFromCentralId,
    });

    const manualCToADueFromId = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "132.91",
      name: `Branch C Due From Branch A Manual ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      parentAccountId: oldDueFromParentAccountId,
    });
    const manualCToADueToId = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "331.91",
      name: `Branch C Due To Branch A Manual ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      parentAccountId: oldDueToParentAccountId,
    });
    await upsertPartnerCurrentAccount({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      operatingUnitId: branchCId,
      partnerOperatingUnitId: branchAId,
      dueFromAccountId: manualCToADueFromId,
      dueToAccountId: manualCToADueToId,
    });

    await sleep(1100);
    const deltaApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      operatingUnitId: branchCId,
      expectedStatus: 201,
    });
    assert(
      Array.isArray(deltaApply.json?.createdAccounts) &&
        deltaApply.json.createdAccounts.length === 9,
      "Single-OU delta apply should create only the missing delta for the new branch"
    );
    assert(
      Array.isArray(deltaApply.json?.updatedOperatingUnits) &&
        deltaApply.json.updatedOperatingUnits.length === 1,
      "Single-OU delta apply should update only the selected OU row"
    );
    assert(
      Array.isArray(deltaApply.json?.updatedPartnerMappings) &&
        deltaApply.json.updatedPartnerMappings.length === 3,
      "Single-OU delta apply should create only the missing directional partner rows"
    );
    assert(
      Array.isArray(deltaApply.json?.reusedAccounts) &&
        deltaApply.json.reusedAccounts.length >= 3,
      "Single-OU delta apply should reuse valid existing manual mappings"
    );

    const deltaRows = await fetchOperatingUnitsByIds([branchAId, branchBId, branchCId]);
    const branchAAfterDelta = deltaRows.find((row) => toNumber(row.id) === branchAId);
    const branchBAfterDelta = deltaRows.find((row) => toNumber(row.id) === branchBId);
    const branchCAfterDelta = deltaRows.find((row) => toNumber(row.id) === branchCId);
    assertAllFourCentralFields(branchCAfterDelta, "Branch C after delta apply");
    assertSnapshotEqual(
      snapshotOperatingUnit(branchAAfterDelta),
      branchASnapshot,
      "Branch A central mappings"
    );
    assertSnapshotEqual(
      snapshotOperatingUnit(branchBAfterDelta),
      branchBSnapshot,
      "Branch B central mappings"
    );

    const mappingsAfterDelta = await fetchPartnerMappings(identity.tenantId, orgA.legalEntityId);
    assert(mappingsAfterDelta.length === 6, "Delta apply should leave six total directional partner mappings");
    const deltaMappingSnapshot = snapshotMappings(mappingsAfterDelta);
    assertSnapshotEqual(
      deltaMappingSnapshot.get(`${branchAId}:${branchBId}`),
      firstMappingSnapshot.get(`${branchAId}:${branchBId}`),
      "A -> B partner mapping"
    );
    assertSnapshotEqual(
      deltaMappingSnapshot.get(`${branchBId}:${branchAId}`),
      firstMappingSnapshot.get(`${branchBId}:${branchAId}`),
      "B -> A partner mapping"
    );

    const configBeforeFailedApply = await fetchConfigRow(identity.tenantId, orgA.legalEntityId);
    assert(configBeforeFailedApply?.last_applied_at, "Config should have last_applied_at before failure test");
    const beforeFailedApplyTs = String(configBeforeFailedApply.last_applied_at);
    const failedApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      operatingUnitId: orgB.operatingUnitId,
      expectedStatus: 400,
    });
    assert(
      toErrorText(failedApply.json).includes("operatingUnitId not found for selected legalEntityId"),
      "Apply should fail clearly when operatingUnitId belongs to another legal entity"
    );
    const configAfterFailedApply = await fetchConfigRow(identity.tenantId, orgA.legalEntityId);
    assert(
      String(configAfterFailedApply?.last_applied_at || "") === beforeFailedApplyTs,
      "Failed apply must not update last_applied_at"
    );

    await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      dueFromParentAccountId: newDueFromParentAccountId,
      dueToParentAccountId: newDueToParentAccountId,
    });

    const beforeRebaselineRows = await fetchOperatingUnitsByIds([branchAId, branchBId, branchCId]);
    const beforeRebaselineMappings = await fetchPartnerMappings(identity.tenantId, orgA.legalEntityId);
    const beforeRebaselineOuSnapshots = new Map(
      beforeRebaselineRows.map((row) => [toNumber(row.id), snapshotOperatingUnit(row)])
    );
    const beforeRebaselineMappingSnapshot = snapshotMappings(beforeRebaselineMappings);

    await sleep(1100);
    const parentChangeApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      expectedStatus: 201,
    });
    assert(
      Array.isArray(parentChangeApply.json?.createdAccounts) &&
        parentChangeApply.json.createdAccounts.length === 0,
      "Default repair mode must not overwrite valid existing mappings after parent change"
    );
    assert(
      Array.isArray(parentChangeApply.json?.updatedOperatingUnits) &&
        parentChangeApply.json.updatedOperatingUnits.length === 0,
      "Parent change apply should preserve valid OU mappings"
    );
    assert(
      Array.isArray(parentChangeApply.json?.updatedPartnerMappings) &&
        parentChangeApply.json.updatedPartnerMappings.length === 0,
      "Parent change apply should preserve valid partner mappings"
    );
    const warningCodes = new Set(
      (parentChangeApply.json?.warnings || []).map((warning) => String(warning?.code || ""))
    );
    assert(
      warningCodes.has("PRESERVED_MANUAL_OU_CURRENT_ACCOUNT"),
      "Apply summary should report preserved manual OU mappings after parent change"
    );
    assert(
      warningCodes.has("PRESERVED_MANUAL_PARTNER_CURRENT_ACCOUNT"),
      "Apply summary should report preserved manual partner mappings after parent change"
    );

    const afterRebaselineRows = await fetchOperatingUnitsByIds([branchAId, branchBId, branchCId]);
    for (const row of afterRebaselineRows) {
      assertSnapshotEqual(
        snapshotOperatingUnit(row),
        beforeRebaselineOuSnapshots.get(toNumber(row.id)),
        `OU ${row.code} mappings after parent change apply`
      );
    }
    const afterRebaselineMappings = await fetchPartnerMappings(identity.tenantId, orgA.legalEntityId);
    const afterRebaselineMappingSnapshot = snapshotMappings(afterRebaselineMappings);
    for (const [key, snapshot] of beforeRebaselineMappingSnapshot.entries()) {
      assertSnapshotEqual(
        afterRebaselineMappingSnapshot.get(key),
        snapshot,
        `Partner mapping ${key} after parent change apply`
      );
    }

    console.log("OU15 current-account config apply checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: orgA.legalEntityId,
          firstApplyCreatedAccounts: firstApply.json.createdAccounts.length,
          rerunCreatedAccounts: rerunApply.json.createdAccounts.length,
          deltaCreatedAccounts: deltaApply.json.createdAccounts.length,
          parentChangeWarnings: parentChangeApply.json.warnings.length,
          finalLastAppliedAt: parentChangeApply.json.lastAppliedAt,
        },
        null,
        2
      )
    );
  } finally {
    if (!serverStopped) {
      server.kill("SIGINT");
      serverStopped = true;
    }
    await sleep(400);
    await closePool();
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("OU15 current-account config apply test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
