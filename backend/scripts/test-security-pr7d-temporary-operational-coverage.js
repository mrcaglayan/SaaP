import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, query } from "../src/db.js";
import { checkUserHasPermissionAtScope } from "../src/services/authz.scope.service.js";
import approvalPoliciesRouter from "../src/routes/approvalPolicies.routes.js";
import {
  apiRequest,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.PR7D_TEMPORARY_COVERAGE_TEST_PORT || 3148);
const BASE_URL =
  process.env.PR7D_TEMPORARY_COVERAGE_TEST_BASE_URL ||
  `http://127.0.0.1:${PORT}`;

function hasRoute(router, routePath, method) {
  return (router?.stack || []).some(
    (layer) =>
      layer?.route?.path === routePath &&
      Boolean(layer.route.methods?.[String(method || "").toLowerCase()]),
  );
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createBootstrapAdminSession(stamp) {
  const email = `pr7d_admin_${stamp}@example.com`;
  const password = "PR7DTemporaryCoverage#12345";
  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode: `PR7D_TEMP_COVERAGE_${stamp}`,
    tenantName: `PR7D Temporary Coverage ${stamp}`,
    adminEmail: email,
    adminPassword: password,
  });
  return {
    tenantId: identity.tenantId,
    userId: identity.userId,
    email,
    password,
  };
}

async function resolveCountryId(iso2) {
  const result = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = ?
     LIMIT 1`,
    [
      String(iso2 || "")
        .trim()
        .toUpperCase(),
    ],
  );
  const countryId = toPositiveInt(result.rows?.[0]?.id);
  assert(countryId > 0, `Country ${iso2} should exist`);
  return countryId;
}

async function createGroupCompany({ baseUrl, token, code, name }) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/org/group-companies",
    expectedStatus: 201,
    body: { code, name },
  });
  const groupCompanyId = toPositiveInt(response.json?.id);
  assert(groupCompanyId > 0, "Group company should be created");
  return groupCompanyId;
}

async function createLegalEntity({
  baseUrl,
  token,
  groupCompanyId,
  code,
  name,
  countryId,
  functionalCurrencyCode = "USD",
}) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/org/legal-entities",
    expectedStatus: 201,
    body: {
      groupCompanyId,
      code,
      name,
      countryId,
      functionalCurrencyCode,
    },
  });
  const legalEntityId = toPositiveInt(response.json?.id);
  assert(legalEntityId > 0, `Legal entity ${code} should be created`);
  return legalEntityId;
}

async function createOperatingUnit({
  baseUrl,
  token,
  legalEntityId,
  code,
  name,
}) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/org/operating-units",
    expectedStatus: 201,
    body: {
      legalEntityId,
      code,
      name,
      unitType: "BRANCH",
      hasSubledger: true,
    },
  });
  const operatingUnitId = toPositiveInt(response.json?.id);
  assert(operatingUnitId > 0, `Operating unit ${code} should be created`);
  return operatingUnitId;
}

async function createActiveTenantUser({
  baseUrl,
  token,
  email,
  name,
  password,
}) {
  const response = await apiRequest({
    baseUrl,
    token,
    method: "POST",
    requestPath: "/api/v1/security/users",
    expectedStatus: 201,
    body: {
      email,
      name,
      password,
      status: "ACTIVE",
    },
  });
  const userId = toPositiveInt(response.json?.id);
  assert(userId > 0, `Tenant user ${email} should be created`);
  return { userId, email, password, name };
}

async function resolveRoleId(tenantId, roleCode) {
  const result = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode],
  );
  const roleId = toPositiveInt(result.rows?.[0]?.id);
  assert(roleId > 0, `Role ${roleCode} should exist for tenant ${tenantId}`);
  return roleId;
}

async function assignRoleScope({
  tenantId,
  userId,
  roleCode,
  scopeType,
  scopeId,
}) {
  const roleId = await resolveRoleId(tenantId, roleCode);
  await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
     )
     VALUES (?, ?, ?, ?, ?, 'ALLOW')
     ON DUPLICATE KEY UPDATE
       effect = VALUES(effect)`,
    [tenantId, userId, roleId, scopeType, scopeId],
  );
  return roleId;
}

async function findRoleAssignment({
  tenantId,
  userId,
  roleCode,
  scopeType,
  scopeId,
}) {
  const result = await query(
    `SELECT urs.id, urs.effective_from, urs.effective_to
     FROM user_role_scopes urs
     JOIN roles r
       ON r.id = urs.role_id
      AND r.tenant_id = urs.tenant_id
     WHERE urs.tenant_id = ?
       AND urs.user_id = ?
       AND r.code = ?
       AND urs.scope_type = ?
       AND urs.scope_id = ?
       AND urs.effect = 'ALLOW'
     LIMIT 1`,
    [tenantId, userId, roleCode, scopeType, scopeId],
  );
  return result.rows?.[0] || null;
}

async function countApprovalDelegations(tenantId) {
  const result = await query(
    `SELECT COUNT(*) AS delegation_count
     FROM approval_delegations
     WHERE tenant_id = ?`,
    [tenantId],
  );
  return Number(result.rows?.[0]?.delegation_count || 0);
}

async function main() {
  const backendRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const repoRoot = path.resolve(backendRoot, "..");
  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = addDays(today, 1);
  const afterTomorrow = addDays(today, 2);

  const appSource = await readFile(
    path.resolve(repoRoot, "frontend/src/App.jsx"),
    "utf8",
  );
  const sidebarSource = await readFile(
    path.resolve(repoRoot, "frontend/src/layouts/sidebarConfig.js"),
    "utf8",
  );
  const delegationPageSource = await readFile(
    path.resolve(
      repoRoot,
      "frontend/src/pages/security/ApprovalDelegationsPage.jsx",
    ),
    "utf8",
  );
  const coveragePageSource = await readFile(
    path.resolve(
      repoRoot,
      "frontend/src/pages/security/TemporaryOperationalCoveragePage.jsx",
    ),
    "utf8",
  );
  const apiSource = await readFile(
    path.resolve(repoRoot, "frontend/src/api/approvalDelegations.js"),
    "utf8",
  );

  assert(
    appSource.includes('appPath: "/app/ayarlar/rbac/temporary-coverage"'),
    "App router must register the temporary operational coverage route",
  );
  assert(
    sidebarSource.includes('to: "/app/ayarlar/rbac/temporary-coverage"'),
    "Sidebar must expose the temporary operational coverage route",
  );
  assert(
    delegationPageSource.includes('to="/app/ayarlar/rbac/temporary-coverage"'),
    "Approval delegations page should link to the dedicated temporary coverage page",
  );
  assert(
    coveragePageSource.includes("Temporary Operational Coverage") &&
      coveragePageSource.includes("Open Approval Delegations"),
    "Temporary coverage page should stay visually separate from approval delegation",
  );
  assert(
    apiSource.includes("/api/v1/approvals/operational-coverages/workspace") &&
      apiSource.includes("/api/v1/approvals/operational-coverages") &&
      apiSource.includes(
        "/api/v1/approvals/operational-coverages/${coverageId}/revoke",
      ),
    "Approval API client should expose operational coverage helpers",
  );
  assert(
    hasRoute(approvalPoliciesRouter, "/operational-coverages/workspace", "get"),
    "Approvals router must expose GET /operational-coverages/workspace",
  );
  assert(
    hasRoute(approvalPoliciesRouter, "/operational-coverages", "post"),
    "Approvals router must expose POST /operational-coverages",
  );
  assert(
    hasRoute(
      approvalPoliciesRouter,
      "/operational-coverages/:coverageId/revoke",
      "post",
    ),
    "Approvals router must expose POST /operational-coverages/:coverageId/revoke",
  );

  const admin = await createBootstrapAdminSession(stamp);
  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });

    const adminToken = await login({
      baseUrl: BASE_URL,
      email: admin.email,
      password: admin.password,
    });

    const countryId = await resolveCountryId("US");
    const groupCompanyId = await createGroupCompany({
      baseUrl: BASE_URL,
      token: adminToken,
      code: `PR7DG${String(stamp).slice(-6)}`,
      name: `PR7D Group ${stamp}`,
    });
    const legalEntityId = await createLegalEntity({
      baseUrl: BASE_URL,
      token: adminToken,
      groupCompanyId,
      code: `PR7DLE${String(stamp).slice(-4)}`,
      name: "PR7D Legal Entity",
      countryId,
    });
    const operatingUnitId = await createOperatingUnit({
      baseUrl: BASE_URL,
      token: adminToken,
      legalEntityId,
      code: `PR7DOU${String(stamp).slice(-4)}`,
      name: "PR7D Operating Unit",
    });

    const manager = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `pr7d_manager_${stamp}@example.com`,
      name: "PR7D Local Manager",
      password: "PR7DManager#12345",
    });
    const requester = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `pr7d_requester_${stamp}@example.com`,
      name: "PR7D Requester",
      password: "PR7DRequester#12345",
    });
    const delegateA = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `pr7d_delegate_a_${stamp}@example.com`,
      name: "PR7D Delegate A",
      password: "PR7DDelegateA#12345",
    });
    const delegateB = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `pr7d_delegate_b_${stamp}@example.com`,
      name: "PR7D Delegate B",
      password: "PR7DDelegateB#12345",
    });

    await assignRoleScope({
      tenantId: admin.tenantId,
      userId: manager.userId,
      roleCode: "LocalUserAdmin",
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
    });
    await assignRoleScope({
      tenantId: admin.tenantId,
      userId: requester.userId,
      roleCode: "BranchOperator",
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
    });

    const requesterToken = await login({
      baseUrl: BASE_URL,
      email: requester.email,
      password: requester.password,
    });
    const managerToken = await login({
      baseUrl: BASE_URL,
      email: manager.email,
      password: manager.password,
    });

    const baselineDelegationCount = await countApprovalDelegations(
      admin.tenantId,
    );
    assert.equal(
      baselineDelegationCount,
      0,
      "Coverage tests should not depend on approval delegations",
    );

    const createCoverageResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: requesterToken,
      method: "POST",
      requestPath: "/api/v1/approvals/operational-coverages",
      expectedStatus: 201,
      body: {
        delegateEmail: delegateA.email,
        roleCode: "BranchOperator",
        scopeType: "OPERATING_UNIT",
        scopeId: operatingUnitId,
        startDate: today,
        endDate: tomorrow,
        note: "PR-7D temporary coverage request",
      },
    });
    const coverageId = toPositiveInt(createCoverageResponse.json?.row?.id);
    const approvalRequestId = toPositiveInt(
      createCoverageResponse.json?.row?.approvalRequest?.id ||
        createCoverageResponse.json?.row?.approvalRequestId,
    );
    assert(coverageId > 0, "Coverage request should be created");
    assert(
      approvalRequestId > 0,
      "Coverage request should link to a unified approval request",
    );
    assert.equal(
      createCoverageResponse.json?.row?.state,
      "REQUESTED",
      "New coverage request should start in REQUESTED state",
    );

    const blockedRoleResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: requesterToken,
      method: "POST",
      requestPath: "/api/v1/approvals/operational-coverages",
      expectedStatus: 400,
      body: {
        delegateEmail: delegateA.email,
        roleCode: "SecurityAdmin",
        scopeType: "OPERATING_UNIT",
        scopeId: operatingUnitId,
        startDate: today,
        endDate: tomorrow,
      },
    });
    assert.match(
      String(blockedRoleResponse.json?.message || ""),
      /not manageable|bounded local operational/i,
      "System roles should be blocked from temporary operational coverage",
    );

    const managerWorkspaceBeforeApproval = await apiRequest({
      baseUrl: BASE_URL,
      token: managerToken,
      method: "GET",
      requestPath: "/api/v1/approvals/operational-coverages/workspace",
      expectedStatus: 200,
    });
    assert(
      Array.isArray(managerWorkspaceBeforeApproval.json?.rows) &&
        managerWorkspaceBeforeApproval.json.rows.some(
          (row) => Number(row.id) === coverageId,
        ),
      "Scoped manager workspace should include the pending coverage request",
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token: managerToken,
      method: "POST",
      requestPath: `/api/v1/approvals/requests/${approvalRequestId}/approve`,
      expectedStatus: 200,
      body: {
        decisionComment: "PR-7D approval",
      },
    });

    const approvedAssignment = await findRoleAssignment({
      tenantId: admin.tenantId,
      userId: delegateA.userId,
      roleCode: "BranchOperator",
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
    });
    assert(
      approvedAssignment?.id,
      "Approval should materialize a dated user_role_scopes assignment",
    );
    assert.equal(
      String(approvedAssignment.effective_from),
      today,
      "Materialized assignment should start on the requested start date",
    );
    assert.equal(
      String(approvedAssignment.effective_to),
      tomorrow,
      "Materialized assignment should end on the requested end date",
    );

    const hasCurrentRuntimeAuthority = await checkUserHasPermissionAtScope(
      delegateA.userId,
      admin.tenantId,
      "cash.txn.create",
      "OPERATING_UNIT",
      operatingUnitId,
      { asOfDate: today },
    );
    assert.equal(
      hasCurrentRuntimeAuthority,
      true,
      "Approved coverage should grant runtime authority during its active window",
    );

    const hasExpiredRuntimeAuthority = await checkUserHasPermissionAtScope(
      delegateA.userId,
      admin.tenantId,
      "cash.txn.create",
      "OPERATING_UNIT",
      operatingUnitId,
      { asOfDate: afterTomorrow },
    );
    assert.equal(
      hasExpiredRuntimeAuthority,
      false,
      "Expired coverage should no longer grant runtime authority",
    );

    const rejectCoverageResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: requesterToken,
      method: "POST",
      requestPath: "/api/v1/approvals/operational-coverages",
      expectedStatus: 201,
      body: {
        delegateEmail: delegateB.email,
        roleCode: "OUAccountant",
        scopeType: "OPERATING_UNIT",
        scopeId: operatingUnitId,
        startDate: today,
        endDate: tomorrow,
        note: "PR-7D reject path",
      },
    });
    const rejectedCoverageId = toPositiveInt(
      rejectCoverageResponse.json?.row?.id,
    );
    const rejectedApprovalRequestId = toPositiveInt(
      rejectCoverageResponse.json?.row?.approvalRequest?.id ||
        rejectCoverageResponse.json?.row?.approvalRequestId,
    );
    assert(
      rejectedCoverageId > 0 && rejectedApprovalRequestId > 0,
      "Reject path should create coverage + approval request",
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token: managerToken,
      method: "POST",
      requestPath: `/api/v1/approvals/requests/${rejectedApprovalRequestId}/reject`,
      expectedStatus: 200,
      body: {
        decisionComment: "PR-7D rejection",
      },
    });

    const managerWorkspaceAfterReject = await apiRequest({
      baseUrl: BASE_URL,
      token: managerToken,
      method: "GET",
      requestPath: "/api/v1/approvals/operational-coverages/workspace",
      expectedStatus: 200,
    });
    const rejectedRow =
      managerWorkspaceAfterReject.json?.rows?.find(
        (row) => Number(row.id) === rejectedCoverageId,
      ) || null;
    assert.equal(
      rejectedRow?.reviewStatus,
      "REJECTED",
      "Rejected coverage should surface rejected review status",
    );
    assert.equal(
      Boolean(rejectedRow?.isRejected),
      true,
      "Rejected coverage should surface rejected workflow outcome",
    );

    const rejectedAssignment = await findRoleAssignment({
      tenantId: admin.tenantId,
      userId: delegateB.userId,
      roleCode: "OUAccountant",
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
    });
    assert.equal(
      Boolean(rejectedAssignment?.id),
      false,
      "Rejected coverage should not materialize a user_role_scopes assignment",
    );

    const delegationCountAfterReview = await countApprovalDelegations(
      admin.tenantId,
    );
    assert.equal(
      delegationCountAfterReview,
      0,
      "Temporary coverage workflow must not create approval_delegations rows",
    );

    const revokeCoverageResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: managerToken,
      method: "POST",
      requestPath: `/api/v1/approvals/operational-coverages/${coverageId}/revoke`,
      expectedStatus: 200,
      body: {
        revokedReason: "PR-7D revoke path",
      },
    });
    assert.equal(
      revokeCoverageResponse.json?.row?.state,
      "REVOKED",
      "Revoked coverage should surface REVOKED state",
    );

    const revokedAssignment = await findRoleAssignment({
      tenantId: admin.tenantId,
      userId: delegateA.userId,
      roleCode: "BranchOperator",
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
    });
    assert.equal(
      Boolean(revokedAssignment?.id),
      false,
      "Revoking coverage should remove the materialized runtime assignment",
    );

    const hasRuntimeAfterRevoke = await checkUserHasPermissionAtScope(
      delegateA.userId,
      admin.tenantId,
      "cash.txn.create",
      "OPERATING_UNIT",
      operatingUnitId,
      { asOfDate: today },
    );
    assert.equal(
      hasRuntimeAfterRevoke,
      false,
      "Revoked coverage should immediately remove runtime authority",
    );

    console.log("PR-7D temporary operational coverage checks passed.");
  } finally {
    if (!serverStopped) {
      server.kill();
      serverStopped = true;
    }
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
