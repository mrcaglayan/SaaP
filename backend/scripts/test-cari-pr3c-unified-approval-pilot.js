import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { assertScopeAccess } from "../src/middleware/rbac.js";
import { seedCore } from "../src/seedCore.js";
import {
  clearApprovalExecutionResolversForTests,
} from "../src/services/approval.engine.service.js";
import {
  approveCounterpartyRequestById,
  createCounterpartyRequest,
  listCounterpartyRequestRows,
  rejectCounterpartyRequestById,
  resolveCounterpartyRequestScope,
} from "../src/services/cari.counterparty-request.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function expectFailure(work, { status, includes }) {
  try {
    await work();
  } catch (error) {
    if (status !== undefined && Number(error?.status || 0) !== Number(status)) {
      throw new Error(
        `Expected status ${status} but got ${String(error?.status)} message=${String(
          error?.message || ""
        )}`
      );
    }
    if (includes && !String(error?.message || "").includes(includes)) {
      throw new Error(
        `Expected message to include "${includes}" but got "${String(error?.message || "")}"`
      );
    }
    return;
  }
  throw new Error("Expected failure but the operation succeeded");
}

function buildScopeContext({ tenantId, legalEntityIds = [], operatingUnitIds = [] }) {
  return {
    tenantId,
    tenantWide: false,
    groups: new Set(),
    countries: new Set(),
    legalEntities: new Set(legalEntityIds.map((item) => toNumber(item)).filter(Boolean)),
    operatingUnits: new Set(operatingUnitIds.map((item) => toNumber(item)).filter(Boolean)),
  };
}

function buildReq({ userId, tenantId, scopeContext }) {
  return {
    user: { userId },
    headers: {},
    ip: "127.0.0.1",
    requestId: `pr3c-${Date.now()}`,
    rbac: {
      permissionScopeContext: scopeContext,
      visibilityScopeContext: null,
      scopeContext,
    },
    body: {},
    query: { tenantId },
    params: {},
  };
}

async function createTenantFixture(stamp) {
  const tenantCode = `PR3C_T_${stamp}`;
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
    tenantCode,
    `PR3C Tenant ${stamp}`,
  ]);
  const tenantRows = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantRows.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to create PR-3C tenant");

  const countryRows = await query(
    `SELECT id, default_currency_code
     FROM countries
     WHERE iso2 = 'TR'
     LIMIT 1`
  );
  const countryId = toNumber(countryRows.rows?.[0]?.id);
  const currencyCode = String(countryRows.rows?.[0]?.default_currency_code || "TRY");
  assert(countryId > 0, "Missing TR country fixture");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `PR3C_G_${stamp}`, `PR3C Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PR3C_G_${stamp}`]
  );
  const groupId = toNumber(groupRows.rows?.[0]?.id);
  assert(groupId > 0, "Failed to create PR-3C group");

  await query(
    `INSERT INTO legal_entities (
       tenant_id,
       group_company_id,
       code,
       name,
       country_id,
       functional_currency_code,
       status
     ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      groupId,
      `PR3C_LE_${stamp}`,
      `PR3C Legal Entity ${stamp}`,
      countryId,
      currencyCode,
    ]
  );
  const entityRows = await query(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PR3C_LE_${stamp}`]
  );
  const legalEntityId = toNumber(entityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create PR-3C legal entity");

  for (const suffix of ["A", "B"]) {
    await query(
      `INSERT INTO operating_units (
         tenant_id,
         legal_entity_id,
         code,
         name,
         unit_type,
         has_subledger,
         status
       ) VALUES (?, ?, ?, ?, 'BRANCH', 1, 'ACTIVE')`,
      [
        tenantId,
        legalEntityId,
        `PR3C_OU_${suffix}_${stamp}`,
        `PR3C OU ${suffix} ${stamp}`,
      ]
    );
  }

  const unitRows = await query(
    `SELECT id
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY id ASC`,
    [tenantId, legalEntityId]
  );
  assert((unitRows.rows || []).length >= 2, "Failed to create PR-3C operating units");

  return {
    tenantId,
    legalEntityId,
    operatingUnitId: toNumber(unitRows.rows?.[0]?.id),
    otherOperatingUnitId: toNumber(unitRows.rows?.[1]?.id),
  };
}

async function createUser({ tenantId, email, name, passwordHash }) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name]
  );
  const rows = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  const userId = toNumber(rows.rows?.[0]?.id);
  assert(userId > 0, `Failed to create user ${email}`);
  return userId;
}

async function assignRoleAtScope({ tenantId, userId, roleCode, scopeType, scopeId }) {
  const roleRows = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = toNumber(roleRows.rows?.[0]?.id);
  assert(roleId > 0, `Role ${roleCode} not found`);

  await query(
    `INSERT INTO user_role_scopes (
       tenant_id,
       user_id,
       role_id,
       scope_type,
       scope_id,
       effect,
       effective_from,
       effective_to
     ) VALUES (?, ?, ?, ?, ?, 'ALLOW', NULL, NULL)`,
    [tenantId, userId, roleId, scopeType, scopeId]
  );
}

async function createScopedPermissionRole({
  tenantId,
  roleCode,
  roleName,
  permissionCodes,
}) {
  await query(
    `INSERT INTO roles (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, roleCode, roleName]
  );
  const roleRows = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = toNumber(roleRows.rows?.[0]?.id);
  assert(roleId > 0, `Scoped permission role was not created: ${roleCode}`);

  const permissionRows = await query(
    `SELECT id, code
     FROM permissions
     WHERE code IN (${permissionCodes.map(() => "?").join(", ")})`,
    permissionCodes
  );
  assert(
    (permissionRows.rows || []).length === permissionCodes.length,
    `Missing scoped permissions for ${roleCode}`
  );

  for (const permissionRow of permissionRows.rows || []) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES (?, ?)`,
      [roleId, permissionRow.id]
    );
  }

  return roleCode;
}

async function insertCounterpartyApprovalPolicy({
  tenantId,
  legalEntityId,
  createdByUserId,
}) {
  const policyCode = `PR3C_POLICY_${Date.now()}`;
  const policyRes = await query(
    `INSERT INTO approval_policies (
       tenant_id,
       module_code,
       policy_code,
       policy_name,
       target_type,
       action_type,
       version_no,
       scope_type,
       scope_id,
       effective_from,
       effective_to,
       step_count,
       min_approvals,
       maker_checker_required,
       allow_self_approve,
       auto_execute_on_final_approval,
       escalation_after_hours,
       min_amount,
       max_amount,
       currency_code,
       approver_permission_code,
       is_active,
       created_by_user_id,
       updated_by_user_id
     ) VALUES (?, 'CARI', ?, ?, 'COUNTERPARTY_REQUEST', 'CREATE', 1, 'LEGAL_ENTITY', ?, NULL, NULL, 1, 1, 1, 0, 1, NULL, NULL, NULL, NULL, 'cari.request.review', 1, ?, ?)`,
    [
      tenantId,
      policyCode,
      "PR3C Counterparty Request Policy",
      legalEntityId,
      createdByUserId,
      createdByUserId,
    ]
  );
  const policyId = toNumber(policyRes.rows?.insertId);
  assert(policyId > 0, "Failed to insert PR-3C approval policy");

  await query(
    `INSERT INTO approval_policy_assignments (
       tenant_id,
       policy_id,
       scope_type,
       scope_id,
       effective_from,
       effective_to,
       is_active
     ) VALUES (?, ?, 'LEGAL_ENTITY', ?, NULL, NULL, 1)`,
    [tenantId, policyId, legalEntityId]
  );

  await query(
    `INSERT INTO approval_policy_steps (
       tenant_id,
       policy_id,
       step_no,
       required_permission_code,
       scope_resolution_mode,
       custom_scope_resolver_key,
       min_approvals,
       allow_self_approve,
       escalation_after_hours
     ) VALUES (?, ?, 1, 'cari.request.review', 'REQUEST_SCOPE', NULL, 1, 0, NULL)`,
    [tenantId, policyId]
  );

  return policyId;
}

async function countAuditLogs(tenantId, requestId, action) {
  const result = await query(
    `SELECT COUNT(*) AS row_count
     FROM audit_logs
     WHERE tenant_id = ?
       AND resource_type = 'counterparty_request'
       AND resource_id = ?
       AND action = ?`,
    [tenantId, String(requestId), action]
  );
  return toNumber(result.rows?.[0]?.row_count);
}

async function main() {
  process.env.CARI_COUNTERPARTY_REQUEST_UNIFIED_APPROVAL = "1";
  clearApprovalExecutionResolversForTests();
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createTenantFixture(stamp);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash("PR3C#Pilot123", 10);
  const requesterUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3c_requester_${stamp}@example.com`,
    name: "PR3C Requester",
    passwordHash,
  });
  const reviewerUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3c_reviewer_${stamp}@example.com`,
    name: "PR3C Reviewer",
    passwordHash,
  });
  const outsiderReviewerUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3c_outsider_${stamp}@example.com`,
    name: "PR3C Outsider Reviewer",
    passwordHash,
  });

  const requestRoleCode = await createScopedPermissionRole({
    tenantId: fixture.tenantId,
    roleCode: `PR3C_REQUEST_${stamp}`,
    roleName: `PR3C Request ${stamp}`,
    permissionCodes: ["cari.card.request"],
  });
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: requesterUserId,
    roleCode: requestRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.operatingUnitId,
  });

  const reviewRoleCode = await createScopedPermissionRole({
    tenantId: fixture.tenantId,
    roleCode: `PR3C_REVIEW_${stamp}`,
    roleName: `PR3C Review ${stamp}`,
    permissionCodes: ["cari.request.review"],
  });
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: reviewerUserId,
    roleCode: reviewRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.operatingUnitId,
  });
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: outsiderReviewerUserId,
    roleCode: reviewRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.otherOperatingUnitId,
  });

  await insertCounterpartyApprovalPolicy({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    createdByUserId: requesterUserId,
  });

  const requesterReq = buildReq({
    userId: requesterUserId,
    tenantId: fixture.tenantId,
    scopeContext: buildScopeContext({
      tenantId: fixture.tenantId,
      operatingUnitIds: [fixture.operatingUnitId],
    }),
  });
  const reviewerReq = buildReq({
    userId: reviewerUserId,
    tenantId: fixture.tenantId,
    scopeContext: buildScopeContext({
      tenantId: fixture.tenantId,
      operatingUnitIds: [fixture.operatingUnitId],
    }),
  });
  const outsiderReq = buildReq({
    userId: outsiderReviewerUserId,
    tenantId: fixture.tenantId,
    scopeContext: buildScopeContext({
      tenantId: fixture.tenantId,
      operatingUnitIds: [fixture.otherOperatingUnitId],
    }),
  });

  const createRes = await createCounterpartyRequest({
    req: requesterReq,
    payload: {
      tenantId: fixture.tenantId,
      userId: requesterUserId,
      legalEntityId: fixture.legalEntityId,
      primaryOperatingUnitId: fixture.operatingUnitId,
      operatingUnitIds: [fixture.operatingUnitId],
      code: `PR3C-${stamp}`,
      name: "PR3C Counterparty",
      isCustomer: true,
      isVendor: false,
      status: "ACTIVE",
      taxId: null,
      email: null,
      phone: null,
      notes: null,
      defaultCurrencyCode: null,
      defaultPaymentTermId: null,
      arAccountId: null,
      apAccountId: null,
      contacts: [],
      addresses: [],
    },
    assertScopeAccess,
  });
  assert(createRes.id > 0, "Counterparty request should be created");
  assert(
    toNumber(createRes.approvalRequest?.id) > 0,
    "Unified pilot should link a generic approval request"
  );
  assert(createRes.requestStatus === "PENDING", "New request should stay pending in legacy status");
  assert(
    String(createRes.approvalRequest?.requestStatus || "").toUpperCase() === "PENDING_REVIEW",
    "Approval request should start in PENDING_REVIEW"
  );
  assert(
    String(createRes.approvalRequest?.scopeType || "").toUpperCase() === "OPERATING_UNIT" &&
      toNumber(createRes.approvalRequest?.scopeId) === fixture.operatingUnitId,
    "Approval request should preserve OU request scope"
  );

  const resolvedScope = await resolveCounterpartyRequestScope(createRes.id, fixture.tenantId);
  assert(
    resolvedScope?.scopeType === "OPERATING_UNIT" &&
      toNumber(resolvedScope?.scopeId) === fixture.operatingUnitId,
    "Route scope resolution should follow the stored request scope"
  );

  const reviewerList = await listCounterpartyRequestRows({
    req: reviewerReq,
    tenantId: fixture.tenantId,
    filters: {
      tenantId: fixture.tenantId,
      legalEntityId: null,
      primaryOperatingUnitId: null,
      status: null,
      role: null,
      mineOnly: false,
      q: null,
      limit: 50,
      offset: 0,
    },
    assertScopeAccess,
  });
  assert(reviewerList.total >= 1, "Scoped reviewer should see the request in scope");

  await expectFailure(
    () =>
      approveCounterpartyRequestById({
        req: outsiderReq,
        tenantId: fixture.tenantId,
        requestId: createRes.id,
        userId: outsiderReviewerUserId,
        decisionComment: "Wrong scope",
        assertScopeAccess,
      }),
    { status: 403, includes: "Access denied" }
  );

  const approveRes = await approveCounterpartyRequestById({
    req: reviewerReq,
    tenantId: fixture.tenantId,
    requestId: createRes.id,
    userId: reviewerUserId,
    decisionComment: "Approved via PR-3C pilot",
    assertScopeAccess,
  });
  assert(
    String(approveRes.request?.requestStatus || "").toUpperCase() === "APPROVED",
    "Approved request should map to APPROVED"
  );
  assert(
    String(approveRes.approvalRequest?.requestStatus || "").toUpperCase() === "APPROVED",
    "Generic approval request should be APPROVED"
  );
  assert(
    String(approveRes.approvalRequest?.executionStatus || "").toUpperCase() === "EXECUTED",
    "Generic approval request should be EXECUTED after final approval"
  );
  assert(
    toNumber(approveRes.counterparty?.id) > 0,
    "Final approval should create the live counterparty"
  );
  assert(
    toNumber(approveRes.request?.createdCounterpartyId) === toNumber(approveRes.counterparty?.id),
    "Request row should link the created counterparty"
  );

  const submitAuditCount = await countAuditLogs(
    fixture.tenantId,
    createRes.id,
    "cari.counterparty_request.submit"
  );
  const approveAuditCount = await countAuditLogs(
    fixture.tenantId,
    createRes.id,
    "cari.counterparty_request.approve"
  );
  assert(submitAuditCount >= 1, "Submit audit log should be written");
  assert(approveAuditCount >= 1, "Approve audit log should be written");

  const secondCreateRes = await createCounterpartyRequest({
    req: requesterReq,
    payload: {
      tenantId: fixture.tenantId,
      userId: requesterUserId,
      legalEntityId: fixture.legalEntityId,
      primaryOperatingUnitId: fixture.operatingUnitId,
      operatingUnitIds: [fixture.operatingUnitId],
      code: `PR3C-R-${stamp}`,
      name: "PR3C Reject Counterparty",
      isCustomer: false,
      isVendor: true,
      status: "ACTIVE",
      taxId: null,
      email: null,
      phone: null,
      notes: null,
      defaultCurrencyCode: null,
      defaultPaymentTermId: null,
      arAccountId: null,
      apAccountId: null,
      contacts: [],
      addresses: [],
    },
    assertScopeAccess,
  });

  const rejectRes = await rejectCounterpartyRequestById({
    req: reviewerReq,
    tenantId: fixture.tenantId,
    requestId: secondCreateRes.id,
    userId: reviewerUserId,
    decisionComment: "Rejected via PR-3C pilot",
    assertScopeAccess,
  });
  assert(
    String(rejectRes.row?.requestStatus || "").toUpperCase() === "REJECTED",
    "Rejected request should map to REJECTED"
  );
  assert(
    String(rejectRes.approvalRequest?.requestStatus || "").toUpperCase() === "REJECTED",
    "Generic approval request should be REJECTED"
  );

  const linkedRowResult = await query(
    `SELECT approval_request_id
     FROM counterparty_requests
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [fixture.tenantId, createRes.id]
  );
  assert(
    toNumber(linkedRowResult.rows?.[0]?.approval_request_id) ===
      toNumber(createRes.approvalRequest?.id),
    "Counterparty request should persist the approval_request_id bridge"
  );

  console.log("PR-3C CARI unified approval pilot checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearApprovalExecutionResolversForTests();
    await closePool();
  });
