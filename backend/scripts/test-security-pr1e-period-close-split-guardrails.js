import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { PERMISSION_GROUPS } from "../src/constants/permission-groups.js";
import {
  RETIRED_PERMISSION_CODES,
  evaluatePermissionRuleSet,
} from "../src/constants/permission-rules.js";
import { seedCore } from "../src/seedCore.js";
import {
  apiRequest,
  createBootstrapAdmin,
  createTenant,
  login,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";
import {
  PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_LEGACY_PERMISSION_CODE,
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
  PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
  isPeriodClosePermissionScopeAllowed,
} from "../../shared/periodCloseGovernance.js";

const PORT = Number(process.env.SECURITY_PR1E_PORT || 3133);
const BASE_URL =
  process.env.SECURITY_PR1E_BASE_URL || `http://127.0.0.1:${PORT}`;

function getErrorMessage(payload) {
  return String(
    payload?.message ||
      payload?.error ||
      payload?.details?.message ||
      JSON.stringify(payload),
  );
}

async function getCountryId(iso2) {
  const result = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = ?
     LIMIT 1`,
    [String(iso2 || "").trim().toUpperCase()],
  );
  const countryId = toNumber(result.rows?.[0]?.id);
  assert(countryId > 0, `Expected country ${iso2} to exist`);
  return countryId;
}

async function getRoleId(tenantId, roleCode) {
  const result = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode],
  );
  const roleId = toNumber(result.rows?.[0]?.id);
  assert(roleId > 0, `Expected role ${roleCode} to exist`);
  return roleId;
}

async function createGroupCompany(token, stamp) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/group-companies",
    body: {
      code: `PCGOV01GC${stamp}`,
      name: `PCGOV01 Group ${stamp}`,
    },
    expectedStatus: 201,
  });
  const groupId = toNumber(response.json?.id);
  assert(groupId > 0, "Expected group company id");
  return groupId;
}

async function createLegalEntity(token, groupCompanyId, countryId, stamp) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/org/legal-entities",
    body: {
      groupCompanyId,
      code: `PCGOV01LE${stamp}`,
      name: `PCGOV01 Legal Entity ${stamp}`,
      countryId,
      functionalCurrencyCode: "TRY",
    },
    expectedStatus: 201,
  });
  const legalEntityId = toNumber(response.json?.id);
  assert(legalEntityId > 0, "Expected legal entity id");
  return legalEntityId;
}

async function createCustomRole(token, code, name) {
  const response = await apiRequest({
    baseUrl: BASE_URL,
    token,
    method: "POST",
    requestPath: "/api/v1/security/roles",
    body: { code, name },
    expectedStatus: 201,
  });
  const roleId = toNumber(response.json?.id);
  assert(roleId > 0, `Expected created role id for ${code}`);
  return roleId;
}

async function main() {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const securityRouteSource = await readFile(
    path.resolve(backendRoot, "src/routes/security.js"),
    "utf8",
  );
  const localUserAdminSection = securityRouteSource.slice(
    securityRouteSource.indexOf("async function createLocalUserAdminAssignment"),
    securityRouteSource.indexOf("async function deleteLocalUserAdminAssignment"),
  );

  assert.deepEqual(PERMISSION_GROUPS["gl.period_governance"]?.permissions, [
    PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
    PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
    PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
    PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  ]);
  assert(RETIRED_PERMISSION_CODES.includes(PERIOD_CLOSE_LEGACY_PERMISSION_CODE));
  assert.equal(
    isPeriodClosePermissionScopeAllowed(
      PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
      "GROUP",
    ),
    true,
  );
  assert.equal(
    isPeriodClosePermissionScopeAllowed(
      PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
      "GROUP",
    ),
    false,
  );
  assert(
    localUserAdminSection.includes(
      "assertRoleAssignmentDoesNotEnableGroupPeriodCloseExecute",
    ),
    "Local user admin writes should reuse the group-execute hard-fail guard",
  );

  const retiredEvaluation = evaluatePermissionRuleSet({
    permissionCodes: [PERIOD_CLOSE_LEGACY_PERMISSION_CODE],
    subjectLabel: "Role Legacy Period Close",
  });
  assert(
    retiredEvaluation.errors.some(
      (error) =>
        error.type === "retired_permission" &&
        error.permissionCode === PERIOD_CLOSE_LEGACY_PERMISSION_CODE,
    ),
    "Legacy period-close permission should be rejected as retired",
  );

  const sodEvaluation = evaluatePermissionRuleSet({
    permissionCodes: [
      PERIOD_CLOSE_READINESS_PERMISSION_CODE,
      PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
      PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
      PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
    ],
    subjectLabel: "Role Period Close Combined",
  });
  assert(
    sodEvaluation.warnings.some(
      (warning) =>
        warning.leftPermissionCode === PERIOD_CLOSE_READINESS_PERMISSION_CODE &&
        warning.rightPermissionCode === PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
    ),
    "Readiness versus approval warning should exist",
  );
  assert(
    sodEvaluation.warnings.some(
      (warning) =>
        warning.leftPermissionCode === PERIOD_CLOSE_APPROVE_PERMISSION_CODE &&
        warning.rightPermissionCode === PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
    ),
    "Approval versus execution warning should exist",
  );
  assert(
    sodEvaluation.warnings.some(
      (warning) =>
        warning.leftPermissionCode === PERIOD_CLOSE_EXECUTE_PERMISSION_CODE &&
        warning.rightPermissionCode === PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
    ),
    "Execution versus reopen warning should exist",
  );

  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant(
    `PCGOV01_${stamp}`,
    `PCGOV01 ${stamp}`,
  );
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const password = "Pcgov01#12345";
  const email = `pcgov01_admin_${stamp}@example.com`;
  const { userId } = await createBootstrapAdmin({
    tenantId,
    email,
    password,
    name: "PCGOV01 Admin",
  });

  const server = startServerProcess({ port: PORT });
  let serverStopped = false;

  try {
    await waitForServer({ baseUrl: BASE_URL });

    const token = await login({
      baseUrl: BASE_URL,
      email,
      password,
    });
    const countryId = await getCountryId("TR");
    const groupId = await createGroupCompany(token, stamp);
    const legalEntityId = await createLegalEntity(
      token,
      groupId,
      countryId,
      stamp,
    );

    const permissionsResponse = await apiRequest({
      baseUrl: BASE_URL,
      token,
      requestPath: "/api/v1/security/permissions",
      expectedStatus: 200,
    });
    const permissionCodes = new Set(
      (permissionsResponse.json?.rows || []).map((row) => String(row.code || "")),
    );
    assert(
      permissionCodes.has(PERIOD_CLOSE_APPROVE_PERMISSION_CODE),
      "Permission catalog should expose split approval permission",
    );
    assert(
      permissionCodes.has(PERIOD_CLOSE_EXECUTE_PERMISSION_CODE),
      "Permission catalog should expose split execution permission",
    );
    assert(
      !permissionCodes.has(PERIOD_CLOSE_LEGACY_PERMISSION_CODE),
      "Permission catalog should hide retired legacy close permission",
    );

    const periodCloseAuthorityRoleId = await getRoleId(
      tenantId,
      "PeriodCloseAuthority",
    );
    const groupAssignmentBlock = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/security/role-assignments",
      body: {
        userId,
        roleId: periodCloseAuthorityRoleId,
        scopeType: "GROUP",
        scopeId: groupId,
        effect: "ALLOW",
      },
      expectedStatus: 400,
    });
    assert(
      getErrorMessage(groupAssignmentBlock.json).includes(
        PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
      ),
      "GROUP assignment block should mention execute permission",
    );

    const groupedRoleId = await createCustomRole(
      token,
      `PCGOV01_GROUP_${stamp}`,
      "PCGOV01 Group Role",
    );
    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/security/role-assignments",
      body: {
        userId,
        roleId: groupedRoleId,
        scopeType: "GROUP",
        scopeId: groupId,
        effect: "ALLOW",
      },
      expectedStatus: 201,
    });

    const addExecuteToGroupedRole = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/security/roles/${groupedRoleId}/permissions`,
      body: {
        permissionCodes: [
          "gl.journal.read",
          "gl.trial_balance.read",
          PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
        ],
      },
      expectedStatus: 400,
    });
    assert(
      getErrorMessage(addExecuteToGroupedRole.json).includes(
        "cannot grant gl.period.close.execute while it is assigned at GROUP scope",
      ),
      "Adding execute to a GROUP-assigned role should hard-fail",
    );

    const replaceExecuteOnGroupedRole = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "PUT",
      requestPath: `/api/v1/security/roles/${groupedRoleId}/permissions`,
      body: {
        permissionCodes: [
          "gl.journal.read",
          "gl.trial_balance.read",
          PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
        ],
      },
      expectedStatus: 400,
    });
    assert(
      getErrorMessage(replaceExecuteOnGroupedRole.json).includes(
        "cannot grant gl.period.close.execute while it is assigned at GROUP scope",
      ),
      "Replacing permissions with execute on a GROUP-assigned role should hard-fail",
    );

    const movableRoleId = await createCustomRole(
      token,
      `PCGOV01_MOVE_${stamp}`,
      "PCGOV01 Movable Role",
    );
    await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: `/api/v1/security/roles/${movableRoleId}/permissions`,
      body: {
        permissionCodes: [
          "gl.journal.read",
          "gl.trial_balance.read",
          PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
        ],
      },
      expectedStatus: 201,
    });
    const legalEntityAssignment = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "POST",
      requestPath: "/api/v1/security/role-assignments",
      body: {
        userId,
        roleId: movableRoleId,
        scopeType: "LEGAL_ENTITY",
        scopeId: legalEntityId,
        effect: "ALLOW",
      },
      expectedStatus: 201,
    });
    const assignmentId = toNumber(legalEntityAssignment.json?.assignmentId);
    assert(assignmentId > 0, "Expected created legal-entity assignment id");

    const moveAssignmentToGroup = await apiRequest({
      baseUrl: BASE_URL,
      token,
      method: "PUT",
      requestPath: `/api/v1/security/role-assignments/${assignmentId}/scope`,
      body: {
        scopeType: "GROUP",
        scopeId: groupId,
        effect: "ALLOW",
      },
      expectedStatus: 400,
    });
    assert(
      getErrorMessage(moveAssignmentToGroup.json).includes(
        "cannot be assigned at GROUP scope",
      ),
      "Scope move should block effective GROUP execute",
    );

    console.log("test-security-pr1e-period-close-split-guardrails passed");
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
  process.exit(1);
});
