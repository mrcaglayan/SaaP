import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import router from "../src/routes/rbac.js";
import { seedCore } from "../src/seedCore.js";
import {
  buildComplianceAuditReport,
  buildComplianceAuditReportCsv,
} from "../src/services/rbac.auditReport.service.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadRoleIdByCode(tenantId, roleCode) {
  const result = await query(
    `SELECT id
       FROM roles
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, roleCode]
  );
  return parsePositiveInt(result.rows?.[0]?.id);
}

async function createRoleWithPermissions(tenantId, roleCode, permissionCodes) {
  await query(
    `INSERT INTO roles (tenant_id, code, name, is_system)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [tenantId, roleCode, roleCode]
  );

  const roleId = await loadRoleIdByCode(tenantId, roleCode);
  assert(roleId, `Role ${roleCode} must exist`);

  await query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

  const permissionResult = await query(
    `SELECT id, code
       FROM permissions
      WHERE code IN (${permissionCodes.map(() => "?").join(", ")})`,
    permissionCodes
  );
  assert.equal(
    (permissionResult.rows || []).length,
    permissionCodes.length,
    `Expected all requested permissions for ${roleCode}`
  );

  for (const row of permissionResult.rows || []) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES (?, ?)`,
      [roleId, row.id]
    );
  }

  return roleId;
}

async function assignRole({
  tenantId,
  userId,
  roleId,
  scopeType,
  scopeId,
  effect = "ALLOW",
}) {
  await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
      )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, userId, roleId, scopeType, scopeId, effect]
  );
}

function findRouteLayer(method, path) {
  return router.stack.find(
    (layer) => layer?.route?.path === path && layer.route.methods?.[method.toLowerCase()]
  );
}

async function invokeRoute(layer, reqOverrides = {}) {
  assert(layer, "Route layer is required");

  const req = {
    method: "GET",
    path: layer.route.path,
    originalUrl: layer.route.path,
    headers: {},
    query: {},
    body: {},
    ...reqOverrides,
  };

  let settled = false;
  let resolveResponse;
  let rejectResponse;
  const completion = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      if (!settled) {
        settled = true;
        resolveResponse({ req, res: this });
      }
      return this;
    },
    send(payload) {
      this.body = payload;
      if (!settled) {
        settled = true;
        resolveResponse({ req, res: this });
      }
      return this;
    },
  };

  const stack = layer.route.stack || [];
  let index = 0;

  const next = (err) => {
    if (err) {
      if (!settled) {
        settled = true;
        rejectResponse(err);
      }
      return;
    }

    const currentLayer = stack[index++];
    if (!currentLayer) {
      if (!settled) {
        settled = true;
        resolveResponse({ req, res });
      }
      return;
    }

    try {
      const maybePromise = currentLayer.handle(req, res, next);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.catch((error) => {
          if (!settled) {
            settled = true;
            rejectResponse(error);
          }
        });
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        rejectResponse(error);
      }
    }
  };

  next();
  return completion;
}

async function main() {
  const uniqueSuffix = Date.now();
  const asOfDate = new Date().toISOString().slice(0, 10);

  await seedCore();

  const countryResult = await query(
    `SELECT id, default_currency_code
       FROM countries
      ORDER BY id
      LIMIT 1`
  );
  const countryId = parsePositiveInt(countryResult.rows?.[0]?.id);
  const currencyCode = String(countryResult.rows?.[0]?.default_currency_code || "USD");
  assert(countryId, "Expected one seeded country");

  const tenantInsert = await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [`PR5E_${uniqueSuffix}`, `PR5E Tenant ${uniqueSuffix}`]
  );
  const tenantId = parsePositiveInt(tenantInsert.rows?.insertId);
  assert(tenantId, "Expected tenant insert id");

  await seedCore();

  const groupInsert = await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `GRP${uniqueSuffix}`, "PR5E Group"]
  );
  const groupCompanyId = parsePositiveInt(groupInsert.rows?.insertId);
  assert(groupCompanyId, "Expected group company id");

  const legalEntityInsert = await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
      )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      groupCompanyId,
      `LE${uniqueSuffix}`,
      "PR5E Legal Entity",
      countryId,
      currencyCode,
    ]
  );
  const legalEntityId = parsePositiveInt(legalEntityInsert.rows?.insertId);
  assert(legalEntityId, "Expected legal entity id");

  const auditorInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr5e-auditor-${uniqueSuffix}@example.com`, "x", "PR5E Auditor"]
  );
  const subjectInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr5e-subject-${uniqueSuffix}@example.com`, "x", "PR5E Subject"]
  );
  const delegateInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr5e-delegate-${uniqueSuffix}@example.com`, "x", "PR5E Delegate"]
  );
  const auditorUserId = parsePositiveInt(auditorInsert.rows?.insertId);
  const subjectUserId = parsePositiveInt(subjectInsert.rows?.insertId);
  const delegateUserId = parsePositiveInt(delegateInsert.rows?.insertId);
  assert(auditorUserId && subjectUserId && delegateUserId, "Expected test users");

  const auditorRoleId = await loadRoleIdByCode(tenantId, "AuditorReadOnly");
  assert(auditorRoleId, "AuditorReadOnly role must be seeded");
  await assignRole({
    tenantId,
    userId: auditorUserId,
    roleId: auditorRoleId,
    scopeType: "TENANT",
    scopeId: tenantId,
  });

  const creatorRoleId = await createRoleWithPermissions(tenantId, "PR5E_PAYMENTS_CREATE", [
    "payments.batch.create",
  ]);
  const approverRoleId = await createRoleWithPermissions(tenantId, "PR5E_PAYMENTS_APPROVE", [
    "payments.batch.approve",
  ]);

  await assignRole({
    tenantId,
    userId: subjectUserId,
    roleId: creatorRoleId,
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  });
  await assignRole({
    tenantId,
    userId: subjectUserId,
    roleId: approverRoleId,
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  });

  const policyInsert = await query(
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
        step_count,
        min_approvals,
        maker_checker_required,
        allow_self_approve,
        auto_execute_on_final_approval,
        approver_permission_code,
        is_active,
        effective_from
      )
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 1, 1, 1, 0, 0, ?, 1, ?)`,
    [
      tenantId,
      "PAYMENTS",
      `PR5E_PAY_BATCH_${uniqueSuffix}`,
      "PR5E Payment Batch Approval",
      "PAYMENT_BATCH",
      "APPROVE",
      "LEGAL_ENTITY",
      legalEntityId,
      "payments.batch.approve",
      asOfDate,
    ]
  );
  const policyId = parsePositiveInt(policyInsert.rows?.insertId);
  assert(policyId, "Expected approval policy id");

  await query(
    `INSERT INTO approval_policy_assignments (
        tenant_id,
        policy_id,
        scope_type,
        scope_id,
        effective_from,
        is_active
      )
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?, 1)`,
    [tenantId, policyId, legalEntityId, asOfDate]
  );

  await query(
    `INSERT INTO approval_policy_steps (
        tenant_id,
        policy_id,
        step_no,
        required_permission_code,
        scope_resolution_mode,
        min_approvals,
        allow_self_approve
      )
     VALUES (?, ?, 1, ?, 'REQUEST_SCOPE', 1, 0)`,
    [tenantId, policyId, "payments.batch.approve"]
  );

  const activeDelegationInsert = await query(
    `INSERT INTO approval_delegations (
        tenant_id,
        delegator_user_id,
        delegate_user_id,
        module_code,
        scope_type,
        scope_id,
        effective_from,
        note,
        is_active,
        created_by_user_id
      )
     VALUES (?, ?, ?, 'PAYMENTS', 'LEGAL_ENTITY', ?, ?, ?, 1, ?)`,
    [
      tenantId,
      subjectUserId,
      delegateUserId,
      legalEntityId,
      asOfDate,
      "PR5E active delegation",
      auditorUserId,
    ]
  );
  const activeDelegationId = parsePositiveInt(activeDelegationInsert.rows?.insertId);
  assert(activeDelegationId, "Expected active delegation id");

  await query(
    `INSERT INTO approval_delegations (
        tenant_id,
        delegator_user_id,
        delegate_user_id,
        module_code,
        scope_type,
        scope_id,
        effective_from,
        effective_to,
        note,
        is_active,
        created_by_user_id
      )
     VALUES (?, ?, ?, 'PAYMENTS', 'LEGAL_ENTITY', ?, DATE_SUB(?, INTERVAL 10 DAY), DATE_SUB(?, INTERVAL 1 DAY), ?, 1, ?)`,
    [
      tenantId,
      subjectUserId,
      delegateUserId,
      legalEntityId,
      asOfDate,
      asOfDate,
      "PR5E expired delegation",
      auditorUserId,
    ]
  );

  const requestInsert = await query(
    `INSERT INTO approval_requests (
        tenant_id,
        request_code,
        policy_id,
        policy_version_no,
        module_code,
        target_type,
        target_id,
        scope_type,
        scope_id,
        legal_entity_id,
        request_status,
        current_step_no,
        execution_status,
        submitted_by_user_id,
        submitted_at,
        approved_at,
        policy_snapshot_json,
        target_snapshot_json,
        last_activity_at
      )
     VALUES (
       ?, ?, ?, 1, 'PAYMENTS', 'PAYMENT_BATCH', ?, 'LEGAL_ENTITY', ?, ?, 'APPROVED', 1, 'NOT_EXECUTED',
       ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, JSON_OBJECT(), JSON_OBJECT(), CURRENT_TIMESTAMP
     )`,
    [tenantId, `PR5E_REQ_${uniqueSuffix}`, policyId, uniqueSuffix, legalEntityId, legalEntityId, subjectUserId]
  );
  const requestId = parsePositiveInt(requestInsert.rows?.insertId);
  assert(requestId, "Expected approval request id");

  await query(
    `INSERT INTO approval_decisions (
        tenant_id,
        request_id,
        step_no,
        decision,
        decided_by_user_id,
        acting_user_id,
        delegator_user_id,
        delegation_id,
        reviewer_authority_user_id,
        comment,
        decided_at
      )
     VALUES (?, ?, 1, 'APPROVE', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      tenantId,
      requestId,
      delegateUserId,
      delegateUserId,
      subjectUserId,
      activeDelegationId,
      subjectUserId,
      "PR5E delegated approval",
    ]
  );

  const fullReport = await buildComplianceAuditReport({
    tenantId,
    reportType: "FULL",
    asOfDate,
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  });
  assert.equal(fullReport.reportType, "FULL");
  assert(fullReport.reports?.accessMatrix, "Expected access matrix report in FULL output");
  assert(fullReport.reports?.sodAnalysis, "Expected SoD report in FULL output");
  assert(fullReport.reports?.approvalCoverage, "Expected approval coverage report in FULL output");
  assert(fullReport.reports?.delegationLog, "Expected delegation log report in FULL output");

  const accessMatrix = fullReport.reports.accessMatrix;
  const subjectMatrixRow = (accessMatrix.matrix || []).find((row) => row.userId === subjectUserId);
  assert(subjectMatrixRow, "Access matrix must include subject user");
  assert(
    (subjectMatrixRow.effectivePermissions || []).some(
      (permission) => permission.code === "payments.batch.approve"
    ),
    "Access matrix must include scoped effective approval permission"
  );
  assert(
    (subjectMatrixRow.activeDelegations || []).some((delegation) => delegation.relation === "OUTGOING"),
    "Access matrix must include outgoing active delegation"
  );

  const sodAnalysis = fullReport.reports.sodAnalysis;
  assert(
    (sodAnalysis.conflicts || []).some(
      (conflict) => conflict.userId === subjectUserId && conflict.conflictRule?.code === "payments.batch.create-approve.same-record"
    ),
    "SoD analysis must surface the payment batch maker-checker conflict"
  );

  const approvalCoverage = fullReport.reports.approvalCoverage;
  assert(
    (approvalCoverage.coveredActions || []).some(
      (action) =>
        action.moduleCode === "PAYMENTS" &&
        action.targetType === "PAYMENT_BATCH" &&
        action.actionType === "APPROVE"
    ),
    "Approval coverage must include the seeded payment batch approval policy"
  );
  assert(
    (approvalCoverage.uncoveredActions || []).length > 0,
    "Approval coverage must keep uncovered actions visible for audit"
  );

  const delegationLog = fullReport.reports.delegationLog;
  assert.equal(delegationLog.summary.activeDelegations, 1);
  assert.equal(delegationLog.summary.expiredDelegations, 1);
  assert.equal(delegationLog.summary.delegatedDecisionCount, 1);
  assert(
    (delegationLog.delegations || []).some(
      (delegation) =>
        delegation.id === activeDelegationId && Number(delegation.decisionsActedOn || 0) === 1
    ),
    "Delegation log must link delegated decisions back to the active delegation row"
  );

  const csvPayload = await buildComplianceAuditReportCsv({
    tenantId,
    reportType: "DELEGATION_LOG",
    asOfDate,
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityId,
  });
  assert(String(csvPayload.fileName || "").endsWith(".csv"), "CSV export must produce a csv file name");
  assert.equal(Number(csvPayload.rowCount || 0), 2);
  assert(
    String(csvPayload.csv || "").includes("delegation_id,delegator_name,delegate_name"),
    "CSV export must include delegation log headers"
  );
  assert(
    String(csvPayload.csv || "").includes(`PR5E_REQ_${uniqueSuffix}`),
    "CSV export must include delegated request codes"
  );

  const auditReportsRoute = findRouteLayer("post", "/audit-reports");
  const exportRoute = findRouteLayer("get", "/audit-reports/export.csv");
  assert(auditReportsRoute, "RBAC router must expose POST /audit-reports");
  assert(exportRoute, "RBAC router must expose GET /audit-reports/export.csv");

  const jsonRouteResult = await invokeRoute(auditReportsRoute, {
    method: "POST",
    user: { userId: auditorUserId, tenantId },
    body: {
      reportType: "SOD_ANALYSIS",
      asOfDate,
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
    },
  });
  assert.equal(jsonRouteResult.res.statusCode, 200);
  assert.equal(jsonRouteResult.res.body?.reportType, "SOD_ANALYSIS");
  assert(
    (jsonRouteResult.res.body?.report?.conflicts || []).length > 0,
    "POST /audit-reports must return SoD conflicts"
  );

  const csvRouteResult = await invokeRoute(exportRoute, {
    method: "GET",
    user: { userId: auditorUserId, tenantId },
    query: {
      reportType: "APPROVAL_COVERAGE",
      asOfDate,
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
    },
  });
  assert.equal(csvRouteResult.res.statusCode, 200);
  assert.equal(csvRouteResult.res.headers["content-type"], "text/csv; charset=utf-8");
  assert(
    String(csvRouteResult.res.headers["content-disposition"] || "").includes(".csv"),
    "GET /audit-reports/export.csv must send a downloadable csv filename"
  );
  assert(
    String(csvRouteResult.res.body || "").includes("coverage_status,module_code,target_type"),
    "CSV route must return coverage csv content"
  );
}

main()
  .then(async () => {
    await closePool();
    console.log("PR-5E compliance audit report package test passed");
  })
  .catch(async (error) => {
    console.error(error?.stack || error);
    await closePool();
    process.exit(1);
  });
