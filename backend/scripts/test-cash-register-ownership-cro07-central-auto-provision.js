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

const PORT = Number(process.env.CASH_CRO07_TEST_PORT || 3137);
const BASE_URL = process.env.CASH_CRO07_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

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

async function upsertOperatingUnit({
  token,
  legalEntityId,
  code,
  name,
  centralDueFromAccountId,
  ouDueToCentralAccountId,
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
      centralDueFromAccountId: centralDueFromAccountId || undefined,
      ouDueToCentralAccountId: ouDueToCentralAccountId || undefined,
    },
    expectedStatus: 201,
  });
  const operatingUnitId = toNumber(response.json?.id);
  assert(operatingUnitId > 0, `Operating unit upsert failed for ${code}`);
  return operatingUnitId;
}

async function autoProvisionCentralCurrentAccounts({
  token,
  legalEntityId,
  operatingUnitId,
  centralDueFromParentAccountId,
  ouDueToCentralParentAccountId,
  expectedStatus = 201,
}) {
  return apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-units/central-current-accounts/auto-provision",
    body: {
      legalEntityId,
      operatingUnitId,
      centralDueFromParentAccountId,
      ouDueToCentralParentAccountId,
    },
    expectedStatus,
  });
}

async function listOperatingUnits({
  token,
  legalEntityId,
  operatingUnitId,
}) {
  const search = new URLSearchParams({
    legalEntityId: String(legalEntityId),
    operatingUnitId: String(operatingUnitId),
  });
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/org/operating-units?${search.toString()}`,
    expectedStatus: 200,
  });
  return Array.isArray(response.json?.rows) ? response.json.rows : [];
}

async function fetchAccountRows(accountIds) {
  const normalizedIds = Array.from(
    new Set((accountIds || []).map((id) => toNumber(id)).filter(Boolean))
  );
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
    tenantCode: `CRO07_${stamp}`,
    tenantName: `Cash CRO07 ${stamp}`,
    adminEmail: `cash_cro07_admin_${stamp}@example.com`,
    adminPassword: "CashCRO07#12345",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const adminToken = await login({
      baseUrl: BASE_URL,
      email: `cash_cro07_admin_${stamp}@example.com`,
      password: "CashCRO07#12345",
    });

    const org = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token: adminToken,
      stamp,
      baseCurrencyCode: "USD",
    });
    const { legalEntityId, coaId } = org;

    const centralDueFromParentCode = "132";
    const ouDueToParentCode = "339";
    const centralDueFromParentAccountId = await createGlAccount({
      token: adminToken,
      coaId,
      code: centralDueFromParentCode,
      name: `Central Due From Branches ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const ouDueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId,
      code: ouDueToParentCode,
      name: `Branches Due To Central ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });

    const branchACode = `BRA${suffix}`;
    const branchAId = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchACode,
      name: `Branch A ${suffix}`,
    });

    const freshProvision = await autoProvisionCentralCurrentAccounts({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
      centralDueFromParentAccountId,
      ouDueToCentralParentAccountId: ouDueToParentAccountId,
    });
    const freshCreatedAccounts = Array.isArray(freshProvision.json?.createdAccounts)
      ? freshProvision.json.createdAccounts
      : [];
    const freshOperatingUnit = freshProvision.json?.operatingUnit || null;
    assert(freshCreatedAccounts.length === 2, "Fresh central auto-provision should create two child accounts");
    assert(
      toNumber(freshOperatingUnit?.centralDueFromAccountId) > 0 &&
        toNumber(freshOperatingUnit?.ouDueToCentralAccountId) > 0,
      "Fresh central auto-provision should return both mapped account ids"
    );
    assert(
      freshOperatingUnit?.capitalSelfBalancingReady === true,
      "Fresh central auto-provision should mark the operating unit ready"
    );

    const freshRows = await fetchAccountRows([
      freshOperatingUnit?.centralDueFromAccountId,
      freshOperatingUnit?.ouDueToCentralAccountId,
      centralDueFromParentAccountId,
      ouDueToParentAccountId,
    ]);
    const freshById = new Map(freshRows.map((row) => [toNumber(row.id), row]));
    const freshCentralDueFromRow = freshById.get(
      toNumber(freshOperatingUnit?.centralDueFromAccountId)
    );
    const freshOuDueToRow = freshById.get(
      toNumber(freshOperatingUnit?.ouDueToCentralAccountId)
    );

    assertAccountRow({
      row: freshCentralDueFromRow,
      expectedCode: "132.01",
      expectedName: `Central Due From ${branchACode}`,
      expectedParentAccountId: centralDueFromParentAccountId,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: freshOuDueToRow,
      expectedCode: "339.01",
      expectedName: `${branchACode} Due To Central`,
      expectedParentAccountId: ouDueToParentAccountId,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });
    assert(
      parseChildSequence(freshCentralDueFromRow?.code, centralDueFromParentCode) === 1 &&
        parseChildSequence(freshOuDueToRow?.code, ouDueToParentCode) === 1,
      "Fresh central auto-provision should use shared child sequence 01"
    );
    assert(
      freshById.get(centralDueFromParentAccountId)?.allow_posting === 0 ||
        freshById.get(centralDueFromParentAccountId)?.allow_posting === false,
      "Central due-from parent should become non-postable after child creation"
    );
    assert(
      freshById.get(ouDueToParentAccountId)?.allow_posting === 0 ||
        freshById.get(ouDueToParentAccountId)?.allow_posting === false,
      "OU due-to-central parent should become non-postable after child creation"
    );

    const freshOperatingUnitRows = await listOperatingUnits({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
    });
    assert(freshOperatingUnitRows.length === 1, "Operating-unit GET should return one filtered row");
    assert(
      Boolean(freshOperatingUnitRows[0]?.capital_self_balancing_ready),
      "Operating-unit GET should expose ready=true after central auto-provision"
    );
    assert(
      String(freshOperatingUnitRows[0]?.central_due_from_account_code || "") === "132.01" &&
        String(freshOperatingUnitRows[0]?.ou_due_to_central_account_code || "") === "339.01",
      "Operating-unit GET should expose the generated central current child codes"
    );

    const reusedProvision = await autoProvisionCentralCurrentAccounts({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
      centralDueFromParentAccountId,
      ouDueToCentralParentAccountId: ouDueToParentAccountId,
    });
    const reusedCreatedAccounts = Array.isArray(reusedProvision.json?.createdAccounts)
      ? reusedProvision.json.createdAccounts
      : [];
    const reusedOperatingUnit = reusedProvision.json?.operatingUnit || null;
    assert(reusedCreatedAccounts.length === 0, "Second central auto-provision should reuse existing setup");
    assert(
      toNumber(reusedOperatingUnit?.centralDueFromAccountId) ===
        toNumber(freshOperatingUnit?.centralDueFromAccountId) &&
        toNumber(reusedOperatingUnit?.ouDueToCentralAccountId) ===
          toNumber(freshOperatingUnit?.ouDueToCentralAccountId),
      "Second central auto-provision should reuse the same mapped account ids"
    );

    const centralDueFromParentCode2 = `1328${suffix}`;
    const ouDueToParentCode2 = `3398${suffix}`;
    const centralDueFromParentAccountId2 = await createGlAccount({
      token: adminToken,
      coaId,
      code: centralDueFromParentCode2,
      name: `Central Due From Partial ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
    });
    const ouDueToParentAccountId2 = await createGlAccount({
      token: adminToken,
      coaId,
      code: ouDueToParentCode2,
      name: `OU Due To Central Partial ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
    });

    const branchBCode = `BRB${suffix}`;
    const branchBId = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchBCode,
      name: `Branch B ${suffix}`,
    });
    const manualCentralDueFromId = await createGlAccount({
      token: adminToken,
      coaId,
      code: `${centralDueFromParentCode2}.09`,
      name: `Central Due From ${branchBCode}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      parentAccountId: centralDueFromParentAccountId2,
    });
    await upsertOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchBCode,
      name: `Branch B ${suffix}`,
      centralDueFromAccountId: manualCentralDueFromId,
    });

    const partialProvision = await autoProvisionCentralCurrentAccounts({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchBId,
      centralDueFromParentAccountId: centralDueFromParentAccountId2,
      ouDueToCentralParentAccountId: ouDueToParentAccountId2,
    });
    const partialCreatedAccounts = Array.isArray(partialProvision.json?.createdAccounts)
      ? partialProvision.json.createdAccounts
      : [];
    const partialOperatingUnit = partialProvision.json?.operatingUnit || null;
    assert(partialCreatedAccounts.length === 1, "Partial central setup should create only one missing account");
    assert(
      toNumber(partialOperatingUnit?.centralDueFromAccountId) === toNumber(manualCentralDueFromId),
      "Partial central setup should reuse the existing central due-from account"
    );

    const partialRows = await fetchAccountRows([
      partialOperatingUnit?.centralDueFromAccountId,
      partialOperatingUnit?.ouDueToCentralAccountId,
    ]);
    const partialById = new Map(partialRows.map((row) => [toNumber(row.id), row]));
    assertAccountRow({
      row: partialById.get(toNumber(partialOperatingUnit?.centralDueFromAccountId)),
      expectedCode: `${centralDueFromParentCode2}.09`,
      expectedName: `Central Due From ${branchBCode}`,
      expectedParentAccountId: centralDueFromParentAccountId2,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: partialById.get(toNumber(partialOperatingUnit?.ouDueToCentralAccountId)),
      expectedCode: `${ouDueToParentCode2}.09`,
      expectedName: `${branchBCode} Due To Central`,
      expectedParentAccountId: ouDueToParentAccountId2,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });

    const validationFailure = await autoProvisionCentralCurrentAccounts({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchAId,
      centralDueFromParentAccountId: ouDueToParentAccountId2,
      ouDueToCentralParentAccountId: centralDueFromParentAccountId2,
      expectedStatus: 400,
    });
    const validationErrorText = toErrorText(validationFailure.json);
    assert(
      validationErrorText.includes(
        "centralDueFromParentAccountId must reference an ASSET account"
      ),
      "Central auto-provision should reject invalid parent-account typing with actionable error text"
    );

    console.log("Cash register ownership CRO07 central auto-provision checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId,
          freshProvision: {
            operatingUnitId: branchAId,
            createdAccountCodes: [freshCentralDueFromRow?.code, freshOuDueToRow?.code],
          },
          reusedProvision: {
            reused: true,
          },
          partialProvision: {
            operatingUnitId: branchBId,
            reusedCentralDueFromAccountId: manualCentralDueFromId,
            createdOuDueToCentralAccountCode:
              partialById.get(toNumber(partialOperatingUnit?.ouDueToCentralAccountId))?.code,
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
    console.error("Cash register ownership CRO07 central auto-provision test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
