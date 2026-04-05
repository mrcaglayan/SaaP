import { query, withTransaction } from "../db.js";
import { logRbacAuditEvent } from "../audit/rbacAuditLogger.js";
import { buildScopeFilter, invalidateRbacCache } from "../middleware/rbac.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import {
  registerApprovalExecutionResolver,
  submitRequest,
} from "./approval.engine.service.js";
import {
  LOCAL_OPERATIONAL_ROLE_CODES,
  getLocalOperationalRoleConfig,
  normalizeLocalOperationalRoleCode,
  normalizeLocalOperationalRoleScopeType,
} from "./localOperationalRoles.service.js";
const OPERATIONAL_COVERAGE_MODULE_CODE = "SECURITY";
const OPERATIONAL_COVERAGE_TARGET_TYPE = "OPERATIONAL_ROLE_COVERAGE";
const OPERATIONAL_COVERAGE_ACTION_TYPE = "ACTIVATE";
const OPERATIONAL_COVERAGE_POLICY_CODE =
  "SECURITY_OPERATIONAL_ROLE_COVERAGE_ACTIVATE_V1";
const OPERATIONAL_COVERAGE_POLICY_NAME = "Temporary Operational Coverage";
const OPERATIONAL_COVERAGE_APPROVER_PERMISSION =
  "security.operational_coverage.review";
const OPERATIONAL_COVERAGE_RESOLVER_KEY = [
  OPERATIONAL_COVERAGE_MODULE_CODE,
  OPERATIONAL_COVERAGE_TARGET_TYPE,
  OPERATIONAL_COVERAGE_ACTION_TYPE,
].join(":");

let operationalCoverageResolverRegistered = false;

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}
function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}
function parseDateOnly(value, label) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw badRequest(`${label} is required`);
  }
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) {
    throw badRequest(`${label} must be a valid date`);
  }
  return match[0];
}
function parseOptionalDateOnly(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const match = String(value)
    .trim()
    .match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}
function parseStoredJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}
function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}
function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}
function normalizeCoverageState(row, today = todayDateOnly()) {
  const reviewStatus = toUpper(row?.approval_request_status || "");
  const executionStatus = toUpper(
    row?.approval_execution_status || "NOT_EXECUTED",
  );
  if (row?.revoked_at) {
    return "REVOKED";
  }
  if (reviewStatus === "APPROVED" && executionStatus === "EXECUTED") {
    if (today < row.start_date) {
      return "APPROVED";
    }
    if (today > row.end_date) {
      return "EXPIRED";
    }
    return "ACTIVE";
  }
  return "REQUESTED";
}
function normalizeReviewStatus(row) {
  const explicit = toUpper(row?.approval_request_status || "");
  if (explicit) {
    return explicit;
  }
  if (row?.rejected_at) {
    return "REJECTED";
  }
  if (row?.approved_at) {
    return "APPROVED";
  }
  return "PENDING_REVIEW";
}
function mapApprovalRequestSummary(row) {
  const approvalRequestId = parsePositiveInt(row?.approval_request_id);
  if (!approvalRequestId) {
    return null;
  }
  return {
    id: approvalRequestId,
    requestCode: row.approval_request_code || null,
    requestStatus: normalizeReviewStatus(row),
    executionStatus: toUpper(row.approval_execution_status || "NOT_EXECUTED"),
    currentStepNo: Number(row.approval_current_step_no || 1),
    submittedAt: row.approval_submitted_at || null,
    approvedAt: row.approval_request_approved_at || null,
    rejectedAt: row.approval_request_rejected_at || null,
    executedAt: row.approval_request_executed_at || null,
    executionErrorText: row.approval_execution_error_text || null,
  };
}
function mapOperationalCoverageRow(row) {
  if (!row) {
    return null;
  }
  const reviewStatus = normalizeReviewStatus(row);
  const state = normalizeCoverageState(row);
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    approvalRequestId: parsePositiveInt(row.approval_request_id),
    requesterUserId: parsePositiveInt(row.requester_user_id),
    requesterUserName: row.requester_user_name || null,
    requesterUserEmail: row.requester_user_email || null,
    delegateUserId: parsePositiveInt(row.delegate_user_id),
    delegateUserName: row.delegate_user_name || null,
    delegateUserEmail: row.delegate_user_email || null,
    roleId: parsePositiveInt(row.role_id),
    roleCode: row.role_code || null,
    roleName: row.role_name || null,
    scopeType: toUpper(row.scope_type),
    scopeId: parsePositiveInt(row.scope_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    note: row.note || null,
    requestedAt: row.created_at || null,
    approvedByUserId: parsePositiveInt(row.approved_by_user_id),
    approvedByUserName: row.approved_by_user_name || null,
    approvedAt: row.approved_at || null,
    activatedByUserId: parsePositiveInt(row.activated_by_user_id),
    activatedByUserName: row.activated_by_user_name || null,
    activatedAt: row.activated_at || null,
    rejectedByUserId: parsePositiveInt(row.rejected_by_user_id),
    rejectedByUserName: row.rejected_by_user_name || null,
    rejectedAt: row.rejected_at || null,
    revokedByUserId: parsePositiveInt(row.revoked_by_user_id),
    revokedByUserName: row.revoked_by_user_name || null,
    revokedAt: row.revoked_at || null,
    revokedReason: row.revoked_reason || null,
    materializedAssignmentId: parsePositiveInt(row.materialized_assignment_id),
    state,
    reviewStatus,
    isRejected: reviewStatus === "REJECTED",
    approvalRequest: mapApprovalRequestSummary(row),
  };
}
const OPERATIONAL_COVERAGE_SELECT_SQL = `
  SELECT
    orc.*,
    r.code AS role_code,
    r.name AS role_name,
    requester.email AS requester_user_email,
    requester.name AS requester_user_name,
    delegate_u.email AS delegate_user_email,
    delegate_u.name AS delegate_user_name,
    le.code AS legal_entity_code,
    le.name AS legal_entity_name,
    ou.code AS operating_unit_code,
    ou.name AS operating_unit_name,
    approved_by_u.name AS approved_by_user_name,
    activated_by_u.name AS activated_by_user_name,
    rejected_by_u.name AS rejected_by_user_name,
    revoked_by_u.name AS revoked_by_user_name,
    ar.request_code AS approval_request_code,
    ar.request_status AS approval_request_status,
    ar.execution_status AS approval_execution_status,
    ar.current_step_no AS approval_current_step_no,
    ar.submitted_at AS approval_submitted_at,
    ar.approved_at AS approval_request_approved_at,
    ar.rejected_at AS approval_request_rejected_at,
    ar.executed_at AS approval_request_executed_at,
    ar.execution_error_text AS approval_execution_error_text
  FROM operational_role_coverages orc
  JOIN roles r
    ON r.id = orc.role_id
   AND r.tenant_id = orc.tenant_id
  JOIN users requester
    ON requester.id = orc.requester_user_id
   AND requester.tenant_id = orc.tenant_id
  JOIN users delegate_u
    ON delegate_u.id = orc.delegate_user_id
   AND delegate_u.tenant_id = orc.tenant_id
  JOIN legal_entities le
    ON le.id = orc.legal_entity_id
   AND le.tenant_id = orc.tenant_id
  LEFT JOIN operating_units ou
    ON ou.id = orc.operating_unit_id
   AND ou.tenant_id = orc.tenant_id
  LEFT JOIN users approved_by_u
    ON approved_by_u.id = orc.approved_by_user_id
   AND approved_by_u.tenant_id = orc.tenant_id
  LEFT JOIN users activated_by_u
    ON activated_by_u.id = orc.activated_by_user_id
   AND activated_by_u.tenant_id = orc.tenant_id
  LEFT JOIN users rejected_by_u
    ON rejected_by_u.id = orc.rejected_by_user_id
   AND rejected_by_u.tenant_id = orc.tenant_id
  LEFT JOIN users revoked_by_u
    ON revoked_by_u.id = orc.revoked_by_user_id
   AND revoked_by_u.tenant_id = orc.tenant_id
  LEFT JOIN approval_requests ar
    ON ar.id = orc.approval_request_id
   AND ar.tenant_id = orc.tenant_id
`;
async function getRoleByCodeForTenant(roleCode, tenantId, runQuery = query) {
  const result = await runQuery(
    `SELECT id, tenant_id, code, name, is_system
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode],
  );
  return result.rows?.[0] || null;
}
async function resolveDelegateUser({
  tenantId,
  delegateUserId = null,
  delegateEmail = null,
  runQuery = query,
}) {
  const normalizedDelegateUserId = parsePositiveInt(delegateUserId);
  const normalizedDelegateEmail = String(delegateEmail || "")
    .trim()
    .toLowerCase();
  if (!normalizedDelegateUserId && !normalizedDelegateEmail) {
    throw badRequest("delegateUserId or delegateEmail is required");
  }
  const params = [tenantId];
  const where = ["tenant_id = ?"];
  if (normalizedDelegateUserId) {
    where.push("id = ?");
    params.push(normalizedDelegateUserId);
  } else {
    where.push("email = ?");
    params.push(normalizedDelegateEmail);
  }
  const result = await runQuery(
    `SELECT id, tenant_id, email, name, status
     FROM users
     WHERE ${where.join(" AND ")}
     LIMIT 1`,
    params,
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest("Delegate user was not found in this tenant");
  }
  if (toUpper(row.status) !== "ACTIVE") {
    throw badRequest("Delegate user must be ACTIVE");
  }
  return row;
}
async function resolveCoverageScopeBinding(
  tenantId,
  roleCode,
  scopeType,
  scopeId,
) {
  const normalizedRoleCode = normalizeLocalOperationalRoleCode(roleCode);
  const normalizedScopeType = normalizeLocalOperationalRoleScopeType(
    normalizedRoleCode,
    scopeType,
  );
  const normalizedScopeId = parsePositiveInt(scopeId);
  if (!normalizedScopeId) {
    throw badRequest("scopeId must be a positive integer");
  }
  if (normalizedScopeType === "LEGAL_ENTITY") {
    await assertLegalEntityBelongsToTenant(
      tenantId,
      normalizedScopeId,
      "scopeId",
    );
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: normalizedScopeId,
      legalEntityId: normalizedScopeId,
      operatingUnitId: null,
    };
  }
  const operatingUnit = await assertOperatingUnitBelongsToTenant(
    tenantId,
    normalizedScopeId,
    "scopeId",
  );
  return {
    scopeType: "OPERATING_UNIT",
    scopeId: normalizedScopeId,
    legalEntityId: parsePositiveInt(operatingUnit.legal_entity_id),
    operatingUnitId: normalizedScopeId,
  };
}
async function ensureOperationalCoverageApprovalPolicy({
  tenantId,
  runQuery = query,
}) {
  const insertResult = await runQuery(
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
     ) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, 1, 1, 1, 0, 1, NULL, NULL, NULL, NULL, ?, 1, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       policy_name = VALUES(policy_name),
       target_type = VALUES(target_type),
       action_type = VALUES(action_type),
       step_count = VALUES(step_count),
       min_approvals = VALUES(min_approvals),
       maker_checker_required = VALUES(maker_checker_required),
       allow_self_approve = VALUES(allow_self_approve),
       auto_execute_on_final_approval = VALUES(auto_execute_on_final_approval),
       approver_permission_code = VALUES(approver_permission_code),
       is_active = VALUES(is_active),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      tenantId,
      OPERATIONAL_COVERAGE_MODULE_CODE,
      OPERATIONAL_COVERAGE_POLICY_CODE,
      OPERATIONAL_COVERAGE_POLICY_NAME,
      OPERATIONAL_COVERAGE_TARGET_TYPE,
      OPERATIONAL_COVERAGE_ACTION_TYPE,
      OPERATIONAL_COVERAGE_APPROVER_PERMISSION,
    ],
  );
  const policyId = parsePositiveInt(insertResult.rows?.insertId);
  if (!policyId) {
    throw new Error(
      "Failed to resolve operational coverage approval policy id",
    );
  }
  await runQuery(
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
     ) VALUES (?, ?, 1, ?, 'REQUEST_SCOPE', NULL, 1, 0, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       required_permission_code = VALUES(required_permission_code),
       scope_resolution_mode = VALUES(scope_resolution_mode),
       custom_scope_resolver_key = VALUES(custom_scope_resolver_key),
       min_approvals = VALUES(min_approvals),
       allow_self_approve = VALUES(allow_self_approve),
       escalation_after_hours = VALUES(escalation_after_hours),
       escalation_target_scope_mode = VALUES(escalation_target_scope_mode),
       escalation_max_count = VALUES(escalation_max_count)`,
    [tenantId, policyId, OPERATIONAL_COVERAGE_APPROVER_PERMISSION],
  );
  return policyId;
}
async function fetchOperationalCoverageRowById({
  tenantId,
  coverageId,
  runQuery = query,
  forUpdate = false,
}) {
  const normalizedCoverageId = parsePositiveInt(coverageId);
  if (!normalizedCoverageId) {
    return null;
  }
  const result = await runQuery(
    `${OPERATIONAL_COVERAGE_SELECT_SQL}
     WHERE orc.tenant_id = ?
       AND orc.id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, normalizedCoverageId],
  );
  return result.rows?.[0] || null;
}
async function fetchOperationalCoverageRowByApprovalRequestId({
  tenantId,
  approvalRequestId,
  runQuery = query,
  forUpdate = false,
}) {
  const normalizedApprovalRequestId = parsePositiveInt(approvalRequestId);
  if (!normalizedApprovalRequestId) {
    return null;
  }
  const result = await runQuery(
    `${OPERATIONAL_COVERAGE_SELECT_SQL}
     WHERE orc.tenant_id = ?
       AND orc.approval_request_id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, normalizedApprovalRequestId],
  );
  return result.rows?.[0] || null;
}
async function findDecisionActorUserId({
  tenantId,
  requestId,
  decision,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT acting_user_id
     FROM approval_decisions
     WHERE tenant_id = ?
       AND request_id = ?
       AND decision = ?
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, requestId, toUpper(decision)],
  );
  return parsePositiveInt(result.rows?.[0]?.acting_user_id);
}
async function assertOperationalCoverageConflicts({
  tenantId,
  delegateUserId,
  roleId,
  scopeType,
  scopeId,
  startDate,
  endDate,
  runQuery = query,
  ignoreCoverageId = null,
  ignoreAssignmentId = null,
}) {
  const assignmentResult = await runQuery(
    `SELECT id, effect
     FROM user_role_scopes
     WHERE tenant_id = ?
       AND user_id = ?
       AND role_id = ?
       AND scope_type = ?
       AND scope_id = ?
     LIMIT 1`,
    [tenantId, delegateUserId, roleId, scopeType, scopeId],
  );
  const assignmentRow = assignmentResult.rows?.[0] || null;
  const existingAssignmentId = parsePositiveInt(assignmentRow?.id);
  if (
    existingAssignmentId &&
    existingAssignmentId !== parsePositiveInt(ignoreAssignmentId)
  ) {
    throw conflict(
      "Delegate user already has a direct role assignment at this scope and cannot receive overlapping temporary coverage",
    );
  }
  const overlapParams = [
    tenantId,
    delegateUserId,
    roleId,
    scopeType,
    scopeId,
    endDate,
    startDate,
  ];
  const overlapWhere = [
    "tenant_id = ?",
    "delegate_user_id = ?",
    "role_id = ?",
    "scope_type = ?",
    "scope_id = ?",
    "revoked_at IS NULL",
    "rejected_at IS NULL",
    "end_date >= ?",
    "start_date <= ?",
  ];
  const normalizedIgnoreCoverageId = parsePositiveInt(ignoreCoverageId);
  if (normalizedIgnoreCoverageId) {
    overlapWhere.push("id <> ?");
    overlapParams.push(normalizedIgnoreCoverageId);
  }
  const overlapResult = await runQuery(
    `SELECT id
     FROM operational_role_coverages
     WHERE ${overlapWhere.join(" AND ")}
     LIMIT 1`,
    overlapParams,
  );
  if (parsePositiveInt(overlapResult.rows?.[0]?.id)) {
    throw conflict(
      "An overlapping temporary coverage request already exists for this delegate, role, and scope",
    );
  }
}
async function listScopedRoleRows(req, tenantId, runQuery = query) {
  const roleCodes = LOCAL_OPERATIONAL_ROLE_CODES;
  const result = await runQuery(
    `SELECT id, code, name
     FROM roles
     WHERE tenant_id = ?
       AND code IN (${roleCodes.map(() => "?").join(", ")})
     ORDER BY code`,
    [tenantId, ...roleCodes],
  );
  return (result.rows || []).map((row) => ({
    id: parsePositiveInt(row.id),
    code: row.code,
    name: row.name,
    allowedScopeTypes: [
      ...(getLocalOperationalRoleConfig(row.code)?.scopeTypes || []),
    ],
  }));
}
async function listScopedLegalEntities(req, tenantId, runQuery = query) {
  const params = [tenantId];
  const conditions = ["le.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "le.id", params));
  const result = await runQuery(
    `SELECT le.id, le.code, le.name, le.status
     FROM legal_entities le
     WHERE ${conditions.join(" AND ")}
     ORDER BY le.code, le.id`,
    params,
  );
  return result.rows || [];
}
async function listScopedOperatingUnits(req, tenantId, runQuery = query) {
  const params = [tenantId];
  const conditions = ["ou.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "operating_unit", "ou.id", params));
  const result = await runQuery(
    `SELECT
       ou.id,
       ou.code,
       ou.name,
       ou.status,
       ou.legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name
     FROM operating_units ou
     JOIN legal_entities le
       ON le.id = ou.legal_entity_id
      AND le.tenant_id = ou.tenant_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY le.code, ou.code, ou.id`,
    params,
  );
  return result.rows || [];
}

/**
 * Resolve one operational coverage id to its governing scope for route
 * permission guards.
 */
export async function resolveOperationalCoverageScope(coverageId, tenantId) {
  const row = await fetchOperationalCoverageRowById({
    tenantId,
    coverageId,
  });
  if (!row) {
    return null;
  }
  return {
    scopeType: toUpper(row.scope_type),
    scopeId: parsePositiveInt(row.scope_id),
  };
}

/**
 * List one scoped operational coverage workspace payload with the bounded local
 * role catalog, visible scopes, and coverage rows.
 */
export async function getOperationalCoverageWorkspace({
  req,
  tenantId,
  state = null,
  runQuery = query,
}) {
  const roleRows = await listScopedRoleRows(req, tenantId, runQuery);
  const legalEntities = await listScopedLegalEntities(req, tenantId, runQuery);
  const operatingUnits = await listScopedOperatingUnits(
    req,
    tenantId,
    runQuery,
  );
  const rowParams = [tenantId];
  const rowConditions = [
    "orc.tenant_id = ?",
    "(" +
      [
        `(orc.scope_type = 'LEGAL_ENTITY' AND ${buildScopeFilter(
          req,
          "legal_entity",
          "orc.scope_id",
          rowParams,
        )})`,
        `(orc.scope_type = 'OPERATING_UNIT' AND ${buildScopeFilter(
          req,
          "operating_unit",
          "orc.scope_id",
          rowParams,
        )})`,
      ].join(" OR ") +
      ")",
  ];
  const result = await runQuery(
    `${OPERATIONAL_COVERAGE_SELECT_SQL}
     WHERE ${rowConditions.join(" AND ")}
     ORDER BY orc.created_at DESC, orc.id DESC`,
    rowParams,
  );
  let rows = (result.rows || []).map(mapOperationalCoverageRow);
  const normalizedState = toUpper(state || "");
  if (normalizedState) {
    rows = rows.filter(
      (row) =>
        toUpper(row.state) === normalizedState ||
        (normalizedState === "REJECTED" && Boolean(row.isRejected)),
    );
  }
  return {
    tenantId,
    roles: roleRows,
    legalEntities,
    operatingUnits,
    rows,
  };
}

/**
 * Read one operational coverage row with its linked approval summary and
 * derived lifecycle state.
 */
export async function getOperationalCoverageById({
  tenantId,
  coverageId,
  runQuery = query,
}) {
  const row = await fetchOperationalCoverageRowById({
    tenantId,
    coverageId,
    runQuery,
  });
  if (!row) {
    throw notFound("Operational coverage request not found");
  }
  return mapOperationalCoverageRow(row);
}

/**
 * Create one temporary operational coverage request and submit it through the
 * unified approval engine using the dedicated SECURITY coverage policy.
 */
export async function createOperationalCoverageRequest({
  req,
  tenantId,
  requesterUserId,
  delegateUserId = null,
  delegateEmail = null,
  roleCode,
  scopeType,
  scopeId,
  startDate,
  endDate,
  note = null,
}) {
  const normalizedRequesterUserId = parsePositiveInt(requesterUserId);
  if (!normalizedRequesterUserId) {
    throw badRequest("requesterUserId is required");
  }
  const normalizedRoleCode = normalizeLocalOperationalRoleCode(roleCode);
  const normalizedStartDate = parseDateOnly(startDate, "startDate");
  const normalizedEndDate = parseDateOnly(endDate, "endDate");
  if (normalizedEndDate < normalizedStartDate) {
    throw badRequest("endDate must be on or after startDate");
  }
  if (normalizedStartDate < todayDateOnly()) {
    throw badRequest("startDate cannot be in the past");
  }
  const scopeBinding = await resolveCoverageScopeBinding(
    tenantId,
    normalizedRoleCode,
    scopeType,
    scopeId,
  );
  const normalizedNote = String(note || "").trim() || null;
  if (normalizedNote && normalizedNote.length > 255) {
    throw badRequest("note cannot exceed 255 characters");
  }
  const operation = await withTransaction(async (tx) => {
    const role = await getRoleByCodeForTenant(
      normalizedRoleCode,
      tenantId,
      tx.query,
    );
    if (!role) {
      throw badRequest(
        `${normalizedRoleCode} role is not configured for this tenant`,
      );
    }
    const delegateUser = await resolveDelegateUser({
      tenantId,
      delegateUserId,
      delegateEmail,
      runQuery: tx.query,
    });
    await assertOperationalCoverageConflicts({
      tenantId,
      delegateUserId: parsePositiveInt(delegateUser.id),
      roleId: parsePositiveInt(role.id),
      scopeType: scopeBinding.scopeType,
      scopeId: scopeBinding.scopeId,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      runQuery: tx.query,
    });
    const insertResult = await tx.query(
      `INSERT INTO operational_role_coverages (
         tenant_id,
         requester_user_id,
         delegate_user_id,
         role_id,
         scope_type,
         scope_id,
         legal_entity_id,
         operating_unit_id,
         start_date,
         end_date,
         note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        normalizedRequesterUserId,
        parsePositiveInt(delegateUser.id),
        parsePositiveInt(role.id),
        scopeBinding.scopeType,
        scopeBinding.scopeId,
        scopeBinding.legalEntityId,
        scopeBinding.operatingUnitId,
        normalizedStartDate,
        normalizedEndDate,
        normalizedNote,
      ],
    );
    const coverageId = parsePositiveInt(insertResult.rows?.insertId);
    if (!coverageId) {
      throw new Error("Failed to create operational coverage request");
    }
    const policyId = await ensureOperationalCoverageApprovalPolicy({
      tenantId,
      runQuery: tx.query,
    });
    const approvalResult = await submitRequest(
      policyId,
      OPERATIONAL_COVERAGE_TARGET_TYPE,
      coverageId,
      {
        tenantId,
        userId: normalizedRequesterUserId,
      },
      {
        idempotencyKey: `operational-coverage:${coverageId}`,
        scopeType: scopeBinding.scopeType,
        scopeId: scopeBinding.scopeId,
        legalEntityId: scopeBinding.legalEntityId,
        operatingUnitId: scopeBinding.operatingUnitId,
        targetSnapshot: {
          module_code: OPERATIONAL_COVERAGE_MODULE_CODE,
          target_type: OPERATIONAL_COVERAGE_TARGET_TYPE,
          target_id: coverageId,
          role_code: normalizedRoleCode,
          scope_type: scopeBinding.scopeType,
          scope_id: scopeBinding.scopeId,
          legal_entity_id: scopeBinding.legalEntityId,
          operating_unit_id: scopeBinding.operatingUnitId,
          start_date: normalizedStartDate,
          end_date: normalizedEndDate,
          execution_resolver_key: OPERATIONAL_COVERAGE_RESOLVER_KEY,
        },
        actionPayload: {
          coverageId,
        },
      },
      {
        runQuery: tx.query,
      },
    );
    const approvalRequestId = parsePositiveInt(approvalResult?.item?.id);
    if (!approvalRequestId) {
      throw new Error(
        "Operational coverage request did not create an approval request",
      );
    }
    await tx.query(
      `UPDATE operational_role_coverages
       SET approval_request_id = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [approvalRequestId, tenantId, coverageId],
    );
    return {
      coverageId,
      approvalRequestId,
      delegateUser,
      role,
      scopeBinding,
    };
  });
  await logRbacAuditEvent(req, {
    tenantId,
    targetUserId: parsePositiveInt(operation.delegateUser.id),
    action: "operational_coverage.request",
    resourceType: "operational_role_coverage",
    resourceId: operation.coverageId,
    scopeType: operation.scopeBinding.scopeType,
    scopeId: operation.scopeBinding.scopeId,
    payload: {
      approvalRequestId: operation.approvalRequestId,
      delegateUserId: parsePositiveInt(operation.delegateUser.id),
      delegateUserEmail: operation.delegateUser.email,
      roleId: parsePositiveInt(operation.role.id),
      roleCode: operation.role.code,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
    },
  });
  return {
    row: await getOperationalCoverageById({
      tenantId,
      coverageId: operation.coverageId,
    }),
    idempotent: false,
  };
}

async function executeApprovedOperationalCoverage({
  request,
  executedByUserId = null,
}) {
  const tenantId = parsePositiveInt(request?.tenantId);
  const approvalRequestId = parsePositiveInt(request?.id);
  const coverageId = parsePositiveInt(request?.targetId);
  if (!tenantId || !approvalRequestId || !coverageId) {
    throw badRequest("Operational coverage execution request is invalid");
  }
  const execution = await withTransaction(async (tx) => {
    const coverageRow = await fetchOperationalCoverageRowById({
      tenantId,
      coverageId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!coverageRow) {
      throw notFound("Operational coverage request not found");
    }
    if (
      parsePositiveInt(coverageRow.approval_request_id) !== approvalRequestId
    ) {
      throw conflict(
        "Operational coverage request is not linked to this approval request",
      );
    }
    if (coverageRow.revoked_at) {
      throw conflict("Revoked operational coverage cannot be activated");
    }
    if (coverageRow.rejected_at) {
      throw conflict("Rejected operational coverage cannot be activated");
    }
    await assertOperationalCoverageConflicts({
      tenantId,
      delegateUserId: parsePositiveInt(coverageRow.delegate_user_id),
      roleId: parsePositiveInt(coverageRow.role_id),
      scopeType: toUpper(coverageRow.scope_type),
      scopeId: parsePositiveInt(coverageRow.scope_id),
      startDate: coverageRow.start_date,
      endDate: coverageRow.end_date,
      runQuery: tx.query,
      ignoreCoverageId: parsePositiveInt(coverageRow.id),
      ignoreAssignmentId: parsePositiveInt(
        coverageRow.materialized_assignment_id,
      ),
    });
    if (parsePositiveInt(coverageRow.materialized_assignment_id)) {
      const assignmentCheck = await tx.query(
        `SELECT id
         FROM user_role_scopes
         WHERE tenant_id = ?
           AND id = ?
         LIMIT 1`,
        [tenantId, parsePositiveInt(coverageRow.materialized_assignment_id)],
      );
      if (parsePositiveInt(assignmentCheck.rows?.[0]?.id)) {
        return {
          assignmentId: parsePositiveInt(
            coverageRow.materialized_assignment_id,
          ),
          coverageId: parsePositiveInt(coverageRow.id),
          idempotent: true,
        };
      }
    }
    const insertAssignment = await tx.query(
      `INSERT INTO user_role_scopes (
         tenant_id,
         user_id,
         role_id,
         scope_type,
         scope_id,
         effect,
         effective_from,
         effective_to
       ) VALUES (?, ?, ?, ?, ?, 'ALLOW', ?, ?)`,
      [
        tenantId,
        parsePositiveInt(coverageRow.delegate_user_id),
        parsePositiveInt(coverageRow.role_id),
        toUpper(coverageRow.scope_type),
        parsePositiveInt(coverageRow.scope_id),
        coverageRow.start_date,
        coverageRow.end_date,
      ],
    );
    const assignmentId = parsePositiveInt(insertAssignment.rows?.insertId);
    if (!assignmentId) {
      throw new Error("Failed to materialize operational coverage assignment");
    }
    await tx.query(
      `UPDATE operational_role_coverages
       SET materialized_assignment_id = COALESCE(materialized_assignment_id, ?),
           activated_by_user_id = COALESCE(activated_by_user_id, ?),
           activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP)
       WHERE tenant_id = ?
         AND id = ?`,
      [
        assignmentId,
        parsePositiveInt(executedByUserId) || null,
        tenantId,
        parsePositiveInt(coverageRow.id),
      ],
    );
    return {
      assignmentId,
      coverageId: parsePositiveInt(coverageRow.id),
      idempotent: false,
    };
  });
  await invalidateRbacCache(tenantId);
  return execution;
}

/**
 * Register the SECURITY operational coverage execution resolver used by the
 * unified approval engine.
 */
export function ensureOperationalCoverageExecutionResolverRegistered() {
  if (operationalCoverageResolverRegistered) {
    return;
  }
  registerApprovalExecutionResolver(OPERATIONAL_COVERAGE_RESOLVER_KEY, {
    async execute({ request, executedByUserId }) {
      return executeApprovedOperationalCoverage({
        request,
        executedByUserId,
      });
    },
  });
  operationalCoverageResolverRegistered = true;
}

/**
 * Synchronize the dedicated operational coverage row with the authoritative
 * generic approval request lifecycle without reusing approval delegation
 * storage or logic.
 */
export async function syncOperationalCoverageApprovalBridge({
  tenantId,
  approvalRequestId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedApprovalRequestId = parsePositiveInt(approvalRequestId);
  if (!normalizedTenantId || !normalizedApprovalRequestId) {
    return null;
  }
  return withTransaction(async (tx) => {
    const requestResult = await tx.query(
      `SELECT
         id,
         tenant_id,
         request_status,
         execution_status,
         executed_by_user_id,
         approved_at,
         rejected_at,
         executed_at,
         execution_result_json
       FROM approval_requests
       WHERE tenant_id = ?
         AND id = ?
         AND module_code = ?
         AND target_type = ?
       LIMIT 1
       FOR UPDATE`,
      [
        normalizedTenantId,
        normalizedApprovalRequestId,
        OPERATIONAL_COVERAGE_MODULE_CODE,
        OPERATIONAL_COVERAGE_TARGET_TYPE,
      ],
    );
    const requestRow = requestResult.rows?.[0] || null;
    if (!requestRow) {
      return null;
    }
    const coverageRow = await fetchOperationalCoverageRowByApprovalRequestId({
      tenantId: normalizedTenantId,
      approvalRequestId: normalizedApprovalRequestId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!coverageRow) {
      return null;
    }
    const requestStatus = toUpper(requestRow.request_status);
    const executionStatus = toUpper(requestRow.execution_status);
    if (requestStatus === "REJECTED") {
      const rejectedByUserId = await findDecisionActorUserId({
        tenantId: normalizedTenantId,
        requestId: normalizedApprovalRequestId,
        decision: "REJECT",
        runQuery: tx.query,
      });
      await tx.query(
        `UPDATE operational_role_coverages
         SET rejected_by_user_id = COALESCE(rejected_by_user_id, ?),
             rejected_at = COALESCE(rejected_at, ?, CURRENT_TIMESTAMP)
         WHERE tenant_id = ?
           AND id = ?`,
        [
          rejectedByUserId || null,
          requestRow.rejected_at || null,
          normalizedTenantId,
          parsePositiveInt(coverageRow.id),
        ],
      );
      return {
        status: "REJECTED",
        coverageId: parsePositiveInt(coverageRow.id),
      };
    }
    if (requestStatus === "APPROVED" && executionStatus === "EXECUTED") {
      const approvedByUserId = await findDecisionActorUserId({
        tenantId: normalizedTenantId,
        requestId: normalizedApprovalRequestId,
        decision: "APPROVE",
        runQuery: tx.query,
      });
      const executionResult = parseStoredJson(
        requestRow.execution_result_json,
        {},
      );
      const assignmentId =
        parsePositiveInt(executionResult?.assignmentId) ||
        parsePositiveInt(coverageRow.materialized_assignment_id);
      await tx.query(
        `UPDATE operational_role_coverages
         SET approved_by_user_id = COALESCE(approved_by_user_id, ?),
             approved_at = COALESCE(approved_at, ?, CURRENT_TIMESTAMP),
             activated_by_user_id = COALESCE(activated_by_user_id, ?, ?),
             activated_at = COALESCE(activated_at, ?, CURRENT_TIMESTAMP),
             materialized_assignment_id = COALESCE(materialized_assignment_id, ?)
         WHERE tenant_id = ?
           AND id = ?`,
        [
          approvedByUserId || null,
          requestRow.approved_at || null,
          parsePositiveInt(requestRow.executed_by_user_id) || null,
          approvedByUserId || null,
          requestRow.executed_at || null,
          assignmentId || null,
          normalizedTenantId,
          parsePositiveInt(coverageRow.id),
        ],
      );
      return {
        status: "APPROVED",
        coverageId: parsePositiveInt(coverageRow.id),
      };
    }
    return {
      status: requestStatus || "PENDING_REVIEW",
      coverageId: parsePositiveInt(coverageRow.id),
    };
  });
}

/**
 * Revoke one approved or active temporary operational coverage and remove its
 * materialized role assignment immediately.
 */
export async function revokeOperationalCoverage({
  req,
  tenantId,
  coverageId,
  revokedByUserId,
  revokedReason = null,
}) {
  const normalizedCoverageId = parsePositiveInt(coverageId);
  const normalizedRevokedByUserId = parsePositiveInt(revokedByUserId);
  if (!normalizedCoverageId) {
    throw badRequest("coverageId is required");
  }
  if (!normalizedRevokedByUserId) {
    throw badRequest("revokedByUserId is required");
  }
  const normalizedRevokedReason = String(revokedReason || "").trim() || null;
  if (normalizedRevokedReason && normalizedRevokedReason.length > 255) {
    throw badRequest("revokedReason cannot exceed 255 characters");
  }
  const operation = await withTransaction(async (tx) => {
    const coverageRow = await fetchOperationalCoverageRowById({
      tenantId,
      coverageId: normalizedCoverageId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!coverageRow) {
      throw notFound("Operational coverage request not found");
    }
    if (coverageRow.revoked_at) {
      return {
        coverageId: parsePositiveInt(coverageRow.id),
        scopeType: toUpper(coverageRow.scope_type),
        scopeId: parsePositiveInt(coverageRow.scope_id),
        delegateUserId: parsePositiveInt(coverageRow.delegate_user_id),
        roleId: parsePositiveInt(coverageRow.role_id),
        roleCode: coverageRow.role_code,
        assignmentRemoved: false,
        idempotent: true,
      };
    }
    if (normalizeReviewStatus(coverageRow) === "REJECTED") {
      throw conflict("Rejected operational coverage cannot be revoked");
    }
    if (normalizeCoverageState(coverageRow) === "EXPIRED") {
      throw conflict("Expired operational coverage cannot be revoked");
    }
    if (
      normalizeReviewStatus(coverageRow) !== "APPROVED" &&
      toUpper(coverageRow.approval_execution_status || "NOT_EXECUTED") !==
        "EXECUTED"
    ) {
      throw conflict("Only approved operational coverage can be revoked");
    }
    let assignmentRemoved = false;
    const normalizedAssignmentId = parsePositiveInt(
      coverageRow.materialized_assignment_id,
    );
    if (normalizedAssignmentId) {
      const deleteResult = await tx.query(
        `DELETE FROM user_role_scopes
         WHERE tenant_id = ?
           AND id = ?`,
        [tenantId, normalizedAssignmentId],
      );
      assignmentRemoved = Number(deleteResult.rows?.affectedRows || 0) > 0;
    } else {
      const deleteResult = await tx.query(
        `DELETE FROM user_role_scopes
         WHERE tenant_id = ?
           AND user_id = ?
           AND role_id = ?
           AND scope_type = ?
           AND scope_id = ?`,
        [
          tenantId,
          parsePositiveInt(coverageRow.delegate_user_id),
          parsePositiveInt(coverageRow.role_id),
          toUpper(coverageRow.scope_type),
          parsePositiveInt(coverageRow.scope_id),
        ],
      );
      assignmentRemoved = Number(deleteResult.rows?.affectedRows || 0) > 0;
    }
    await tx.query(
      `UPDATE operational_role_coverages
       SET revoked_by_user_id = COALESCE(revoked_by_user_id, ?),
           revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
           revoked_reason = ?,
           materialized_assignment_id = materialized_assignment_id
       WHERE tenant_id = ?
         AND id = ?`,
      [
        normalizedRevokedByUserId,
        normalizedRevokedReason,
        tenantId,
        normalizedCoverageId,
      ],
    );
    return {
      coverageId: parsePositiveInt(coverageRow.id),
      scopeType: toUpper(coverageRow.scope_type),
      scopeId: parsePositiveInt(coverageRow.scope_id),
      delegateUserId: parsePositiveInt(coverageRow.delegate_user_id),
      roleId: parsePositiveInt(coverageRow.role_id),
      roleCode: coverageRow.role_code,
      assignmentRemoved,
      idempotent: false,
    };
  });
  if (operation.assignmentRemoved) {
    await invalidateRbacCache(tenantId);
  }
  await logRbacAuditEvent(req, {
    tenantId,
    targetUserId: operation.delegateUserId,
    action: "operational_coverage.revoke",
    resourceType: "operational_role_coverage",
    resourceId: operation.coverageId,
    scopeType: operation.scopeType,
    scopeId: operation.scopeId,
    payload: {
      delegateUserId: operation.delegateUserId,
      roleId: operation.roleId,
      roleCode: operation.roleCode,
      revokedReason: normalizedRevokedReason,
      assignmentRemoved: operation.assignmentRemoved,
    },
  });
  return {
    row: await getOperationalCoverageById({
      tenantId,
      coverageId: operation.coverageId,
    }),
    idempotent: Boolean(operation.idempotent),
  };
}
export default {
  ensureOperationalCoverageExecutionResolverRegistered,
  resolveOperationalCoverageScope,
  getOperationalCoverageWorkspace,
  getOperationalCoverageById,
  createOperationalCoverageRequest,
  revokeOperationalCoverage,
  syncOperationalCoverageApprovalBridge,
};
