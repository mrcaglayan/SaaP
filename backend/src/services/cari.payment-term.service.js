import { query } from "../db.js";
import { getVisibilityScope } from "../middleware/rbac.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

function mapPaymentTermRow(row) {
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    code: row.code,
    name: row.name,
    dueDays: Number(row.due_days || 0),
    graceDays: Number(row.grace_days || 0),
    isEndOfMonth: row.is_end_of_month === true || row.is_end_of_month === 1 || row.is_end_of_month === "1",
    status: row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function forbiddenError(message) {
  const err = new Error(message);
  err.status = 403;
  err.code = "FORBIDDEN";
  return err;
}

async function assertLegalEntityBelongsToTenant(tenantId, legalEntityId, fieldLabel = "legalEntityId") {
  const result = await query(
    `SELECT
       id,
       country_id,
       group_company_id
     FROM legal_entities
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(`${fieldLabel} not found for tenant`);
  }
  return row;
}

function buildPaymentTermVisibilityWhere(req, tenantId, params) {
  const scopeContext = getVisibilityScope(req);
  if (!scopeContext) {
    return "1 = 0";
  }
  if (scopeContext.tenantWide) {
    return "1 = 1";
  }

  const clauses = [];

  // Payment terms are legal-entity-owned rows. Use the legalEntities set as
  // the canonical expanded visibility envelope. Country/group scopes are
  // already expanded into legalEntities by the RBAC hierarchy resolver.
  //
  // Do not filter directly by le.country_id or le.group_company_id here:
  // legal-entity scoped users also carry parent country/group context for
  // hierarchy checks, and using those parent sets would over-broaden reads.
  const legalEntityIds = Array.from(scopeContext.legalEntities || []).filter(Boolean);
  if (legalEntityIds.length > 0) {
    params.push(...legalEntityIds);
    clauses.push(
      `pt.legal_entity_id IN (${legalEntityIds.map(() => "?").join(", ")})`
    );
  }

  const operatingUnitIds = Array.from(scopeContext.operatingUnits || []).filter(Boolean);
  if (operatingUnitIds.length > 0) {
    params.push(tenantId, ...operatingUnitIds);
    clauses.push(
      `pt.legal_entity_id IN (
         SELECT DISTINCT ou.legal_entity_id
         FROM operating_units ou
         WHERE ou.tenant_id = ?
           AND ou.id IN (${operatingUnitIds.map(() => "?").join(", ")})
       )`
    );
  }

  if (clauses.length === 0) {
    return "1 = 0";
  }
  return `(${clauses.join(" OR ")})`;
}
async function assertVisibleLegalEntityForRead(req, tenantId, legalEntityId, label = "legalEntityId") {
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const legalEntityRow = await assertLegalEntityBelongsToTenant(
    tenantId,
    parsedLegalEntityId,
    label
  );
  const scopeContext = getVisibilityScope(req);
  if (!scopeContext) {
    throw forbiddenError(`Access denied for ${label}`);
  }
  if (scopeContext.tenantWide) {
    return legalEntityRow;
  }

  // Use the expanded legalEntities set as the canonical read envelope.
  // Country/group scopes are already expanded into legalEntities. This avoids
  // granting all sibling entities merely because a legal-entity scoped actor
  // also carries parent country/group context.
  if (scopeContext.legalEntities?.has(parsedLegalEntityId)) {
    return legalEntityRow;
  }

  const operatingUnitIds = Array.from(scopeContext.operatingUnits || []).filter(Boolean);
  if (operatingUnitIds.length > 0) {
    const result = await query(
      `SELECT 1
       FROM operating_units
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id IN (${operatingUnitIds.map(() => "?").join(", ")})
       LIMIT 1`,
      [tenantId, legalEntityId, ...operatingUnitIds]
    );
    if (result.rows?.[0]) {
      return legalEntityRow;
    }
  }

  throw forbiddenError(`Access denied for ${label}`);
}

export async function resolvePaymentTermScope(paymentTermId, tenantId) {
  const parsedPaymentTermId = parsePositiveInt(paymentTermId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedPaymentTermId || !parsedTenantId) {
    return null;
  }

  const result = await query(
    `SELECT legal_entity_id
     FROM payment_terms
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [parsedTenantId, parsedPaymentTermId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

/**
 * List payment terms visible to the current actor inside the scoped legal
 * entity envelope they can read or request against.
 */
export async function listPaymentTerms({
  req,
  tenantId,
  filters,
}) {
  const params = [tenantId];
  const conditions = ["pt.tenant_id = ?", "le.tenant_id = pt.tenant_id", "le.id = pt.legal_entity_id"];
  conditions.push(buildPaymentTermVisibilityWhere(req, tenantId, params));

  if (filters.legalEntityId) {
    await assertVisibleLegalEntityForRead(req, tenantId, filters.legalEntityId, "legalEntityId");
    conditions.push("pt.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }

  if (filters.status) {
    conditions.push("pt.status = ?");
    params.push(filters.status);
  }

  if (filters.q) {
    conditions.push("(pt.code LIKE ? OR pt.name LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const whereSql = conditions.join(" AND ");
  const totalResult = await query(
    `SELECT COUNT(*) AS row_count
     FROM payment_terms pt
     JOIN legal_entities le
       ON le.id = pt.legal_entity_id
      AND le.tenant_id = pt.tenant_id
     WHERE ${whereSql}`,
    params
  );
  const total = Number(totalResult.rows?.[0]?.row_count || 0);

  const safeLimit =
    Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;

  const result = await query(
    `SELECT
        pt.id,
        pt.tenant_id,
        pt.legal_entity_id,
        pt.code,
        pt.name,
        pt.due_days,
        pt.grace_days,
        pt.is_end_of_month,
        pt.status,
        pt.created_at,
        pt.updated_at
     FROM payment_terms pt
     JOIN legal_entities le
       ON le.id = pt.legal_entity_id
      AND le.tenant_id = pt.tenant_id
     WHERE ${whereSql}
     ORDER BY pt.code ASC, pt.id ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (result.rows || []).map(mapPaymentTermRow),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Load one payment term after verifying the actor can see its parent legal
 * entity through direct, country/group, or operating-unit scope.
 */
export async function getPaymentTermByIdForTenant({
  req,
  tenantId,
  paymentTermId,
}) {
  const result = await query(
    `SELECT
        pt.id,
        pt.tenant_id,
        pt.legal_entity_id,
        le.country_id,
        le.group_company_id,
        pt.code,
        pt.name,
        pt.due_days,
        pt.grace_days,
        pt.is_end_of_month,
        pt.status,
        pt.created_at,
        pt.updated_at
     FROM payment_terms pt
     JOIN legal_entities le
       ON le.id = pt.legal_entity_id
      AND le.tenant_id = pt.tenant_id
     WHERE pt.tenant_id = ?
       AND pt.id = ?
     LIMIT 1`,
    [tenantId, paymentTermId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest("Payment term not found");
  }

  await assertVisibleLegalEntityForRead(req, tenantId, parsePositiveInt(row.legal_entity_id), "paymentTermId");
  return mapPaymentTermRow(row);
}

export async function createPaymentTerm({
  req,
  payload,
  assertScopeAccess,
}) {
  await assertLegalEntityBelongsToTenant(payload.tenantId, payload.legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");

  let paymentTermId = 0;
  try {
    const insertResult = await query(
      `INSERT INTO payment_terms (
         tenant_id,
         legal_entity_id,
         code,
         name,
         due_days,
         grace_days,
         is_end_of_month,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.tenantId,
        payload.legalEntityId,
        payload.code,
        payload.name,
        payload.dueDays,
        payload.graceDays,
        payload.isEndOfMonth ? 1 : 0,
        payload.status,
      ]
    );
    paymentTermId = Number(insertResult.rows?.insertId || 0);
  } catch (error) {
    const code = Number(error?.errno || 0);
    const message = String(error?.message || "").toLowerCase();
    if (code === 1062 || message.includes("duplicate")) {
      throw badRequest("Payment term code already exists for legalEntityId");
    }
    throw error;
  }

  if (!Number.isInteger(paymentTermId) || paymentTermId <= 0) {
    throw badRequest("Failed to create payment term");
  }

  const row = await getPaymentTermByIdForTenant({
    req,
    tenantId: payload.tenantId,
    paymentTermId,
    assertScopeAccess,
  });
  return row;
}
