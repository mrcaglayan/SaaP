import { readFile } from "node:fs/promises";
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

const PORT = Number(process.env.ORG_OU18_TEST_PORT || 3144);
const BASE_URL = process.env.ORG_OU18_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

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
  unitType = "BRANCH",
  hasSubledger = true,
  centralDueFromAccountId,
  centralDueToAccountId,
  ouDueFromCentralAccountId,
  ouDueToCentralAccountId,
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
      unitType,
      hasSubledger,
      centralDueFromAccountId: centralDueFromAccountId || undefined,
      centralDueToAccountId: centralDueToAccountId || undefined,
      ouDueFromCentralAccountId: ouDueFromCentralAccountId || undefined,
      ouDueToCentralAccountId: ouDueToCentralAccountId || undefined,
    },
    expectedStatus,
  });
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

async function listCurrentAccountConfigs({ token, legalEntityId }) {
  const queryString = legalEntityId ? `?legalEntityId=${legalEntityId}` : "";
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/org/operating-unit-current-account-config${queryString}`,
    expectedStatus: 200,
  });
  return Array.isArray(response.json?.rows) ? response.json.rows : [];
}

async function listOperatingUnits({ token, legalEntityId }) {
  const queryString = legalEntityId ? `?legalEntityId=${legalEntityId}` : "";
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/org/operating-units${queryString}`,
    expectedStatus: 200,
  });
  return Array.isArray(response.json?.rows) ? response.json.rows : [];
}

async function listPartnerCurrentAccounts({ token, legalEntityId }) {
  const queryString = legalEntityId ? `?legalEntityId=${legalEntityId}` : "";
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/org/operating-unit-partner-current-accounts${queryString}`,
    expectedStatus: 200,
  });
  return Array.isArray(response.json?.rows) ? response.json.rows : [];
}

async function upsertPartnerCurrentAccount({
  token,
  legalEntityId,
  operatingUnitId,
  partnerOperatingUnitId,
  dueFromAccountId,
  dueToAccountId,
}) {
  return apiRequest({
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
}

function mappingKey(row) {
  return `${toNumber(row?.operating_unit_id)}:${toNumber(row?.partner_operating_unit_id)}`;
}

async function main() {
  const helperModule = await import(
    new URL("../../frontend/src/pages/settings/orgCurrentAccountHelpers.js", import.meta.url)
  );
  const {
    buildRankedOperatingUnitCurrentAccountOptions,
    formatRankedOperatingUnitCurrentAccountOptionLabel,
    summarizeOperatingUnitCurrentAccountConfigDrift,
  } = helperModule;

  const pageSource = await readFile(
    new URL("../../frontend/src/pages/settings/OrganizationManagementPage.jsx", import.meta.url),
    "utf8"
  );
  assert(
    pageSource.includes("Repair missing only"),
    "Organization Management page should expose the Repair missing only action"
  );
  assert(
    pageSource.includes("advanced exception mode"),
    "Organization Management page should label manual current-account edits as advanced exception mode"
  );

  const stamp = Date.now();
  const suffix = String(stamp).slice(-6);
  const identity = await seedAndCreateTenantAdmin({
    tenantCode: `OU18_${stamp}`,
    tenantName: `OU18 ${stamp}`,
    adminEmail: `ou18_admin_${stamp}@example.com`,
    adminPassword: "OU18#12345",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const adminToken = await login({
      baseUrl: BASE_URL,
      email: `ou18_admin_${stamp}@example.com`,
      password: "OU18#12345",
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
      code: "132",
      name: `Due From Parent ${suffix}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const dueToParentAccountId = await createGlAccount({
      token: adminToken,
      coaId: org.coaId,
      code: "331",
      name: `Due To Parent ${suffix}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });

    const branchBResponse = await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      code: `KEO${suffix}`,
      name: `Branch KEO ${suffix}`,
    });
    const branchBId = toNumber(branchBResponse.json?.id);
    assert(branchBId > 0, "Second branch save should succeed");

    await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      dueFromParentAccountId,
      dueToParentAccountId,
      autoProvisionOnOperatingUnitCreate: true,
    });

    const configRowsBeforeApply = await listCurrentAccountConfigs({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const operatingUnitsBeforeApply = await listOperatingUnits({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const partnerRowsBeforeApply = await listPartnerCurrentAccounts({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const summaryBeforeApply = summarizeOperatingUnitCurrentAccountConfigDrift(
      configRowsBeforeApply[0],
      operatingUnitsBeforeApply,
      partnerRowsBeforeApply
    );
    assert(summaryBeforeApply.configured, "Config summary should report configured parents");
    assert(
      summaryBeforeApply.currentAccountSetupExpected,
      "Two active branches should expect current-account setup"
    );
    assert(
      summaryBeforeApply.missingCentralMappingOperatingUnitCount === 2,
      "Before repair, both branches should be flagged with missing four-field central setup"
    );
    assert(
      summaryBeforeApply.missingPartnerDirectionCount === 2,
      "Before repair, both branch-pair directions should be flagged as missing"
    );
    assert(
      summaryBeforeApply.configChangedSinceLastApply,
      "Freshly-saved config should be marked as changed until the first successful apply"
    );

    const initialRepair = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      repairMissingOnly: true,
    });
    assert(
      Array.isArray(initialRepair.json?.updatedOperatingUnits) &&
        initialRepair.json.updatedOperatingUnits.length === 2,
      "Initial repair should fill both branches"
    );
    assert(
      Array.isArray(initialRepair.json?.updatedPartnerMappings) &&
        initialRepair.json.updatedPartnerMappings.length === 2,
      "Initial repair should create both directional branch-pair mappings"
    );

    const configRowsReady = await listCurrentAccountConfigs({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const operatingUnitsReady = await listOperatingUnits({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const partnerRowsReady = await listPartnerCurrentAccounts({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const readySummary = summarizeOperatingUnitCurrentAccountConfigDrift(
      configRowsReady[0],
      operatingUnitsReady,
      partnerRowsReady
    );
    assert(
      readySummary.missingCentralMappingOperatingUnitCount === 0,
      "After repair, no active branch should be missing central mappings"
    );
    assert(
      readySummary.missingPartnerDirectionCount === 0,
      "After repair, no branch-pair direction should be missing"
    );
    assert(!readySummary.hasDrift, "After repair, config summary should be drift-free");

    const branchAReady =
      operatingUnitsReady.find((row) => toNumber(row.id) === org.operatingUnitId) || null;
    const branchBReady =
      operatingUnitsReady.find((row) => toNumber(row.id) === branchBId) || null;
    assert(branchAReady && branchBReady, "Both branches should be listed after repair");

    const branchAToB = partnerRowsReady.find(
      (row) =>
        toNumber(row.operating_unit_id) === org.operatingUnitId &&
        toNumber(row.partner_operating_unit_id) === branchBId
    );
    const branchBToA = partnerRowsReady.find(
      (row) =>
        toNumber(row.operating_unit_id) === branchBId &&
        toNumber(row.partner_operating_unit_id) === org.operatingUnitId
    );
    assert(branchAToB && branchBToA, "Repair should create both directional partner rows");

    await upsertOperatingUnit({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      code: branchAReady.code,
      name: branchAReady.name,
      unitType: branchAReady.unit_type,
      hasSubledger: Boolean(branchAReady.has_subledger),
      centralDueFromAccountId: toNumber(branchAReady.central_due_from_account_id),
      centralDueToAccountId: toNumber(branchAReady.central_due_to_account_id),
      ouDueFromCentralAccountId: toNumber(branchAReady.ou_due_from_central_account_id),
      ouDueToCentralAccountId: toNumber(branchAReady.ou_due_to_central_account_id),
    });
    await upsertPartnerCurrentAccount({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      operatingUnitId: org.operatingUnitId,
      partnerOperatingUnitId: branchBId,
      dueFromAccountId: toNumber(branchAToB.due_from_account_id),
      dueToAccountId: toNumber(branchAToB.due_to_account_id),
    });

    const untouchedSnapshot = {
      dueFromAccountId: toNumber(branchBToA.due_from_account_id),
      dueToAccountId: toNumber(branchBToA.due_to_account_id),
    };

    await query(
      `UPDATE operating_units
       SET central_due_to_account_id = NULL
       WHERE tenant_id = ?
         AND id = ?`,
      [identity.tenantId, org.operatingUnitId]
    );
    await query(
      `DELETE FROM operating_unit_partner_current_accounts
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND operating_unit_id = ?
         AND partner_operating_unit_id = ?
       LIMIT 1`,
      [identity.tenantId, org.legalEntityId, org.operatingUnitId, branchBId]
    );

    const configRowsWithDrift = await listCurrentAccountConfigs({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const operatingUnitsWithDrift = await listOperatingUnits({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const partnerRowsWithDrift = await listPartnerCurrentAccounts({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const driftSummary = summarizeOperatingUnitCurrentAccountConfigDrift(
      configRowsWithDrift[0],
      operatingUnitsWithDrift,
      partnerRowsWithDrift
    );
    assert(
      driftSummary.missingCentralMappingOperatingUnitCount === 1,
      "One branch should be flagged when a central four-field mapping is manually broken"
    );
    assert(
      driftSummary.missingPartnerDirectionCount === 1,
      "One branch-pair direction should be flagged when a mapping row is missing"
    );
    assert(
      driftSummary.legalEntityStillNotReady,
      "Saved config with missing OU or branch-pair mappings should show as not fully ready"
    );
    assert(
      !driftSummary.configChangedSinceLastApply,
      "Pure mapping drift should not masquerade as a config change after last apply"
    );

    const repairMissingOnly = await applyCurrentAccountConfig({
      token: adminToken,
      legalEntityId: org.legalEntityId,
      repairMissingOnly: true,
    });
    assert(
      Array.isArray(repairMissingOnly.json?.updatedOperatingUnits) &&
        repairMissingOnly.json.updatedOperatingUnits.length === 1,
      "Repair missing only should refill just the broken branch row"
    );
    assert(
      Array.isArray(repairMissingOnly.json?.updatedPartnerMappings) &&
        repairMissingOnly.json.updatedPartnerMappings.length === 1,
      "Repair missing only should recreate just the missing branch-pair direction"
    );

    const operatingUnitsAfterRepair = await listOperatingUnits({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const partnerRowsAfterRepair = await listPartnerCurrentAccounts({
      token: adminToken,
      legalEntityId: org.legalEntityId,
    });
    const finalSummary = summarizeOperatingUnitCurrentAccountConfigDrift(
      configRowsWithDrift[0],
      operatingUnitsAfterRepair,
      partnerRowsAfterRepair
    );
    assert(!finalSummary.hasDrift, "Repair missing only should clear drift");

    const untouchedAfterRepair =
      partnerRowsAfterRepair.find((row) => mappingKey(row) === mappingKey(branchBToA)) || null;
    assert(
      untouchedAfterRepair &&
        toNumber(untouchedAfterRepair.due_from_account_id) === untouchedSnapshot.dueFromAccountId &&
        toNumber(untouchedAfterRepair.due_to_account_id) === untouchedSnapshot.dueToAccountId,
      "Repair missing only should preserve untouched manual partner rows"
    );

    const centralOptions = buildRankedOperatingUnitCurrentAccountOptions(
      [
        {
          id: 1,
          code: "132.01",
          name: "Generic Due From",
          account_breadcrumb: "132.01 - Generic Due From",
        },
        {
          id: 2,
          code: "132.02",
          name: "WEO Due From Central",
          account_breadcrumb: "132.02 - WEO Due From Central",
        },
      ],
      { sourceOperatingUnitCode: "WEO" }
    );
    assert(
      toNumber(centralOptions[0]?.id) === 2,
      "Manual central dropdown ranking should prefer the exact branch match first"
    );
    assert(
      formatRankedOperatingUnitCurrentAccountOptionLabel(centralOptions[0], (en) => en).includes(
        "Exact branch match"
      ),
      "Exact branch-ranked option label should be operator-visible"
    );
    assert(
      formatRankedOperatingUnitCurrentAccountOptionLabel(centralOptions[1], (en) => en).includes(
        "Fallback same-entity account"
      ),
      "Fallback same-entity label should stay visible for manual exceptions"
    );

    const pairOptions = buildRankedOperatingUnitCurrentAccountOptions(
      [
        {
          id: 3,
          code: "132.03",
          name: "WEO Due From KEO",
          account_breadcrumb: "132.03 - WEO Due From KEO",
        },
        {
          id: 4,
          code: "132.04",
          name: "WEO Due From MEO",
          account_breadcrumb: "132.04 - WEO Due From MEO",
        },
      ],
      { sourceOperatingUnitCode: "WEO", partnerOperatingUnitCode: "KEO" }
    );
    assert(
      toNumber(pairOptions[0]?.id) === 3,
      "Manual branch-pair dropdown ranking should prefer the exact source/partner match first"
    );
    assert(
      formatRankedOperatingUnitCurrentAccountOptionLabel(pairOptions[0], (en) => en).includes(
        "Exact branch-pair match"
      ),
      "Branch-pair exact match label should be operator-visible"
    );
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
  console.error("test-org-ou18-organization-management-current-account-ux failed");
  console.error(error);
  process.exitCode = 1;
});
