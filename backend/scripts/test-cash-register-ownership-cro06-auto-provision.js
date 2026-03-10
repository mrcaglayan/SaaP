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
      allowPosting: true,
      parentAccountId: parentAccountId || undefined,
    },
    expectedStatus: 201,
  });
  const accountId = toNumber(response.json?.id);
  assert(accountId > 0, `GL account create failed for ${code}`);
  return accountId;
}

async function createOperatingUnit({
  token,
  legalEntityId,
  code,
  name,
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
    },
    expectedStatus: 201,
  });
  const operatingUnitId = toNumber(response.json?.id);
  assert(operatingUnitId > 0, `Operating unit create failed for ${code}`);
  return operatingUnitId;
}

async function createOperatingUnitPartnerCurrentAccount({
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
  assert(id > 0, "Partner current-account mapping create failed");
  return id;
}

async function autoProvisionPartnerCurrentAccounts({
  token,
  legalEntityId,
  operatingUnitId,
  partnerOperatingUnitId,
  dueFromParentAccountId,
  dueToParentAccountId,
  expectedStatus = 201,
}) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-unit-partner-current-accounts/auto-provision",
    body: {
      legalEntityId,
      operatingUnitId,
      partnerOperatingUnitId,
      dueFromParentAccountId,
      dueToParentAccountId,
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
    const { legalEntityId, coaId } = org;

    const dueFromParentCode = "132";
    const dueToParentCode = "339";
    const dueFromParentAccountId = await createGlAccount({
      token: adminToken,
      coaId,
      code: dueFromParentCode,
      name: `Due From Branches ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const dueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId,
      code: dueToParentCode,
      name: `Due To Branches ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });

    const branchACode = `BRA${suffix}`;
    const branchBCode = `BRB${suffix}`;
    const branchAId = await createOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchACode,
      name: `Branch A ${suffix}`,
    });
    const branchBId = await createOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchBCode,
      name: `Branch B ${suffix}`,
    });

    const freshProvision = await autoProvisionPartnerCurrentAccounts({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
      partnerOperatingUnitId: branchBId,
      dueFromParentAccountId,
      dueToParentAccountId,
    });
    const freshCreatedAccounts = Array.isArray(freshProvision.json?.createdAccounts)
      ? freshProvision.json.createdAccounts
      : [];
    const freshMappings = Array.isArray(freshProvision.json?.mappings)
      ? freshProvision.json.mappings
      : [];
    assert(freshCreatedAccounts.length === 4, "Fresh auto-provision should create four child accounts");
    assert(freshMappings.length === 2, "Fresh auto-provision should return two directional mappings");

    const branchAToB = findDirectionalMapping(freshMappings, branchAId, branchBId);
    const branchBToA = findDirectionalMapping(freshMappings, branchBId, branchAId);
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
      expectedCode: "132.01",
      expectedName: `${branchACode} Due From ${branchBCode}`,
      expectedParentAccountId: dueFromParentAccountId,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: aToBDueToRow,
      expectedCode: "339.01",
      expectedName: `${branchACode} Due To ${branchBCode}`,
      expectedParentAccountId: dueToParentAccountId,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });
    assertAccountRow({
      row: bToADueFromRow,
      expectedCode: "132.02",
      expectedName: `${branchBCode} Due From ${branchACode}`,
      expectedParentAccountId: dueFromParentAccountId,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: bToADueToRow,
      expectedCode: "339.02",
      expectedName: `${branchBCode} Due To ${branchACode}`,
      expectedParentAccountId: dueToParentAccountId,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });
    assert(
      parseChildSequence(aToBDueFromRow?.code, dueFromParentCode) === 1 &&
        parseChildSequence(aToBDueToRow?.code, dueToParentCode) === 1,
      "Fresh A -> B mapping should use shared child sequence 01"
    );
    assert(
      parseChildSequence(bToADueFromRow?.code, dueFromParentCode) === 2 &&
        parseChildSequence(bToADueToRow?.code, dueToParentCode) === 2,
      "Fresh B -> A mapping should use shared child sequence 02"
    );

    assert(
      accountById.get(dueFromParentAccountId)?.allow_posting === 0 ||
        accountById.get(dueFromParentAccountId)?.allow_posting === false,
      "Due-from parent should become non-postable after child creation"
    );
    assert(
      accountById.get(dueToParentAccountId)?.allow_posting === 0 ||
        accountById.get(dueToParentAccountId)?.allow_posting === false,
      "Due-to parent should become non-postable after child creation"
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
      String(listAToBRows[0]?.due_from_account_code || "") === "132.01" &&
        String(listAToBRows[0]?.due_to_account_code || "") === "339.01",
      "GET mapping list should expose A -> B generated child codes"
    );

    const reusedProvision = await autoProvisionPartnerCurrentAccounts({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
      partnerOperatingUnitId: branchBId,
      dueFromParentAccountId,
      dueToParentAccountId,
    });
    const reusedCreatedAccounts = Array.isArray(reusedProvision.json?.createdAccounts)
      ? reusedProvision.json.createdAccounts
      : [];
    const reusedMappings = Array.isArray(reusedProvision.json?.mappings)
      ? reusedProvision.json.mappings
      : [];
    assert(reusedCreatedAccounts.length === 0, "Second auto-provision should reuse existing setup");
    assert(reusedMappings.length === 2, "Second auto-provision should still return both mappings");
    assert(
      reusedMappings.every((row) => row?.created === false),
      "Second auto-provision should mark both mappings as existing"
    );
    assert(
      toNumber(findDirectionalMapping(reusedMappings, branchAId, branchBId)?.id) ===
        toNumber(branchAToB?.id) &&
        toNumber(findDirectionalMapping(reusedMappings, branchBId, branchAId)?.id) ===
          toNumber(branchBToA?.id),
      "Second auto-provision should reuse the same mapping ids"
    );

    const dueFromParentCode2 = `1328${suffix}`;
    const dueToParentCode2 = `3398${suffix}`;
    const dueFromParentAccountId2 = await createGlAccount({
      token: adminToken,
      coaId,
      code: dueFromParentCode2,
      name: `Due From Branches Partial ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const dueToParentAccountId2 = await createGlAccount({
      token: adminToken,
      coaId,
      code: dueToParentCode2,
      name: `Due To Branches Partial ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });

    const branchCCode = `BRC${suffix}`;
    const branchDCode = `BRD${suffix}`;
    const branchCId = await createOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchCCode,
      name: `Branch C ${suffix}`,
    });
    const branchDId = await createOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchDCode,
      name: `Branch D ${suffix}`,
    });

    const manualCToDDueFromId = await createGlAccount({
      token: adminToken,
      coaId,
      code: `${dueFromParentCode2}.09`,
      name: `${branchCCode} Due From ${branchDCode}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      parentAccountId: dueFromParentAccountId2,
    });
    const manualCToDDueToId = await createGlAccount({
      token: adminToken,
      coaId,
      code: `${dueToParentCode2}.09`,
      name: `${branchCCode} Due To ${branchDCode}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      parentAccountId: dueToParentAccountId2,
    });
    const manualMappingId = await createOperatingUnitPartnerCurrentAccount({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchCId,
      partnerOperatingUnitId: branchDId,
      dueFromAccountId: manualCToDDueFromId,
      dueToAccountId: manualCToDDueToId,
    });

    const partialProvision = await autoProvisionPartnerCurrentAccounts({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchCId,
      partnerOperatingUnitId: branchDId,
      dueFromParentAccountId: dueFromParentAccountId2,
      dueToParentAccountId: dueToParentAccountId2,
    });
    const partialCreatedAccounts = Array.isArray(partialProvision.json?.createdAccounts)
      ? partialProvision.json.createdAccounts
      : [];
    const partialMappings = Array.isArray(partialProvision.json?.mappings)
      ? partialProvision.json.mappings
      : [];
    assert(partialCreatedAccounts.length === 2, "Partial setup should create only the missing reverse-direction accounts");
    assert(partialMappings.length === 2, "Partial setup should still return both directions");

    const partialCToD = findDirectionalMapping(partialMappings, branchCId, branchDId);
    const partialDToC = findDirectionalMapping(partialMappings, branchDId, branchCId);
    assert(
      partialCToD?.created === false && toNumber(partialCToD?.id) === manualMappingId,
      "Existing C -> D mapping should be reused during partial auto-provision"
    );
    assert(partialDToC?.created === true, "Missing D -> C mapping should be created");

    const partialRows = await fetchAccountRows([
      partialDToC?.dueFromAccountId,
      partialDToC?.dueToAccountId,
    ]);
    const partialById = new Map(partialRows.map((row) => [toNumber(row.id), row]));
    assertAccountRow({
      row: partialById.get(toNumber(partialDToC?.dueFromAccountId)),
      expectedCode: `${dueFromParentCode2}.01`,
      expectedName: `${branchDCode} Due From ${branchCCode}`,
      expectedParentAccountId: dueFromParentAccountId2,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: partialById.get(toNumber(partialDToC?.dueToAccountId)),
      expectedCode: `${dueToParentCode2}.01`,
      expectedName: `${branchDCode} Due To ${branchCCode}`,
      expectedParentAccountId: dueToParentAccountId2,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });

    const validationFailure = await autoProvisionPartnerCurrentAccounts({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
      partnerOperatingUnitId: branchBId,
      dueFromParentAccountId: dueToParentAccountId2,
      dueToParentAccountId: dueFromParentAccountId2,
      expectedStatus: 400,
    });
    const validationErrorText = toErrorText(validationFailure.json);
    assert(
      validationErrorText.includes("dueFromParentAccountId must reference an ASSET account"),
      "Auto-provision should reject invalid parent-account typing with actionable error text"
    );

    console.log("Cash register ownership CRO06 auto-provision checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId,
          freshProvision: {
            branchAToBMappingId: toNumber(branchAToB?.id),
            branchBToAMappingId: toNumber(branchBToA?.id),
            createdAccountCodes: [
              aToBDueFromRow?.code,
              aToBDueToRow?.code,
              bToADueFromRow?.code,
              bToADueToRow?.code,
            ],
          },
          reusedProvision: {
            reused: true,
          },
          partialProvision: {
            manualMappingId,
            createdReverseMappingId: toNumber(partialDToC?.id),
            createdReverseAccountCodes: [
              partialById.get(toNumber(partialDToC?.dueFromAccountId))?.code,
              partialById.get(toNumber(partialDToC?.dueToAccountId))?.code,
            ],
          },
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
    console.error("Cash register ownership CRO06 auto-provision test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
