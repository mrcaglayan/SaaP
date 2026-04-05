import { query, withTransaction } from "../db.js";
import { getVisibilityScope, hasScopeAccess } from "../middleware/rbac.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildVisibilityScopeWhereClause,
  loadUserPermissionCodes,
} from "./authz.scope.service.js";
import {
  evaluateApprovalNeed,
  recordDecision,
  registerApprovalExecutionResolver,
  submitRequest,
} from "./approval.engine.service.js";
import {
  assertCountryExists,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import { createCounterpartyTx } from "./cari.counterparty.service.js";

const REQUEST_STATUS_PENDING = "PENDING";
const REQUEST_STATUS_APPROVED = "APPROVED";
const REQUEST_STATUS_REJECTED = "REJECTED";
const REQUEST_STATUS_CANCELLED = "CANCELLED";
const CARI_COUNTERPARTY_APPROVAL_TARGET_TYPE = "COUNTERPARTY_REQUEST";
const CARI_COUNTERPARTY_APPROVAL_ACTION_TYPE = "CREATE";
const CARI_COUNTERPARTY_APPROVAL_EXECUTION_RESOLVER_KEY =
  "CARI_COUNTERPARTY_REQUEST_CREATE";
const CARI_COUNTERPARTY_DEFAULT_POLICY_CODE_PREFIX =
  "CARI_COUNTERPARTY_REQUEST_DEFAULT_LE";
const CARI_COUNTERPARTY_DEFAULT_POLICY_NAME_PREFIX =
  "Counterparty Request Review";
const CARI_COUNTERPARTY_APPROVER_PERMISSION_CODE = "cari.request.review";

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      serializationError: "requested_payload_json could not be serialized",
    });
  }
}

function parseStoredJson(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function toNullableString(value, maxLength = 255) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function resolveClientIp(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const firstIp = forwardedFor
      .split(",")
      .map((segment) => segment.trim())
      .find(Boolean);
    if (firstIp) {
      return firstIp.slice(0, 64);
    }
  }
  return String(req?.ip || req?.socket?.remoteAddress || "unknown").slice(0, 64);
}

function forbiddenError(message) {
  const err = new Error(message);
  err.status = 403;
  err.code = "FORBIDDEN";
  return err;
}

function buildRequestRoleCode({ isCustomer, isVendor }) {
  if (isCustomer && isVendor) {
    return "BOTH";
  }
  if (isCustomer) {
    return "CUSTOMER";
  }
  if (isVendor) {
    return "VENDOR";
  }
  return "OTHER";
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function mapEffectiveRequestStatus(row) {
  const approvalRequestStatus = toUpper(
    row?.approval_request_status ?? row?.approvalRequestStatus
  );
  if (!approvalRequestStatus) {
    return row?.request_status || REQUEST_STATUS_PENDING;
  }
  if (approvalRequestStatus === "APPROVED") {
    return REQUEST_STATUS_APPROVED;
  }
  if (approvalRequestStatus === "REJECTED") {
    return REQUEST_STATUS_REJECTED;
  }
  if (approvalRequestStatus === "WITHDRAWN") {
    return REQUEST_STATUS_CANCELLED;
  }
  return REQUEST_STATUS_PENDING;
}

function buildApprovalRequestSummary(row) {
  const approvalRequestId = parsePositiveInt(
    row?.approval_request_id ?? row?.approvalRequestId
  );
  if (!approvalRequestId) {
    return null;
  }
  return {
    id: approvalRequestId,
    requestCode: row.approval_request_code || null,
    requestStatus: toUpper(row.approval_request_status) || null,
    executionStatus: toUpper(row.approval_execution_status) || null,
    currentStepNo: Number(row.approval_current_step_no || 1),
    scopeType: toUpper(row.approval_scope_type) || null,
    scopeId: parsePositiveInt(row.approval_scope_id),
    submittedByUserId: parsePositiveInt(row.approval_submitted_by_user_id),
    executedByUserId: parsePositiveInt(row.approval_executed_by_user_id),
    submittedAt: row.approval_submitted_at || null,
    approvedAt: row.approval_approved_at || null,
    rejectedAt: row.approval_rejected_at || null,
    withdrawnAt: row.approval_withdrawn_at || null,
    executedAt: row.approval_executed_at || null,
    executionErrorText: row.approval_execution_error_text || null,
  };
}

function buildUnifiedRequestScope(row) {
  const approvalScopeType = toUpper(row?.approval_scope_type);
  const approvalScopeId = parsePositiveInt(row?.approval_scope_id);
  if (approvalScopeType && approvalScopeId) {
    return {
      scopeType: approvalScopeType,
      scopeId: approvalScopeId,
    };
  }
  const primaryOperatingUnitId = parsePositiveInt(row?.primary_operating_unit_id);
  if (primaryOperatingUnitId) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: primaryOperatingUnitId,
    };
  }
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row?.legal_entity_id),
  };
}

function mapCounterpartyRequestRow(row) {
  const isCustomer = parseDbBoolean(row.is_customer);
  const isVendor = parseDbBoolean(row.is_vendor);
  const approvalRequest = buildApprovalRequestSummary(row);
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    primaryOperatingUnitId: parsePositiveInt(row.primary_operating_unit_id),
    code: row.code || null,
    name: row.name || null,
    isCustomer,
    isVendor,
    requestRole: buildRequestRoleCode({ isCustomer, isVendor }),
    requestStatus:
      row.effective_request_status || mapEffectiveRequestStatus(row) || REQUEST_STATUS_PENDING,
    requestedPayload: parseStoredJson(row.requested_payload_json),
    requestedByUserId: parsePositiveInt(row.requested_by_user_id),
    requestedByUserName: row.requested_by_user_name || null,
    decidedByUserId: parsePositiveInt(row.decided_by_user_id),
    decidedByUserName: row.decided_by_user_name || null,
    decisionComment: row.decision_comment || null,
    createdCounterpartyId: parsePositiveInt(row.created_counterparty_id),
    createdCounterpartyCode: row.created_counterparty_code || null,
    createdCounterpartyName: row.created_counterparty_name || null,
    decidedAt: row.decided_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    approvalRequest,
  };
}

function normalizeRequestedOperatingUnitIds(primaryOperatingUnitId, operatingUnitIds = []) {
  return Array.from(
    new Set(
      [primaryOperatingUnitId, ...(Array.isArray(operatingUnitIds) ? operatingUnitIds : [])]
        .map((id) => parsePositiveInt(id))
        .filter(Boolean)
    )
  );
}

async function assertRequestedOperatingUnits({
  tenantId,
  legalEntityId,
  primaryOperatingUnitId,
  operatingUnitIds,
}) {
  const normalizedIds = normalizeRequestedOperatingUnitIds(primaryOperatingUnitId, operatingUnitIds);
  for (const operatingUnitId of normalizedIds) {
    const operatingUnit = await assertOperatingUnitBelongsToTenant(
      tenantId,
      operatingUnitId,
      "operatingUnitIds[]"
    );
    if (parsePositiveInt(operatingUnit.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
      throw badRequest("operatingUnitIds[] must belong to legalEntityId");
    }
  }
  return normalizedIds;
}

async function assertRequestedCountriesExist(addresses = []) {
  const uniqueCountryIds = Array.from(
    new Set(
      (Array.isArray(addresses) ? addresses : [])
        .map((row) => parsePositiveInt(row?.countryId))
        .filter(Boolean)
    )
  );
  for (const countryId of uniqueCountryIds) {
    await assertCountryExists(countryId, "addresses[].countryId");
  }
}

async function insertCounterpartyRequestAuditLog({
  req,
  runQuery = query,
  tenantId,
  userId,
  action,
  requestId,
  legalEntityId,
  payload,
}) {
  await runQuery(
    `INSERT INTO audit_logs (
        tenant_id,
        user_id,
        action,
        resource_type,
        resource_id,
        scope_type,
        scope_id,
        request_id,
        ip_address,
        user_agent,
        payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      userId || null,
      action,
      "counterparty_request",
      requestId ? String(requestId) : null,
      legalEntityId ? "LEGAL_ENTITY" : null,
      legalEntityId || null,
      toNullableString(req?.requestId || req?.headers?.["x-request-id"], 80),
      resolveClientIp(req),
      toNullableString(req?.headers?.["user-agent"], 255),
      safeStringify(payload || null),
    ]
  );
}

function buildCounterpartyRequestScopeWhere(req, params) {
  return buildVisibilityScopeWhereClause(getVisibilityScope(req), params, {
    LEGAL_ENTITY: { idColumn: "r.legal_entity_id" },
    OPERATING_UNIT: { idColumn: "r.primary_operating_unit_id" },
  });
}

const COUNTERPARTY_REQUEST_EFFECTIVE_STATUS_SQL = `
  CASE
    WHEN ar.id IS NULL THEN r.request_status
    WHEN ar.request_status = 'APPROVED' THEN 'APPROVED'
    WHEN ar.request_status = 'REJECTED' THEN 'REJECTED'
    WHEN ar.request_status = 'WITHDRAWN' THEN 'CANCELLED'
    ELSE 'PENDING'
  END
`;

async function fetchCounterpartyRequestRow({
  tenantId,
  requestId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
        r.*,
        ${COUNTERPARTY_REQUEST_EFFECTIVE_STATUS_SQL} AS effective_request_status,
        requester.name AS requested_by_user_name,
        decider.name AS decided_by_user_name,
        ar.id AS approval_request_id,
        ar.request_code AS approval_request_code,
        ar.request_status AS approval_request_status,
        ar.current_step_no AS approval_current_step_no,
        ar.execution_status AS approval_execution_status,
        ar.scope_type AS approval_scope_type,
        ar.scope_id AS approval_scope_id,
        ar.submitted_by_user_id AS approval_submitted_by_user_id,
        ar.executed_by_user_id AS approval_executed_by_user_id,
        ar.submitted_at AS approval_submitted_at,
        ar.approved_at AS approval_approved_at,
        ar.rejected_at AS approval_rejected_at,
        ar.withdrawn_at AS approval_withdrawn_at,
        ar.executed_at AS approval_executed_at,
        ar.execution_error_text AS approval_execution_error_text,
        cp.code AS created_counterparty_code,
        cp.name AS created_counterparty_name
     FROM counterparty_requests r
     LEFT JOIN users requester
       ON requester.tenant_id = r.tenant_id
      AND requester.id = r.requested_by_user_id
     LEFT JOIN users decider
       ON decider.tenant_id = r.tenant_id
      AND decider.id = r.decided_by_user_id
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.approval_request_id
     LEFT JOIN counterparties cp
       ON cp.tenant_id = r.tenant_id
      AND cp.legal_entity_id = r.legal_entity_id
      AND cp.id = r.created_counterparty_id
     WHERE r.tenant_id = ?
       AND r.id = ?
     LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, requestId]
  );
  return result.rows?.[0] || null;
}

async function applyUnifiedCounterpartyApprovalExecution({
  request,
  executedByUserId,
}) {
  return withTransaction(async (tx) => {
    const requestRow = await fetchCounterpartyRequestRow({
      tenantId: request.tenantId,
      requestId: request.targetId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!requestRow) {
      throw badRequest("Counterparty request not found for approval execution");
    }

    if (parsePositiveInt(requestRow.created_counterparty_id)) {
      return {
        request: mapCounterpartyRequestRow(requestRow),
        counterparty: {
          id: parsePositiveInt(requestRow.created_counterparty_id),
          code: requestRow.created_counterparty_code || null,
          name: requestRow.created_counterparty_name || null,
        },
      };
    }

    const requestedPayload = parseStoredJson(requestRow.requested_payload_json);
    if (!requestedPayload || typeof requestedPayload !== "object") {
      throw badRequest("Requested payload is missing or invalid");
    }

    let createdRow;
    try {
      createdRow = await createCounterpartyTx({
        req: {
          headers: {},
          requestId: request.requestCode || null,
        },
        payload: {
          ...requestedPayload,
          tenantId: request.tenantId,
          userId: parsePositiveInt(executedByUserId) || null,
        },
        runQuery: tx.query,
        skipScopeAccessValidation: true,
      });
    } catch (err) {
      if (Number(err?.errno) === 1062) {
        throw badRequest("Counterparty code must be unique within tenant and legalEntityId");
      }
      throw err;
    }

    await tx.query(
      `UPDATE counterparty_requests
       SET request_status = ?,
           decided_by_user_id = COALESCE(?, decided_by_user_id),
           created_counterparty_id = ?,
           decided_at = COALESCE(decided_at, CURRENT_TIMESTAMP)
       WHERE tenant_id = ?
         AND id = ?`,
      [
        REQUEST_STATUS_APPROVED,
        parsePositiveInt(executedByUserId) || null,
        createdRow.id,
        request.tenantId,
        request.targetId,
      ]
    );

    const approvedRow = await fetchCounterpartyRequestRow({
      tenantId: request.tenantId,
      requestId: request.targetId,
      runQuery: tx.query,
    });
    return {
      request: mapCounterpartyRequestRow(approvedRow),
      counterparty: createdRow,
    };
  });
}

function buildDefaultCounterpartyApprovalPolicyCode(legalEntityId) {
  return `${CARI_COUNTERPARTY_DEFAULT_POLICY_CODE_PREFIX}_${parsePositiveInt(legalEntityId)}`;
}

function buildDefaultCounterpartyApprovalPolicyName(legalEntityId) {
  return `${CARI_COUNTERPARTY_DEFAULT_POLICY_NAME_PREFIX} LE ${parsePositiveInt(legalEntityId)}`;
}

/**
 * Ensure a deterministic default unified approval policy exists for one legal
 * entity's counterparty-request flow. This keeps the request queue on the
 * generic approval engine even when a tenant has not configured a custom CARI
 * approval policy yet.
 */
async function ensureDefaultCounterpartyApprovalPolicy({
  tenantId,
  legalEntityId,
  createdByUserId = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedUserId = parsePositiveInt(createdByUserId) || null;
  if (!normalizedTenantId || !normalizedLegalEntityId) {
    throw badRequest("tenantId and legalEntityId are required for default approval policy setup");
  }

  const policyCode = buildDefaultCounterpartyApprovalPolicyCode(normalizedLegalEntityId);
  const policyName = buildDefaultCounterpartyApprovalPolicyName(normalizedLegalEntityId);
  let policyId = parsePositiveInt(
    (
      await runQuery(
        `SELECT id
         FROM approval_policies
         WHERE tenant_id = ?
           AND module_code = 'CARI'
           AND policy_code = ?
         LIMIT 1`,
        [normalizedTenantId, policyCode]
      )
    ).rows?.[0]?.id
  );

  if (!policyId) {
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
       ) VALUES (?, 'CARI', ?, ?, 'COUNTERPARTY_REQUEST', 'CREATE', 1, 'LEGAL_ENTITY', ?, NULL, NULL, 1, 1, 1, 0, 1, NULL, NULL, NULL, NULL, ?, 1, ?, ?)`,
      [
        normalizedTenantId,
        policyCode,
        policyName,
        normalizedLegalEntityId,
        CARI_COUNTERPARTY_APPROVER_PERMISSION_CODE,
        normalizedUserId,
        normalizedUserId,
      ]
    );
    policyId = parsePositiveInt(insertResult.rows?.insertId);
  }

  if (!policyId) {
    policyId = parsePositiveInt(
      (
        await runQuery(
          `SELECT id
           FROM approval_policies
           WHERE tenant_id = ?
             AND module_code = 'CARI'
             AND policy_code = ?
           LIMIT 1`,
          [normalizedTenantId, policyCode]
        )
      ).rows?.[0]?.id
    );
  }
  if (!policyId) {
    throw new Error("Failed to resolve default counterparty approval policy id");
  }

  await runQuery(
    `UPDATE approval_policies
     SET policy_name = ?,
         target_type = 'COUNTERPARTY_REQUEST',
         action_type = 'CREATE',
         scope_type = 'LEGAL_ENTITY',
         scope_id = ?,
         step_count = 1,
         min_approvals = 1,
         maker_checker_required = 1,
         allow_self_approve = 0,
         auto_execute_on_final_approval = 1,
         approver_permission_code = ?,
         is_active = 1,
         updated_by_user_id = ?
     WHERE id = ?`,
    [
      policyName,
      normalizedLegalEntityId,
      CARI_COUNTERPARTY_APPROVER_PERMISSION_CODE,
      normalizedUserId,
      policyId,
    ]
  );

  const existingAssignmentId = parsePositiveInt(
    (
      await runQuery(
        `SELECT id
         FROM approval_policy_assignments
         WHERE tenant_id = ?
           AND policy_id = ?
           AND scope_type = 'LEGAL_ENTITY'
           AND scope_id = ?
         LIMIT 1`,
        [normalizedTenantId, policyId, normalizedLegalEntityId]
      )
    ).rows?.[0]?.id
  );
  if (!existingAssignmentId) {
    await runQuery(
      `INSERT INTO approval_policy_assignments (
         tenant_id,
         policy_id,
         scope_type,
         scope_id,
         effective_from,
         effective_to,
         is_active
       ) VALUES (?, ?, 'LEGAL_ENTITY', ?, NULL, NULL, 1)`,
      [normalizedTenantId, policyId, normalizedLegalEntityId]
    );
  } else {
    await runQuery(
      `UPDATE approval_policy_assignments
       SET is_active = 1,
           effective_from = NULL,
           effective_to = NULL
       WHERE id = ?`,
      [existingAssignmentId]
    );
  }

  const existingStepId = parsePositiveInt(
    (
      await runQuery(
        `SELECT id
         FROM approval_policy_steps
         WHERE policy_id = ?
           AND step_no = 1
         LIMIT 1`,
        [policyId]
      )
    ).rows?.[0]?.id
  );
  if (!existingStepId) {
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
       ) VALUES (?, ?, 1, ?, 'REQUEST_SCOPE', NULL, 1, 0, NULL, NULL, NULL)`,
      [normalizedTenantId, policyId, CARI_COUNTERPARTY_APPROVER_PERMISSION_CODE]
    );
  } else {
    await runQuery(
      `UPDATE approval_policy_steps
       SET required_permission_code = ?,
           scope_resolution_mode = 'REQUEST_SCOPE',
           custom_scope_resolver_key = NULL,
           min_approvals = 1,
           allow_self_approve = 0,
           escalation_after_hours = NULL,
           escalation_target_scope_mode = NULL,
           escalation_max_count = NULL
       WHERE id = ?`,
      [CARI_COUNTERPARTY_APPROVER_PERMISSION_CODE, existingStepId]
    );
  }

  return policyId;
}

/**
 * Resolve the effective unified approval policy for one counterparty request.
 * When no tenant policy exists yet, this auto-provisions the deterministic
 * default legal-entity policy and re-evaluates the request against it.
 */
async function resolveCounterpartyApprovalNeed({
  tenantId,
  legalEntityId,
  primaryOperatingUnitId = null,
  createdByUserId = null,
}) {
  let approvalNeed = await evaluateApprovalNeed(
    "CARI",
    CARI_COUNTERPARTY_APPROVAL_TARGET_TYPE,
    CARI_COUNTERPARTY_APPROVAL_ACTION_TYPE,
    {
      tenantId,
      legalEntityId,
      operatingUnitId: primaryOperatingUnitId || null,
    }
  );

  if (approvalNeed?.approvalRequired && parsePositiveInt(approvalNeed?.policy?.id)) {
    return approvalNeed;
  }

  await ensureDefaultCounterpartyApprovalPolicy({
    tenantId,
    legalEntityId,
    createdByUserId,
  });

  approvalNeed = await evaluateApprovalNeed(
    "CARI",
    CARI_COUNTERPARTY_APPROVAL_TARGET_TYPE,
    CARI_COUNTERPARTY_APPROVAL_ACTION_TYPE,
    {
      tenantId,
      legalEntityId,
      operatingUnitId: primaryOperatingUnitId || null,
    }
  );

  if (!approvalNeed?.approvalRequired || !parsePositiveInt(approvalNeed?.policy?.id)) {
    throw badRequest(
      "Counterparty request approval policy could not be resolved for the selected legal entity"
    );
  }
  return approvalNeed;
}

/**
 * Backfill one pending legacy counterparty request into the unified approval
 * engine so the queue can stay on one tracked review model.
 */
export async function bridgePendingCounterpartyRequestToUnifiedApproval({
  req,
  tenantId,
  requestId,
}) {
  const requestRow = await fetchCounterpartyRequestRow({
    tenantId,
    requestId,
  });
  if (!requestRow) {
    throw badRequest("Counterparty request not found");
  }
  if (parsePositiveInt(requestRow.approval_request_id)) {
    return mapCounterpartyRequestRow(requestRow);
  }
  if (toUpper(requestRow.request_status) !== REQUEST_STATUS_PENDING) {
    return mapCounterpartyRequestRow(requestRow);
  }

  const normalizedLegalEntityId = parsePositiveInt(requestRow.legal_entity_id);
  const normalizedOperatingUnitId = parsePositiveInt(requestRow.primary_operating_unit_id) || null;
  const requesterUserId = parsePositiveInt(requestRow.requested_by_user_id) || null;
  const approvalNeed = await resolveCounterpartyApprovalNeed({
    tenantId,
    legalEntityId: normalizedLegalEntityId,
    primaryOperatingUnitId: normalizedOperatingUnitId,
    createdByUserId: requesterUserId,
  });

  ensureCounterpartyApprovalResolverRegistered();

  return withTransaction(async (tx) => {
    const lockedRow = await fetchCounterpartyRequestRow({
      tenantId,
      requestId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!lockedRow) {
      throw badRequest("Counterparty request not found");
    }
    if (parsePositiveInt(lockedRow.approval_request_id)) {
      return mapCounterpartyRequestRow(lockedRow);
    }
    if (toUpper(lockedRow.request_status) !== REQUEST_STATUS_PENDING) {
      return mapCounterpartyRequestRow(lockedRow);
    }

    const submitRes = await submitRequest(
      approvalNeed.policy.id,
      CARI_COUNTERPARTY_APPROVAL_TARGET_TYPE,
      requestId,
      { tenantId, userId: requesterUserId },
      {
        legalEntityId: normalizedLegalEntityId,
        operatingUnitId: normalizedOperatingUnitId,
        scopeType: approvalNeed.requestScope?.scopeType || null,
        scopeId: approvalNeed.requestScope?.scopeId || null,
        idempotencyKey: `CARI_COUNTERPARTY_REQUEST:${tenantId}:${requestId}`,
        targetSnapshot: {
          counterpartyRequestId: requestId,
          code: lockedRow.code || null,
          name: lockedRow.name || null,
          executionResolverKey: CARI_COUNTERPARTY_APPROVAL_EXECUTION_RESOLVER_KEY,
        },
        actionPayload: {
          executionResolverKey: CARI_COUNTERPARTY_APPROVAL_EXECUTION_RESOLVER_KEY,
        },
      },
      { runQuery: tx.query }
    );

    await tx.query(
      `UPDATE counterparty_requests
       SET approval_request_id = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [parsePositiveInt(submitRes.item?.id) || null, tenantId, requestId]
    );

    await insertCounterpartyRequestAuditLog({
      req,
      runQuery: tx.query,
      tenantId,
      userId: requesterUserId,
      action: "cari.counterparty_request.bridge_to_unified_approval",
      requestId,
      legalEntityId: normalizedLegalEntityId,
      payload: {
        approvalRequestId: parsePositiveInt(submitRes.item?.id) || null,
        approvalPolicyId: parsePositiveInt(approvalNeed.policy?.id) || null,
        approvalEngine: "UNIFIED",
      },
    });

    const bridgedRow = await fetchCounterpartyRequestRow({
      tenantId,
      requestId,
      runQuery: tx.query,
    });
    return mapCounterpartyRequestRow(bridgedRow);
  });
}

/**
 * Register the CARI counterparty-create execution resolver with the unified
 * approval engine so generic approval routes can execute approved requests.
 */
export function ensureCounterpartyApprovalResolverRegistered() {
  registerApprovalExecutionResolver(CARI_COUNTERPARTY_APPROVAL_EXECUTION_RESOLVER_KEY, {
    async execute({ request, executedByUserId }) {
      return applyUnifiedCounterpartyApprovalExecution({
        request,
        executedByUserId,
      });
    },
  });
}

async function syncCounterpartyRequestDecisionState({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment,
  requestStatus,
  action,
  createdCounterpartyId = null,
  runQuery = query,
}) {
  const requestRow = await fetchCounterpartyRequestRow({
    tenantId,
    requestId,
    runQuery,
  });
  if (!requestRow) {
    throw badRequest("Counterparty request not found");
  }

  await runQuery(
    `UPDATE counterparty_requests
     SET request_status = ?,
         decision_comment = ?,
         decided_by_user_id = ?,
         created_counterparty_id = COALESCE(?, created_counterparty_id),
         decided_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND id = ?`,
    [
      requestStatus,
      decisionComment || null,
      parsePositiveInt(userId) || null,
      parsePositiveInt(createdCounterpartyId) || null,
      tenantId,
      requestId,
    ]
  );

  await insertCounterpartyRequestAuditLog({
    req,
    runQuery,
    tenantId,
    userId,
    action,
    requestId,
    legalEntityId: parsePositiveInt(requestRow.legal_entity_id),
    payload: {
      decisionComment: decisionComment || null,
      approvalRequestId: parsePositiveInt(requestRow.approval_request_id) || null,
      finalApproval: requestStatus === REQUEST_STATUS_APPROVED,
      createdCounterpartyId: parsePositiveInt(createdCounterpartyId) || null,
    },
  });
}

/**
 * Resolve one request to its authoritative review scope for route protection.
 */
export async function resolveCounterpartyRequestScope(requestId, tenantId) {
  const parsedRequestId = parsePositiveInt(requestId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedRequestId || !parsedTenantId) {
    return null;
  }
  const row = await fetchCounterpartyRequestRow({
    tenantId: parsedTenantId,
    requestId: parsedRequestId,
  });
  if (!row) {
    return null;
  }
  return buildUnifiedRequestScope(row);
}

/**
 * List counterparty requests visible to the current actor.
 */
export async function listCounterpartyRequestRows({
  req,
  tenantId,
  filters,
  assertScopeAccess,
}) {
  const userId = parsePositiveInt(req.user?.userId);
  const permissionCodes = await loadUserPermissionCodes({ tenantId, userId });
  const canReviewAll = permissionCodes.includes("cari.request.review");
  const params = [tenantId];
  const conditions = ["r.tenant_id = ?"];

  conditions.push(buildCounterpartyRequestScopeWhere(req, params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("r.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.primaryOperatingUnitId) {
    assertScopeAccess(
      req,
      "operating_unit",
      filters.primaryOperatingUnitId,
      "primaryOperatingUnitId"
    );
    conditions.push("r.primary_operating_unit_id = ?");
    params.push(filters.primaryOperatingUnitId);
  }
  if (filters.status) {
    conditions.push(`(${COUNTERPARTY_REQUEST_EFFECTIVE_STATUS_SQL}) = ?`);
    params.push(filters.status);
  }
  if (filters.role === "CUSTOMER") {
    conditions.push("r.is_customer = TRUE");
  } else if (filters.role === "VENDOR") {
    conditions.push("r.is_vendor = TRUE");
  } else if (filters.role === "BOTH") {
    conditions.push("r.is_customer = TRUE");
    conditions.push("r.is_vendor = TRUE");
  }
  if (filters.q) {
    conditions.push("(r.code LIKE ? OR r.name LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  if (!canReviewAll || filters.mineOnly === true) {
    conditions.push("r.requested_by_user_id = ?");
    params.push(userId || 0);
  }

  const whereSql = conditions.join(" AND ");
  const safeLimit =
    Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 50;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;

  const totalResult = await query(
    `SELECT COUNT(*) AS row_count
     FROM counterparty_requests r
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.approval_request_id
     WHERE ${whereSql}`,
    params
  );
  const total = Number(totalResult.rows?.[0]?.row_count || 0);

  const result = await query(
    `SELECT
        r.*,
        ${COUNTERPARTY_REQUEST_EFFECTIVE_STATUS_SQL} AS effective_request_status,
        requester.name AS requested_by_user_name,
        decider.name AS decided_by_user_name,
        ar.id AS approval_request_id,
        ar.request_code AS approval_request_code,
        ar.request_status AS approval_request_status,
        ar.current_step_no AS approval_current_step_no,
        ar.execution_status AS approval_execution_status,
        ar.scope_type AS approval_scope_type,
        ar.scope_id AS approval_scope_id,
        ar.submitted_by_user_id AS approval_submitted_by_user_id,
        ar.executed_by_user_id AS approval_executed_by_user_id,
        ar.submitted_at AS approval_submitted_at,
        ar.approved_at AS approval_approved_at,
        ar.rejected_at AS approval_rejected_at,
        ar.withdrawn_at AS approval_withdrawn_at,
        ar.executed_at AS approval_executed_at,
        ar.execution_error_text AS approval_execution_error_text,
        cp.code AS created_counterparty_code,
        cp.name AS created_counterparty_name
     FROM counterparty_requests r
     LEFT JOIN users requester
       ON requester.tenant_id = r.tenant_id
      AND requester.id = r.requested_by_user_id
     LEFT JOIN users decider
       ON decider.tenant_id = r.tenant_id
      AND decider.id = r.decided_by_user_id
     LEFT JOIN approval_requests ar
       ON ar.tenant_id = r.tenant_id
      AND ar.id = r.approval_request_id
     LEFT JOIN counterparties cp
       ON cp.tenant_id = r.tenant_id
      AND cp.legal_entity_id = r.legal_entity_id
      AND cp.id = r.created_counterparty_id
     WHERE ${whereSql}
     ORDER BY
       CASE (${COUNTERPARTY_REQUEST_EFFECTIVE_STATUS_SQL})
         WHEN 'PENDING' THEN 0
         WHEN 'APPROVED' THEN 1
         WHEN 'REJECTED' THEN 2
         ELSE 3
       END,
       r.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (result.rows || []).map(mapCounterpartyRequestRow),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Submit one counterparty request without granting direct master-data edit power.
 */
export async function createCounterpartyRequest({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const legalEntityId = payload.legalEntityId;
  const requestedPrimaryOperatingUnitId = parsePositiveInt(payload.primaryOperatingUnitId);

  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  const requestedOperatingUnitIds = await assertRequestedOperatingUnits({
    tenantId,
    legalEntityId,
    primaryOperatingUnitId: requestedPrimaryOperatingUnitId,
    operatingUnitIds: payload.operatingUnitIds,
  });
  const primaryOperatingUnitId =
    requestedPrimaryOperatingUnitId || requestedOperatingUnitIds[0] || null;

  await assertRequestedCountriesExist(payload.addresses);

  const hasLegalEntityScope = hasScopeAccess(req, "legal_entity", legalEntityId);
  if (hasLegalEntityScope) {
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  } else {
    if (requestedOperatingUnitIds.length === 0) {
      throw badRequest(
        "primaryOperatingUnitId or operatingUnitIds is required when requester lacks legalEntity scope"
      );
    }
    for (const operatingUnitId of requestedOperatingUnitIds) {
      assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitIds[]");
    }
  }

  const storedPayload = {
    ...payload,
    operatingUnitIds: requestedOperatingUnitIds,
    primaryOperatingUnitId,
  };
  const approvalNeed = await resolveCounterpartyApprovalNeed({
    tenantId,
    legalEntityId,
    primaryOperatingUnitId,
    createdByUserId: payload.userId,
  });

  ensureCounterpartyApprovalResolverRegistered();

  return withTransaction(async (tx) => {
    const insertResult = await tx.query(
      `INSERT INTO counterparty_requests (
          tenant_id,
          legal_entity_id,
          primary_operating_unit_id,
          code,
          name,
          is_customer,
          is_vendor,
          request_status,
          requested_payload_json,
          requested_by_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      [
        tenantId,
        legalEntityId,
        primaryOperatingUnitId || null,
        payload.code,
        payload.name,
        payload.isCustomer ? 1 : 0,
        payload.isVendor ? 1 : 0,
        safeStringify(storedPayload),
        payload.userId,
      ]
    );
    const requestId = parsePositiveInt(insertResult.rows?.insertId);
    if (!requestId) {
      throw new Error("Counterparty request create failed");
    }

    const submitRes = await submitRequest(
      approvalNeed.policy.id,
      CARI_COUNTERPARTY_APPROVAL_TARGET_TYPE,
      requestId,
      { tenantId, userId: payload.userId },
      {
        legalEntityId,
        operatingUnitId: primaryOperatingUnitId || null,
        scopeType: approvalNeed.requestScope?.scopeType || null,
        scopeId: approvalNeed.requestScope?.scopeId || null,
        idempotencyKey: `CARI_COUNTERPARTY_REQUEST:${tenantId}:${requestId}`,
        targetSnapshot: {
          counterpartyRequestId: requestId,
          code: payload.code,
          name: payload.name,
          executionResolverKey: CARI_COUNTERPARTY_APPROVAL_EXECUTION_RESOLVER_KEY,
        },
        actionPayload: {
          executionResolverKey: CARI_COUNTERPARTY_APPROVAL_EXECUTION_RESOLVER_KEY,
        },
      },
      { runQuery: tx.query }
    );

    await tx.query(
      `UPDATE counterparty_requests
       SET approval_request_id = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [parsePositiveInt(submitRes.item?.id) || null, tenantId, requestId]
    );

    await insertCounterpartyRequestAuditLog({
      req,
      runQuery: tx.query,
      tenantId,
      userId: payload.userId,
      action: "cari.counterparty_request.submit",
      requestId,
      legalEntityId,
      payload: {
        code: payload.code,
        name: payload.name,
        isCustomer: Boolean(payload.isCustomer),
        isVendor: Boolean(payload.isVendor),
        primaryOperatingUnitId: primaryOperatingUnitId || null,
        operatingUnitIds: requestedOperatingUnitIds,
        approvalRequestId: parsePositiveInt(submitRes.item?.id) || null,
        approvalPolicyId: parsePositiveInt(approvalNeed.policy?.id) || null,
        approvalEngine: "UNIFIED",
      },
    });

    const createdRow = await fetchCounterpartyRequestRow({
      tenantId,
      requestId,
      runQuery: tx.query,
    });
    return mapCounterpartyRequestRow(createdRow);
  });
}

/**
 * Record one review approval on a counterparty request.
 */
export async function approveCounterpartyRequestById({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment,
  assertScopeAccess,
}) {
  const requestRow = await fetchCounterpartyRequestRow({
    tenantId,
    requestId,
  });
  if (!requestRow) {
    throw badRequest("Counterparty request not found");
  }

  const requestScope = buildUnifiedRequestScope(requestRow);
  assertScopeAccess(req, requestScope.scopeType.toLowerCase(), requestScope.scopeId, "requestId");

  const approvalRequestId =
    parsePositiveInt(requestRow.approval_request_id) ||
    parsePositiveInt(
      (
        await bridgePendingCounterpartyRequestToUnifiedApproval({
          req,
          tenantId,
          requestId,
        })
      )?.approvalRequest?.id
    );
  if (!approvalRequestId) {
    throw badRequest("Counterparty request is missing its unified approval bridge");
  }

  ensureCounterpartyApprovalResolverRegistered();

  const approvalResult = await recordDecision(
    approvalRequestId,
    userId,
    "APPROVE",
    decisionComment || null
  );

  const unifiedRequest = approvalResult.item || null;
  const finalApproved = toUpper(unifiedRequest?.requestStatus) === "APPROVED";
  const executedCounterpartyId = parsePositiveInt(
    approvalResult.execution_result?.counterparty?.id ??
      approvalResult.execution_result?.counterpartyId
  );

  if (finalApproved) {
    await syncCounterpartyRequestDecisionState({
      req,
      tenantId,
      requestId,
      userId,
      decisionComment,
      requestStatus: REQUEST_STATUS_APPROVED,
      action: "cari.counterparty_request.approve",
      createdCounterpartyId: executedCounterpartyId || null,
    });
  } else {
    await insertCounterpartyRequestAuditLog({
      req,
      tenantId,
      userId,
      action: "cari.counterparty_request.approve",
      requestId,
      legalEntityId: parsePositiveInt(requestRow.legal_entity_id),
      payload: {
        decisionComment: decisionComment || null,
        approvalRequestId,
        finalApproval: false,
        approvalRequestStatus: unifiedRequest?.requestStatus || null,
        currentStepNo: Number(unifiedRequest?.currentStepNo || 1),
      },
    });
  }

  const refreshedRow = await fetchCounterpartyRequestRow({
    tenantId,
    requestId,
  });
  return {
    request: mapCounterpartyRequestRow(refreshedRow),
    counterparty:
      approvalResult.execution_result?.counterparty ||
      approvalResult.execution_result ||
      null,
    approvalRequest: unifiedRequest,
  };
}

/**
 * Record one review rejection on a counterparty request.
 */
export async function rejectCounterpartyRequestById({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment,
  assertScopeAccess,
}) {
  const requestRow = await fetchCounterpartyRequestRow({
    tenantId,
    requestId,
  });
  if (!requestRow) {
    throw badRequest("Counterparty request not found");
  }

  const requestScope = buildUnifiedRequestScope(requestRow);
  assertScopeAccess(req, requestScope.scopeType.toLowerCase(), requestScope.scopeId, "requestId");

  const approvalRequestId =
    parsePositiveInt(requestRow.approval_request_id) ||
    parsePositiveInt(
      (
        await bridgePendingCounterpartyRequestToUnifiedApproval({
          req,
          tenantId,
          requestId,
        })
      )?.approvalRequest?.id
    );
  if (!approvalRequestId) {
    throw badRequest("Counterparty request is missing its unified approval bridge");
  }

  const approvalResult = await recordDecision(
    approvalRequestId,
    userId,
    "REJECT",
    decisionComment || null
  );

  await syncCounterpartyRequestDecisionState({
    req,
    tenantId,
    requestId,
    userId,
    decisionComment,
    requestStatus: REQUEST_STATUS_REJECTED,
    action: "cari.counterparty_request.reject",
  });

  const refreshedRow = await fetchCounterpartyRequestRow({
    tenantId,
    requestId,
  });
  return {
    row: mapCounterpartyRequestRow(refreshedRow),
    approvalRequest: approvalResult.item || null,
  };
}
