import { query, withTransaction } from "../db.js";
import {
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildOwnershipContext,
  normalizeOwnershipContextInput,
} from "./ownership.context.policy.service.js";

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function clipText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function normalizeOptionalText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw badRequest(`Value cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

function normalizeOptionalUpperText(value, maxLength) {
  const normalized = normalizeOptionalText(value, maxLength);
  return normalized ? normalized.toUpperCase() : null;
}

function parseLenientDateOnly(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw) {
      return raw;
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function monthEndFromDateOnly(value) {
  const parsed = parseLenientDateOnly(value);
  if (!parsed) {
    return null;
  }
  const [yearText, monthText] = parsed.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function buildExplicitOwnershipContext({
  ownershipScope,
  operatingUnitId,
  operatingUnitCode,
  operatingUnitName,
} = {}) {
  const normalizedScope = normalizeUpperText(ownershipScope);
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId) || null;
  if (!normalizedScope && !normalizedOperatingUnitId) {
    return null;
  }
  if (normalizedScope === "CENTRAL" && !normalizedOperatingUnitId) {
    return buildOwnershipContext({
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      operatingUnitCode: null,
      operatingUnitName: null,
    });
  }
  if (normalizedScope === "OPERATING_UNIT" && normalizedOperatingUnitId) {
    return buildOwnershipContext({
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: normalizedOperatingUnitId,
      operatingUnitCode,
      operatingUnitName,
    });
  }
  if (normalizedOperatingUnitId) {
    return buildOwnershipContext({
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: normalizedOperatingUnitId,
      operatingUnitCode,
      operatingUnitName,
    });
  }
  return null;
}

function parseDateOnlyOrNull(value, label) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw badRequest(`${label} must be a valid date`);
  }
  return raw;
}

function makeNotFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function makeConflict(message, details = null) {
  const err = new Error(message);
  err.status = 409;
  if (details) {
    err.details = details;
  }
  return err;
}

function normalizeAssignmentStatus(value, fallback = "ACTIVE") {
  const normalized = normalizeUpperText(value || fallback);
  if (!["ACTIVE", "INACTIVE"].includes(normalized)) {
    throw badRequest("status must be one of ACTIVE, INACTIVE");
  }
  return normalized;
}

export function normalizePayrollEmployeeCode(value) {
  const normalized = normalizeUpperText(value);
  if (!normalized) {
    throw badRequest("employeeCode is required");
  }
  if (normalized.length > 100) {
    throw badRequest("employeeCode cannot exceed 100 characters");
  }
  return normalized;
}

export function normalizePayrollCostCenterCode(value) {
  const normalized = normalizeUpperText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length > 100) {
    throw badRequest("costCenterCode cannot exceed 100 characters");
  }
  return normalized;
}

function toScopeRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    employee_code: normalizeUpperText(row.employee_code),
    ownership_scope: normalizeUpperText(row.ownership_scope),
    status: normalizeUpperText(row.status),
    source_type: normalizeUpperText(row.source_type),
    expected_cost_center_code: row.expected_cost_center_code || null,
    ownership_context: buildOwnershipContext({
      ownershipScope: row.ownership_scope,
      operatingUnitId: row.operating_unit_id,
      operatingUnitCode: row.operating_unit_code,
      operatingUnitName: row.operating_unit_name,
    }),
  };
}

function datesOverlap(leftFrom, leftTo, rightFrom, rightTo) {
  const leftEnd = leftTo || "9999-12-31";
  const rightEnd = rightTo || "9999-12-31";
  return leftFrom <= rightEnd && rightFrom <= leftEnd;
}

function buildResolutionNote({
  resolutionStatus,
  employeeCode,
  asOfDate,
  expectedCostCenterCode = null,
  importedCostCenterCode = null,
  candidateCount = null,
} = {}) {
  if (resolutionStatus === "UNRESOLVED") {
    return clipText(
      `No active payroll ownership assignment found for employee ${employeeCode} as of ${asOfDate}.`,
      255
    );
  }
  if (resolutionStatus === "AMBIGUOUS") {
    return clipText(
      `Multiple active payroll ownership assignments (${candidateCount || 0}) match employee ${employeeCode} as of ${asOfDate}.`,
      255
    );
  }
  if (resolutionStatus === "MISMATCH") {
    return clipText(
      `Expected cost center ${expectedCostCenterCode || "-"} but imported ${importedCostCenterCode || "-"}.`,
      255
    );
  }
  return null;
}

function buildValidationSampleLine(line) {
  return {
    line_no: parsePositiveInt(line?.line_no) || null,
    employee_code: normalizeUpperText(line?.employee_code),
    employee_name: clipText(line?.employee_name, 255),
    cost_center_code: normalizePayrollCostCenterCode(line?.cost_center_code),
    ownership_scope: normalizeUpperText(line?.ownership_scope) || null,
    operating_unit_id: parsePositiveInt(line?.operating_unit_id),
    operating_unit_code: clipText(line?.operating_unit_code, 80),
    operating_unit_name: clipText(line?.operating_unit_name, 200),
    ownership_assignment_id: parsePositiveInt(line?.ownership_assignment_id),
    ownership_resolution_status:
      normalizeUpperText(line?.ownership_resolution_status) || "UNRESOLVED",
    ownership_resolution_note: clipText(line?.ownership_resolution_note, 255),
  };
}

async function getAssignmentScopeRowById({ tenantId, assignmentId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, tenant_id, legal_entity_id
     FROM payroll_employee_owner_context_assignments
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, assignmentId]
  );
  return result.rows?.[0] || null;
}

async function getAssignmentRowById({
  tenantId,
  assignmentId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
        a.id,
        a.tenant_id,
        a.legal_entity_id,
        a.employee_code,
        a.employee_name_snapshot,
        a.ownership_scope,
        a.operating_unit_id,
        a.effective_from,
        a.effective_to,
        a.status,
        a.expected_cost_center_code,
        a.source_type,
        a.notes,
        a.created_by_user_id,
        a.updated_by_user_id,
        a.deactivated_by_user_id,
        a.deactivated_at,
        a.created_at,
        a.updated_at,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
     FROM payroll_employee_owner_context_assignments a
     JOIN legal_entities le
       ON le.id = a.legal_entity_id
      AND le.tenant_id = a.tenant_id
     LEFT JOIN operating_units ou
       ON ou.id = a.operating_unit_id
      AND ou.tenant_id = a.tenant_id
     WHERE a.tenant_id = ?
       AND a.id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, assignmentId]
  );
  return toScopeRow(result.rows?.[0] || null);
}

async function lockActiveAssignmentsForEmployee({
  tenantId,
  legalEntityId,
  employeeCode,
  runQuery,
}) {
  const result = await runQuery(
    `SELECT
        id,
        effective_from,
        effective_to,
        status
     FROM payroll_employee_owner_context_assignments
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND employee_code = ?
       AND status = 'ACTIVE'
     ORDER BY effective_from ASC, id ASC
     FOR UPDATE`,
    [tenantId, legalEntityId, employeeCode]
  );
  return result.rows || [];
}

async function assertOperatingUnitMatchesLegalEntity({
  tenantId,
  legalEntityId,
  operatingUnitId,
}) {
  if (!operatingUnitId) {
    return null;
  }
  const operatingUnit = await assertOperatingUnitBelongsToTenant(
    tenantId,
    operatingUnitId,
    "operatingUnitId"
  );
  if (parsePositiveInt(operatingUnit.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest("operatingUnitId must belong to the same legalEntityId");
  }
  return operatingUnit;
}

function normalizeAssignmentInput(input, { allowPartial = false } = {}) {
  const hasField = (key) => Object.prototype.hasOwnProperty.call(input || {}, key);
  const result = {};

  if (!allowPartial || hasField("legalEntityId")) {
    const parsedLegalEntityId = parsePositiveInt(input?.legalEntityId);
    if (!parsedLegalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    result.legalEntityId = parsedLegalEntityId;
  }

  if (!allowPartial || hasField("employeeCode")) {
    result.employeeCode = normalizePayrollEmployeeCode(input?.employeeCode);
  }

  if (!allowPartial || hasField("employeeNameSnapshot")) {
    result.employeeNameSnapshot = normalizeOptionalText(input?.employeeNameSnapshot, 255);
  }

  const hasOwnershipFields =
    hasField("ownershipScope") || hasField("operatingUnitId") || !allowPartial;
  if (hasOwnershipFields) {
    if (allowPartial) {
      if (hasField("ownershipScope")) {
        const normalizedOwnershipScope = normalizeUpperText(input?.ownershipScope);
        if (!["CENTRAL", "OPERATING_UNIT"].includes(normalizedOwnershipScope)) {
          throw badRequest("ownershipScope must be one of CENTRAL, OPERATING_UNIT");
        }
        result.ownershipScope = normalizedOwnershipScope;
      }
      if (hasField("operatingUnitId")) {
        result.operatingUnitId =
          input?.operatingUnitId === undefined || input?.operatingUnitId === null || input?.operatingUnitId === ""
            ? null
            : parsePositiveInt(input.operatingUnitId);
        if (input?.operatingUnitId && !result.operatingUnitId) {
          throw badRequest("operatingUnitId must be a positive integer");
        }
      }
    } else {
      const normalizedContext = normalizeOwnershipContextInput({
        ownershipScope: input?.ownershipScope,
        operatingUnitId: input?.operatingUnitId,
        scopeFieldName: "ownershipScope",
        operatingUnitFieldName: "operatingUnitId",
        defaultOwnershipScope: "CENTRAL",
      });
      result.ownershipScope = normalizedContext.ownershipScope;
      result.operatingUnitId = normalizedContext.operatingUnitId;
    }
  }

  if (!allowPartial || hasField("effectiveFrom")) {
    const effectiveFrom = parseDateOnlyOrNull(input?.effectiveFrom, "effectiveFrom");
    if (!effectiveFrom) {
      throw badRequest("effectiveFrom is required");
    }
    result.effectiveFrom = effectiveFrom;
  }

  if (!allowPartial || hasField("effectiveTo")) {
    result.effectiveTo = parseDateOnlyOrNull(input?.effectiveTo, "effectiveTo");
  }

  if (!allowPartial || hasField("status")) {
    result.status = normalizeAssignmentStatus(input?.status, "ACTIVE");
  }

  if (!allowPartial || hasField("expectedCostCenterCode")) {
    result.expectedCostCenterCode = normalizeOptionalUpperText(
      input?.expectedCostCenterCode,
      100
    );
  }

  if (!allowPartial || hasField("sourceType")) {
    const sourceType = normalizeOptionalUpperText(input?.sourceType, 40);
    result.sourceType = sourceType || "MANUAL";
  }

  if (!allowPartial || hasField("notes")) {
    result.notes = normalizeOptionalText(input?.notes, 500);
  }

  if (result.effectiveFrom && result.effectiveTo && result.effectiveFrom > result.effectiveTo) {
    throw badRequest("effectiveTo must be on or after effectiveFrom");
  }

  return result;
}

export async function resolvePayrollOwnershipAssignmentScope(assignmentId, tenantId) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedAssignmentId = parsePositiveInt(assignmentId);
  if (!parsedTenantId || !parsedAssignmentId) {
    return null;
  }
  const row = await getAssignmentScopeRowById({
    tenantId: parsedTenantId,
    assignmentId: parsedAssignmentId,
  });
  if (!row) {
    return null;
  }
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export async function listPayrollOwnershipAssignmentRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["a.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "a.legal_entity_id", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("a.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.employeeCode) {
    conditions.push("a.employee_code = ?");
    params.push(filters.employeeCode);
  }
  if (filters.operatingUnitId) {
    conditions.push("a.operating_unit_id = ?");
    params.push(filters.operatingUnitId);
  }
  if (filters.status) {
    conditions.push("a.status = ?");
    params.push(filters.status);
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(
      `(
        a.employee_code LIKE ?
        OR a.employee_name_snapshot LIKE ?
        OR le.code LIKE ?
        OR le.name LIKE ?
        OR ou.code LIKE ?
        OR ou.name LIKE ?
        OR a.expected_cost_center_code LIKE ?
      )`
    );
    params.push(like, like, like, like, like, like, like);
  }

  const whereSql = conditions.join(" AND ");
  const countResult = await query(
    `SELECT COUNT(*) AS total
     FROM payroll_employee_owner_context_assignments a
     JOIN legal_entities le
       ON le.id = a.legal_entity_id
      AND le.tenant_id = a.tenant_id
     LEFT JOIN operating_units ou
       ON ou.id = a.operating_unit_id
      AND ou.tenant_id = a.tenant_id
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const safeLimit =
    Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;

  const listResult = await query(
    `SELECT
        a.id,
        a.tenant_id,
        a.legal_entity_id,
        a.employee_code,
        a.employee_name_snapshot,
        a.ownership_scope,
        a.operating_unit_id,
        a.effective_from,
        a.effective_to,
        a.status,
        a.expected_cost_center_code,
        a.source_type,
        a.notes,
        a.created_by_user_id,
        a.updated_by_user_id,
        a.deactivated_by_user_id,
        a.deactivated_at,
        a.created_at,
        a.updated_at,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
     FROM payroll_employee_owner_context_assignments a
     JOIN legal_entities le
       ON le.id = a.legal_entity_id
      AND le.tenant_id = a.tenant_id
     LEFT JOIN operating_units ou
       ON ou.id = a.operating_unit_id
      AND ou.tenant_id = a.tenant_id
     WHERE ${whereSql}
     ORDER BY
       le.code ASC,
       a.employee_code ASC,
       a.effective_from DESC,
       a.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (listResult.rows || []).map((row) => toScopeRow(row)),
    total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

export async function getPayrollOwnershipAssignmentByIdForTenant({
  req,
  tenantId,
  assignmentId,
  assertScopeAccess,
}) {
  const row = await getAssignmentRowById({ tenantId, assignmentId });
  if (!row) {
    throw makeNotFound("Payroll ownership assignment not found");
  }
  assertScopeAccess(req, "legal_entity", row.legal_entity_id, "assignmentId");
  return { item: row };
}

async function validateNoActiveOverlap({
  tenantId,
  legalEntityId,
  employeeCode,
  effectiveFrom,
  effectiveTo,
  currentAssignmentId = null,
  runQuery,
}) {
  const lockedRows = await lockActiveAssignmentsForEmployee({
    tenantId,
    legalEntityId,
    employeeCode,
    runQuery,
  });

  const conflicts = lockedRows.filter((row) => {
    if (currentAssignmentId && parsePositiveInt(row.id) === parsePositiveInt(currentAssignmentId)) {
      return false;
    }
    return datesOverlap(
      String(row.effective_from || "").slice(0, 10),
      row.effective_to ? String(row.effective_to).slice(0, 10) : null,
      effectiveFrom,
      effectiveTo
    );
  });

  if (conflicts.length > 0) {
    throw makeConflict(
      `Active ownership assignment overlap for employee ${employeeCode}`,
      {
        employeeCode,
        legalEntityId,
        overlappingAssignmentIds: conflicts.map((row) => parsePositiveInt(row.id)).filter(Boolean),
      }
    );
  }
}

export async function createPayrollOwnershipAssignment({
  req,
  tenantId,
  userId,
  input,
  assertScopeAccess,
}) {
  const payload = normalizeAssignmentInput(input, { allowPartial: false });
  await assertLegalEntityBelongsToTenant(tenantId, payload.legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");
  await assertOperatingUnitMatchesLegalEntity({
    tenantId,
    legalEntityId: payload.legalEntityId,
    operatingUnitId: payload.operatingUnitId,
  });

  return withTransaction(async (tx) => {
    if (payload.status === "ACTIVE") {
      await validateNoActiveOverlap({
        tenantId,
        legalEntityId: payload.legalEntityId,
        employeeCode: payload.employeeCode,
        effectiveFrom: payload.effectiveFrom,
        effectiveTo: payload.effectiveTo,
        runQuery: tx.query,
      });
    }

    const insertResult = await tx.query(
      `INSERT INTO payroll_employee_owner_context_assignments (
          tenant_id,
          legal_entity_id,
          employee_code,
          employee_name_snapshot,
          ownership_scope,
          operating_unit_id,
          effective_from,
          effective_to,
          status,
          expected_cost_center_code,
          source_type,
          notes,
          created_by_user_id,
          updated_by_user_id,
          deactivated_by_user_id,
          deactivated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        payload.legalEntityId,
        payload.employeeCode,
        payload.employeeNameSnapshot,
        payload.ownershipScope,
        payload.operatingUnitId,
        payload.effectiveFrom,
        payload.effectiveTo,
        payload.status,
        payload.expectedCostCenterCode,
        payload.sourceType,
        payload.notes,
        userId,
        userId,
        payload.status === "INACTIVE" ? userId : null,
        payload.status === "INACTIVE" ? new Date() : null,
      ]
    );
    const assignmentId = parsePositiveInt(insertResult.rows?.insertId);
    if (!assignmentId) {
      throw new Error("Failed to create payroll ownership assignment");
    }

    const item = await getAssignmentRowById({
      tenantId,
      assignmentId,
      runQuery: tx.query,
    });
    if (!item) {
      throw new Error("Created payroll ownership assignment not found");
    }

    return { item };
  });
}

export async function updatePayrollOwnershipAssignment({
  req,
  tenantId,
  userId,
  assignmentId,
  input,
  assertScopeAccess,
}) {
  const payload = normalizeAssignmentInput(input, { allowPartial: true });

  return withTransaction(async (tx) => {
    const current = await getAssignmentRowById({
      tenantId,
      assignmentId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!current) {
      throw makeNotFound("Payroll ownership assignment not found");
    }

    assertScopeAccess(req, "legal_entity", current.legal_entity_id, "assignmentId");

    const nextLegalEntityId = payload.legalEntityId ?? parsePositiveInt(current.legal_entity_id);
    await assertLegalEntityBelongsToTenant(tenantId, nextLegalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", nextLegalEntityId, "legalEntityId");

    const nextOwnershipScope = payload.ownershipScope ?? current.ownership_scope;
    const nextOperatingUnitId =
      payload.operatingUnitId !== undefined
        ? payload.operatingUnitId
        : nextOwnershipScope === "CENTRAL"
          ? null
          : parsePositiveInt(current.operating_unit_id);
    const normalizedContext = normalizeOwnershipContextInput({
      ownershipScope: nextOwnershipScope,
      operatingUnitId: nextOperatingUnitId,
      scopeFieldName: "ownershipScope",
      operatingUnitFieldName: "operatingUnitId",
      defaultOwnershipScope: "CENTRAL",
    });
    await assertOperatingUnitMatchesLegalEntity({
      tenantId,
      legalEntityId: nextLegalEntityId,
      operatingUnitId: normalizedContext.operatingUnitId,
    });

    const nextEmployeeCode = payload.employeeCode ?? normalizePayrollEmployeeCode(current.employee_code);
    const nextEffectiveFrom =
      payload.effectiveFrom ?? String(current.effective_from || "").slice(0, 10);
    const nextEffectiveTo =
      payload.effectiveTo !== undefined
        ? payload.effectiveTo
        : current.effective_to
          ? String(current.effective_to).slice(0, 10)
          : null;
    if (nextEffectiveFrom && nextEffectiveTo && nextEffectiveFrom > nextEffectiveTo) {
      throw badRequest("effectiveTo must be on or after effectiveFrom");
    }

    const nextStatus = payload.status ?? normalizeAssignmentStatus(current.status);
    if (nextStatus === "ACTIVE") {
      await validateNoActiveOverlap({
        tenantId,
        legalEntityId: nextLegalEntityId,
        employeeCode: nextEmployeeCode,
        effectiveFrom: nextEffectiveFrom,
        effectiveTo: nextEffectiveTo,
        currentAssignmentId: assignmentId,
        runQuery: tx.query,
      });
    }

    const nextDeactivatedByUserId =
      nextStatus === "INACTIVE"
        ? parsePositiveInt(current.deactivated_by_user_id) || userId
        : null;
    const nextDeactivatedAt =
      nextStatus === "INACTIVE"
        ? current.deactivated_at || new Date()
        : null;

    await tx.query(
      `UPDATE payroll_employee_owner_context_assignments
       SET legal_entity_id = ?,
           employee_code = ?,
           employee_name_snapshot = ?,
           ownership_scope = ?,
           operating_unit_id = ?,
           effective_from = ?,
           effective_to = ?,
           status = ?,
           expected_cost_center_code = ?,
           source_type = ?,
           notes = ?,
           updated_by_user_id = ?,
           deactivated_by_user_id = ?,
           deactivated_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [
        nextLegalEntityId,
        nextEmployeeCode,
        payload.employeeNameSnapshot !== undefined
          ? payload.employeeNameSnapshot
          : current.employee_name_snapshot,
        normalizedContext.ownershipScope,
        normalizedContext.operatingUnitId,
        nextEffectiveFrom,
        nextEffectiveTo,
        nextStatus,
        payload.expectedCostCenterCode !== undefined
          ? payload.expectedCostCenterCode
          : current.expected_cost_center_code,
        payload.sourceType ?? current.source_type,
        payload.notes !== undefined ? payload.notes : current.notes,
        userId,
        nextDeactivatedByUserId,
        nextDeactivatedAt,
        tenantId,
        assignmentId,
      ]
    );

    const item = await getAssignmentRowById({
      tenantId,
      assignmentId,
      runQuery: tx.query,
    });
    if (!item) {
      throw new Error("Updated payroll ownership assignment not found");
    }
    return { item };
  });
}

export async function deactivatePayrollOwnershipAssignment({
  req,
  tenantId,
  userId,
  assignmentId,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const current = await getAssignmentRowById({
      tenantId,
      assignmentId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!current) {
      throw makeNotFound("Payroll ownership assignment not found");
    }

    assertScopeAccess(req, "legal_entity", current.legal_entity_id, "assignmentId");

    if (normalizeAssignmentStatus(current.status) === "INACTIVE") {
      return {
        item: current,
        alreadyInactive: true,
      };
    }

    await tx.query(
      `UPDATE payroll_employee_owner_context_assignments
       SET status = 'INACTIVE',
           updated_by_user_id = ?,
           deactivated_by_user_id = ?,
           deactivated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [userId, userId, tenantId, assignmentId]
    );

    const item = await getAssignmentRowById({
      tenantId,
      assignmentId,
      runQuery: tx.query,
    });
    if (!item) {
      throw new Error("Deactivated payroll ownership assignment not found");
    }
    return {
      item,
      alreadyInactive: false,
    };
  });
}

export async function resolvePayrollEmployeeOwnershipContext({
  tenantId,
  legalEntityId,
  employeeCode,
  asOfDate,
  runQuery = query,
}) {
  const normalizedEmployeeCode = normalizePayrollEmployeeCode(employeeCode);
  const effectiveAsOfDate = parseDateOnlyOrNull(asOfDate, "asOfDate");
  if (!effectiveAsOfDate) {
    throw badRequest("asOfDate is required");
  }

  const result = await runQuery(
    `SELECT
        a.id,
        a.tenant_id,
        a.legal_entity_id,
        a.employee_code,
        a.employee_name_snapshot,
        a.ownership_scope,
        a.operating_unit_id,
        a.effective_from,
        a.effective_to,
        a.status,
        a.expected_cost_center_code,
        a.source_type,
        a.notes,
        a.created_by_user_id,
        a.updated_by_user_id,
        a.deactivated_by_user_id,
        a.deactivated_at,
        a.created_at,
        a.updated_at,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
     FROM payroll_employee_owner_context_assignments a
     JOIN legal_entities le
       ON le.id = a.legal_entity_id
      AND le.tenant_id = a.tenant_id
     LEFT JOIN operating_units ou
       ON ou.id = a.operating_unit_id
      AND ou.tenant_id = a.tenant_id
     WHERE a.tenant_id = ?
       AND a.legal_entity_id = ?
       AND a.employee_code = ?
       AND a.status = 'ACTIVE'
       AND a.effective_from <= ?
       AND COALESCE(a.effective_to, '9999-12-31') >= ?
     ORDER BY a.effective_from DESC, a.id DESC`,
    [
      tenantId,
      legalEntityId,
      normalizedEmployeeCode,
      effectiveAsOfDate,
      effectiveAsOfDate,
    ]
  );

  const rows = (result.rows || []).map((row) => toScopeRow(row));
  if (rows.length === 0) {
    return {
      resolution_status: "UNRESOLVED",
      employee_code: normalizedEmployeeCode,
      ownership_as_of_date: effectiveAsOfDate,
      assignment: null,
      candidates: [],
    };
  }
  if (rows.length > 1) {
    return {
      resolution_status: "AMBIGUOUS",
      employee_code: normalizedEmployeeCode,
      ownership_as_of_date: effectiveAsOfDate,
      assignment: null,
      candidates: rows,
    };
  }

  return {
    resolution_status: "RESOLVED",
    employee_code: normalizedEmployeeCode,
    ownership_as_of_date: effectiveAsOfDate,
    ownership_scope: rows[0].ownership_scope,
    operating_unit_id: parsePositiveInt(rows[0].operating_unit_id),
    assignment: rows[0],
    candidates: rows,
  };
}

export function derivePayrollOwnershipAsOfDate({ payrollPeriod, payDate } = {}) {
  const fromPayrollPeriod = monthEndFromDateOnly(payrollPeriod);
  if (fromPayrollPeriod) {
    return fromPayrollPeriod;
  }

  const fromPayDate = parseLenientDateOnly(payDate);
  if (fromPayDate) {
    return fromPayDate;
  }

  throw badRequest(
    "ownershipAsOfDate could not be derived; payrollPeriod or payDate must be a valid date"
  );
}

export async function resolvePayrollRunLineOwnershipSnapshot({
  tenantId,
  legalEntityId,
  employeeCode,
  costCenterCode,
  asOfDate,
  runQuery = query,
}) {
  const resolution = await resolvePayrollEmployeeOwnershipContext({
    tenantId,
    legalEntityId,
    employeeCode,
    asOfDate,
    runQuery,
  });
  const normalizedCostCenterCode = normalizePayrollCostCenterCode(costCenterCode);

  if (resolution.resolution_status === "UNRESOLVED") {
    return {
      employee_code: resolution.employee_code,
      ownership_as_of_date: resolution.ownership_as_of_date,
      ownership_scope: null,
      operating_unit_id: null,
      ownership_assignment_id: null,
      ownership_resolution_status: "UNRESOLVED",
      ownership_resolution_note: buildResolutionNote({
        resolutionStatus: "UNRESOLVED",
        employeeCode: resolution.employee_code,
        asOfDate: resolution.ownership_as_of_date,
      }),
      ownership_context: null,
      assignment: null,
      candidates: [],
    };
  }

  if (resolution.resolution_status === "AMBIGUOUS") {
    return {
      employee_code: resolution.employee_code,
      ownership_as_of_date: resolution.ownership_as_of_date,
      ownership_scope: null,
      operating_unit_id: null,
      ownership_assignment_id: null,
      ownership_resolution_status: "AMBIGUOUS",
      ownership_resolution_note: buildResolutionNote({
        resolutionStatus: "AMBIGUOUS",
        employeeCode: resolution.employee_code,
        asOfDate: resolution.ownership_as_of_date,
        candidateCount: Array.isArray(resolution.candidates)
          ? resolution.candidates.length
          : 0,
      }),
      ownership_context: null,
      assignment: null,
      candidates: resolution.candidates || [],
    };
  }

  const assignment = resolution.assignment || null;
  const expectedCostCenterCode = normalizePayrollCostCenterCode(
    assignment?.expected_cost_center_code
  );
  const hasMismatch =
    Boolean(expectedCostCenterCode) &&
    expectedCostCenterCode !== normalizePayrollCostCenterCode(normalizedCostCenterCode);

  return {
    employee_code: resolution.employee_code,
    ownership_as_of_date: resolution.ownership_as_of_date,
    ownership_scope: resolution.ownership_scope,
    operating_unit_id: parsePositiveInt(resolution.operating_unit_id),
    ownership_assignment_id: parsePositiveInt(assignment?.id),
    ownership_resolution_status: hasMismatch ? "MISMATCH" : "RESOLVED",
    ownership_resolution_note: hasMismatch
      ? buildResolutionNote({
          resolutionStatus: "MISMATCH",
          expectedCostCenterCode,
          importedCostCenterCode: normalizedCostCenterCode,
        })
      : null,
    ownership_context: buildExplicitOwnershipContext({
      ownershipScope: resolution.ownership_scope,
      operatingUnitId: resolution.operating_unit_id,
      operatingUnitCode: assignment?.operating_unit_code,
      operatingUnitName: assignment?.operating_unit_name,
    }),
    assignment,
    candidates: resolution.candidates || [],
  };
}

export function buildPayrollRunOwnershipSummary(lines = []) {
  const summary = {
    total_line_count: 0,
    resolved_line_count: 0,
    unresolved_line_count: 0,
    ambiguous_line_count: 0,
    mismatch_line_count: 0,
    owner_context_count: 0,
    mixed_ou_count: 0,
    has_mixed_owner_contexts: false,
    breakdown: [],
  };

  const breakdownMap = new Map();

  for (const line of Array.isArray(lines) ? lines : []) {
    summary.total_line_count += 1;
    const status = normalizeUpperText(
      line?.ownership_resolution_status ?? line?.resolution_status
    );
    if (status === "RESOLVED") {
      summary.resolved_line_count += 1;
    } else if (status === "UNRESOLVED") {
      summary.unresolved_line_count += 1;
    } else if (status === "AMBIGUOUS") {
      summary.ambiguous_line_count += 1;
    } else if (status === "MISMATCH") {
      summary.mismatch_line_count += 1;
    }

    if (!["RESOLVED", "MISMATCH"].includes(status)) {
      continue;
    }

    const ownershipScope = normalizeUpperText(line?.ownership_scope);
    const operatingUnitId = parsePositiveInt(
      line?.operating_unit_id ?? line?.operatingUnitId
    );
    const key = `${ownershipScope || "UNKNOWN"}:${operatingUnitId || 0}`;
    if (!breakdownMap.has(key)) {
      breakdownMap.set(key, {
        ownership_scope: ownershipScope || null,
        operating_unit_id: operatingUnitId,
        operating_unit_code: clipText(
          line?.operating_unit_code ?? line?.operatingUnitCode,
          80
        ),
        operating_unit_name: clipText(
          line?.operating_unit_name ?? line?.operatingUnitName,
          200
        ),
        line_count: 0,
        resolved_line_count: 0,
        mismatch_line_count: 0,
      });
    }

    const bucket = breakdownMap.get(key);
    bucket.line_count += 1;
    if (status === "RESOLVED") {
      bucket.resolved_line_count += 1;
    } else if (status === "MISMATCH") {
      bucket.mismatch_line_count += 1;
    }
  }

  summary.breakdown = Array.from(breakdownMap.values()).sort((left, right) => {
    const leftScope = normalizeUpperText(left?.ownership_scope);
    const rightScope = normalizeUpperText(right?.ownership_scope);
    if (leftScope !== rightScope) {
      if (leftScope === "CENTRAL") {
        return -1;
      }
      if (rightScope === "CENTRAL") {
        return 1;
      }
    }
    const leftCode = clipText(left?.operating_unit_code, 80) || "";
    const rightCode = clipText(right?.operating_unit_code, 80) || "";
    if (leftCode !== rightCode) {
      return leftCode.localeCompare(rightCode);
    }
    return (left?.operating_unit_id || 0) - (right?.operating_unit_id || 0);
  });
  summary.owner_context_count = summary.breakdown.length;
  summary.mixed_ou_count = summary.breakdown.filter(
    (row) => normalizeUpperText(row?.ownership_scope) === "OPERATING_UNIT"
  ).length;
  summary.has_mixed_owner_contexts = summary.owner_context_count > 1;

  return summary;
}

export function buildPayrollRunOwnershipValidationDetails(
  lines = [],
  { ownershipAsOfDate = null, sampleLimit = 10 } = {}
) {
  const normalizedLines = Array.isArray(lines) ? lines : [];
  const ownershipSummary = buildPayrollRunOwnershipSummary(normalizedLines);
  const blockingStatuses = ["UNRESOLVED", "AMBIGUOUS", "MISMATCH"];
  const blockingLines = normalizedLines.filter((line) =>
    blockingStatuses.includes(normalizeUpperText(line?.ownership_resolution_status))
  );

  return {
    ownership_as_of_date:
      parseDateOnlyOrNull(ownershipAsOfDate, "ownershipAsOfDate") ||
      parseDateOnlyOrNull(
        normalizedLines[0]?.ownership_as_of_date,
        "ownershipAsOfDate"
      ) ||
      null,
    summary: ownershipSummary,
    blocking_statuses: blockingStatuses.filter((status) =>
      blockingLines.some(
        (line) => normalizeUpperText(line?.ownership_resolution_status) === status
      )
    ),
    blocking_line_count: blockingLines.length,
    can_finalize: blockingLines.length === 0,
    sample_lines: blockingLines
      .slice(0, Math.max(1, Number(sampleLimit || 10)))
      .map((line) => buildValidationSampleLine(line)),
  };
}

async function listPayrollRunOwnershipLines({
  tenantId,
  legalEntityId,
  runId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
        l.id,
        l.tenant_id,
        l.legal_entity_id,
        l.run_id,
        l.line_no,
        l.employee_code,
        l.employee_name,
        l.cost_center_code,
        l.ownership_scope,
        l.operating_unit_id,
        l.ownership_assignment_id,
        l.ownership_resolution_status,
        l.ownership_resolution_note,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
     FROM payroll_run_lines l
     LEFT JOIN operating_units ou
       ON ou.id = l.operating_unit_id
      AND ou.tenant_id = l.tenant_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND l.run_id = ?
     ORDER BY l.line_no ASC, l.id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, legalEntityId, runId]
  );
  return result.rows || [];
}

export async function getPayrollRunOwnershipValidationDetails({
  tenantId,
  legalEntityId,
  runId,
  ownershipAsOfDate = null,
  runQuery = query,
}) {
  const lines = await listPayrollRunOwnershipLines({
    tenantId,
    legalEntityId,
    runId,
    runQuery,
    forUpdate: false,
  });
  return buildPayrollRunOwnershipValidationDetails(lines, {
    ownershipAsOfDate,
  });
}

export async function reresolvePayrollRunOwnershipSnapshots({
  tenantId,
  legalEntityId,
  runId,
  ownershipAsOfDate,
  runType,
  runQuery = query,
}) {
  const effectiveOwnershipAsOfDate = parseDateOnlyOrNull(
    ownershipAsOfDate,
    "ownershipAsOfDate"
  );
  if (!effectiveOwnershipAsOfDate) {
    throw badRequest("ownershipAsOfDate is required for payroll ownership re-resolution");
  }

  const lockedLines = await listPayrollRunOwnershipLines({
    tenantId,
    legalEntityId,
    runId,
    runQuery,
    forUpdate: true,
  });

  if (normalizeUpperText(runType) === "REVERSAL") {
    return {
      skipped: true,
      skip_reason: "REVERSAL_RUN",
      updated_line_count: 0,
      total_line_count: lockedLines.length,
      validation: buildPayrollRunOwnershipValidationDetails(lockedLines, {
        ownershipAsOfDate: effectiveOwnershipAsOfDate,
      }),
      lines: lockedLines,
    };
  }

  const nextLines = [];
  let updatedLineCount = 0;

  for (const line of lockedLines) {
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await resolvePayrollRunLineOwnershipSnapshot({
      tenantId,
      legalEntityId,
      employeeCode: line.employee_code,
      costCenterCode: line.cost_center_code,
      asOfDate: effectiveOwnershipAsOfDate,
      runQuery,
    });

    const nextLine = {
      ...line,
      ownership_scope: snapshot.ownership_scope,
      operating_unit_id: snapshot.operating_unit_id,
      ownership_assignment_id: snapshot.ownership_assignment_id,
      ownership_resolution_status: snapshot.ownership_resolution_status,
      ownership_resolution_note: snapshot.ownership_resolution_note,
      operating_unit_code:
        snapshot.assignment?.operating_unit_code ?? line.operating_unit_code ?? null,
      operating_unit_name:
        snapshot.assignment?.operating_unit_name ?? line.operating_unit_name ?? null,
      ownership_as_of_date: snapshot.ownership_as_of_date,
    };

    const changed =
      normalizeUpperText(line.ownership_scope) !== normalizeUpperText(nextLine.ownership_scope) ||
      parsePositiveInt(line.operating_unit_id) !== parsePositiveInt(nextLine.operating_unit_id) ||
      parsePositiveInt(line.ownership_assignment_id) !==
        parsePositiveInt(nextLine.ownership_assignment_id) ||
      normalizeUpperText(line.ownership_resolution_status) !==
        normalizeUpperText(nextLine.ownership_resolution_status) ||
      String(line.ownership_resolution_note || "") !==
        String(nextLine.ownership_resolution_note || "");

    if (changed) {
      // eslint-disable-next-line no-await-in-loop
      await runQuery(
        `UPDATE payroll_run_lines
         SET ownership_scope = ?,
             operating_unit_id = ?,
             ownership_assignment_id = ?,
             ownership_resolution_status = ?,
             ownership_resolution_note = ?
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND id = ?`,
        [
          nextLine.ownership_scope,
          nextLine.operating_unit_id,
          nextLine.ownership_assignment_id,
          nextLine.ownership_resolution_status,
          nextLine.ownership_resolution_note,
          tenantId,
          legalEntityId,
          parsePositiveInt(line.id),
        ]
      );
      updatedLineCount += 1;
    }

    nextLines.push(nextLine);
  }

  return {
    skipped: false,
    skip_reason: null,
    updated_line_count: updatedLineCount,
    total_line_count: nextLines.length,
    validation: buildPayrollRunOwnershipValidationDetails(nextLines, {
      ownershipAsOfDate: effectiveOwnershipAsOfDate,
    }),
    lines: nextLines,
  };
}

export default {
  normalizePayrollEmployeeCode,
  normalizePayrollCostCenterCode,
  resolvePayrollOwnershipAssignmentScope,
  listPayrollOwnershipAssignmentRows,
  getPayrollOwnershipAssignmentByIdForTenant,
  createPayrollOwnershipAssignment,
  updatePayrollOwnershipAssignment,
  deactivatePayrollOwnershipAssignment,
  derivePayrollOwnershipAsOfDate,
  resolvePayrollEmployeeOwnershipContext,
  resolvePayrollRunLineOwnershipSnapshot,
  buildPayrollRunOwnershipSummary,
  buildPayrollRunOwnershipValidationDetails,
  getPayrollRunOwnershipValidationDetails,
  reresolvePayrollRunOwnershipSnapshots,
};
