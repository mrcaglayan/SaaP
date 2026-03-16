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

async function listOperatingUnits({ token, legalEntityId, operatingUnitId }) {
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
    const { legalEntityId, coaId, operatingUnitId: bootstrapOperatingUnitId } = org;

    const dueFromParentCode = "132";
    const dueToParentCode = "339";
    const dueFromParentAccountId = await createGlAccount({
      token: adminToken,
      coaId,
      code: dueFromParentCode,
      name: `Central Due From Parent ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const dueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId,
      code: dueToParentCode,
      name: `Central Due To Parent ${suffix}`,
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

    const branchCode = `BRA${suffix}`;
    const branchResponse = await createOperatingUnit({
      token: adminToken,
      legalEntityId,
      code: branchCode,
      name: `Branch A ${suffix}`,
    });
    const branchId = toNumber(branchResponse.json?.id);
    assert(branchId > 0, `Operating unit create failed for ${branchCode}`);
    assert(
      branchResponse.json?.currentAccountProvisioning?.status ===
        "skipped_auto_provision_disabled",
      "Branch save should skip create-time auto-provision when saved config disables it"
    );

    const freshApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchId,
    });
    const freshCreatedAccounts = Array.isArray(freshApply.json?.createdAccounts)
      ? freshApply.json.createdAccounts
      : [];
    const freshUpdatedOperatingUnits = Array.isArray(freshApply.json?.updatedOperatingUnits)
      ? freshApply.json.updatedOperatingUnits
      : [];
    const freshPartnerMappings = Array.isArray(freshApply.json?.partnerMappings)
      ? freshApply.json.partnerMappings
      : [];
    assert(
      freshCreatedAccounts.length === 8,
      "Saved-config delta apply should create the four central accounts plus both partner directions against the existing bootstrap branch"
    );
    assert(
      freshUpdatedOperatingUnits.length === 1,
      "Saved-config delta apply should update one operating-unit row for a single-branch apply"
    );
    assert(freshApply.json?.lastAppliedAt, "Saved-config apply should return lastAppliedAt");

    const updatedUnit = freshUpdatedOperatingUnits[0] || null;
    assert(toNumber(updatedUnit?.id) === branchId, "Updated operating-unit summary should target the selected branch");
    assert(
      updatedUnit?.currentAccountProvisioningReady === true,
      "Saved-config central apply should report currentAccountProvisioningReady=true"
    );
    assert(
      freshPartnerMappings.length === 2 &&
        freshPartnerMappings.every(
          (row) =>
            toNumber(row?.operatingUnitId) === branchId ||
            toNumber(row?.partnerOperatingUnitId) === branchId
        ) &&
        freshPartnerMappings.some(
          (row) =>
            toNumber(row?.operatingUnitId) === branchId &&
            toNumber(row?.partnerOperatingUnitId) === bootstrapOperatingUnitId
        ) &&
        freshPartnerMappings.some(
          (row) =>
            toNumber(row?.operatingUnitId) === bootstrapOperatingUnitId &&
            toNumber(row?.partnerOperatingUnitId) === branchId
        ),
      "Single-branch saved-config apply should also create both partner directions against the bootstrap branch"
    );

    const freshRows = await fetchAccountRows([
      updatedUnit?.centralDueFromAccountId,
      updatedUnit?.centralDueToAccountId,
      updatedUnit?.ouDueFromCentralAccountId,
      updatedUnit?.ouDueToCentralAccountId,
      dueFromParentAccountId,
      dueToParentAccountId,
    ]);
    const freshById = new Map(freshRows.map((row) => [toNumber(row.id), row]));
    const centralDueFromRow = freshById.get(toNumber(updatedUnit?.centralDueFromAccountId));
    const centralDueToRow = freshById.get(toNumber(updatedUnit?.centralDueToAccountId));
    const ouDueFromCentralRow = freshById.get(toNumber(updatedUnit?.ouDueFromCentralAccountId));
    const ouDueToCentralRow = freshById.get(toNumber(updatedUnit?.ouDueToCentralAccountId));

    assertAccountRow({
      row: centralDueFromRow,
      expectedCode: "132.01",
      expectedName: `Central Due From ${branchCode}`,
      expectedParentAccountId: dueFromParentAccountId,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: ouDueToCentralRow,
      expectedCode: "339.01",
      expectedName: `${branchCode} Due To Central`,
      expectedParentAccountId: dueToParentAccountId,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });
    assertAccountRow({
      row: ouDueFromCentralRow,
      expectedCode: "132.02",
      expectedName: `${branchCode} Due From Central`,
      expectedParentAccountId: dueFromParentAccountId,
      expectedAccountType: "ASSET",
      expectedNormalSide: "DEBIT",
    });
    assertAccountRow({
      row: centralDueToRow,
      expectedCode: "339.02",
      expectedName: `Central Due To ${branchCode}`,
      expectedParentAccountId: dueToParentAccountId,
      expectedAccountType: "LIABILITY",
      expectedNormalSide: "CREDIT",
    });
    assert(
      parseChildSequence(centralDueFromRow?.code, dueFromParentCode) === 1 &&
        parseChildSequence(ouDueToCentralRow?.code, dueToParentCode) === 1,
      "Forward central pair should use shared child sequence 01"
    );
    assert(
      parseChildSequence(ouDueFromCentralRow?.code, dueFromParentCode) === 2 &&
        parseChildSequence(centralDueToRow?.code, dueToParentCode) === 2,
      "Reverse central pair should use shared child sequence 02"
    );

    assert(
      freshById.get(dueFromParentAccountId)?.allow_posting === 0 ||
        freshById.get(dueFromParentAccountId)?.allow_posting === false,
      "Due-from parent should remain non-postable after child creation"
    );
    assert(
      freshById.get(dueToParentAccountId)?.allow_posting === 0 ||
        freshById.get(dueToParentAccountId)?.allow_posting === false,
      "Due-to parent should remain non-postable after child creation"
    );

    const listedOperatingUnits = await listOperatingUnits({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchId,
    });
    assert(listedOperatingUnits.length === 1, "Operating-unit GET should return one filtered row");
    assert(
      Boolean(listedOperatingUnits[0]?.cross_context_self_balancing_ready),
      "Operating-unit GET should expose cross_context_self_balancing_ready=true after saved-config apply"
    );
    assert(
      String(listedOperatingUnits[0]?.central_due_from_account_code || "") === "132.01" &&
        String(listedOperatingUnits[0]?.central_due_to_account_code || "") === "339.02" &&
        String(listedOperatingUnits[0]?.ou_due_from_central_account_code || "") === "132.02" &&
        String(listedOperatingUnits[0]?.ou_due_to_central_account_code || "") === "339.01",
      "Operating-unit GET should expose the generated four-direction central current child codes"
    );

    const rerunApply = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId,
      operatingUnitId: branchId,
    });
    const rerunCreatedAccounts = Array.isArray(rerunApply.json?.createdAccounts)
      ? rerunApply.json.createdAccounts
      : [];
    const rerunUpdatedOperatingUnits = Array.isArray(rerunApply.json?.updatedOperatingUnits)
      ? rerunApply.json.updatedOperatingUnits
      : [];
    const rerunReusedAccounts = Array.isArray(rerunApply.json?.reusedAccounts)
      ? rerunApply.json.reusedAccounts
      : [];
    const rerunPartnerMappings = Array.isArray(rerunApply.json?.partnerMappings)
      ? rerunApply.json.partnerMappings
      : [];
    assert(
      rerunCreatedAccounts.length === 0,
      "Second saved-config apply should reuse the existing four-direction central setup"
    );
    assert(
      rerunUpdatedOperatingUnits.length === 0,
      "Second saved-config apply should not rewrite an already-valid central mapping row"
    );
    assert(
      rerunReusedAccounts.length >= 4,
      "Second saved-config apply should report reused central accounts"
    );
    assert(
      rerunPartnerMappings.length === 2 &&
        rerunPartnerMappings.every((row) => row?.created === false),
      "Second saved-config apply should keep the bootstrap branch partner mappings as existing rows"
    );

    console.log("Cash register ownership CRO07 saved-config central apply checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId,
          operatingUnitId: branchId,
          createdAccountCodes: [
            centralDueFromRow?.code,
            centralDueToRow?.code,
            ouDueFromCentralRow?.code,
            ouDueToCentralRow?.code,
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
    console.error("Cash register ownership CRO07 saved-config central apply test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
