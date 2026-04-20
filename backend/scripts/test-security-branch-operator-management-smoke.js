import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closePool, query } from "../src/db.js";
import securityRouter from "../src/routes/security.js";
import {
  apiRequest,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.PR7C_LOCAL_USER_ADMIN_TEST_PORT || 3147);
const BASE_URL =
  process.env.PR7C_LOCAL_USER_ADMIN_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

function hasRoute(router, routePath, method) {
  return (router?.stack || []).some(
    (layer) =>
      layer?.route?.path === routePath &&
      Boolean(layer.route.methods?.[String(method || "").toLowerCase()])
  );
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function assertIncludesAll(actualValues, expectedValues, message) {
  const actualSet = new Set(actualValues);
  for (const expectedValue of expectedValues) {
    assert(actualSet.has(expectedValue), `${message}: missing ${expectedValue}`);
  }
}

async function createBootstrapAdminSession(stamp) {
  const email = `pr7c_admin_${stamp}@example.com`;
  const password = "PR7CLocalAdmin#12345";
  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode: `PR7C_LOCAL_ADMIN_${stamp}`,
    tenantName: `PR7C Local Admin ${stamp}`,
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
    [String(iso2 || "").trim().toUpperCase()]
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
    body: {
      code,
      name,
    },
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

async function createOperatingUnit({ baseUrl, token, legalEntityId, code, name }) {
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

async function createActiveTenantUser({ baseUrl, token, email, name, password }) {
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
  return {
    userId,
    email,
    password,
    name,
  };
}

async function resolveRoleId(tenantId, roleCode) {
  const result = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = toPositiveInt(result.rows?.[0]?.id);
  assert(roleId > 0, `Role ${roleCode} should exist for tenant ${tenantId}`);
  return roleId;
}

async function assignRoleScope({ tenantId, userId, roleCode, scopeType, scopeId }) {
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
    [tenantId, userId, roleId, scopeType, scopeId]
  );
  return roleId;
}

async function ensureCustomRoleWithPermission({
  tenantId,
  roleCode,
  roleName,
  permissionCode,
}) {
  await query(
    `INSERT INTO roles (tenant_id, code, name, is_system)
     VALUES (?, ?, ?, FALSE)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       is_system = VALUES(is_system)`,
    [tenantId, roleCode, roleName]
  );
  const roleId = await resolveRoleId(tenantId, roleCode);

  const permissionResult = await query(
    `SELECT id
     FROM permissions
     WHERE code = ?
     LIMIT 1`,
    [permissionCode]
  );
  const permissionId = toPositiveInt(permissionResult.rows?.[0]?.id);
  assert(permissionId > 0, `Permission ${permissionCode} should exist`);

  await query(
    `INSERT IGNORE INTO role_permissions (role_id, permission_id)
     VALUES (?, ?)`,
    [roleId, permissionId]
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
    `SELECT urs.id
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     WHERE urs.tenant_id = ?
       AND urs.user_id = ?
       AND r.code = ?
       AND urs.scope_type = ?
       AND urs.scope_id = ?
       AND urs.effect = 'ALLOW'
     LIMIT 1`,
    [tenantId, userId, roleCode, scopeType, scopeId]
  );
  return toPositiveInt(result.rows?.[0]?.id);
}

async function listAuditActions(tenantId, actorUserId) {
  const result = await query(
    `SELECT action
     FROM rbac_audit_logs
     WHERE tenant_id = ?
       AND actor_user_id = ?
     ORDER BY id`,
    [tenantId, actorUserId]
  );
  return (result.rows || []).map((row) => String(row.action || "").trim());
}

async function main() {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(backendRoot, "..");
  const stamp = Date.now();

  const pageSource = await readFile(
    path.resolve(repoRoot, "frontend/src/pages/security/BranchOperatorManagementPage.jsx"),
    "utf8"
  );
  const apiSource = await readFile(
    path.resolve(repoRoot, "frontend/src/api/rbacAdmin.js"),
    "utf8"
  );
  const appSource = await readFile(path.resolve(repoRoot, "frontend/src/App.jsx"), "utf8");
  const sidebarSource = await readFile(
    path.resolve(repoRoot, "frontend/src/layouts/sidebarConfig.js"),
    "utf8"
  );

  assert(
    appSource.includes('appPath: "/app/ayarlar/sube-operatorleri"'),
    "App router must register /app/ayarlar/sube-operatorleri"
  );
  assert(
    sidebarSource.includes('to: "/app/ayarlar/sube-operatorleri"'),
    "Sidebar must expose /app/ayarlar/sube-operatorleri"
  );
  assert(
    sidebarSource.includes('"security.user_admin.local"') &&
      sidebarSource.includes('"security.user_admin.entity"'),
    "Sidebar access should allow both the new local-admin permission and the legacy bridge"
  );
  assert(
    pageSource.includes("getLocalUserAdminData") &&
      pageSource.includes("assignLocalUserRole") &&
      pageSource.includes("deleteLocalUserRoleAssignment"),
    "Local user admin page must use the generalized local-admin API helpers"
  );
  assert(
    pageSource.includes('"security.user_admin.local"') &&
      pageSource.includes('"security.user_admin.entity"'),
    "Local user admin page must honor both the new permission and the legacy compatibility bridge"
  );
  assert(
    apiSource.includes('api.get("/api/v1/security/local-user-admin")') &&
      apiSource.includes('api.post("/api/v1/security/local-user-admin/assignments", payload)') &&
      apiSource.includes('`/api/v1/security/local-user-admin/assignments/${assignmentId}`'),
    "RBAC admin API client must expose generalized local user admin helpers"
  );
  assert(
    apiSource.includes('api.get("/api/v1/security/entity-branch-operators")') &&
      apiSource.includes('api.post("/api/v1/security/entity-branch-operators", payload)') &&
      apiSource.includes('`/api/v1/security/entity-branch-operators/${assignmentId}`'),
    "RBAC admin API client must preserve the legacy branch-operator compatibility helpers"
  );
  assert(
    hasRoute(securityRouter, "/local-user-admin", "get"),
    "Security router must expose GET /local-user-admin"
  );
  assert(
    hasRoute(securityRouter, "/local-user-admin/assignments", "post"),
    "Security router must expose POST /local-user-admin/assignments"
  );
  assert(
    hasRoute(securityRouter, "/local-user-admin/assignments/:assignmentId", "delete"),
    "Security router must expose DELETE /local-user-admin/assignments/:assignmentId"
  );
  assert(
    hasRoute(securityRouter, "/entity-branch-operators", "post"),
    "Security router must preserve POST /entity-branch-operators for compatibility"
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
      code: `PR7CG${String(stamp).slice(-6)}`,
      name: `PR7C Group ${stamp}`,
    });
    const entityAId = await createLegalEntity({
      baseUrl: BASE_URL,
      token: adminToken,
      groupCompanyId,
      code: `PR7CEA${String(stamp).slice(-4)}`,
      name: "PR7C Entity A",
      countryId,
    });
    const entityBId = await createLegalEntity({
      baseUrl: BASE_URL,
      token: adminToken,
      groupCompanyId,
      code: `PR7CEB${String(stamp).slice(-4)}`,
      name: "PR7C Entity B",
      countryId,
    });
    const entityAOuId = await createOperatingUnit({
      baseUrl: BASE_URL,
      token: adminToken,
      legalEntityId: entityAId,
      code: `AOU${String(stamp).slice(-4)}`,
      name: "PR7C Entity A Branch",
    });
    const entityBOuId = await createOperatingUnit({
      baseUrl: BASE_URL,
      token: adminToken,
      legalEntityId: entityBId,
      code: `BOU${String(stamp).slice(-4)}`,
      name: "PR7C Entity B Branch",
    });

    const localManager = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `pr7c_local_manager_${stamp}@example.com`,
      name: "PR7C Local Manager",
      password: "PR7CLocalManager#12345",
    });
    const compatManager = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `pr7c_compat_manager_${stamp}@example.com`,
      name: "PR7C Compatibility Manager",
      password: "PR7CCompatManager#12345",
    });
    const compatManagedUser = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `pr7c_branch_user_${stamp}@example.com`,
      name: "PR7C Branch User",
      password: "PR7CBranchUser#12345",
    });
    const legacyCompatUser = await createActiveTenantUser({
      baseUrl: BASE_URL,
      token: adminToken,
      email: `pr7c_legacy_branch_user_${stamp}@example.com`,
      name: "PR7C Legacy Branch User",
      password: "PR7CLegacyBranchUser#12345",
    });

    await assignRoleScope({
      tenantId: admin.tenantId,
      userId: localManager.userId,
      roleCode: "LocalUserAdmin",
      scopeType: "LEGAL_ENTITY",
      scopeId: entityAId,
    });

    await ensureCustomRoleWithPermission({
      tenantId: admin.tenantId,
      roleCode: "PR7C_LEGACY_ENTITY_USER_ADMIN",
      roleName: "PR7C Legacy Entity User Admin",
      permissionCode: "security.user_admin.entity",
    });
    await assignRoleScope({
      tenantId: admin.tenantId,
      userId: compatManager.userId,
      roleCode: "PR7C_LEGACY_ENTITY_USER_ADMIN",
      scopeType: "LEGAL_ENTITY",
      scopeId: entityAId,
    });

    const localManagerToken = await login({
      baseUrl: BASE_URL,
      email: localManager.email,
      password: localManager.password,
    });

    const localAdminDataResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: localManagerToken,
      method: "GET",
      requestPath: "/api/v1/security/local-user-admin",
      expectedStatus: 200,
    });
    const localAdminRoles = Array.isArray(localAdminDataResponse.json?.roles)
      ? localAdminDataResponse.json.roles
      : [];
    const localAdminRoleCodes = localAdminRoles.map((role) => String(role.code || "").trim());
    assertIncludesAll(
      localAdminRoleCodes,
      [
        "BranchOperator",
        "OUAPSubmitter",
        "OUAccountant",
        "AuditorReadOnly",
        "BranchInventoryViewer",
        "BranchInventoryExecutor",
        "BranchInventoryOperator",
        "EntityInventoryViewer",
        "EntityInventoryOperator",
        "BranchFixedAssetViewer",
        "BranchFixedAssetOperator",
        "EntityFixedAssetViewer",
        "EntityFixedAssetOperator",
      ],
      "Local user admin allow-list should include bounded local roles"
    );
    assert(
      !localAdminRoleCodes.includes("SecurityAdmin") &&
        !localAdminRoleCodes.includes("SystemAdmin") &&
        !localAdminRoleCodes.includes("LocalUserAdmin") &&
        !localAdminRoleCodes.includes("PeriodCloseSupervisorAuthority"),
      "Local user admin allow-list must exclude tenant security, local-admin roles, and centrally managed period-close supervisor roles"
    );
    const auditorRole =
      localAdminRoles.find((role) => String(role.code || "").trim() === "AuditorReadOnly") ||
      null;
    assert(
      auditorRole &&
        Array.isArray(auditorRole.allowedScopeTypes) &&
        auditorRole.allowedScopeTypes.includes("LEGAL_ENTITY") &&
        auditorRole.allowedScopeTypes.includes("OPERATING_UNIT"),
      "AuditorReadOnly should remain manageable at local scopes"
    );

    const visibleLegalEntities = Array.isArray(localAdminDataResponse.json?.legalEntities)
      ? localAdminDataResponse.json.legalEntities
      : [];
    assert.deepEqual(
      visibleLegalEntities.map((row) => toPositiveInt(row.id)),
      [entityAId],
      "Entity-scoped local admins should only see their own legal entity"
    );

    const visibleOperatingUnits = Array.isArray(localAdminDataResponse.json?.operatingUnits)
      ? localAdminDataResponse.json.operatingUnits
      : [];
    assert.deepEqual(
      visibleOperatingUnits.map((row) => toPositiveInt(row.id)),
      [entityAOuId],
      "Entity-scoped local admins should only see operating units inside their own legal entity"
    );

    const invitedLocalUserEmail = `pr7c_invited_local_${stamp}@example.com`;
    const createLocalAssignmentResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: localManagerToken,
      method: "POST",
      requestPath: "/api/v1/security/local-user-admin/assignments",
      expectedStatus: 201,
      body: {
        email: invitedLocalUserEmail,
        name: "PR7C Invited OU Accountant",
        roleCode: "OUAccountant",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      },
    });
    assert.equal(
      createLocalAssignmentResponse.json?.role?.code,
      "OUAccountant",
      "Local user admin should assign allow-listed local roles"
    );
    assert.equal(
      Boolean(createLocalAssignmentResponse.json?.assignmentCreated),
      true,
      "Allow-listed local role assignment should create a new assignment"
    );
    assert(
      Boolean(createLocalAssignmentResponse.json?.invite?.inviteUrl),
      "Local user admin should preserve invite support for new users"
    );

    const invitedLocalUserId = toPositiveInt(createLocalAssignmentResponse.json?.user?.id);
    assert(invitedLocalUserId > 0, "Invited local user id should be returned");
    const newAssignmentId = toPositiveInt(createLocalAssignmentResponse.json?.assignmentId);
    assert(newAssignmentId > 0, "New local role assignment id should be returned");
    assert(
      (await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: invitedLocalUserId,
        roleCode: "OUAccountant",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      })) > 0,
      "Allow-listed local role assignment should persist in user_role_scopes"
    );

    const blockedSystemRoleResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: localManagerToken,
      method: "POST",
      requestPath: "/api/v1/security/local-user-admin/assignments",
      expectedStatus: 400,
      body: {
        email: invitedLocalUserEmail,
        name: "PR7C Invited OU Accountant",
        roleCode: "SecurityAdmin",
        scopeType: "LEGAL_ENTITY",
        scopeId: entityAId,
      },
    });
    assert(
      String(blockedSystemRoleResponse.json?.message || "").includes(
        "not manageable through local user administration"
      ),
      "Local user admin must block non-local or system roles"
    );

    const blockedCentralRoleResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: localManagerToken,
      method: "POST",
      requestPath: "/api/v1/security/local-user-admin/assignments",
      expectedStatus: 400,
      body: {
        email: invitedLocalUserEmail,
        name: "PR7C Invited OU Accountant",
        roleCode: "PeriodCloseSupervisorAuthority",
        scopeType: "LEGAL_ENTITY",
        scopeId: entityAId,
      },
    });
    assert(
      String(blockedCentralRoleResponse.json?.message || "").includes(
        "centrally managed"
      ) &&
        String(blockedCentralRoleResponse.json?.message || "").includes(
          "PeriodCloseSupervisorAuthority"
        ),
      "Local user admin must surface the explicit central-management rejection for PeriodCloseSupervisorAuthority"
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token: localManagerToken,
      method: "POST",
      requestPath: "/api/v1/security/local-user-admin/assignments",
      expectedStatus: 403,
      body: {
        email: invitedLocalUserEmail,
        name: "PR7C Invited OU Accountant",
        roleCode: "BranchOperator",
        scopeType: "OPERATING_UNIT",
        scopeId: entityBOuId,
      },
    });

    await apiRequest({
      baseUrl: BASE_URL,
      token: localManagerToken,
      method: "DELETE",
      requestPath: `/api/v1/security/local-user-admin/assignments/${newAssignmentId}`,
      expectedStatus: 200,
    });
    assert.equal(
      await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: invitedLocalUserId,
        roleCode: "OUAccountant",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      }),
      0,
      "Local user admin should revoke local assignments inside the manageable entity"
    );

    const localAuditActions = await listAuditActions(admin.tenantId, localManager.userId);
    assertIncludesAll(
      localAuditActions,
      [
        "local_user_admin.invite",
        "local_user_admin.assignment.create",
        "local_user_admin.assignment.delete",
      ],
      "Local user admin actions should remain audit logged"
    );

    const compatManagerToken = await login({
      baseUrl: BASE_URL,
      email: compatManager.email,
      password: compatManager.password,
    });

    const compatListResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: compatManagerToken,
      method: "GET",
      requestPath: "/api/v1/security/entity-branch-operators",
      expectedStatus: 200,
    });
    const compatOperatingUnits = Array.isArray(compatListResponse.json?.operatingUnits)
      ? compatListResponse.json.operatingUnits
      : [];
    assert.deepEqual(
      compatOperatingUnits.map((row) => toPositiveInt(row.id)),
      [entityAOuId],
      "Legacy branch-operator seam should still be filtered to the manager's entity"
    );

    const compatCreateResponse = await apiRequest({
      baseUrl: BASE_URL,
      token: compatManagerToken,
      method: "POST",
      requestPath: "/api/v1/security/entity-branch-operators",
      expectedStatus: 201,
      body: {
        email: compatManagedUser.email,
        name: compatManagedUser.name,
        operatingUnitId: entityAOuId,
      },
    });
    assert.equal(
      compatCreateResponse.json?.role?.code,
      "BranchOperator",
      "Legacy branch-operator seam should still assign BranchOperator through the compatibility bridge"
    );
    assert.equal(
      Boolean(compatCreateResponse.json?.assignmentCreated),
      true,
      "Legacy branch-operator compatibility seam should still create assignments"
    );
    assert.deepEqual(
      compatCreateResponse.json?.createdCompanionRoleCodes || [],
      ["BranchInventoryExecutor", "BranchFixedAssetOperator"],
      "Legacy branch-operator compatibility seam should auto-assign inventory and fixed-asset companions"
    );
    assert(
      (await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: compatManagedUser.userId,
        roleCode: "BranchOperator",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      })) > 0,
      "Legacy branch-operator compatibility seam should persist BranchOperator assignments"
    );
    assert(
      (await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: compatManagedUser.userId,
        roleCode: "BranchInventoryExecutor",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      })) > 0,
      "Legacy branch-operator compatibility seam should persist BranchInventoryExecutor companion assignments"
    );
    assert.equal(
      await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: compatManagedUser.userId,
        roleCode: "BranchInventoryViewer",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      }),
      0,
      "Legacy branch-operator compatibility seam should not persist redundant BranchInventoryViewer companion assignments"
    );
    assert(
      (await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: compatManagedUser.userId,
        roleCode: "BranchFixedAssetOperator",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      })) > 0,
      "Legacy branch-operator compatibility seam should persist BranchFixedAssetOperator companion assignments"
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token: compatManagerToken,
      method: "DELETE",
      requestPath: `/api/v1/security/entity-branch-operators/${compatCreateResponse.json?.assignmentId}`,
      expectedStatus: 200,
    });
    assert.equal(
      await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: compatManagedUser.userId,
        roleCode: "BranchOperator",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      }),
      0,
      "Deleting the compatibility bridge assignment should remove BranchOperator"
    );
    assert.equal(
      await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: compatManagedUser.userId,
        roleCode: "BranchInventoryExecutor",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      }),
      0,
      "Deleting the compatibility bridge assignment should remove BranchInventoryExecutor companions"
    );
    assert.equal(
      await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: compatManagedUser.userId,
        roleCode: "BranchFixedAssetOperator",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      }),
      0,
      "Deleting the compatibility bridge assignment should remove BranchFixedAssetOperator companions"
    );

    await assignRoleScope({
      tenantId: admin.tenantId,
      userId: legacyCompatUser.userId,
      roleCode: "BranchOperator",
      scopeType: "OPERATING_UNIT",
      scopeId: entityAOuId,
    });
    await assignRoleScope({
      tenantId: admin.tenantId,
      userId: legacyCompatUser.userId,
      roleCode: "BranchInventoryViewer",
      scopeType: "OPERATING_UNIT",
      scopeId: entityAOuId,
    });
    await apiRequest({
      baseUrl: BASE_URL,
      token: compatManagerToken,
      method: "GET",
      requestPath: "/api/v1/security/entity-branch-operators",
      expectedStatus: 200,
    });
    assert(
      (await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: legacyCompatUser.userId,
        roleCode: "BranchInventoryExecutor",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      })) > 0,
      "Listing the compatibility bridge should reconcile legacy BranchOperator inventory companions to BranchInventoryExecutor"
    );
    assert.equal(
      await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: legacyCompatUser.userId,
        roleCode: "BranchInventoryViewer",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      }),
      0,
      "Listing the compatibility bridge should remove redundant legacy BranchInventoryViewer companions"
    );
    assert(
      (await findRoleAssignment({
        tenantId: admin.tenantId,
        userId: legacyCompatUser.userId,
        roleCode: "BranchFixedAssetOperator",
        scopeType: "OPERATING_UNIT",
        scopeId: entityAOuId,
      })) > 0,
      "Listing the compatibility bridge should backfill the fixed-asset companion when reconciling legacy BranchOperator rows"
    );

    const compatAuditActions = await listAuditActions(admin.tenantId, compatManager.userId);
    assertIncludesAll(
      compatAuditActions,
      [
        "entity_user_admin.branch_operator.assignment.create",
        "entity_user_admin.branch_operator.assignment.delete",
      ],
      "Legacy branch-operator bridge should keep audit logging"
    );

    console.log("PR-7C local user administration smoke passed.");
    console.log(
      JSON.stringify(
        {
          tenantId: admin.tenantId,
          entityAId,
          entityBId,
          entityAOuId,
          entityBOuId,
          localManagerUserId: localManager.userId,
          compatManagerUserId: compatManager.userId,
          invitedLocalUserId,
          compatManagedUserId: compatManagedUser.userId,
          legacyCompatUserId: legacyCompatUser.userId,
        },
        null,
        2
      )
    );
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
