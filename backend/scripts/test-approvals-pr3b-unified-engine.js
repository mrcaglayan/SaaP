import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  clearApprovalExecutionResolversForTests,
  evaluateApprovalNeed,
  executeRequest,
  escalateRequest,
  getRequestDiagnostics,
  recordDecision,
  registerApprovalExecutionResolver,
  reverseExecution,
  submitRequest,
  withdrawRequest,
} from "../src/services/approval.engine.service.js";

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

async function createTenantFixture(stamp) {
  const tenantCode = `PR3B_T_${stamp}`;
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
    tenantCode,
    `PR3B Tenant ${stamp}`,
  ]);
  const tenantRows = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantRows.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to create PR-3B tenant");

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
    [tenantId, `PR3B_G_${stamp}`, `PR3B Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PR3B_G_${stamp}`]
  );
  const groupId = toNumber(groupRows.rows?.[0]?.id);
  assert(groupId > 0, "Failed to create PR-3B group");

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
      `PR3B_LE_${stamp}`,
      `PR3B Legal Entity ${stamp}`,
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
    [tenantId, `PR3B_LE_${stamp}`]
  );
  const legalEntityId = toNumber(entityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create PR-3B legal entity");

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
        `PR3B_OU_${suffix}_${stamp}`,
        `PR3B OU ${suffix} ${stamp}`,
      ]
    );
  }

  const unitRows = await query(
    `SELECT id, code
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY id ASC`,
    [tenantId, legalEntityId]
  );
  assert((unitRows.rows || []).length >= 2, "Failed to create PR-3B operating units");

  return {
    tenantId,
    legalEntityId,
    operatingUnitId: toNumber(unitRows.rows[0].id),
    otherOperatingUnitId: toNumber(unitRows.rows[1].id),
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

async function createScopedReviewRole(tenantId, stamp) {
  const roleCode = `PR3B_REVIEW_${stamp}`;
  await query(
    `INSERT INTO roles (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, roleCode, `PR3B Review ${stamp}`]
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
  assert(roleId > 0, "Scoped review role was not created");

  const permissionRows = await query(
    `SELECT id
     FROM permissions
     WHERE code = 'cari.request.review'
     LIMIT 1`
  );
  const permissionId = toNumber(permissionRows.rows?.[0]?.id);
  assert(permissionId > 0, "cari.request.review permission not found");

  await query(
    `INSERT INTO role_permissions (role_id, permission_id)
     VALUES (?, ?)`,
    [roleId, permissionId]
  );
  return roleCode;
}

async function insertGenericPolicyFixture({
  tenantId,
  legalEntityId,
  createdByUserId,
}) {
  const policyCode = `PR3B_POLICY_${Date.now()}`;
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
     ) VALUES (?, 'CARI', ?, ?, 'COUNTERPARTY_REQUEST', 'CREATE', 1, 'LEGAL_ENTITY', ?, NULL, NULL, 2, 1, 1, 0, 1, NULL, NULL, NULL, NULL, 'cari.request.review', 1, ?, ?)`,
    [tenantId, policyCode, "PR3B Counterparty Policy", legalEntityId, createdByUserId, createdByUserId]
  );
  const policyId = toNumber(policyRes.rows?.insertId);
  assert(policyId > 0, "Failed to insert PR-3B approval policy");

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
     ) VALUES
       (?, ?, 1, 'cari.request.review', 'REQUEST_SCOPE', NULL, 2, 0, NULL),
       (?, ?, 2, 'cari.request.review', 'REQUEST_SCOPE', NULL, 1, 0, NULL)`,
    [tenantId, policyId, tenantId, policyId]
  );

  return policyId;
}

async function main() {
  clearApprovalExecutionResolversForTests();
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createTenantFixture(stamp);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash("PR3B#Engine123", 10);
  const requesterUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3b_requester_${stamp}@example.com`,
    name: "PR3B Requester",
    passwordHash,
  });
  const scopedApproverUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3b_scoped_${stamp}@example.com`,
    name: "PR3B Scoped Approver",
    passwordHash,
  });
  const outsiderUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3b_outsider_${stamp}@example.com`,
    name: "PR3B Outsider Approver",
    passwordHash,
  });
  const tenantApproverAUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3b_tenanta_${stamp}@example.com`,
    name: "PR3B Tenant Approver A",
    passwordHash,
  });
  const tenantApproverBUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3b_tenantb_${stamp}@example.com`,
    name: "PR3B Tenant Approver B",
    passwordHash,
  });

  for (const userId of [requesterUserId, tenantApproverAUserId, tenantApproverBUserId]) {
    await assignRoleAtScope({
      tenantId: fixture.tenantId,
      userId,
      roleCode: "TenantAdmin",
      scopeType: "TENANT",
      scopeId: fixture.tenantId,
    });
  }

  const scopedRoleCode = await createScopedReviewRole(fixture.tenantId, stamp);
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: scopedApproverUserId,
    roleCode: scopedRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.operatingUnitId,
  });
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: outsiderUserId,
    roleCode: scopedRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.otherOperatingUnitId,
  });

  const policyId = await insertGenericPolicyFixture({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    createdByUserId: requesterUserId,
  });

  const executionCalls = [];
  registerApprovalExecutionResolver("TEST_COUNTERPARTY_EXEC", {
    async execute({ request, actionPayload }) {
      executionCalls.push(`execute:${request.id}`);
      return {
        applied: true,
        targetId: request.targetId,
        event: actionPayload?.event || null,
      };
    },
    async reverse({ request }) {
      executionCalls.push(`reverse:${request.id}`);
      return {
        reversed: true,
        targetId: request.targetId,
      };
    },
  });

  const evaluation = await evaluateApprovalNeed("CARI", "COUNTERPARTY_REQUEST", "CREATE", {
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    operatingUnitId: fixture.operatingUnitId,
  });
  assert(evaluation.approvalRequired === true, "evaluateApprovalNeed should require approval");
  assert(toNumber(evaluation.policy?.id) === policyId, "Matched policy should be the generic PR-3B fixture");
  assert(
    String(evaluation.assignment?.scopeType || "").toUpperCase() === "LEGAL_ENTITY",
    "Matched assignment should resolve to LEGAL_ENTITY scope"
  );

  const submitRes = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9001,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      targetSnapshot: { targetType: "COUNTERPARTY_REQUEST", targetId: 9001 },
      actionPayload: {
        executionResolverKey: "TEST_COUNTERPARTY_EXEC",
        event: "APPLY_COUNTERPARTY",
      },
      idempotencyKey: `PR3B_REQ_${stamp}`,
    }
  );
  const requestId = toNumber(submitRes.item?.id);
  assert(requestId > 0, "submitRequest should create a request id");
  assert(
    String(submitRes.item?.requestStatus || "").toUpperCase() === "PENDING_REVIEW",
    "New request should start in PENDING_REVIEW"
  );

  await expectFailure(
    () => recordDecision(requestId, requesterUserId, "APPROVE", "self approval should fail"),
    { status: 403, includes: "Maker-checker violation" }
  );

  await expectFailure(
    () => recordDecision(requestId, outsiderUserId, "APPROVE", "wrong-ou reviewer"),
    { status: 403, includes: "Missing permission" }
  );

  const step1Approve1 = await recordDecision(
    requestId,
    scopedApproverUserId,
    "APPROVE",
    "OU-scoped approval"
  );
  assert(
    Number(step1Approve1.item?.currentStepNo || 0) === 1,
    "One approval at step 1 should not advance before the threshold"
  );

  await expectFailure(
    () => recordDecision(requestId, scopedApproverUserId, "APPROVE", "duplicate approval"),
    { status: 409, includes: "Decision already exists" }
  );

  const step1Approve2 = await recordDecision(
    requestId,
    tenantApproverAUserId,
    "APPROVE",
    "Tenant approval advances step"
  );
  assert(
    Number(step1Approve2.item?.currentStepNo || 0) === 2,
    "Second distinct approval should advance to step 2"
  );
  assert(
    String(step1Approve2.item?.requestStatus || "").toUpperCase() === "PENDING_REVIEW",
    "Request should remain reviewable after advancing to step 2"
  );

  const diagnostics = await getRequestDiagnostics(requestId);
  assert(Number(diagnostics.steps?.length || 0) === 2, "Diagnostics should include both approval steps");
  assert(Number(diagnostics.currentStep?.stepNo || 0) === 2, "Diagnostics should point at step 2");
  assert(
    Array.isArray(diagnostics.availableApproverUserIds) &&
      diagnostics.availableApproverUserIds.includes(tenantApproverBUserId),
    "Diagnostics should list current-step approvers at request scope"
  );

  const finalApprove = await recordDecision(
    requestId,
    tenantApproverBUserId,
    "APPROVE",
    "Final approval"
  );
  assert(
    String(finalApprove.item?.requestStatus || "").toUpperCase() === "APPROVED",
    "Final approval should mark the request APPROVED"
  );
  assert(
    String(finalApprove.item?.executionStatus || "").toUpperCase() === "EXECUTED",
    "Auto execute should set execution status to EXECUTED"
  );
  assert(
    finalApprove.execution_result?.applied === true,
    "Final approval should return the execution result"
  );
  assert(executionCalls.filter((entry) => entry.startsWith("execute:")).length === 1, "Execute resolver should run once");

  const executeAgain = await executeRequest(requestId);
  assert(executeAgain.idempotent === true, "executeRequest should be idempotent after execution");
  assert(executionCalls.filter((entry) => entry.startsWith("execute:")).length === 1, "Execute resolver should not run twice");

  const reverseRes = await reverseExecution(requestId);
  assert(
    String(reverseRes.item?.executionStatus || "").toUpperCase() === "REVERSED",
    "reverseExecution should mark execution status REVERSED"
  );
  assert(reverseRes.reverse_result?.reversed === true, "reverseExecution should return reverse payload");

  const withdrawSubmit = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9002,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `PR3B_WITHDRAW_${stamp}`,
    }
  );
  const withdrawRes = await withdrawRequest(toNumber(withdrawSubmit.item?.id), requesterUserId);
  assert(
    String(withdrawRes.item?.requestStatus || "").toUpperCase() === "WITHDRAWN",
    "withdrawRequest should mark the request WITHDRAWN"
  );

  const escalatedSubmit = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9003,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `PR3B_ESCALATE_${stamp}`,
    }
  );
  const escalatedRes = await escalateRequest(toNumber(escalatedSubmit.item?.id));
  assert(
    String(escalatedRes.item?.requestStatus || "").toUpperCase() === "ESCALATED",
    "escalateRequest should mark the request ESCALATED"
  );
  const rejectedEscalated = await recordDecision(
    toNumber(escalatedSubmit.item?.id),
    tenantApproverAUserId,
    "REJECT",
    "Escalated request rejected"
  );
  assert(
    String(rejectedEscalated.item?.requestStatus || "").toUpperCase() === "REJECTED",
    "Escalated request should still be rejectable"
  );

  const returnedSubmit = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9004,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `PR3B_RETURN_${stamp}`,
    }
  );
  const returnedRes = await recordDecision(
    toNumber(returnedSubmit.item?.id),
    tenantApproverAUserId,
    "RETURN",
    "Needs revision"
  );
  assert(
    String(returnedRes.item?.requestStatus || "").toUpperCase() === "RETURNED",
    "RETURN should mark the request RETURNED"
  );

  console.log("PR-3B unified approval engine checks passed");
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
