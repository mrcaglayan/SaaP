import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertBookBelongsToTenant,
  assertFiscalPeriodBelongsToCalendar,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import {
  buildLocalClosePackScopeKey,
  LOCAL_CLOSE_PACK_STATUS_VALUES,
  resolveLocalClosePackRowScope,
} from "./local.close-packs.shared.js";

function toUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDateTime(value) {
  return value || null;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function isDuplicateKeyError(err) {
  return Number(err?.errno) === 1062 || toUpperText(err?.code) === "ER_DUP_ENTRY";
}

function mapLocalClosePackRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    bookId: parsePositiveInt(row.book_id),
    bookCode: row.book_code || null,
    bookName: row.book_name || null,
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    fiscalYear: Number(row.fiscal_year || 0) || null,
    periodNo: Number(row.period_no || 0) || null,
    periodName: row.period_name || null,
    closeScopeType: toUpperText(row.close_scope_type),
    scopeKey: String(row.scope_key || ""),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
    status: toUpperText(row.status),
    note: row.note || null,
    ownerUserId: parsePositiveInt(row.owner_user_id),
    ownerUserName: row.owner_user_name || null,
    reviewerUserId: parsePositiveInt(row.reviewer_user_id),
    reviewerUserName: row.reviewer_user_name || null,
    workflowInstanceId: parsePositiveInt(row.workflow_instance_id),
    workflowInstanceStatus: row.workflow_instance_status
      ? toUpperText(row.workflow_instance_status)
      : null,
    workflowCurrentStepNo: Number(row.workflow_current_step_no || 0) || null,
    pendingReopenRequestCount: Number(row.pending_reopen_request_count || 0) || 0,
    submittedAt: toDateTime(row.submitted_at),
    approvedAt: toDateTime(row.approved_at),
    lockedAt: toDateTime(row.locked_at),
    reopenedAt: toDateTime(row.reopened_at),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdByUserName: row.created_by_user_name || null,
    updatedByUserId: parsePositiveInt(row.updated_by_user_id),
    updatedByUserName: row.updated_by_user_name || null,
    createdAt: toDateTime(row.created_at),
    updatedAt: toDateTime(row.updated_at),
  };
}

function assertLocalClosePackRowReadable(req, row, assertScopeAccess) {
  const scope = resolveLocalClosePackRowScope(row);
  if (!scope) {
    return;
  }
  assertScopeAccess(req, scope.scopeKind, scope.scopeId, "localClosePack");
}

function canReadLocalClosePackRow(req, row, assertScopeAccess) {
  try {
    assertLocalClosePackRowReadable(req, row, assertScopeAccess);
    return true;
  } catch (err) {
    if (Number(err?.status) === 403) {
      return false;
    }
    throw err;
  }
}

function buildLocalClosePackBaseSelect(whereSql) {
  return `SELECT
      lcp.*,
      le.code AS legal_entity_code,
      le.name AS legal_entity_name,
      b.code AS book_code,
      b.name AS book_name,
      fp.fiscal_year,
      fp.period_no,
      fp.period_name,
      ou.code AS operating_unit_code,
      ou.name AS operating_unit_name,
      owner_user.name AS owner_user_name,
      reviewer_user.name AS reviewer_user_name,
      creator.name AS created_by_user_name,
      updater.name AS updated_by_user_name,
      wi.status AS workflow_instance_status,
      wi.current_step_no AS workflow_current_step_no,
      (
        SELECT COUNT(*)
        FROM local_close_pack_reopen_requests lcrr
        WHERE lcrr.tenant_id = lcp.tenant_id
          AND lcrr.local_close_pack_id = lcp.id
          AND lcrr.request_status = 'REQUESTED'
      ) AS pending_reopen_request_count
    FROM local_close_packs lcp
    JOIN legal_entities le ON le.id = lcp.legal_entity_id
    JOIN books b ON b.id = lcp.book_id
    JOIN fiscal_periods fp ON fp.id = lcp.fiscal_period_id
    LEFT JOIN operating_units ou ON ou.id = lcp.operating_unit_id
    LEFT JOIN users owner_user ON owner_user.id = lcp.owner_user_id
    LEFT JOIN users reviewer_user ON reviewer_user.id = lcp.reviewer_user_id
    LEFT JOIN users creator ON creator.id = lcp.created_by_user_id
    LEFT JOIN users updater ON updater.id = lcp.updated_by_user_id
    LEFT JOIN workflow_instances wi ON wi.id = lcp.workflow_instance_id
    WHERE ${whereSql}`;
}

/**
 * Resolve the RBAC scope for a local close-pack row.
 */
export async function resolveLocalClosePackScope(packId, tenantId, runQuery = query) {
  const normalizedPackId = parsePositiveInt(packId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedPackId || !normalizedTenantId) {
    return null;
  }

  const result = await runQuery(
    `SELECT id, legal_entity_id, operating_unit_id, close_scope_type
     FROM local_close_packs
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [normalizedTenantId, normalizedPackId]
  );
  const row = result.rows?.[0] || null;
  const scope = resolveLocalClosePackRowScope(row);
  return scope
    ? {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      }
    : null;
}

/**
 * List local close-pack headers with row-level scope filtering.
 */
export async function listLocalClosePacks({
  req,
  tenantId,
  filters,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const where = ["lcp.tenant_id = ?"];
  const params = [normalizedTenantId];

  if (filters?.legalEntityId) {
    where.push("lcp.legal_entity_id = ?");
    params.push(parsePositiveInt(filters.legalEntityId));
  }
  if (filters?.bookId) {
    where.push("lcp.book_id = ?");
    params.push(parsePositiveInt(filters.bookId));
  }
  if (filters?.fiscalPeriodId) {
    where.push("lcp.fiscal_period_id = ?");
    params.push(parsePositiveInt(filters.fiscalPeriodId));
  }
  if (filters?.closeScopeType) {
    where.push("lcp.close_scope_type = ?");
    params.push(toUpperText(filters.closeScopeType));
  }
  if (filters?.operatingUnitId) {
    where.push("lcp.operating_unit_id = ?");
    params.push(parsePositiveInt(filters.operatingUnitId));
  }
  if (filters?.status) {
    where.push("lcp.status = ?");
    params.push(toUpperText(filters.status));
  }
  if (filters?.q) {
    where.push(
      `(le.code LIKE ? OR le.name LIKE ? OR b.code LIKE ? OR b.name LIKE ? OR ou.code LIKE ? OR ou.name LIKE ?)`
    );
    const wildcard = `%${filters.q}%`;
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
  }

  const result = await runQuery(
    `${buildLocalClosePackBaseSelect(where.join(" AND "))}
     ORDER BY lcp.fiscal_period_id DESC, lcp.book_id ASC, lcp.id DESC`,
    params
  );

  const scopedRows = (result.rows || []).filter((row) =>
    canReadLocalClosePackRow(req, row, assertScopeAccess)
  );
  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;

  return {
    rows: scopedRows
      .slice(safeOffset, safeOffset + safeLimit)
      .map(mapLocalClosePackRow),
    total: scopedRows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Load one local close-pack header and enforce row-level scope access.
 */
export async function getLocalClosePackById({
  req,
  tenantId,
  packId,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedPackId = parsePositiveInt(packId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedPackId) {
    throw badRequest("packId is required");
  }

  const result = await runQuery(
    `${buildLocalClosePackBaseSelect("lcp.tenant_id = ? AND lcp.id = ?")}
     LIMIT 1`,
    [normalizedTenantId, normalizedPackId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw notFound("Local close pack not found");
  }

  assertLocalClosePackRowReadable(req, row, assertScopeAccess);
  return mapLocalClosePackRow(row);
}

/**
 * Create the baseline local close-pack header and validate its scope contract.
 */
export async function createLocalClosePack({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const userId = parsePositiveInt(input?.userId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }

  const closeScopeType = toUpperText(input.closeScopeType);
  if (!LOCAL_CLOSE_PACK_STATUS_VALUES.includes(toUpperText(input.status))) {
    throw badRequest("status is invalid for local close packs");
  }

  const legalEntity = await assertLegalEntityBelongsToTenant(
    tenantId,
    input.legalEntityId,
    "legalEntityId"
  );
  const book = await assertBookBelongsToTenant(tenantId, input.bookId, "bookId");
  if (parsePositiveInt(book.legal_entity_id) !== parsePositiveInt(legalEntity.id)) {
    throw badRequest("bookId must belong to the selected legalEntityId");
  }
  await assertFiscalPeriodBelongsToCalendar(
    parsePositiveInt(book.calendar_id),
    input.fiscalPeriodId,
    "fiscalPeriodId"
  );

  let operatingUnitId = null;
  if (closeScopeType === "OPERATING_UNIT") {
    const operatingUnit = await assertOperatingUnitBelongsToTenant(
      tenantId,
      input.operatingUnitId,
      "operatingUnitId"
    );
    if (parsePositiveInt(operatingUnit.legal_entity_id) !== parsePositiveInt(legalEntity.id)) {
      throw badRequest("operatingUnitId must belong to the selected legalEntityId");
    }
    operatingUnitId = parsePositiveInt(operatingUnit.id);
  }

  const scopeRow = {
    close_scope_type: closeScopeType,
    operating_unit_id: operatingUnitId,
    legal_entity_id: parsePositiveInt(legalEntity.id),
  };
  assertLocalClosePackRowReadable(req, scopeRow, assertScopeAccess);

  const scopeKey = buildLocalClosePackScopeKey({
    closeScopeType,
    operatingUnitId,
  });

  try {
    const insertResult = await runQuery(
      `INSERT INTO local_close_packs (
         tenant_id,
         legal_entity_id,
         book_id,
         fiscal_period_id,
         close_scope_type,
         scope_key,
         operating_unit_id,
         status,
         note,
         created_by_user_id,
         updated_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        parsePositiveInt(legalEntity.id),
        parsePositiveInt(book.id),
        parsePositiveInt(input.fiscalPeriodId),
        closeScopeType,
        scopeKey,
        operatingUnitId,
        toUpperText(input.status),
        input.note || null,
        userId,
        userId,
      ]
    );

    return getLocalClosePackById({
      req,
      tenantId,
      packId: parsePositiveInt(insertResult.rows?.insertId),
      assertScopeAccess,
      runQuery,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict(
        "Local close pack already exists for the selected book, fiscal period, and scope"
      );
    }
    throw err;
  }
}

export default {
  resolveLocalClosePackScope,
  listLocalClosePacks,
  getLocalClosePackById,
  createLocalClosePack,
};
