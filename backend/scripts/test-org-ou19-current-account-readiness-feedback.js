import { readFile } from "node:fs/promises";
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

const PORT = Number(process.env.ORG_OU19_TEST_PORT || 3145);
const BASE_URL = process.env.ORG_OU19_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

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

async function upsertOperatingUnit({
  token,
  legalEntityId,
  code,
  name,
  status = "ACTIVE",
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
      status,
    },
    expectedStatus: 201,
  });
  return toNumber(response.json?.id);
}

async function saveCurrentAccountConfig({
  token,
  legalEntityId,
  dueFromParentAccountId,
  dueToParentAccountId,
}) {
  await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-unit-current-account-config",
    body: {
      legalEntityId,
      dueFromParentAccountId,
      dueToParentAccountId,
      autoProvisionOnOperatingUnitCreate: true,
    },
    expectedStatus: 201,
  });
}

async function applyCurrentAccountConfig({ token, legalEntityId }) {
  await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-unit-current-account-config/apply",
    body: {
      legalEntityId,
      repairMissingOnly: true,
    },
    expectedStatus: 201,
  });
}

async function getTenantReadiness({ token }) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: "/api/v1/onboarding/readiness",
    expectedStatus: 200,
  });
  return response.json;
}

async function getModuleReadiness({ token, legalEntityId }) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/onboarding/module-readiness?legalEntityId=${legalEntityId}`,
    expectedStatus: 200,
  });
  return response.json;
}

function findReadinessCheck(payload, key) {
  return payload?.checks?.find((row) => String(row?.key || "").trim() === key) || null;
}

function findModuleRow(payload, moduleKey, legalEntityId) {
  return (
    payload?.modules?.[moduleKey]?.byLegalEntity?.find(
      (row) => Number(row?.legalEntityId) === Number(legalEntityId)
    ) || null
  );
}

async function main() {
  const pageSource = await readFile(
    new URL("../../frontend/src/readiness/TenantReadinessChecklist.jsx", import.meta.url),
    "utf8"
  );
  const appLayoutSource = await readFile(
    new URL("../../frontend/src/layouts/AppLayout.jsx", import.meta.url),
    "utf8"
  );
  const messagesSource = await readFile(
    new URL("../../frontend/src/i18n/messages.js", import.meta.url),
    "utf8"
  );
  assert(
    pageSource.includes("operatingUnitCurrentAccounts") &&
      pageSource.includes("/app/ayarlar/organizasyon-yonetimi"),
    "Tenant readiness checklist must link the OU current-account readiness key to Organization Management"
  );
  assert(
    appLayoutSource.includes("operatingUnitCurrentAccounts") &&
      appLayoutSource.includes("/app/ayarlar/organizasyon-yonetimi"),
    "App layout readiness menu must route the OU current-account readiness key to Organization Management"
  );
  assert(
    messagesSource.includes("operatingUnitCurrentAccounts:"),
    "Readiness i18n labels must include operatingUnitCurrentAccounts"
  );

  const stamp = Date.now();
  const suffix = String(stamp).slice(-6);
  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode: `OU19_${stamp}`,
    tenantName: `OU19 ${stamp}`,
    adminEmail: `ou19_admin_${stamp}@example.com`,
    adminPassword: "OU19#12345",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const adminToken = await login({
      baseUrl: BASE_URL,
      email: `ou19_admin_${stamp}@example.com`,
      password: "OU19#12345",
    });

    const org = await bootstrapOrgBookCoa({
      baseUrl: BASE_URL,
      token: adminToken,
      stamp,
      baseCurrencyCode: "USD",
    });

    const dueFromParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: org.coaId,
      code: `132${suffix}`,
      name: `Due From Parent ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const dueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: org.coaId,
      code: `331${suffix}`,
      name: `Due To Parent ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });

    const branchAId = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      code: `WEO${suffix}`,
      name: `Wardak ${suffix}`,
    });
    const branchBId = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      code: `KEO${suffix}`,
      name: `Kabil ${suffix}`,
    });
    assert(branchAId > 0 && branchBId > 0, "Expected two operating units");

    let tenantReadiness = await getTenantReadiness({ token: adminToken });
    let tenantOuCheck = findReadinessCheck(
      tenantReadiness,
      "operatingUnitCurrentAccounts"
    );
    assert(tenantOuCheck && tenantOuCheck.ready === false, "Tenant readiness should block when multi-OU config is missing");
    assert(
      tenantOuCheck?.details?.blockingRows?.[0]?.blockerCode === "MISSING_CONFIG",
      "Tenant readiness should identify missing saved config"
    );

    let moduleReadiness = await getModuleReadiness({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    let moduleRow = findModuleRow(
      moduleReadiness,
      "operatingUnitCurrentAccounts",
      org.legalEntityId
    );
    assert(moduleRow && moduleRow.ready === false, "Module readiness should block when config is missing");
    assert(moduleRow.blockerCode === "MISSING_CONFIG", "Module readiness blocker should be MISSING_CONFIG");
    assert(
      moduleRow.setupPath === "/app/ayarlar/organizasyon-yonetimi",
      "Module readiness should point operators to Organization Management"
    );

    await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      dueFromParentAccountId,
      dueToParentAccountId,
    });

    moduleReadiness = await getModuleReadiness({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    moduleRow = findModuleRow(
      moduleReadiness,
      "operatingUnitCurrentAccounts",
      org.legalEntityId
    );
    assert(
      moduleRow.blockerCode === "CONFIG_SAVED_NOT_APPLIED",
      "Saved config without apply should report CONFIG_SAVED_NOT_APPLIED"
    );

    await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });

    moduleReadiness = await getModuleReadiness({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    moduleRow = findModuleRow(
      moduleReadiness,
      "operatingUnitCurrentAccounts",
      org.legalEntityId
    );
    assert(moduleRow.ready === true, "Module readiness should become ready after apply");

    await query(
      `DELETE FROM operating_unit_partner_current_accounts
       WHERE tenant_id = ?
         AND legal_entity_id = ?
       LIMIT 1`,
      [identity.tenantId, org.legalEntityId]
    );

    tenantReadiness = await getTenantReadiness({ token: adminToken });
    tenantOuCheck = findReadinessCheck(
      tenantReadiness,
      "operatingUnitCurrentAccounts"
    );
    assert(
      tenantOuCheck && tenantOuCheck.ready === false,
      "Tenant readiness should block again when partner mappings drift"
    );
    assert(
      tenantOuCheck?.details?.blockingRows?.[0]?.blockerCode === "MAPPING_DRIFT",
      "Tenant readiness should report mapping drift"
    );

    moduleReadiness = await getModuleReadiness({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    moduleRow = findModuleRow(
      moduleReadiness,
      "operatingUnitCurrentAccounts",
      org.legalEntityId
    );
    assert(moduleRow.blockerCode === "MAPPING_DRIFT", "Module readiness should report mapping drift");

    await query(
      `UPDATE operating_units
       SET status = 'INACTIVE'
       WHERE tenant_id = ?
         AND id IN (?, ?)`,
      [identity.tenantId, branchAId, branchBId]
    );

    tenantReadiness = await getTenantReadiness({ token: adminToken });
    tenantOuCheck = findReadinessCheck(
      tenantReadiness,
      "operatingUnitCurrentAccounts"
    );
    assert(
      tenantOuCheck && tenantOuCheck.ready === true,
      "Inactive branch should not keep OU current-account readiness blocked"
    );

    moduleReadiness = await getModuleReadiness({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    moduleRow = findModuleRow(
      moduleReadiness,
      "operatingUnitCurrentAccounts",
      org.legalEntityId
    );
    assert(moduleRow.ready === true, "One-active-branch entity should not be blocked");
    assert(moduleRow.applicable === false, "One-active-branch entity should be marked not applicable");
    assert(
      Number(moduleRow.effectiveActiveOperatingUnitCount) === 1,
      "Effective active OU count should ignore inactive branches"
    );

    console.log("PR-OU19 readiness and operator feedback regression passed.");
  } finally {
    if (!serverStopped) {
      server.kill("SIGTERM");
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
