import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  recordDecision,
  submitRequest,
} from "../src/services/approval.engine.service.js";
import {
  createApprovalDelegation,
  resolveApprovalDelegation,
  revokeApprovalDelegation,
} from "../src/services/approval.delegation.service.js";

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
  const tenantCode = `PR5D_T_${stamp}`;
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
    tenantCode,
    `PR5D Tenant ${stamp}`,
  ]);
  const tenantRows = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantRows.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to create PR-5D tenant");

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
    [tenantId, `PR5D_G_${stamp}`, `PR5D Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR5D_G_${stamp}`]
  );
  const groupId = toNumber(groupRows.rows?.[0]?.id);
  assert(groupId > 0, "Failed to create PR-5D group");

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
      `PR5D_LE_${stamp}`,
      `PR5D Legal Entity ${stamp}`,
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
    [tenantId, `PR5D_LE_${stamp}`]
  );
  const legalEntityId = toNumber(entityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create PR-5D legal entity");

  await query(
    `INSERT INTO operating_units (
       tenant_id,
       legal_entity_id,
       code,
       name,
       unit_type,
       has_subledger,
       status
     ) VALUES
       (?, ?, ?, ?, 'BRANCH', 1, 'ACTIVE'),
       (?, ?, ?, ?, 'BRANCH', 1, 'ACTIVE')`,
    [
      tenantId,
      legalEntityId,
      `PR5D_OU_A_${stamp}`,
      `PR5D OU A ${stamp}`,
      tenantId,
      legalEntityId,
      `PR5D_OU_B_${stamp}`,
      `PR5D OU B ${stamp}`,
    ]
  );
  const unitRows = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
      ORDER BY id ASC`,
    [tenantId, legalEntityId]
  );
  assert((unitRows.rows || []).length >= 2, "Failed to create PR-5D operating units");

  return {
    tenantId,
    legalEntityId,
    operatingUnitId: toNumber(unitRows.rows[0]?.id),
    otherOperatingUnitId: toNumber(unitRows.rows[1]?.id),
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

async function createScopedReviewRole(tenantId, stamp) {
  const roleCode = `PR5D_REVIEW_${stamp}`;
  await query(
    `INSERT INTO roles (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, roleCode, `PR5D Review ${stamp}`]
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

async function insertDelegationPolicyFixture({
  tenantId,
  legalEntityId,
  createdByUserId,
}) {
  const policyCode = `PR5D_POLICY_${Date.now()}`;
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
     ) VALUES (?, 'CARI', ?, ?, 'COUNTERPARTY_REQUEST', 'CREATE', 1, 'LEGAL_ENTITY', ?, NULL, NULL, 1, 2, 1, 0, 0, NULL, NULL, NULL, NULL, 'cari.request.review', 1, ?, ?)`,
    [
      tenantId,
      policyCode,
      "PR5D Counterparty Delegation Policy",
      legalEntityId,
      createdByUserId,
      createdByUserId,
    ]
  );
  const policyId = toNumber(policyRes.rows?.insertId);
  assert(policyId > 0, "Failed to insert PR-5D approval policy");

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
     ) VALUES (?, ?, 1, 'cari.request.review', 'REQUEST_SCOPE', NULL, 2, 0, NULL)`,
    [tenantId, policyId]
  );

  return policyId;
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createTenantFixture(stamp);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash("PR5D#Delegation123", 10);
  const requesterUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5d_requester_${stamp}@example.com`,
    name: "PR5D Requester",
    passwordHash,
  });
  const delegatorUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5d_delegator_${stamp}@example.com`,
    name: "PR5D Delegator",
    passwordHash,
  });
  const delegateAUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5d_delegate_a_${stamp}@example.com`,
    name: "PR5D Delegate A",
    passwordHash,
  });
  const delegateBUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5d_delegate_b_${stamp}@example.com`,
    name: "PR5D Delegate B",
    passwordHash,
  });
  const wrongScopeDelegateUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5d_delegate_wrong_${stamp}@example.com`,
    name: "PR5D Wrong Scope Delegate",
    passwordHash,
  });
  const directApproverUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5d_direct_${stamp}@example.com`,
    name: "PR5D Direct Approver",
    passwordHash,
  });

  const scopedRoleCode = await createScopedReviewRole(fixture.tenantId, stamp);
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: delegatorUserId,
    roleCode: scopedRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.operatingUnitId,
  });
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: directApproverUserId,
    roleCode: scopedRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.operatingUnitId,
  });

  const policyId = await insertDelegationPolicyFixture({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    createdByUserId: requesterUserId,
  });

  const delegationA = await createApprovalDelegation({
    tenantId: fixture.tenantId,
    delegatorUserId,
    delegateUserId: delegateAUserId,
    moduleCode: "CARI",
    scopeType: "LEGAL_ENTITY",
    scopeId: fixture.legalEntityId,
    createdByUserId: delegatorUserId,
    note: "Primary delegate",
  });
  assert(toNumber(delegationA?.id) > 0, "Primary approval delegation should be created");

  const delegationB = await createApprovalDelegation({
    tenantId: fixture.tenantId,
    delegatorUserId,
    delegateUserId: delegateBUserId,
    moduleCode: "CARI",
    scopeType: "LEGAL_ENTITY",
    scopeId: fixture.legalEntityId,
    createdByUserId: delegatorUserId,
    note: "Secondary delegate",
  });
  assert(toNumber(delegationB?.id) > 0, "Secondary approval delegation should be created");

  await createApprovalDelegation({
    tenantId: fixture.tenantId,
    delegatorUserId,
    delegateUserId: wrongScopeDelegateUserId,
    moduleCode: "CARI",
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.otherOperatingUnitId,
    createdByUserId: delegatorUserId,
    note: "Wrong OU delegate",
  });

  const submitRes = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9801,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `PR5D_REQ1_${stamp}`,
    }
  );
  const requestId = toNumber(submitRes.item?.id);
  assert(requestId > 0, "Delegation test request should be created");

  const resolvedDelegation = await resolveApprovalDelegation({
    tenantId: fixture.tenantId,
    actingUserId: delegateAUserId,
    moduleCode: "CARI",
    permissionCode: "cari.request.review",
    requestScope: {
      scopeType: "OPERATING_UNIT",
      scopeId: fixture.operatingUnitId,
    },
  });
  assert(
    toNumber(resolvedDelegation?.id) === toNumber(delegationA?.id),
    "Delegate A should resolve to the matching approval delegation"
  );

  const noWrongScopeDelegation = await resolveApprovalDelegation({
    tenantId: fixture.tenantId,
    actingUserId: wrongScopeDelegateUserId,
    moduleCode: "CARI",
    permissionCode: "cari.request.review",
    requestScope: {
      scopeType: "OPERATING_UNIT",
      scopeId: fixture.operatingUnitId,
    },
  });
  assert(
    noWrongScopeDelegation === null,
    "Wrong-scope delegate should not resolve for the request scope"
  );

  const delegatedApprove = await recordDecision(
    requestId,
    delegateAUserId,
    "APPROVE",
    "Delegate A approved on behalf of delegator"
  );
  assert(
    String(delegatedApprove.item?.requestStatus || "").toUpperCase() === "PENDING_REVIEW",
    "One delegated approval should not finish the two-approval step"
  );

  const decisionRows = await query(
    `SELECT acting_user_id, delegator_user_id, delegation_id, reviewer_authority_user_id
       FROM approval_decisions
      WHERE tenant_id = ?
        AND request_id = ?
      ORDER BY id ASC`,
    [fixture.tenantId, requestId]
  );
  assert((decisionRows.rows || []).length === 1, "Delegated approval should create one decision row");
  const decisionRow = decisionRows.rows[0];
  assert(
    toNumber(decisionRow.acting_user_id) === delegateAUserId,
    "Decision should record the human acting user"
  );
  assert(
    toNumber(decisionRow.delegator_user_id) === delegatorUserId,
    "Decision should record the delegated authority source"
  );
  assert(
    toNumber(decisionRow.delegation_id) === toNumber(delegationA?.id),
    "Decision should record the delegation id"
  );
  assert(
    toNumber(decisionRow.reviewer_authority_user_id) === delegatorUserId,
    "Decision authority should collapse to the delegator for threshold counting"
  );

  await expectFailure(
    () =>
      recordDecision(
        requestId,
        delegateBUserId,
        "APPROVE",
        "Second delegate should not count twice for same delegator"
      ),
    { status: 409, includes: "delegated authority" }
  );

  const finalApprove = await recordDecision(
    requestId,
    directApproverUserId,
    "APPROVE",
    "Direct reviewer approved"
  );
  assert(
    String(finalApprove.item?.requestStatus || "").toUpperCase() === "APPROVED",
    "Direct second approval should finalize the request"
  );

  const delegatorSubmitRes = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9802,
    { tenantId: fixture.tenantId, userId: delegatorUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `PR5D_REQ2_${stamp}`,
    }
  );
  const delegatorRequestId = toNumber(delegatorSubmitRes.item?.id);
  assert(delegatorRequestId > 0, "Delegator-submitted request should be created");

  await expectFailure(
    () =>
      recordDecision(
        delegatorRequestId,
        delegateAUserId,
        "APPROVE",
        "Delegate should not bypass delegator maker-checker conflict"
      ),
    { status: 403, includes: "Maker-checker violation" }
  );

  const revokeRes = await revokeApprovalDelegation(delegationA.id, {
    tenantId: fixture.tenantId,
    revokedByUserId: delegatorUserId,
    revokedReason: "Delegation window ended",
  });
  assert(revokeRes.idempotent === false, "Revocation should deactivate the active delegation");

  const revokedSubmitRes = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9803,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `PR5D_REQ3_${stamp}`,
    }
  );
  const revokedRequestId = toNumber(revokedSubmitRes.item?.id);
  assert(revokedRequestId > 0, "Post-revoke request should be created");

  await expectFailure(
    () =>
      recordDecision(
        revokedRequestId,
        delegateAUserId,
        "APPROVE",
        "Revoked delegate should no longer approve"
      ),
    { status: 403, includes: "Missing permission" }
  );

  console.log(
    "PR-5D approval delegation checks passed (scope + SoD + audit + revocation)."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
