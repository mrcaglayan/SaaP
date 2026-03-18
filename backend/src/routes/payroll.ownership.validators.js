import { badRequest, parsePositiveInt } from "./_utils.js";
import {
  normalizeText,
  optionalPositiveInt,
  parsePagination,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeEmployeeCodeOrNull(value, label = "employeeCode") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = normalizeUpperText(value);
  if (normalized.length > 100) {
    throw badRequest(`${label} cannot exceed 100 characters`);
  }
  return normalized || null;
}

function normalizeStatusOrNull(value, label = "status") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const normalized = normalizeUpperText(value);
  if (!["ACTIVE", "INACTIVE"].includes(normalized)) {
    throw badRequest(`${label} must be one of ACTIVE, INACTIVE`);
  }
  return normalized;
}

function parseOptionalDateOnly(value, label) {
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

function parseAssignmentIdParam(req) {
  const assignmentId = parsePositiveInt(req.params?.assignmentId ?? req.params?.id);
  if (!assignmentId) {
    throw badRequest("assignmentId must be a positive integer");
  }
  return assignmentId;
}

export function parsePayrollOwnershipAssignmentListFilters(req) {
  const pagination = parsePagination(req.query, { limit: 100, offset: 0, maxLimit: 500 });
  return {
    tenantId: requireTenantId(req),
    legalEntityId: optionalPositiveInt(
      req.query?.legalEntityId ?? req.query?.legal_entity_id,
      "legalEntityId"
    ),
    employeeCode: normalizeEmployeeCodeOrNull(
      req.query?.employeeCode ?? req.query?.employee_code,
      "employeeCode"
    ),
    operatingUnitId: optionalPositiveInt(
      req.query?.operatingUnitId ?? req.query?.operating_unit_id,
      "operatingUnitId"
    ),
    status: normalizeStatusOrNull(req.query?.status, "status"),
    q: normalizeText(req.query?.q, "q", 120),
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export function parsePayrollOwnershipAssignmentReadInput(req) {
  return {
    tenantId: requireTenantId(req),
    assignmentId: parseAssignmentIdParam(req),
  };
}

function parseOwnershipAssignmentBody(req, { partial = false } = {}) {
  const payload = {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
  };

  if (!partial || req.body?.legalEntityId !== undefined || req.body?.legal_entity_id !== undefined) {
    const legalEntityId = parsePositiveInt(req.body?.legalEntityId ?? req.body?.legal_entity_id);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    payload.legalEntityId = legalEntityId;
  }

  if (!partial || req.body?.employeeCode !== undefined || req.body?.employee_code !== undefined) {
    const employeeCode = normalizeEmployeeCodeOrNull(
      req.body?.employeeCode ?? req.body?.employee_code,
      "employeeCode"
    );
    if (!employeeCode) {
      throw badRequest("employeeCode is required");
    }
    payload.employeeCode = employeeCode;
  }

  if (
    !partial ||
    req.body?.employeeNameSnapshot !== undefined ||
    req.body?.employee_name_snapshot !== undefined
  ) {
    payload.employeeNameSnapshot = normalizeText(
      req.body?.employeeNameSnapshot ?? req.body?.employee_name_snapshot,
      "employeeNameSnapshot",
      255
    );
  }

  if (
    !partial ||
    req.body?.ownershipScope !== undefined ||
    req.body?.ownership_scope !== undefined
  ) {
    payload.ownershipScope = normalizeUpperText(
      req.body?.ownershipScope ?? req.body?.ownership_scope
    );
  }

  if (
    !partial ||
    req.body?.operatingUnitId !== undefined ||
    req.body?.operating_unit_id !== undefined
  ) {
    const rawOperatingUnitId = req.body?.operatingUnitId ?? req.body?.operating_unit_id;
    payload.operatingUnitId =
      rawOperatingUnitId === null || rawOperatingUnitId === ""
        ? null
        : optionalPositiveInt(rawOperatingUnitId, "operatingUnitId");
  }

  if (!partial || req.body?.effectiveFrom !== undefined || req.body?.effective_from !== undefined) {
    const effectiveFrom = parseOptionalDateOnly(
      req.body?.effectiveFrom ?? req.body?.effective_from,
      "effectiveFrom"
    );
    if (!effectiveFrom) {
      throw badRequest("effectiveFrom is required");
    }
    payload.effectiveFrom = effectiveFrom;
  }

  if (!partial || req.body?.effectiveTo !== undefined || req.body?.effective_to !== undefined) {
    payload.effectiveTo = parseOptionalDateOnly(
      req.body?.effectiveTo ?? req.body?.effective_to,
      "effectiveTo"
    );
  }

  if (!partial || req.body?.status !== undefined) {
    const status = normalizeStatusOrNull(req.body?.status, "status");
    if (!status) {
      throw badRequest("status is required");
    }
    payload.status = status;
  }

  if (
    !partial ||
    req.body?.expectedCostCenterCode !== undefined ||
    req.body?.expected_cost_center_code !== undefined
  ) {
    payload.expectedCostCenterCode = normalizeEmployeeCodeOrNull(
      req.body?.expectedCostCenterCode ?? req.body?.expected_cost_center_code,
      "expectedCostCenterCode"
    );
  }

  if (!partial || req.body?.sourceType !== undefined || req.body?.source_type !== undefined) {
    payload.sourceType = normalizeText(
      req.body?.sourceType ?? req.body?.source_type,
      "sourceType",
      40
    )
      ? normalizeUpperText(req.body?.sourceType ?? req.body?.source_type)
      : partial
        ? undefined
        : "MANUAL";
  }

  if (!partial || req.body?.notes !== undefined) {
    payload.notes = normalizeText(req.body?.notes, "notes", 500);
  }

  return payload;
}

export function parsePayrollOwnershipAssignmentCreateInput(req) {
  return parseOwnershipAssignmentBody(req, { partial: false });
}

export function parsePayrollOwnershipAssignmentUpdateInput(req) {
  const payload = parseOwnershipAssignmentBody(req, { partial: true });
  payload.assignmentId = parseAssignmentIdParam(req);

  const updatableFields = [
    "legalEntityId",
    "employeeCode",
    "employeeNameSnapshot",
    "ownershipScope",
    "operatingUnitId",
    "effectiveFrom",
    "effectiveTo",
    "status",
    "expectedCostCenterCode",
    "sourceType",
    "notes",
  ];
  if (!updatableFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field))) {
    throw badRequest("At least one updatable field is required");
  }

  return payload;
}

export function parsePayrollOwnershipAssignmentDeactivateInput(req) {
  return {
    tenantId: requireTenantId(req),
    userId: requireUserId(req),
    assignmentId: parseAssignmentIdParam(req),
  };
}
