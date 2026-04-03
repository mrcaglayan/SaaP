import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import { runOneAvailableJob } from "../src/services/jobs.service.js";
import { recordDecision, submitRequest } from "../src/services/approval.engine.service.js";
import {
  listTenantIdsWithOverdueApprovalEscalations,
  sweepDueApprovalEscalations,
} from "../src/services/approval.escalation.service.js";
import { enqueueDueApprovalEscalationJobs } from "../src/jobs/approval-escalation.job.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function createTenantFixture(stamp) {
  const tenantCode = `PR5C_T_${stamp}`;
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
    tenantCode,
    `PR5C Tenant ${stamp}`,
  ]);
  const tenantRows = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantRows.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to create PR-5C tenant");

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
    [tenantId, `PR5C_G_${stamp}`, `PR5C Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR5C_G_${stamp}`]
  );
  const groupId = toNumber(groupRows.rows?.[0]?.id);
  assert(groupId > 0, "Failed to create PR-5C group");

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
      `PR5C_LE_${stamp}`,
      `PR5C Legal Entity ${stamp}`,
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
    [tenantId, `PR5C_LE_${stamp}`]
  );
  const legalEntityId = toNumber(entityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create PR-5C legal entity");

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
      `PR5C_OU_${stamp}`,
      `PR5C OU ${stamp}`,
    ]
  );
  const ouRows = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const operatingUnitId = toNumber(ouRows.rows?.[0]?.id);
  assert(operatingUnitId > 0, "Failed to create PR-5C operating unit");

  return {
    tenantId,
    legalEntityId,
    operatingUnitId,
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
  const roleCode = `PR5C_REVIEW_${stamp}`;
  await query(
    `INSERT INTO roles (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, roleCode, `PR5C Review ${stamp}`]
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

async function insertEscalationPolicyFixture({
  tenantId,
  legalEntityId,
  createdByUserId,
}) {
  const policyCode = `PR5C_POLICY_${Date.now()}`;
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
      policyCode,
      "PR5C Escalation Policy",
      legalEntityId,
      createdByUserId,
      createdByUserId,
    ]
  );
  const policyId = toNumber(policyRes.rows?.insertId);
  assert(policyId > 0, "Failed to insert PR-5C approval policy");

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
       escalation_after_hours,
       escalation_target_scope_mode,
       escalation_max_count
     ) VALUES (?, ?, 1, 'cari.request.review', 'TARGET_OPERATING_UNIT', NULL, 1, 0, 1, 'TARGET_LEGAL_ENTITY', 1)`,
    [tenantId, policyId]
  );

  return policyId;
}

async function countEscalationEvents({ tenantId, requestId }) {
  const result = await query(
    `SELECT COUNT(*) AS total
       FROM approval_escalation_events
      WHERE tenant_id = ?
        AND request_id = ?`,
    [tenantId, requestId]
  );
  return toNumber(result.rows?.[0]?.total);
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createTenantFixture(stamp);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash("PR5C#Escalation123", 10);
  const requesterUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5c_requester_${stamp}@example.com`,
    name: "PR5C Requester",
    passwordHash,
  });
  const ouReviewerUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5c_ou_${stamp}@example.com`,
    name: "PR5C OU Reviewer",
    passwordHash,
  });
  const entityReviewerUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr5c_entity_${stamp}@example.com`,
    name: "PR5C Entity Reviewer",
    passwordHash,
  });

  const scopedRoleCode = await createScopedReviewRole(fixture.tenantId, stamp);
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: ouReviewerUserId,
    roleCode: scopedRoleCode,
    scopeType: "OPERATING_UNIT",
    scopeId: fixture.operatingUnitId,
  });
  await assignRoleAtScope({
    tenantId: fixture.tenantId,
    userId: entityReviewerUserId,
    roleCode: scopedRoleCode,
    scopeType: "LEGAL_ENTITY",
    scopeId: fixture.legalEntityId,
  });

  const policyId = await insertEscalationPolicyFixture({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    createdByUserId: requesterUserId,
  });

  const submitRes1 = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9501,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `PR5C_REQ1_${stamp}`,
    }
  );
  const requestId1 = toNumber(submitRes1.item?.id);
  assert(requestId1 > 0, "First approval request should be created");

  await query(
    `UPDATE approval_requests
        SET last_activity_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)
      WHERE tenant_id = ?
        AND id = ?`,
    [fixture.tenantId, requestId1]
  );

  const dueTenants = await listTenantIdsWithOverdueApprovalEscalations({
    tenantId: fixture.tenantId,
  });
  assert(
    dueTenants.includes(fixture.tenantId),
    "Due tenant lookup should include the PR-5C tenant before escalation"
  );

  const sweepRes = await sweepDueApprovalEscalations({
    tenantId: fixture.tenantId,
    limit: 10,
  });
  assert(sweepRes.scannedRequests >= 1, "Escalation sweep should scan at least one request");
  assert(sweepRes.escalatedRequests === 1, "Escalation sweep should escalate one request");
  assert(sweepRes.notificationCount === 1, "Escalation sweep should notify one reviewer");

  const requestRows1 = await query(
    `SELECT request_status
       FROM approval_requests
      WHERE tenant_id = ?
        AND id = ?`,
    [fixture.tenantId, requestId1]
  );
  assert(
    String(requestRows1.rows?.[0]?.request_status || "").toUpperCase() === "ESCALATED",
    "Escalation sweep should mark the request ESCALATED"
  );

  const escalationEventRows1 = await query(
    `SELECT step_no, escalation_no, target_scope_type, target_scope_id, notified_user_count
       FROM approval_escalation_events
      WHERE tenant_id = ?
        AND request_id = ?
      ORDER BY id ASC`,
    [fixture.tenantId, requestId1]
  );
  assert(
    (escalationEventRows1.rows || []).length === 1,
    "First request should have exactly one escalation event"
  );
  const escalationEvent1 = escalationEventRows1.rows[0];
  assert(
    String(escalationEvent1.target_scope_type || "").toUpperCase() === "LEGAL_ENTITY",
    "Escalation target scope should widen to LEGAL_ENTITY"
  );
  assert(
    toNumber(escalationEvent1.target_scope_id) === fixture.legalEntityId,
    "Escalation target scope id should match the legal entity"
  );
  assert(
    toNumber(escalationEvent1.notified_user_count) === 1,
    "Escalation event should record the notified reviewer count"
  );

  const notificationRows1 = await query(
    `SELECT user_id, notification_type, source_ref_type, source_ref_id
       FROM in_app_notifications
      WHERE tenant_id = ?
        AND source_ref_type = 'APPROVAL_REQUEST'
        AND source_ref_id = ?
      ORDER BY id ASC`,
    [fixture.tenantId, requestId1]
  );
  assert(
    (notificationRows1.rows || []).length === 1,
    "Escalation should create one in-app notification"
  );
  assert(
    toNumber(notificationRows1.rows[0].user_id) === entityReviewerUserId,
    "Escalation should notify the legal-entity reviewer"
  );
  assert(
    String(notificationRows1.rows[0].notification_type || "") === "APPROVAL_REQUEST_ESCALATED",
    "Escalation notification type should be APPROVAL_REQUEST_ESCALATED"
  );

  const approveRes = await recordDecision(
    requestId1,
    entityReviewerUserId,
    "APPROVE",
    "Escalated entity reviewer approved"
  );
  assert(
    String(approveRes.item?.requestStatus || "").toUpperCase() === "APPROVED",
    "Escalated request should remain reviewable and approvable"
  );

  const submitRes2 = await submitRequest(
    policyId,
    "COUNTERPARTY_REQUEST",
    9502,
    { tenantId: fixture.tenantId, userId: requesterUserId },
    {
      legalEntityId: fixture.legalEntityId,
      operatingUnitId: fixture.operatingUnitId,
      idempotencyKey: `PR5C_REQ2_${stamp}`,
    }
  );
  const requestId2 = toNumber(submitRes2.item?.id);
  assert(requestId2 > 0, "Second approval request should be created");

  await query(
    `UPDATE approval_requests
        SET last_activity_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)
      WHERE tenant_id = ?
        AND id = ?`,
    [fixture.tenantId, requestId2]
  );

  const enqueueRes = await enqueueDueApprovalEscalationJobs({
    tenantId: fixture.tenantId,
    limit: 10,
  });
  assert(enqueueRes.queued_jobs === 1, "Scheduler should queue one escalation job");
  assert(enqueueRes.idempotent_hits === 0, "First scheduler tick should not be idempotent");

  const workerRes = await runOneAvailableJob({
    workerId: `pr5c-worker:${process.pid}`,
    tenantId: fixture.tenantId,
    queueNames: ["ops.approvals.escalation"],
  });
  assert(workerRes.ok === true, "Queued approval escalation job should succeed");

  const requestRows2 = await query(
    `SELECT request_status
       FROM approval_requests
      WHERE tenant_id = ?
        AND id = ?`,
    [fixture.tenantId, requestId2]
  );
  assert(
    String(requestRows2.rows?.[0]?.request_status || "").toUpperCase() === "ESCALATED",
    "Queued job should escalate the second request"
  );

  await query(
    `UPDATE approval_requests
        SET last_activity_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)
      WHERE tenant_id = ?
        AND id = ?`,
    [fixture.tenantId, requestId2]
  );

  const secondSweepRes = await sweepDueApprovalEscalations({
    tenantId: fixture.tenantId,
    limit: 10,
  });
  assert(
    secondSweepRes.escalatedRequests === 0,
    "Max escalation count should prevent a second escalation for the same request step"
  );
  assert(
    (await countEscalationEvents({ tenantId: fixture.tenantId, requestId: requestId2 })) === 1,
    "Second request should still have only one escalation event"
  );

  console.log(
    "PR-5C approval escalation engine checks passed (sweep + notifications + queued job)."
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
