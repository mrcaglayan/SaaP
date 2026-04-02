import { query, withTransaction } from "../db.js";
import { getScopeContext, hasScopeAccess } from "../middleware/rbac.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertCountryExists,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import { createCounterpartyTx } from "./cari.counterparty.service.js";

const REQUEST_STATUS_PENDING = "PENDING";
const REQUEST_STATUS_APPROVED = "APPROVED";
const REQUEST_STATUS_REJECTED = "REJECTED";

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

function mapCounterpartyRequestRow(row) {
  const isCustomer = parseDbBoolean(row.is_customer);
  const isVendor = parseDbBoolean(row.is_vendor);
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
    requestStatus: row.request_status || REQUEST_STATUS_PENDING,
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

async function loadUserPermissionCodes({ tenantId, userId, runQuery = query }) {
  if (!parsePositiveInt(tenantId) || !parsePositiveInt(userId)) {
    return [];
  }
  const result = await runQuery(
    `SELECT
       p.code,
       SUM(CASE WHEN urs.effect = 'ALLOW' THEN 1 ELSE 0 END) AS allow_count,
       SUM(CASE WHEN urs.effect = 'DENY' AND urs.scope_type = 'TENANT' THEN 1 ELSE 0 END) AS tenant_deny_count
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE urs.user_id = ?
       AND urs.tenant_id = ?
     GROUP BY p.code
     HAVING allow_count > 0
        AND tenant_deny_count = 0`,
    [userId, tenantId]
  );
  return (result.rows || []).map((row) => String(row.code || "").trim()).filter(Boolean);
}

function buildCounterpartyRequestScopeWhere(req, params) {
  const scopeContext = getScopeContext(req);
  if (!scopeContext) {
    return "1 = 0";
  }
  if (scopeContext.tenantWide) {
    return "1 = 1";
  }

  const clauses = [];
  const legalEntityIds = Array.from(scopeContext.legalEntities || []).filter(Boolean);
  const operatingUnitIds = Array.from(scopeContext.operatingUnits || []).filter(Boolean);

  if (legalEntityIds.length > 0) {
    params.push(...legalEntityIds);
    clauses.push(`r.legal_entity_id IN (${legalEntityIds.map(() => "?").join(", ")})`);
  }
  if (operatingUnitIds.length > 0) {
    params.push(...operatingUnitIds);
    clauses.push(
      `(
         r.primary_operating_unit_id IS NOT NULL
         AND r.primary_operating_unit_id IN (${operatingUnitIds.map(() => "?").join(", ")})
       )`
    );
  }

  if (clauses.length === 0) {
    return "1 = 0";
  }
  return `(${clauses.join(" OR ")})`;
}

async function fetchCounterpartyRequestRow({
  tenantId,
  requestId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
        r.*,
        requester.name AS requested_by_user_name,
        decider.name AS decided_by_user_name,
        cp.code AS created_counterparty_code,
        cp.name AS created_counterparty_name
     FROM counterparty_requests r
     LEFT JOIN users requester
       ON requester.tenant_id = r.tenant_id
      AND requester.id = r.requested_by_user_id
     LEFT JOIN users decider
       ON decider.tenant_id = r.tenant_id
      AND decider.id = r.decided_by_user_id
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

/**
 * Resolve one request to its legal-entity scope for route protection.
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
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
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
  const canReviewAll = permissionCodes.includes("cari.card.upsert");
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
    conditions.push("r.request_status = ?");
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
     WHERE ${whereSql}`,
    params
  );
  const total = Number(totalResult.rows?.[0]?.row_count || 0);

  const result = await query(
    `SELECT
        r.*,
        requester.name AS requested_by_user_name,
        decider.name AS decided_by_user_name,
        cp.code AS created_counterparty_code,
        cp.name AS created_counterparty_name
     FROM counterparty_requests r
     LEFT JOIN users requester
       ON requester.tenant_id = r.tenant_id
      AND requester.id = r.requested_by_user_id
     LEFT JOIN users decider
       ON decider.tenant_id = r.tenant_id
      AND decider.id = r.decided_by_user_id
     LEFT JOIN counterparties cp
       ON cp.tenant_id = r.tenant_id
      AND cp.legal_entity_id = r.legal_entity_id
      AND cp.id = r.created_counterparty_id
     WHERE ${whereSql}
     ORDER BY
       CASE r.request_status
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
 * Submit one counterparty request without direct master upsert.
 */
export async function createCounterpartyRequest({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const legalEntityId = payload.legalEntityId;
  const primaryOperatingUnitId = parsePositiveInt(payload.primaryOperatingUnitId);

  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  const requestedOperatingUnitIds = await assertRequestedOperatingUnits({
    tenantId,
    legalEntityId,
    primaryOperatingUnitId,
    operatingUnitIds: payload.operatingUnitIds,
  });

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

/**
 * Approve one pending request and create the live counterparty card.
 */
export async function approveCounterpartyRequestById({
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
    assertScopeAccess(req, "legal_entity", requestRow.legal_entity_id, "requestId");
    if (String(requestRow.request_status || "").toUpperCase() !== REQUEST_STATUS_PENDING) {
      throw badRequest(
        `Only PENDING requests can be approved (current: ${requestRow.request_status || "-"})`
      );
    }
    if (parsePositiveInt(requestRow.requested_by_user_id) === parsePositiveInt(userId)) {
      throw forbiddenError("Maker-checker violation: requester cannot approve own request");
    }

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
        assertScopeAccess,
        runQuery: tx.query,
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

/**
 * Reject one pending request without creating a live counterparty.
 */
export async function rejectCounterpartyRequestById({
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
    assertScopeAccess(req, "legal_entity", requestRow.legal_entity_id, "requestId");
    if (String(requestRow.request_status || "").toUpperCase() !== REQUEST_STATUS_PENDING) {
      throw badRequest(
        `Only PENDING requests can be rejected (current: ${requestRow.request_status || "-"})`
      );
    }
    if (parsePositiveInt(requestRow.requested_by_user_id) === parsePositiveInt(userId)) {
      throw forbiddenError("Maker-checker violation: requester cannot reject own request");
    }

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
