import { setTimeout as sleep } from "node:timers/promises";
import { closePool } from "../src/db.js";
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

const PORT = Number(process.env.ORG_OU14_TEST_PORT || 3140);
const BASE_URL = process.env.ORG_OU14_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

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
  autoProvisionOnOperatingUnitCreate,
  expectedStatus = 201,
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
    expectedStatus,
  });
}

async function listCurrentAccountConfigs({
  token,
  legalEntityId,
}) {
  const search = new URLSearchParams();
  if (legalEntityId) {
    search.set("legalEntityId", String(legalEntityId));
  }
  const query = search.toString();
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "GET",
    requestPath: `/api/v1/org/operating-unit-current-account-config${query ? `?${query}` : ""}`,
    expectedStatus: 200,
  });
  return Array.isArray(response.json?.rows) ? response.json.rows : [];
}

async function main() {
  const stamp = Date.now();
  const identity = await seedAndCreateTenantAdmin({
    tenantCode: `OU14_${stamp}`,
    tenantName: `OU14 ${stamp}`,
    adminEmail: `ou14_admin_${stamp}@example.com`,
    adminPassword: "OU14#12345",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });
    const adminToken = await login({
      baseUrl: BASE_URL,
      email: `ou14_admin_${stamp}@example.com`,
      password: "OU14#12345",
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

    const dueFromParentA1 = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "132",
      name: `Due From Parent ${stamp}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });
    const dueToParentA1 = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "331",
      name: `Due To Parent ${stamp}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });
    const dueToParentA2 = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "332",
      name: `Due To Parent 2 ${stamp}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });
    const invalidDueFromType = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "333",
      name: `Invalid Due From Type ${stamp}`,
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });
    const postingLeafDueFrom = await createGlAccount({
      token: adminToken,
      coaId: orgA.coaId,
      code: "134",
      name: `Posting Leaf Due From ${stamp}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    });
    const dueFromParentB = await createGlAccount({
      token: adminToken,
      coaId: orgB.coaId,
      code: "142",
      name: `Due From Parent Other Entity ${stamp}`,
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: false,
    });

    const createResponse = await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      dueFromParentAccountId: dueFromParentA1,
      dueToParentAccountId: dueToParentA1,
      expectedStatus: 201,
    });
    assert(
      toNumber(createResponse.json?.row?.legal_entity_id) === orgA.legalEntityId,
      "Create config should return the selected legal entity id"
    );
    assert(
      toNumber(createResponse.json?.row?.due_from_parent_account_id) === dueFromParentA1,
      "Create config should persist due_from_parent_account_id"
    );
    assert(
      toNumber(createResponse.json?.row?.due_to_parent_account_id) === dueToParentA1,
      "Create config should persist due_to_parent_account_id"
    );
    assert(
      createResponse.json?.row?.auto_provision_on_operating_unit_create === true ||
        createResponse.json?.row?.auto_provision_on_operating_unit_create === 1,
      "Create config should default auto-provision-on-create to true"
    );

    const updateResponse = await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      dueFromParentAccountId: dueFromParentA1,
      dueToParentAccountId: dueToParentA2,
      autoProvisionOnOperatingUnitCreate: false,
      expectedStatus: 201,
    });
    assert(
      toNumber(updateResponse.json?.row?.due_to_parent_account_id) === dueToParentA2,
      "Update config should replace due_to_parent_account_id"
    );
    assert(
      updateResponse.json?.row?.auto_provision_on_operating_unit_create === false ||
        updateResponse.json?.row?.auto_provision_on_operating_unit_create === 0,
      "Update config should persist auto_provision_on_operating_unit_create=false"
    );

    const configRows = await listCurrentAccountConfigs({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
    });
    assert(configRows.length === 1, "List config should return exactly one row for legal entity");
    assert(
      toNumber(configRows[0]?.due_to_parent_account_id) === dueToParentA2,
      "List config should reflect updated Due To parent"
    );

    const invalidTypeResponse = await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      dueFromParentAccountId: invalidDueFromType,
      dueToParentAccountId: dueToParentA2,
      expectedStatus: 400,
    });
    assert(
      toErrorText(invalidTypeResponse.json).includes(
        "dueFromParentAccountId must reference an ASSET account"
      ),
      "Config save should reject invalid account type with actionable error text"
    );

    const postingLeafResponse = await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      dueFromParentAccountId: postingLeafDueFrom,
      dueToParentAccountId: dueToParentA2,
      expectedStatus: 400,
    });
    assert(
      toErrorText(postingLeafResponse.json).includes(
        "dueFromParentAccountId must reference a child-capable non-postable control/header account"
      ),
      "Config save should reject posting leaf accounts as saved control parents"
    );

    const entityMismatchResponse = await saveCurrentAccountConfig({
      token: adminToken,
      legalEntityId: orgA.legalEntityId,
      dueFromParentAccountId: dueFromParentB,
      dueToParentAccountId: dueToParentA2,
      expectedStatus: 400,
    });
    assert(
      toErrorText(entityMismatchResponse.json).includes(
        "dueFromParentAccountId must belong to selected legalEntityId"
      ),
      "Config save should reject parent accounts from a different legal entity"
    );

    const allRows = await listCurrentAccountConfigs({ token: adminToken });
    assert(allRows.length >= 2, "List config should surface each legal entity row");

    console.log("OU14 current-account config foundation checks passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: identity.tenantId,
          legalEntityId: orgA.legalEntityId,
          configRow: {
            dueFromParentAccountId: dueFromParentA1,
            dueToParentAccountId: dueToParentA2,
            autoProvisionOnOperatingUnitCreate: false,
          },
          legalEntityRowCount: allRows.length,
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
    console.error("OU14 current-account config foundation test failed.");
    console.error(toErrorText(err?.message || err));
    console.error(err);
    process.exitCode = 1;
  });
