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

const PORT = Number(process.env.CASH_CRO06_TEST_PORT || 3136);
const BASE_URL = process.env.CASH_CRO06_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

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

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function parseChildSequence(code, parentCode) {
  const normalizedCode = normalizeCode(code);
  const normalizedParentCode = normalizeCode(parentCode);
  if (!normalizedCode || !normalizedParentCode) {
    return null;
  }
  if (!normalizedCode.startsWith(`${normalizedParentCode}.`)) {
    return null;
  }
  const suffix = normalizedCode.slice(normalizedParentCode.length + 1);
  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  return Number(suffix);
}

async function createGlAccount({
  token,
  coaId,
  code,
  name,
  accountType,
  normalSide,
  allowPosting = false,
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

async function createOperatingUnit({ token, legalEntityId, code, name }) {
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
    },
    expectedStatus: 201,
  });
  assert(toNumber(response.json?.id) > 0, `Operating unit create failed for ${code}`);
  return response;
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
  expectedStatus = 201,
}) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-unit-current-account-config/apply",
    body: {
      legalEntityId,
      operatingUnitId,
      repairMissingOnly: true,
    },
    expectedStatus,
  });
}

async function listPartnerCurrentMappings({
  token,
  legalEntityId,
  operatingUnitId,
  partnerOperatingUnitId,
}) {
  const search = new URLSearchParams({
    legalEntityId: String(legalEntityId),
    operatingUnitId: String(operatingUnitId),
    partnerOperatingUnitId: String(partnerOperatingUnitId),
  });
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/org/operating-unit-partner-current-accounts?${search.toString()}`,
    expectedStatus: 200,
  });
  return Array.isArray(response.json?.rows) ? response.json.rows : [];
}

async function fetchAccountRows(accountIds) {
  const normalizedIds = Array.from(new Set((accountIds || []).map((id) => toNumber(id)).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return [];
  }
  const placeholders = normalizedIds.map(() => "?").join(",");
  const result = await query(
    `SELECT
       id,
       code,
       name,
       account_type,
       normal_side,
       allow_posting,
       parent_account_id,
       is_active
     FROM accounts
     WHERE id IN (${placeholders})
     ORDER BY id`,
    normalizedIds
  );
  return result.rows || [];
}

function findDirectionalMapping(rows, operatingUnitId, partnerOperatingUnitId) {
  return (
    (Array.isArray(rows) ? rows : []).find(
      (row) =>
        toNumber(row?.operatingUnitId ?? row?.operating_unit_id) === toNumber(operatingUnitId) &&
        toNumber(row?.partnerOperatingUnitId ?? row?.partner_operating_unit_id) ===
          toNumber(partnerOperatingUnitId)
    ) || null
  );
}

function assertAccountRow({
  row,
  expectedCode,
  expectedName,
  expectedParentAccountId,
  expectedAccountType,
  expectedNormalSide,
}) {
  assert(row, `Account row missing for ${expectedCode}`);
  assert(String(row.code) === expectedCode, `Expected account code ${expectedCode}, got ${row.code}`);
  assert(String(row.name) === expectedName, `Expected account name ${expectedName}, got ${row.name}`);
  assert(
    String(row.account_type || "").toUpperCase() === String(expectedAccountType).toUpperCase(),
    `Expected ${expectedCode} account_type=${expectedAccountType}, got ${row.account_type}`
  );
  assert(
    String(row.normal_side || "").toUpperCase() === String(expectedNormalSide).toUpperCase(),
    `Expected ${expectedCode} normal_side=${expectedNormalSide}, got ${row.normal_side}`
  );
  assert(
    toNumber(row.parent_account_id) === toNumber(expectedParentAccountId),
    `Expected ${expectedCode} parent_account_id=${expectedParentAccountId}, got ${row.parent_account_id}`
  );
  assert(Boolean(row.is_active), `${expectedCode} should stay active`);
}

async function main() {
  const stamp = Date.now();
  const suffix = String(stamp).slice(-6);
  const identity = await seedAndCreateTenantAdmin({
    tenantCode: `CRO06_${stamp}`,
    tenantName: `Cash CRO06 ${stamp}`,
    adminEmail: `cash_cro06_admin_${stamp}@example.com`,
    adminPassword: "CashCRO06#12345",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const adminToken = await login({
      baseUrl: BASE_URL,
      email: `cash_cro06_admin_${stamp}@example.com`,
      password: "CashCRO06#12345",
    });

    const org = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token: adminToken,
      stamp,
      baseCurrencyCode: "USD",
    });
    const { legalEntityId, coaId, operatingUnitId: bootstrapOperatingUnitId } = org;

    const dueFromParentCode = "132";
    const dueToParentCode = "339";
    const dueFromParentAccountId = await createGlAccount({
      token: adminToken,
      coaId,
      code: dueFromParentCode,
      name: `Due From Branches ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const dueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId,
      code: dueToParentCode,
      name: `Due To Branches ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });

    await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId,
      dueFromParentAccountId,
      dueToParentAccountId,
      autoProvisionOnOperatingUnitCreate: false,
    });

    const branchACode = `BRA${suffix}`;
    const branchBCode = `BRB${suffix}`;
    const branchAResponse = await createOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchACode,
      name: `Branch A ${suffix}`,
    });
    const branchAId = toNumber(branchAResponse.json?.id);
    assert(branchAId > 0, `Operating unit create failed for ${branchACode}`);
    assert(
      branchAResponse.json?.currentAccountProvisioning?.status ===
        "skipped_auto_provision_disabled",
      "Branch A save should skip create-time auto-provision when saved config disables it"
    );
    const branchBResponse = await createOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchBCode,
      name: `Branch B ${suffix}`,
    });
    const branchBId = toNumber(branchBResponse.json?.id);
    assert(branchBId > 0, `Operating unit create failed for ${branchBCode}`);
    assert(
      branchBResponse.json?.currentAccountProvisioning?.status ===
        "skipped_auto_provision_disabled",
      "Branch B save should skip create-time auto-provision when saved config disables it"
    );

    const freshApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
    });
    const freshCreatedAccounts = Array.isArray(freshApply.json?.createdAccounts)
      ? freshApply.json.createdAccounts
      : [];
    const freshPartnerMappings = Array.isArray(freshApply.json?.partnerMappings)
      ? freshApply.json.partnerMappings
      : [];
    const freshUpdatedPartnerMappings = Array.isArray(freshApply.json?.updatedPartnerMappings)
      ? freshApply.json.updatedPartnerMappings
      : [];
    const peerCount = 2;
    assert(
      freshCreatedAccounts.length === 4 + peerCount * 4,
      "Saved-config delta apply should create four central accounts plus both partner directions for every existing peer branch"
    );
    assert(
      freshUpdatedPartnerMappings.length === peerCount * 2,
      "Saved-config delta apply should create both partner directions for every selected-branch peer"
    );
    assert(freshApply.json?.lastAppliedAt, "Saved-config apply should return lastAppliedAt");

    const branchAToB = findDirectionalMapping(freshPartnerMappings, branchAId, branchBId);
    const branchBToA = findDirectionalMapping(freshPartnerMappings, branchBId, branchAId);
    const branchAToBootstrap = findDirectionalMapping(
      freshPartnerMappings,
      branchAId,
      bootstrapOperatingUnitId
    );
    const bootstrapToBranchA = findDirectionalMapping(
      freshPartnerMappings,
      bootstrapOperatingUnitId,
      branchAId
    );
    assert(
      branchAToBootstrap?.created === true,
      "Selected-branch apply should also create Branch A -> bootstrap branch mapping"
    );
    assert(
      bootstrapToBranchA?.created === true,
      "Selected-branch apply should also create bootstrap branch -> Branch A mapping"
    );
    assert(branchAToB?.created === true, "Branch A -> Branch B mapping should be marked created");
    assert(branchBToA?.created === true, "Branch B -> Branch A mapping should be marked created");

    const createdRows = await fetchAccountRows([
      branchAToB?.dueFromAccountId,
      branchAToB?.dueToAccountId,
      branchBToA?.dueFromAccountId,
      branchBToA?.dueToAccountId,
      dueFromParentAccountId,
      dueToParentAccountId,
    ]);
    const accountById = new Map(createdRows.map((row) => [toNumber(row.id), row]));
    const aToBDueFromRow = accountById.get(toNumber(branchAToB?.dueFromAccountId));
    const aToBDueToRow = accountById.get(toNumber(branchAToB?.dueToAccountId));
    const bToADueFromRow = accountById.get(toNumber(branchBToA?.dueFromAccountId));
    const bToADueToRow = accountById.get(toNumber(branchBToA?.dueToAccountId));

    assertAccountRow({
      row: aToBDueFromRow,
      expectedCode: "132.05",
      expectedName: `${branchACode} Due From ${branchBCode}`,
      expectedParentAccountId: dueFromParentAccountId,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: aToBDueToRow,
      expectedCode: "339.05",
      expectedName: `${branchACode} Due To ${branchBCode}`,
      expectedParentAccountId: dueToParentAccountId,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });
    assertAccountRow({
      row: bToADueFromRow,
      expectedCode: "132.06",
      expectedName: `${branchBCode} Due From ${branchACode}`,
      expectedParentAccountId: dueFromParentAccountId,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: bToADueToRow,
      expectedCode: "339.06",
      expectedName: `${branchBCode} Due To ${branchACode}`,
      expectedParentAccountId: dueToParentAccountId,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });
    assert(
      parseChildSequence(aToBDueFromRow?.code, dueFromParentCode) === 5 &&
        parseChildSequence(aToBDueToRow?.code, dueToParentCode) === 5,
      "Fresh A -> B mapping should use shared child sequence 05 after the bootstrap peer consumes 03-04"
    );
    assert(
      parseChildSequence(bToADueFromRow?.code, dueFromParentCode) === 6 &&
        parseChildSequence(bToADueToRow?.code, dueToParentCode) === 6,
      "Fresh B -> A mapping should use shared child sequence 06 after the bootstrap peer consumes 03-04"
    );

    assert(
      accountById.get(dueFromParentAccountId)?.allow_posting === 0 ||
        accountById.get(dueFromParentAccountId)?.allow_posting === false,
      "Due-from parent should remain non-postable after child creation"
    );
    assert(
      accountById.get(dueToParentAccountId)?.allow_posting === 0 ||
        accountById.get(dueToParentAccountId)?.allow_posting === false,
      "Due-to parent should remain non-postable after child creation"
    );

    const listAToBRows = await listPartnerCurrentMappings({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
      partnerOperatingUnitId: branchBId,
    });
    const listBToARows = await listPartnerCurrentMappings({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchBId,
      partnerOperatingUnitId: branchAId,
    });
    assert(listAToBRows.length === 1, "GET mapping list should return one row for A -> B");
    assert(listBToARows.length === 1, "GET mapping list should return one row for B -> A");
    assert(
      String(listAToBRows[0]?.due_from_account_code || "") === "132.05" &&
        String(listAToBRows[0]?.due_to_account_code || "") === "339.05",
      "GET mapping list should expose A -> B generated child codes from saved-config apply"
    );

    const rerunApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
    });
    const rerunCreatedAccounts = Array.isArray(rerunApply.json?.createdAccounts)
      ? rerunApply.json.createdAccounts
      : [];
    const rerunUpdatedPartnerMappings = Array.isArray(rerunApply.json?.updatedPartnerMappings)
      ? rerunApply.json.updatedPartnerMappings
      : [];
    const rerunPartnerMappings = Array.isArray(rerunApply.json?.partnerMappings)
      ? rerunApply.json.partnerMappings
      : [];
    assert(rerunCreatedAccounts.length === 0, "Second saved-config apply should reuse existing branch-pair setup");
    assert(
      rerunUpdatedPartnerMappings.length === 0,
      "Second saved-config apply should not rewrite existing branch-pair mappings"
    );
    assert(
      rerunPartnerMappings.length === peerCount * 2,
      "Second saved-config apply should still return both partner directions for every peer"
    );
    assert(
      rerunPartnerMappings.every((row) => row?.created === false),
      "Second saved-config apply should mark both partner directions as existing"
    );

    console.log("Cash register ownership CRO06 saved-config branch-pair apply checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId,
          branchAToBMappingId: toNumber(branchAToB?.id),
          branchBToAMappingId: toNumber(branchBToA?.id),
          createdAccountCodes: [
            aToBDueFromRow?.code,
            aToBDueToRow?.code,
            bToADueFromRow?.code,
            bToADueToRow?.code,
          ],
          rerunCreatedAccounts: rerunCreatedAccounts.length,
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
    console.error("Cash register ownership CRO06 saved-config apply test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
