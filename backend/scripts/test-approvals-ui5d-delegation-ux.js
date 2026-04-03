import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import meRouter from "../src/routes/me.js";
import approvalsRouter from "../src/routes/approvalPolicies.routes.js";
import {
  createApprovalDelegation,
  listUserApprovalDelegations,
  revokeApprovalDelegation,
} from "../src/services/approval.delegation.service.js";
import {
  getApprovalRequestDelegationPreview,
  submitRequest,
} from "../src/services/approval.engine.service.js";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dayOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createTenantFixture(stamp) {
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
    `UI5D_T_${stamp}`,
    `UI5D Tenant ${stamp}`,
  ]);
  const tenantRows = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [`UI5D_T_${stamp}`]
  );
  const tenantId = toNumber(tenantRows.rows?.[0]?.id);
  assert(tenantId > 0, "Tenant fixture should exist");

  const countryRows = await query(
    `SELECT id, default_currency_code
       FROM countries
      WHERE iso2 = 'TR'
      LIMIT 1`
  );
  const countryId = toNumber(countryRows.rows?.[0]?.id);
  const currencyCode = String(countryRows.rows?.[0]?.default_currency_code || "TRY");
  assert(countryId > 0, "TR country fixture should exist");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `UI5D_G_${stamp}`, `UI5D Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `UI5D_G_${stamp}`]
  );
  const groupId = toNumber(groupRows.rows?.[0]?.id);
  assert(groupId > 0, "Group fixture should exist");

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
      `UI5D_LE_${stamp}`,
      `UI5D Legal Entity ${stamp}`,
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
    [tenantId, `UI5D_LE_${stamp}`]
  );
  const legalEntityId = toNumber(entityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Legal entity fixture should exist");

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
    [tenantId, legalEntityId, `UI5D_OU_${stamp}`, `UI5D OU ${stamp}`]
  );
  const unitRows = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const operatingUnitId = toNumber(unitRows.rows?.[0]?.id);
  assert(operatingUnitId > 0, "Operating unit fixture should exist");

  return {
    tenantId,
    legalEntityId,
    operatingUnitId,
  };
}

async function createUser({ tenantId, email, name }) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, "x", name]
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
  assert(userId > 0, `User ${email} should exist`);
  return userId;
}

async function createScopedReviewRole(tenantId, stamp) {
  const roleCode = `UI5D_REVIEW_${stamp}`;
  await query(
    `INSERT INTO roles (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, roleCode, `UI5D Review ${stamp}`]
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
  assert(roleId > 0, "Scoped review role should exist");

  const permissionRows = await query(
    `SELECT id
       FROM permissions
      WHERE code = 'cari.request.review'
      LIMIT 1`
  );
  const permissionId = toNumber(permissionRows.rows?.[0]?.id);
  assert(permissionId > 0, "cari.request.review permission should exist");

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
  assert(roleId > 0, `Role ${roleCode} should exist`);

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

async function insertDelegationPolicyFixture({ tenantId, legalEntityId, createdByUserId }) {
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
     ) VALUES (?, 'CARI', ?, ?, 'COUNTERPARTY_REQUEST', 'CREATE', 1, 'LEGAL_ENTITY', ?, NULL, NULL, 1, 1, 1, 0, 0, NULL, NULL, NULL, NULL, 'cari.request.review', 1, ?, ?)`,
    [
      tenantId,
      `UI5D_POLICY_${Date.now()}`,
      "UI5D Counterparty Review Policy",
      legalEntityId,
      createdByUserId,
      createdByUserId,
    ]
  );
  const policyId = toNumber(policyRes.rows?.insertId);
  assert(policyId > 0, "Approval policy should exist");

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

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createTenantFixture(stamp);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const requesterUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `ui5d-requester-${stamp}@example.com`,
    name: "UI5D Requester",
  });
  const delegatorUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `ui5d-delegator-${stamp}@example.com`,
    name: "UI5D Delegator",
  });
  const activeDelegateUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `ui5d-active-delegate-${stamp}@example.com`,
    name: "UI5D Active Delegate",
  });
  const expiredDelegateUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `ui5d-expired-delegate-${stamp}@example.com`,
    name: "UI5D Expired Delegate",
  });
  const revokedDelegateUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `ui5d-revoked-delegate-${stamp}@example.com`,
    name: "UI5D Revoked Delegate",
  });
  const directReviewerUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `ui5d-direct-reviewer-${stamp}@example.com`,
    name: "UI5D Direct Reviewer",
  });
  const outsiderUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `ui5d-outsider-${stamp}@example.com`,
    name: "UI5D Outsider",
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
    userId: directReviewerUserId,
    roleCode: scopedRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.operatingUnitId,
  });

  const policyId = await insertDelegationPolicyFixture({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    createdByUserId: requesterUserId,
  });

  const activeDelegation = await createApprovalDelegation({
    tenantId: fixture.tenantId,
    delegatorUserId,
    delegateUserId: activeDelegateUserId,
    moduleCode: "CARI",
    scopeType: "LEGAL_ENTITY",
    scopeId: fixture.legalEntityId,
    effectiveFrom: dayOffset(-1),
    effectiveTo: dayOffset(7),
    createdByUserId: delegatorUserId,
    note: "Active incoming delegation",
  });
  const expiredDelegation = await createApprovalDelegation({
    tenantId: fixture.tenantId,
    delegatorUserId,
    delegateUserId: expiredDelegateUserId,
    moduleCode: "CARI",
    scopeType: "LEGAL_ENTITY",
    scopeId: fixture.legalEntityId,
    effectiveFrom: dayOffset(-10),
    effectiveTo: dayOffset(-2),
    createdByUserId: delegatorUserId,
    note: "Expired incoming delegation",
  });
  const revokedDelegation = await createApprovalDelegation({
    tenantId: fixture.tenantId,
    delegatorUserId,
    delegateUserId: revokedDelegateUserId,
    moduleCode: "CARI",
    scopeType: "LEGAL_ENTITY",
    scopeId: fixture.legalEntityId,
    effectiveFrom: dayOffset(-3),
    effectiveTo: dayOffset(3),
    createdByUserId: delegatorUserId,
    note: "Revoked incoming delegation",
  });
  await revokeApprovalDelegation(revokedDelegation.id, {
    tenantId: fixture.tenantId,
    revokedByUserId: delegatorUserId,
    revokedReason: "UI-5D revoke verification",
  });

  const submitRes = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    5401,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `UI5D_REQ_${stamp}`,
    }
  );
  const requestId = toNumber(submitRes.item?.id);
  assert(requestId > 0, "Approval request should exist");

  const delegatedPreview = await getApprovalRequestDelegationPreview(
    requestId,
    activeDelegateUserId
  );
  assert.equal(delegatedPreview.authorityMode, "DELEGATED");
  assert.equal(toNumber(delegatedPreview.delegation?.id), toNumber(activeDelegation.id));
  assert.equal(delegatedPreview.delegation?.delegatorUserName, "UI5D Delegator");

  const directPreview = await getApprovalRequestDelegationPreview(
    requestId,
    directReviewerUserId
  );
  assert.equal(directPreview.authorityMode, "DIRECT");

  const noAuthorityPreview = await getApprovalRequestDelegationPreview(
    requestId,
    outsiderUserId
  );
  assert.equal(noAuthorityPreview.authorityMode, "NONE");

  const delegatorDelegations = await listUserApprovalDelegations({
    tenantId: fixture.tenantId,
    userId: delegatorUserId,
  });
  assert.equal((delegatorDelegations.outgoing || []).length, 3);
  assert(
    (delegatorDelegations.outgoing || []).some((row) => row.state === "ACTIVE"),
    "Outgoing delegations should include an active row"
  );
  assert(
    (delegatorDelegations.outgoing || []).some((row) => row.state === "EXPIRED"),
    "Outgoing delegations should include an expired row"
  );
  assert(
    (delegatorDelegations.outgoing || []).some((row) => row.state === "REVOKED"),
    "Outgoing delegations should include a revoked row"
  );

  const activeDelegateDelegations = await listUserApprovalDelegations({
    tenantId: fixture.tenantId,
    userId: activeDelegateUserId,
  });
  assert.equal((activeDelegateDelegations.incoming || []).length, 1);
  assert.equal(activeDelegateDelegations.incoming?.[0]?.delegatorUserName, "UI5D Delegator");
  assert.equal(activeDelegateDelegations.incoming?.[0]?.state, "ACTIVE");

  const meDelegationsRoute = (meRouter.stack || []).find(
    (layer) => layer?.route?.path === "/delegations" && layer.route.methods?.get
  );
  assert(meDelegationsRoute, "ME router should expose GET /delegations");

  const delegationPreviewRoute = (approvalsRouter.stack || []).find(
    (layer) =>
      layer?.route?.path === "/requests/:requestId/delegation-preview" &&
      layer.route.methods?.get
  );
  assert(
    delegationPreviewRoute,
    "Approvals router should expose GET /requests/:requestId/delegation-preview"
  );

  console.log("UI-5D delegation UX seams verified.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
