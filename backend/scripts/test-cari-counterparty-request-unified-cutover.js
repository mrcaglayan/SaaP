import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  apiRequest,
  bootstrapOrgBookCoa,
  createBootstrapAdmin,
  createTenant,
  login,
  startServerProcess,
  waitForServer,
} from "./ex05-test-helpers.js";
import { bridgePendingCounterpartyRequestToUnifiedApproval } from "../src/services/cari.counterparty-request.service.js";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function countCariCounterpartyPolicies(tenantId) {
  const result = await query(
    `SELECT COUNT(*) AS row_count
     FROM approval_policies
     WHERE tenant_id = ?
       AND module_code = 'CARI'
       AND target_type = 'COUNTERPARTY_REQUEST'
       AND action_type = 'CREATE'`,
    [tenantId]
  );
  return toNumber(result.rows?.[0]?.row_count);
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantCode = `CARI_CUTOVER_${stamp}`;
  const tenantName = `CARI Cutover ${stamp}`;
  const adminEmail = `cari.cutover.${stamp}@example.com`;
  const adminPassword = "CariCutover#123";
  const reviewerEmail = `cari.cutover.reviewer.${stamp}@example.com`;
  const reviewerPassword = "CariCutoverReviewer#123";
  const tenantId = await createTenant(tenantCode, tenantName);
  const { userId } = await createBootstrapAdmin({
    tenantId,
    email: adminEmail,
    password: adminPassword,
    name: "CARI Cutover Admin",
  });
  await createBootstrapAdmin({
    tenantId,
    email: reviewerEmail,
    password: reviewerPassword,
    name: "CARI Cutover Reviewer",
  });

  let server = null;
  const port = 3226;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    server = startServerProcess({ port });
    await waitForServer({ baseUrl, timeoutMs: 30_000 });
    const token = await login({ baseUrl, email: adminEmail, password: adminPassword });
    const reviewerToken = await login({
      baseUrl,
      email: reviewerEmail,
      password: reviewerPassword,
    });
    const org = await bootstrapOrgBookCoa({
      baseUrl,
      token,
      stamp,
      baseCurrencyCode: "AFN",
    });

    assert.equal(
      await countCariCounterpartyPolicies(tenantId),
      0,
      "Fresh cutover tenant should start without a CARI counterparty approval policy"
    );

    const createRes = await apiRequest({
      baseUrl,
      token,
      method: "POST",
      requestPath: "/api/v1/cari/counterparty-requests",
      body: {
        tenantId,
        legalEntityId: org.legalEntityId,
        primaryOperatingUnitId: org.operatingUnitId,
        code: `CUT${stamp}`,
        name: `Cutover Vendor ${stamp}`,
        isVendor: true,
        isCustomer: false,
      },
      expectedStatus: 201,
    });

    const createdRow = createRes.json?.row || null;
    assert(toNumber(createdRow?.id) > 0, "Counterparty request id should be created");
    assert(
      toNumber(createdRow?.approvalRequest?.id) > 0,
      "New counterparty request should bridge to unified approval immediately"
    );
    const approvalRequestId = toNumber(createdRow?.approvalRequest?.id);
    assert(approvalRequestId > 0, "Unified approval request id should be created");
    assert.equal(
      await countCariCounterpartyPolicies(tenantId),
      1,
      "Submitting the first request should auto-provision the default CARI approval policy"
    );

    const approvalRes = await apiRequest({
      baseUrl,
      token: reviewerToken,
      method: "POST",
      requestPath: `/api/v1/approvals/requests/${approvalRequestId}/approve`,
      body: {
        decisionComment: "Cutover reviewer approval",
      },
      expectedStatus: 200,
    });
    assert.equal(
      String(
        approvalRes.json?.item?.executionStatus ||
          approvalRes.json?.item?.execution_status ||
          ""
      ).toUpperCase(),
      "EXECUTED",
      "Generic unified approval route should execute CARI request after final approval"
    );

    const approvedRequestRes = await query(
      `SELECT request_status,
              created_counterparty_id
         FROM counterparty_requests
        WHERE tenant_id = ?
          AND id = ?`,
      [tenantId, toNumber(createdRow?.id)]
    );
    assert.equal(
      String(approvedRequestRes.rows?.[0]?.request_status || "").toUpperCase(),
      "APPROVED",
      "Counterparty request should sync back to APPROVED after unified execution"
    );
    assert(
      toNumber(approvedRequestRes.rows?.[0]?.created_counterparty_id) > 0,
      "Unified execution should create the live counterparty card"
    );

    const legacyPayload = JSON.stringify({
      tenantId,
      userId,
      legalEntityId: org.legalEntityId,
      primaryOperatingUnitId: org.operatingUnitId,
      operatingUnitIds: [org.operatingUnitId],
      code: `LEG${stamp}`,
      name: `Legacy Vendor ${stamp}`,
      isVendor: true,
      isCustomer: false,
      status: "ACTIVE",
      contacts: [],
      addresses: [],
    });
    const insertLegacyRes = await query(
      `INSERT INTO counterparty_requests (
         tenant_id,
         legal_entity_id,
         primary_operating_unit_id,
         code,
         name,
         is_customer,
         is_vendor,
         request_status,
         requested_payload_json,
         requested_by_user_id
       ) VALUES (?, ?, ?, ?, ?, 0, 1, 'PENDING', ?, ?)`,
      [
        tenantId,
        org.legalEntityId,
        org.operatingUnitId,
        `LEG${stamp}`,
        `Legacy Vendor ${stamp}`,
        legacyPayload,
        userId,
      ]
    );
    const legacyRequestId = toNumber(insertLegacyRes.rows?.insertId);
    assert(legacyRequestId > 0, "Legacy pending request should be inserted");

    const bridgedLegacyRow = await bridgePendingCounterpartyRequestToUnifiedApproval({
      req: null,
      tenantId,
      requestId: legacyRequestId,
    });
    assert(
      toNumber(bridgedLegacyRow?.approvalRequest?.id) > 0,
      "Backfilled legacy request should gain a unified approval bridge"
    );

    console.log(
      "test-cari-counterparty-request-unified-cutover passed"
    );
  } finally {
    if (server) {
      server.kill();
      await sleep(500);
    }
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
