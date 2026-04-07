import { badRequest } from "./_utils.js";
import {
  normalizeCode,
  normalizeEnum,
  normalizeText,
  optionalPositiveInt,
  parseBooleanFlag,
  parsePagination,
  requirePositiveInt,
  requireTenantId,
  requireUserId,
} from "./cash.validators.common.js";
import {
  LOCAL_CLOSE_PACK_WORKFLOW_PROCESS_TYPE,
  LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE,
} from "../services/local.close-packs.shared.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
  CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
} from "../../../shared/cariDocumentWorkflowGovernance.js";

const PROCESS_TYPES = [
  "PERIOD_CLOSE",
  "CONSOLIDATION_RUN",
  LOCAL_CLOSE_PACK_WORKFLOW_PROCESS_TYPE,
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
];
const STAGE_SCOPE_TYPES = ["OPERATING_UNIT", "LEGAL_ENTITY", "COUNTRY", "GROUP"];
const ASSIGNMENT_STATUS = ["ACTIVE", "INACTIVE"];
const INSTANCE_STATUS = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "SUPERSEDED"];
const TARGET_TYPES = [
  "PERIOD_CLOSE_RUN",
  "CONSOLIDATION_RUN",
  LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE,
  CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
];

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeOptionalEnum(value, label, allowedValues) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizeEnum(value, label, allowedValues);
}

function parseDateOnly(rawValue, label, { required = false } = {}) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    if (required) {
      throw badRequest(`${label} is required`);
    }
    return null;
  }

  const value = String(rawValue).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${label} must be a valid date`);
  }
  return value;
}

function parseNullablePositiveIntField(body, camelKey, snakeKey, label) {
  const provided = hasOwn(body, camelKey) || hasOwn(body, snakeKey);
  if (!provided) {
    return { provided: false, value: undefined };
  }
  const raw = hasOwn(body, camelKey) ? body[camelKey] : body[snakeKey];
  if (raw === null || raw === "") {
    return { provided: true, value: null };
  }
  return { provided: true, value: requirePositiveInt(raw, label) };
}

function parseNullableDateField(body, camelKey, snakeKey, label) {
  const provided = hasOwn(body, camelKey) || hasOwn(body, snakeKey);
  if (!provided) {
    return { provided: false, value: undefined };
  }
  const raw = hasOwn(body, camelKey) ? body[camelKey] : body[snakeKey];
  if (raw === null || raw === "") {
    return { provided: true, value: null };
  }
  return { provided: true, value: parseDateOnly(raw, label) };
}

function parseOptionalIsActiveFlag(query = {}) {
  const hasFlag = hasOwn(query, "isActive") || hasOwn(query, "is_active");
  if (!hasFlag) {
    return null;
  }
  return parseBooleanFlag(query.isActive ?? query.is_active, true);
}

function countAssignmentScopeTargets(input = {}) {
  return [
    input.groupCompanyId,
    input.countryId,
    input.legalEntityId,
    input.operatingUnitId,
  ].filter((value) => value !== undefined && value !== null && value !== "").length;
}

function assertSingleAssignmentScopeTarget(input, label) {
  if (countAssignmentScopeTargets(input) > 1) {
    throw badRequest(`${label} must set at most one of groupCompanyId, countryId, legalEntityId, or operatingUnitId`);
  }
}

function parseWorkflowCoverageDiagnosticSteps(steps, processType) {
  if (steps === undefined) {
    return [];
  }
  if (!Array.isArray(steps)) {
    throw badRequest("steps must be an array");
  }

  const normalizedProcessType = String(processType || "").toUpperCase();
  const seenStepNos = new Set();
  return steps.map((rawStep, index) => {
    const step = rawStep || {};
    const resolvedStepNo =
      step.stepNo ?? step.step_no ?? (Number.isInteger(index + 1) ? index + 1 : null);
    const stepNo = requirePositiveInt(resolvedStepNo, `steps[${index}].stepNo`);
    if (seenStepNos.has(stepNo)) {
      throw badRequest(`Duplicate stepNo detected: ${stepNo}`);
    }
    seenStepNos.add(stepNo);

    const requiredPermissionCode = normalizeText(
      step.requiredPermissionCode ?? step.required_permission_code,
      `steps[${index}].requiredPermissionCode`,
      120
    );
    if (
      normalizedProcessType !== AP_DOCUMENT_WORKFLOW_PROCESS_TYPE &&
      !requiredPermissionCode
    ) {
      throw badRequest(`steps[${index}].requiredPermissionCode is required`);
    }

    return {
      stepNo,
      stageScopeType: normalizeEnum(
        step.stageScopeType ?? step.stage_scope_type,
        `steps[${index}].stageScopeType`,
        STAGE_SCOPE_TYPES
      ),
      requiredPermissionCode:
        normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
          ? requiredPermissionCode || null
          : requiredPermissionCode,
      minApproverCount:
        step.minApproverCount === undefined &&
        step.min_approver_count === undefined
          ? 1
          : requirePositiveInt(
              step.minApproverCount ?? step.min_approver_count,
              `steps[${index}].minApproverCount`
            ),
    };
  });
}

export function parseWorkflowDefinitionIdParam(req) {
  return requirePositiveInt(
    req.params?.definitionId ?? req.params?.id,
    "definitionId"
  );
}

export function parseWorkflowAssignmentIdParam(req) {
  return requirePositiveInt(
    req.params?.assignmentId ?? req.params?.id,
    "assignmentId"
  );
}

export function parseWorkflowInstanceIdParam(req) {
  return requirePositiveInt(
    req.params?.instanceId ?? req.params?.id,
    "instanceId"
  );
}

export function parseWorkflowDefinitionsListInput(req) {
  const tenantId = requireTenantId(req);
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });

  return {
    tenantId,
    ...pagination,
    processType: normalizeOptionalEnum(
      req.query?.processType ?? req.query?.process_type,
      "processType",
      PROCESS_TYPES
    ),
    isActive: parseOptionalIsActiveFlag(req.query),
    q: normalizeText(req.query?.q, "q", 120),
  };
}

export function parseWorkflowDefinitionCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const body = req.body || {};

  return {
    tenantId,
    userId,
    code: normalizeCode(body.code, "code", 60),
    name: normalizeText(body.name, "name", 255, { required: true }),
    processType: normalizeEnum(
      body.processType ?? body.process_type,
      "processType",
      PROCESS_TYPES
    ),
    isActive: parseBooleanFlag(body.isActive ?? body.is_active, true),
    versionNo:
      body.versionNo === undefined && body.version_no === undefined
        ? 1
        : requirePositiveInt(body.versionNo ?? body.version_no, "versionNo"),
  };
}

export function parseWorkflowDefinitionUpdateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const definitionId = parseWorkflowDefinitionIdParam(req);
  const body = req.body || {};

  const patch = {
    tenantId,
    userId,
    definitionId,
  };

  if (hasOwn(body, "code")) {
    patch.code = normalizeCode(body.code, "code", 60);
  }
  if (hasOwn(body, "name")) {
    patch.name = normalizeText(body.name, "name", 255, { required: true });
  }
  if (hasOwn(body, "processType") || hasOwn(body, "process_type")) {
    patch.processType = normalizeEnum(
      body.processType ?? body.process_type,
      "processType",
      PROCESS_TYPES
    );
  }
  if (hasOwn(body, "isActive") || hasOwn(body, "is_active")) {
    patch.isActive = parseBooleanFlag(body.isActive ?? body.is_active, true);
  }
  if (hasOwn(body, "versionNo") || hasOwn(body, "version_no")) {
    patch.versionNo = requirePositiveInt(
      body.versionNo ?? body.version_no,
      "versionNo"
    );
  }

  const patchKeys = Object.keys(patch).filter(
    (key) => !["tenantId", "userId", "definitionId"].includes(key)
  );
  if (patchKeys.length === 0) {
    throw badRequest("At least one updatable field is required");
  }

  return patch;
}

/**
 * Parses one full workflow-definition step replacement payload.
 */
export function parseWorkflowDefinitionStepsReplaceInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const definitionId = parseWorkflowDefinitionIdParam(req);
  const body = req.body || {};

  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    throw badRequest("steps must be a non-empty array");
  }

  const seenStepNos = new Set();
  const steps = body.steps.map((rawStep, index) => {
    const step = rawStep || {};
    const resolvedStepNo =
      step.stepNo ?? step.step_no ?? (Number.isInteger(index + 1) ? index + 1 : null);
    const stepNo = requirePositiveInt(resolvedStepNo, `steps[${index}].stepNo`);
    if (seenStepNos.has(stepNo)) {
      throw badRequest(`Duplicate stepNo detected: ${stepNo}`);
    }
    seenStepNos.add(stepNo);

    return {
      stepNo,
      stageScopeType: normalizeEnum(
        step.stageScopeType ?? step.stage_scope_type,
        `steps[${index}].stageScopeType`,
        STAGE_SCOPE_TYPES
      ),
      requiredPermissionCode: normalizeText(
        step.requiredPermissionCode ?? step.required_permission_code,
        `steps[${index}].requiredPermissionCode`,
        120
      ),
      minApproverCount:
        step.minApproverCount === undefined &&
        step.min_approver_count === undefined
          ? 1
          : requirePositiveInt(
              step.minApproverCount ?? step.min_approver_count,
              `steps[${index}].minApproverCount`
            ),
      allowSelfApprove: parseBooleanFlag(
        step.allowSelfApprove ?? step.allow_self_approve,
        false
      ),
      escalationAfterHours:
        step.escalationAfterHours === undefined &&
        step.escalation_after_hours === undefined
          ? null
          : step.escalationAfterHours === null || step.escalation_after_hours === null
            ? null
            : requirePositiveInt(
                step.escalationAfterHours ?? step.escalation_after_hours,
                `steps[${index}].escalationAfterHours`
              ),
    };
  });

  return {
    tenantId,
    userId,
    definitionId,
    steps,
  };
}

/**
 * Parse one workflow-assignment list request, including optional country scope filters.
 */
export function parseWorkflowAssignmentsListInput(req) {
  const tenantId = requireTenantId(req);
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });

  return {
    tenantId,
    ...pagination,
    processType: normalizeOptionalEnum(
      req.query?.processType ?? req.query?.process_type,
      "processType",
      PROCESS_TYPES
    ),
    status: normalizeOptionalEnum(req.query?.status, "status", ASSIGNMENT_STATUS),
    workflowDefinitionId: optionalPositiveInt(
      req.query?.workflowDefinitionId ?? req.query?.workflow_definition_id,
      "workflowDefinitionId"
    ),
    groupCompanyId: optionalPositiveInt(
      req.query?.groupCompanyId ?? req.query?.group_company_id,
      "groupCompanyId"
    ),
    countryId: optionalPositiveInt(
      req.query?.countryId ?? req.query?.country_id,
      "countryId"
    ),
    legalEntityId: optionalPositiveInt(
      req.query?.legalEntityId ?? req.query?.legal_entity_id,
      "legalEntityId"
    ),
    operatingUnitId: optionalPositiveInt(
      req.query?.operatingUnitId ?? req.query?.operating_unit_id,
      "operatingUnitId"
    ),
    effectiveOn: parseDateOnly(
      req.query?.effectiveOn ?? req.query?.effective_on,
      "effectiveOn"
    ),
    q: normalizeText(req.query?.q, "q", 120),
  };
}

export function parseWorkflowInstancesListInput(req) {
  const tenantId = requireTenantId(req);
  const pagination = parsePagination(req.query, {
    limit: 100,
    offset: 0,
    maxLimit: 500,
  });

  return {
    tenantId,
    ...pagination,
    processType: normalizeOptionalEnum(
      req.query?.processType ?? req.query?.process_type,
      "processType",
      PROCESS_TYPES
    ),
    status: normalizeOptionalEnum(req.query?.status, "status", INSTANCE_STATUS),
    targetType: normalizeOptionalEnum(
      req.query?.targetType ?? req.query?.target_type,
      "targetType",
      TARGET_TYPES
    ),
    targetId: optionalPositiveInt(
      req.query?.targetId ?? req.query?.target_id,
      "targetId"
    ),
    workflowDefinitionId: optionalPositiveInt(
      req.query?.workflowDefinitionId ?? req.query?.workflow_definition_id,
      "workflowDefinitionId"
    ),
  };
}

/**
 * Parse one workflow-assignment create request and enforce the one-row-one-scope input rule.
 */
export function parseWorkflowAssignmentCreateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const body = req.body || {};

  const effectiveFrom = parseDateOnly(
    body.effectiveFrom ?? body.effective_from,
    "effectiveFrom",
    { required: true }
  );
  const effectiveTo = parseDateOnly(
    body.effectiveTo ?? body.effective_to,
    "effectiveTo"
  );
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw badRequest("effectiveTo cannot be earlier than effectiveFrom");
  }

  const input = {
    tenantId,
    userId,
    processType: normalizeEnum(
      body.processType ?? body.process_type,
      "processType",
      PROCESS_TYPES
    ),
    workflowDefinitionId: requirePositiveInt(
      body.workflowDefinitionId ?? body.workflow_definition_id,
      "workflowDefinitionId"
    ),
    groupCompanyId: optionalPositiveInt(
      body.groupCompanyId ?? body.group_company_id,
      "groupCompanyId"
    ),
    countryId: optionalPositiveInt(
      body.countryId ?? body.country_id,
      "countryId"
    ),
    legalEntityId: optionalPositiveInt(
      body.legalEntityId ?? body.legal_entity_id,
      "legalEntityId"
    ),
    operatingUnitId: optionalPositiveInt(
      body.operatingUnitId ?? body.operating_unit_id,
      "operatingUnitId"
    ),
    effectiveFrom,
    effectiveTo,
    status: normalizeEnum(
      body.status ?? "ACTIVE",
      "status",
      ASSIGNMENT_STATUS
    ),
  };
  assertSingleAssignmentScopeTarget(input, "Workflow assignment");
  return input;
}

/**
 * Parse one workflow coverage-diagnostics request for the setup review screen.
 */
export function parseWorkflowCoverageDiagnosticsInput(req) {
  const tenantId = requireTenantId(req);
  const body = req.body || {};
  const scopeType = normalizeOptionalEnum(
    body.scopeType ?? body.scope_type,
    "scopeType",
    ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"]
  );

  const input = {
    tenantId,
    processType: normalizeEnum(
      body.processType ?? body.process_type,
      "processType",
      PROCESS_TYPES
    ),
    groupCompanyId: optionalPositiveInt(
      body.groupCompanyId ?? body.group_company_id,
      "groupCompanyId"
    ),
    countryId: optionalPositiveInt(
      body.countryId ?? body.country_id,
      "countryId"
    ),
    legalEntityId: optionalPositiveInt(
      body.legalEntityId ?? body.legal_entity_id,
      "legalEntityId"
    ),
    operatingUnitId: optionalPositiveInt(
      body.operatingUnitId ?? body.operating_unit_id,
      "operatingUnitId"
    ),
    effectiveOn: parseDateOnly(
      body.effectiveOn ?? body.effective_on,
      "effectiveOn"
    ),
  };
  assertSingleAssignmentScopeTarget(input, "Workflow coverage diagnostics");

  if ((scopeType === "GROUP" && !input.groupCompanyId) ||
      (scopeType === "COUNTRY" && !input.countryId) ||
      (scopeType === "LEGAL_ENTITY" && !input.legalEntityId) ||
      (scopeType === "OPERATING_UNIT" && !input.operatingUnitId)) {
    throw badRequest(`scopeType ${scopeType} requires the matching scope id field`);
  }

  input.scopeType =
    scopeType ||
    (input.operatingUnitId
      ? "OPERATING_UNIT"
      : input.legalEntityId
        ? "LEGAL_ENTITY"
        : input.countryId
          ? "COUNTRY"
          : input.groupCompanyId
            ? "GROUP"
            : "TENANT");
  input.scopeId =
    input.scopeType === "OPERATING_UNIT"
      ? input.operatingUnitId
      : input.scopeType === "LEGAL_ENTITY"
        ? input.legalEntityId
        : input.scopeType === "COUNTRY"
          ? input.countryId
          : input.scopeType === "GROUP"
            ? input.groupCompanyId
            : tenantId;
  input.steps = parseWorkflowCoverageDiagnosticSteps(body.steps, input.processType);

  return input;
}

/**
 * Parse one workflow-assignment patch request and reject ambiguous scope-target combinations.
 */
export function parseWorkflowAssignmentUpdateInput(req) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const assignmentId = parseWorkflowAssignmentIdParam(req);
  const body = req.body || {};

  const processTypeProvided =
    hasOwn(body, "processType") || hasOwn(body, "process_type");
  const workflowDefinitionIdProvided =
    hasOwn(body, "workflowDefinitionId") || hasOwn(body, "workflow_definition_id");
  const statusProvided = hasOwn(body, "status");

  const groupCompanyField = parseNullablePositiveIntField(
    body,
    "groupCompanyId",
    "group_company_id",
    "groupCompanyId"
  );
  const countryField = parseNullablePositiveIntField(
    body,
    "countryId",
    "country_id",
    "countryId"
  );
  const legalEntityField = parseNullablePositiveIntField(
    body,
    "legalEntityId",
    "legal_entity_id",
    "legalEntityId"
  );
  const operatingUnitField = parseNullablePositiveIntField(
    body,
    "operatingUnitId",
    "operating_unit_id",
    "operatingUnitId"
  );
  const effectiveFromField = parseNullableDateField(
    body,
    "effectiveFrom",
    "effective_from",
    "effectiveFrom"
  );
  const effectiveToField = parseNullableDateField(
    body,
    "effectiveTo",
    "effective_to",
    "effectiveTo"
  );

  const patch = {
    tenantId,
    userId,
    assignmentId,
  };

  if (processTypeProvided) {
    patch.processType = normalizeEnum(
      body.processType ?? body.process_type,
      "processType",
      PROCESS_TYPES
    );
  }
  if (workflowDefinitionIdProvided) {
    patch.workflowDefinitionId = requirePositiveInt(
      body.workflowDefinitionId ?? body.workflow_definition_id,
      "workflowDefinitionId"
    );
  }
  if (statusProvided) {
    patch.status = normalizeEnum(body.status, "status", ASSIGNMENT_STATUS);
  }

  if (groupCompanyField.provided) {
    patch.groupCompanyId = groupCompanyField.value;
  }
  if (countryField.provided) {
    patch.countryId = countryField.value;
  }
  if (legalEntityField.provided) {
    patch.legalEntityId = legalEntityField.value;
  }
  if (operatingUnitField.provided) {
    patch.operatingUnitId = operatingUnitField.value;
  }
  if (effectiveFromField.provided) {
    patch.effectiveFrom = effectiveFromField.value;
  }
  if (effectiveToField.provided) {
    patch.effectiveTo = effectiveToField.value;
  }

  const patchKeys = Object.keys(patch).filter(
    (key) => !["tenantId", "userId", "assignmentId"].includes(key)
  );
  if (patchKeys.length === 0) {
    throw badRequest("At least one updatable field is required");
  }
  if (
    patch.effectiveFrom &&
    patch.effectiveTo &&
    patch.effectiveTo < patch.effectiveFrom
  ) {
    throw badRequest("effectiveTo cannot be earlier than effectiveFrom");
  }
  assertSingleAssignmentScopeTarget(patch, "Workflow assignment patch");

  return patch;
}

/**
 * Parses one workflow instance decision payload, optionally requiring a
 * non-empty reviewer comment for return/reject flows.
 */
export function parseWorkflowInstanceDecisionInput(req, { requireComment = false } = {}) {
  const tenantId = requireTenantId(req);
  const userId = requireUserId(req);
  const instanceId = parseWorkflowInstanceIdParam(req);
  const body = req.body || {};
  const decisionNote = normalizeText(
    body.decisionNote ?? body.decision_note,
    "decisionNote",
    500
  );

  if (requireComment && !decisionNote) {
    throw badRequest("decisionNote is required for RETURN or REJECT");
  }

  return {
    tenantId,
    userId,
    instanceId,
    decisionNote,
  };
}

export default {
  parseWorkflowDefinitionIdParam,
  parseWorkflowAssignmentIdParam,
  parseWorkflowInstanceIdParam,
  parseWorkflowDefinitionsListInput,
  parseWorkflowDefinitionCreateInput,
  parseWorkflowDefinitionUpdateInput,
  parseWorkflowDefinitionStepsReplaceInput,
  parseWorkflowAssignmentsListInput,
  parseWorkflowInstancesListInput,
  parseWorkflowAssignmentCreateInput,
  parseWorkflowCoverageDiagnosticsInput,
  parseWorkflowAssignmentUpdateInput,
  parseWorkflowInstanceDecisionInput,
};
