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
import { assertSoD } from "./sod.service.js";
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

function isCounterpartyUnifiedApprovalEnabled() {
  const raw = String(
    process.env.CARI_COUNTERPARTY_REQUEST_UNIFIED_APPROVAL ?? "1"
  ).trim();
  return !["0", "false", "off", "no"].includes(raw.toLowerCase());
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

function ensureCounterpartyApprovalResolverRegistered() {
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

async function createCounterpartyRequestLegacy({
  req,
  payload,
  tenantId,
  legalEntityId,
  primaryOperatingUnitId,
  requestedOperatingUnitIds,
  storedPayload,
}) {
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

async function approveCounterpartyRequestByIdLegacy({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const requestRow = await fetchCounterpartyRequestRow({
      tenantId,
      requestId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!requestRow) {
      throw badRequest("Counterparty request not found");
    }
    const requestScope = buildUnifiedRequestScope(requestRow);
    assertScopeAccess(req, requestScope.scopeType.toLowerCase(), requestScope.scopeId, "requestId");
    if (String(requestRow.request_status || "").toUpperCase() !== REQUEST_STATUS_PENDING) {
      throw badRequest(
        `Only PENDING requests can be approved (current: ${requestRow.request_status || "-"})`
      );
    }
    await assertSoD({
      tenantId,
      userId,
      actionCode: "cari.request.review",
      recordType: "COUNTERPARTY_REQUEST",
      recordId: requestId,
      context: {
        actorUserIds: {
          requestedByUserId: requestRow.requested_by_user_id,
        },
      },
    });

    const requestedPayload = parseStoredJson(requestRow.requested_payload_json);
    if (!requestedPayload || typeof requestedPayload !== "object") {
      throw badRequest("Requested payload is missing or invalid");
    }

    let createdRow;
    try {
      createdRow = await createCounterpartyTx({
        req,
        payload: {
          ...requestedPayload,
          tenantId,
          userId,
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
           decision_comment = ?,
           decided_by_user_id = ?,
           created_counterparty_id = ?,
           decided_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [
        REQUEST_STATUS_APPROVED,
        decisionComment || null,
        userId,
        createdRow.id,
        tenantId,
        requestId,
      ]
    );

    await insertCounterpartyRequestAuditLog({
      req,
      runQuery: tx.query,
      tenantId,
      userId,
      action: "cari.counterparty_request.approve",
      requestId,
      legalEntityId: parsePositiveInt(requestRow.legal_entity_id),
      payload: {
        decisionComment: decisionComment || null,
        createdCounterpartyId: createdRow.id,
      },
    });

    const approvedRow = await fetchCounterpartyRequestRow({
      tenantId,
      requestId,
      runQuery: tx.query,
    });
    return {
      request: mapCounterpartyRequestRow(approvedRow),
      counterparty: createdRow,
    };
  });
}

async function rejectCounterpartyRequestByIdLegacy({
  req,
  tenantId,
  requestId,
  userId,
  decisionComment,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const requestRow = await fetchCounterpartyRequestRow({
      tenantId,
      requestId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!requestRow) {
      throw badRequest("Counterparty request not found");
    }
    const requestScope = buildUnifiedRequestScope(requestRow);
    assertScopeAccess(req, requestScope.scopeType.toLowerCase(), requestScope.scopeId, "requestId");
    if (String(requestRow.request_status || "").toUpperCase() !== REQUEST_STATUS_PENDING) {
      throw badRequest(
        `Only PENDING requests can be rejected (current: ${requestRow.request_status || "-"})`
      );
    }
    await assertSoD({
      tenantId,
      userId,
      actionCode: "cari.request.review",
      recordType: "COUNTERPARTY_REQUEST",
      recordId: requestId,
      context: {
        actorUserIds: {
          requestedByUserId: requestRow.requested_by_user_id,
        },
      },
    });

    await tx.query(
      `UPDATE counterparty_requests
       SET request_status = ?,
           decision_comment = ?,
           decided_by_user_id = ?,
           decided_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [
        REQUEST_STATUS_REJECTED,
        decisionComment || null,
        userId,
        tenantId,
        requestId,
      ]
    );

    await insertCounterpartyRequestAuditLog({
      req,
      runQuery: tx.query,
      tenantId,
      userId,
      action: "cari.counterparty_request.reject",
      requestId,
      legalEntityId: parsePositiveInt(requestRow.legal_entity_id),
      payload: {
        decisionComment: decisionComment || null,
      },
    });

    const rejectedRow = await fetchCounterpartyRequestRow({
      tenantId,
      requestId,
      runQuery: tx.query,
    });
    return mapCounterpartyRequestRow(rejectedRow);
  });
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

  if (!isCounterpartyUnifiedApprovalEnabled()) {
    return createCounterpartyRequestLegacy({
      req,
      payload,
      tenantId,
      legalEntityId,
      primaryOperatingUnitId,
      requestedOperatingUnitIds,
      storedPayload,
    });
  }

  const approvalNeed = await evaluateApprovalNeed(
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
    return createCounterpartyRequestLegacy({
      req,
      payload,
      tenantId,
      legalEntityId,
      primaryOperatingUnitId,
      requestedOperatingUnitIds,
      storedPayload,
    });
  }

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

  if (
    !isCounterpartyUnifiedApprovalEnabled() ||
    !parsePositiveInt(requestRow.approval_request_id)
  ) {
    return approveCounterpartyRequestByIdLegacy({
      req,
      tenantId,
      requestId,
      userId,
      decisionComment,
      assertScopeAccess,
    });
  }

  ensureCounterpartyApprovalResolverRegistered();

  const approvalResult = await recordDecision(
    requestRow.approval_request_id,
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
        approvalRequestId: parsePositiveInt(requestRow.approval_request_id) || null,
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

  if (
    !isCounterpartyUnifiedApprovalEnabled() ||
    !parsePositiveInt(requestRow.approval_request_id)
  ) {
    return rejectCounterpartyRequestByIdLegacy({
      req,
      tenantId,
      requestId,
      userId,
      decisionComment,
      assertScopeAccess,
    });
  }

  const approvalResult = await recordDecision(
    requestRow.approval_request_id,
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
