import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertCountryExists,
  assertGroupCompanyBelongsToTenant,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import {
  LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE,
} from "./local.close-packs.shared.js";
import {
  recordDecision,
  submitRequest,
} from "./approval.engine.service.js";
import {
  supersedeApprovedCariDocumentWorkflowInstanceTx,
  syncCariDocumentFromWorkflowRequestTx,
} from "./cari.document.workflow.runtime.service.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
  CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
} from "../../../shared/cariDocumentWorkflowGovernance.js";

const FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1 =
  "FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1";
const WORKFLOW_UNIFIED_MODULE_CODE = "WORKFLOW";
const WORKFLOW_UNIFIED_ACTION_TYPE = "APPROVE_WORKFLOW";

const WORKFLOW_INSTANCE_TARGET_SCOPE_SELECT_SQL = `COALESCE(
      period_close_book.legal_entity_id,
      local_close_pack.legal_entity_id,
      workflow_cari_doc.legal_entity_id
    ) AS target_legal_entity_id,
      COALESCE(
        period_close_entity.country_id,
        local_close_entity.country_id,
        workflow_cari_entity.country_id
      ) AS target_country_id,
      COALESCE(
        period_close_entity.group_company_id,
        local_close_entity.group_company_id,
        consolidation_group.group_company_id,
        workflow_cari_entity.group_company_id
      ) AS target_group_company_id,
      COALESCE(
        local_close_pack.operating_unit_id,
        workflow_cari_doc.operating_unit_id
      ) AS target_operating_unit_id`;

const WORKFLOW_INSTANCE_TARGET_SCOPE_JOIN_SQL = `LEFT JOIN period_close_runs pcr
      ON pcr.id = wi.target_id
     AND wi.target_type = 'PERIOD_CLOSE_RUN'
     AND pcr.tenant_id = wi.tenant_id
    LEFT JOIN books period_close_book ON period_close_book.id = pcr.book_id
    LEFT JOIN legal_entities period_close_entity
      ON period_close_entity.id = period_close_book.legal_entity_id
    LEFT JOIN consolidation_runs cr
      ON cr.id = wi.target_id
     AND wi.target_type = 'CONSOLIDATION_RUN'
    LEFT JOIN consolidation_groups consolidation_group
      ON consolidation_group.id = cr.consolidation_group_id
     AND consolidation_group.tenant_id = wi.tenant_id
    LEFT JOIN local_close_packs local_close_pack
      ON local_close_pack.id = wi.target_id
     AND wi.target_type = '${LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE}'
     AND local_close_pack.tenant_id = wi.tenant_id
    LEFT JOIN legal_entities local_close_entity
      ON local_close_entity.id = local_close_pack.legal_entity_id
    LEFT JOIN cari_documents workflow_cari_doc
      ON workflow_cari_doc.id = wi.target_id
     AND wi.target_type = '${CARI_DOCUMENT_WORKFLOW_TARGET_TYPE}'
     AND workflow_cari_doc.tenant_id = wi.tenant_id
    LEFT JOIN legal_entities workflow_cari_entity
      ON workflow_cari_entity.id = workflow_cari_doc.legal_entity_id`;

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDbBoolean(value) {
  return value === true || Number(value) === 1;
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function toDateOnly(value) {
  if (!value) {
    return null;
  }
  const asText = String(value);
  const dateOnlyMatch = asText.match(/\d{4}-\d{2}-\d{2}/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[0];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function notFound(message, code = "") {
  const err = new Error(message);
  err.status = 404;
  if (code) {
    err.code = code;
  }
  return err;
}

function conflict(message, code = "") {
  const err = new Error(message);
  err.status = 409;
  if (code) {
    err.code = code;
  }
  return err;
}

function forbidden(message, code = "") {
  const err = new Error(message);
  err.status = 403;
  if (code) {
    err.code = code;
  }
  return err;
}

function isDuplicateKeyError(err) {
  return Number(err?.errno) === 1062 || toUpper(err?.code) === "ER_DUP_ENTRY";
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function mapWorkflowProcessToUnifiedTargetType(processType) {
  const normalized = toUpper(processType);
  if (normalized === "PERIOD_CLOSE") {
    return "PERIOD_CLOSE_RUN";
  }
  if (normalized === "CONSOLIDATION_RUN") {
    return "CONSOLIDATION_RUN";
  }
  if (normalized === "LOCAL_CLOSE_PACK") {
    return LOCAL_CLOSE_PACK_WORKFLOW_TARGET_TYPE;
  }
  if (normalized === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return CARI_DOCUMENT_WORKFLOW_TARGET_TYPE;
  }
  return normalized;
}

function isApDocumentWorkflowProcessType(processType) {
  return toUpper(processType) === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;
}

function isApDocumentWorkflowInstanceRow(row) {
  return (
    isApDocumentWorkflowProcessType(row?.process_type ?? row?.processType) &&
    toUpper(row?.target_type ?? row?.targetType) === CARI_DOCUMENT_WORKFLOW_TARGET_TYPE
  );
}

function normalizeWorkflowStepPermissionCode(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function assertWorkflowStepPermissionCompatibility(processType, step, index) {
  const normalizedProcessType = toUpper(processType);
  const permissionCode = normalizeWorkflowStepPermissionCode(
    step?.requiredPermissionCode ?? step?.required_permission_code ?? null
  );
  if (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    if (permissionCode) {
      throw badRequest(
        `steps[${index}].requiredPermissionCode must be null for AP_DOCUMENT_POSTING`
      );
    }
    return;
  }
  if (!permissionCode) {
    throw badRequest(`steps[${index}].requiredPermissionCode is required`);
  }
}

function mapStageScopeTypeToUnifiedScopeResolutionMode(stageScopeType) {
  const normalized = toUpper(stageScopeType);
  if (normalized === "OPERATING_UNIT") {
    return "TARGET_OPERATING_UNIT";
  }
  if (normalized === "LEGAL_ENTITY") {
    return "TARGET_LEGAL_ENTITY";
  }
  if (normalized === "COUNTRY") {
    return "TARGET_COUNTRY";
  }
  if (normalized === "GROUP") {
    return "TARGET_GROUP";
  }
  return "REQUEST_SCOPE";
}

function mapUnifiedScopeResolutionModeToStageScopeType(scopeResolutionMode) {
  const normalized = toUpper(scopeResolutionMode);
  if (normalized === "TARGET_OPERATING_UNIT") {
    return "OPERATING_UNIT";
  }
  if (normalized === "TARGET_LEGAL_ENTITY") {
    return "LEGAL_ENTITY";
  }
  if (normalized === "TARGET_COUNTRY") {
    return "COUNTRY";
  }
  if (normalized === "TARGET_GROUP") {
    return "GROUP";
  }
  return "GROUP";
}

function mapWorkflowAssignmentRowToUnifiedScope(row) {
  const operatingUnitId = parsePositiveInt(
    row?.operating_unit_id ?? row?.operatingUnitId
  );
  if (operatingUnitId) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
    };
  }
  const legalEntityId = parsePositiveInt(
    row?.legal_entity_id ?? row?.legalEntityId
  );
  if (legalEntityId) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
    };
  }
  const countryId = parsePositiveInt(row?.country_id ?? row?.countryId);
  if (countryId) {
    return {
      scopeType: "COUNTRY",
      scopeId: countryId,
    };
  }
  const groupCompanyId = parsePositiveInt(
    row?.group_company_id ?? row?.groupCompanyId
  );
  if (groupCompanyId) {
    return {
      scopeType: "GROUP",
      scopeId: groupCompanyId,
    };
  }
  return {
    scopeType: "TENANT",
    scopeId: parsePositiveInt(row?.tenant_id ?? row?.tenantId),
  };
}

function resolveWorkflowUnifiedRequestScope(instanceRow, fallbackScope = {}) {
  const operatingUnitId =
    parsePositiveInt(instanceRow?.target_operating_unit_id) ||
    parsePositiveInt(instanceRow?.targetOperatingUnitId) ||
    parsePositiveInt(fallbackScope?.operatingUnitId);
  if (operatingUnitId) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
      legalEntityId:
        parsePositiveInt(instanceRow?.target_legal_entity_id) ||
        parsePositiveInt(instanceRow?.targetLegalEntityId) ||
        parsePositiveInt(fallbackScope?.legalEntityId) ||
        null,
      countryId:
        parsePositiveInt(instanceRow?.target_country_id) ||
        parsePositiveInt(instanceRow?.targetCountryId) ||
        parsePositiveInt(fallbackScope?.countryId) ||
        null,
      operatingUnitId,
      groupCompanyId:
        parsePositiveInt(instanceRow?.target_group_company_id) ||
        parsePositiveInt(instanceRow?.targetGroupCompanyId) ||
        parsePositiveInt(fallbackScope?.groupCompanyId) ||
        null,
    };
  }

  const legalEntityId =
    parsePositiveInt(instanceRow?.target_legal_entity_id) ||
    parsePositiveInt(instanceRow?.targetLegalEntityId) ||
    parsePositiveInt(fallbackScope?.legalEntityId);
  if (legalEntityId) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
      legalEntityId,
      countryId:
        parsePositiveInt(instanceRow?.target_country_id) ||
        parsePositiveInt(instanceRow?.targetCountryId) ||
        parsePositiveInt(fallbackScope?.countryId) ||
        null,
      operatingUnitId: null,
      groupCompanyId:
        parsePositiveInt(instanceRow?.target_group_company_id) ||
        parsePositiveInt(instanceRow?.targetGroupCompanyId) ||
        parsePositiveInt(fallbackScope?.groupCompanyId) ||
        null,
    };
  }

  const countryId =
    parsePositiveInt(instanceRow?.target_country_id) ||
    parsePositiveInt(instanceRow?.targetCountryId) ||
    parsePositiveInt(fallbackScope?.countryId);
  if (countryId) {
    return {
      scopeType: "COUNTRY",
      scopeId: countryId,
      legalEntityId: null,
      countryId,
      operatingUnitId: null,
      groupCompanyId:
        parsePositiveInt(instanceRow?.target_group_company_id) ||
        parsePositiveInt(instanceRow?.targetGroupCompanyId) ||
        parsePositiveInt(fallbackScope?.groupCompanyId) ||
        null,
    };
  }

  const groupCompanyId =
    parsePositiveInt(instanceRow?.target_group_company_id) ||
    parsePositiveInt(instanceRow?.targetGroupCompanyId) ||
    parsePositiveInt(fallbackScope?.groupCompanyId);
  if (groupCompanyId) {
    return {
      scopeType: "GROUP",
      scopeId: groupCompanyId,
      legalEntityId: null,
      countryId: null,
      operatingUnitId: null,
      groupCompanyId,
    };
  }

  return {
    scopeType: "TENANT",
    scopeId:
      parsePositiveInt(instanceRow?.tenant_id) ||
      parsePositiveInt(instanceRow?.tenantId),
    legalEntityId: null,
    countryId: null,
    operatingUnitId: null,
    groupCompanyId: null,
  };
}

function buildWorkflowUnifiedTargetSnapshot(instanceRow, fallbackScope = {}) {
  return {
    module_code: WORKFLOW_UNIFIED_MODULE_CODE,
    process_type: toUpper(instanceRow?.process_type ?? instanceRow?.processType),
    target_type: toUpper(instanceRow?.target_type ?? instanceRow?.targetType),
    target_id: parsePositiveInt(instanceRow?.target_id ?? instanceRow?.targetId),
    workflow_definition_id: parsePositiveInt(
      instanceRow?.workflow_definition_id ?? instanceRow?.workflowDefinitionId
    ),
    country_id:
      parsePositiveInt(instanceRow?.target_country_id) ||
      parsePositiveInt(instanceRow?.targetCountryId) ||
      parsePositiveInt(fallbackScope?.countryId) ||
      null,
    group_company_id:
      parsePositiveInt(instanceRow?.target_group_company_id) ||
      parsePositiveInt(instanceRow?.targetGroupCompanyId) ||
      parsePositiveInt(fallbackScope?.groupCompanyId) ||
      null,
    legal_entity_id:
      parsePositiveInt(instanceRow?.target_legal_entity_id) ||
      parsePositiveInt(instanceRow?.targetLegalEntityId) ||
      parsePositiveInt(fallbackScope?.legalEntityId) ||
      null,
    operating_unit_id:
      parsePositiveInt(instanceRow?.target_operating_unit_id) ||
      parsePositiveInt(instanceRow?.targetOperatingUnitId) ||
      parsePositiveInt(fallbackScope?.operatingUnitId) ||
      null,
  };
}

function buildWorkflowUnifiedActionPayload(instanceId, processType) {
  return {
    legacy_workflow_instance_id: parsePositiveInt(instanceId),
    legacy_process_type: toUpper(processType),
    workflow_bridge: true,
  };
}

function buildWorkflowUnifiedRequestCode(tenantId, instanceId) {
  return `WFR-${parsePositiveInt(tenantId)}-${parsePositiveInt(instanceId)}`;
}

function buildWorkflowUnifiedPolicySnapshot(definitionRow, stepRows) {
  const normalizedSteps = (Array.isArray(stepRows) ? stepRows : []).map((step) => ({
    step_no: Number(step.step_no || step.stepNo || 1),
    required_permission_code: normalizeWorkflowStepPermissionCode(
      step.required_permission_code ?? step.requiredPermissionCode ?? null
    ),
    scope_resolution_mode: mapStageScopeTypeToUnifiedScopeResolutionMode(
      step.stage_scope_type ?? step.stageScopeType
    ),
    custom_scope_resolver_key: null,
    min_approvals: Math.max(
      1,
      Number(step.min_approver_count ?? step.minApproverCount ?? 1)
    ),
    allow_self_approve: Boolean(
      toDbBoolean(step.allow_self_approve ?? step.allowSelfApprove)
    ),
    escalation_after_hours:
      parsePositiveInt(step.escalation_after_hours ?? step.escalationAfterHours) ||
      null,
  }));

  return {
    id:
      parsePositiveInt(definitionRow?.generic_policy_id) ||
      parsePositiveInt(definitionRow?.genericPolicyId) ||
      null,
    tenant_id:
      parsePositiveInt(definitionRow?.tenant_id) ||
      parsePositiveInt(definitionRow?.tenantId),
    module_code: WORKFLOW_UNIFIED_MODULE_CODE,
    policy_code: String(definitionRow?.code || "").trim().toUpperCase(),
    policy_name:
      String(definitionRow?.name || "").trim() ||
      String(definitionRow?.code || "").trim().toUpperCase(),
    target_type: mapWorkflowProcessToUnifiedTargetType(
      definitionRow?.process_type ?? definitionRow?.processType
    ),
    action_type: WORKFLOW_UNIFIED_ACTION_TYPE,
    version_no: Number(definitionRow?.version_no ?? definitionRow?.versionNo ?? 1),
    scope_type: null,
    scope_id: null,
    effective_from: null,
    effective_to: null,
    step_count: Math.max(1, normalizedSteps.length),
    min_approvals: 1,
    maker_checker_required: false,
    allow_self_approve: true,
    auto_execute_on_final_approval: false,
    escalation_after_hours: null,
    approver_permission_code:
      String(normalizedSteps[0]?.required_permission_code || "").trim() ||
      "approvals.requests.approve",
    matched_assignment: null,
    steps: normalizedSteps,
  };
}

function mapWorkflowInstanceStatusToUnifiedRequestStatus(status) {
  const normalized = toUpper(status);
  if (normalized === "APPROVED") {
    return "APPROVED";
  }
  if (normalized === "REJECTED") {
    return "REJECTED";
  }
  if (["CANCELLED", "SUPERSEDED"].includes(normalized)) {
    return "WITHDRAWN";
  }
  return "PENDING_REVIEW";
}

function mapUnifiedRequestStatusToWorkflowStatus(requestStatus) {
  const normalized = toUpper(requestStatus);
  if (normalized === "APPROVED") {
    return "APPROVED";
  }
  if (["REJECTED", "RETURNED"].includes(normalized)) {
    return "REJECTED";
  }
  if (normalized === "WITHDRAWN") {
    return "CANCELLED";
  }
  return "PENDING";
}

function mapWorkflowDefinitionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    processType: toUpper(row.process_type),
    genericPolicyId: parsePositiveInt(row.generic_policy_id),
    isActive: toDbBoolean(row.is_active),
    versionNo: Number(row.version_no || 0),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdByUserName: row.created_by_user_name || null,
    stepCount: Number(row.step_count || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapWorkflowDefinitionStepRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    workflowDefinitionId: parsePositiveInt(row.workflow_definition_id),
    stepNo: Number(row.step_no || 0),
    stageScopeType: toUpper(row.stage_scope_type),
    requiredPermissionCode: normalizeWorkflowStepPermissionCode(
      row.required_permission_code
    ),
    minApproverCount: Number(row.min_approver_count || 0),
    allowSelfApprove: toDbBoolean(row.allow_self_approve),
    escalationAfterHours: parsePositiveInt(row.escalation_after_hours),
    createdAt: row.created_at || null,
  };
}

function mapWorkflowAssignmentRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    processType: toUpper(row.process_type),
    workflowDefinitionId: parsePositiveInt(row.workflow_definition_id),
    workflowDefinitionCode: String(row.workflow_definition_code || ""),
    workflowDefinitionName: String(row.workflow_definition_name || ""),
    groupCompanyId: parsePositiveInt(row.group_company_id),
    groupCompanyCode: row.group_company_code || null,
    groupCompanyName: row.group_company_name || null,
    countryId: parsePositiveInt(row.country_id),
    countryIso2: row.country_iso2 || null,
    countryName: row.country_name || null,
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
    effectiveFrom: toDateOnly(row.effective_from),
    effectiveTo: toDateOnly(row.effective_to),
    status: toUpper(row.status),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdByUserName: row.created_by_user_name || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapWorkflowInstanceRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    processType: toUpper(row.process_type),
    targetType: toUpper(row.target_type),
    targetId: parsePositiveInt(row.target_id),
    workflowDefinitionId: parsePositiveInt(row.workflow_definition_id),
    genericRequestId: parsePositiveInt(row.generic_request_id),
    workflowDefinitionCode: String(row.workflow_definition_code || ""),
    workflowDefinitionName: String(row.workflow_definition_name || ""),
    status: toUpper(row.status),
    currentStepNo: Number(row.current_step_no || 0),
    requestedByUserId: parsePositiveInt(row.requested_by_user_id),
    requestedByUserName: row.requested_by_user_name || null,
    requestedAt: row.requested_at || null,
    resolvedAt: row.resolved_at || null,
    resolutionNote: row.resolution_note || null,
    idempotencyKey: row.idempotency_key || null,
    targetGroupCompanyId: parsePositiveInt(row.target_group_company_id),
    targetCountryId: parsePositiveInt(row.target_country_id),
    targetLegalEntityId: parsePositiveInt(row.target_legal_entity_id),
    targetOperatingUnitId: parsePositiveInt(row.target_operating_unit_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapWorkflowInstanceDecisionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    workflowInstanceId: parsePositiveInt(row.workflow_instance_id),
    stepNo: Number(row.step_no || 0),
    decision: toUpper(row.decision),
    decisionByUserId: parsePositiveInt(row.decision_by_user_id),
    decisionByUserName: row.decision_by_user_name || null,
    decisionNote: row.decision_note || null,
    createdAt: row.created_at || null,
  };
}

function assertTenantWideScope(req, label = "tenant fallback scope") {
  if (!req?.rbac?.permissionScopeContext?.tenantWide) {
    throw forbidden(`Data scope denied: ${label}`);
  }
}

function assertAssignmentScopeAccess(req, row, assertScopeAccess) {
  const operatingUnitId = parsePositiveInt(row?.operating_unit_id ?? row?.operatingUnitId);
  const legalEntityId = parsePositiveInt(row?.legal_entity_id ?? row?.legalEntityId);
  const countryId = parsePositiveInt(row?.country_id ?? row?.countryId);
  const groupCompanyId = parsePositiveInt(row?.group_company_id ?? row?.groupCompanyId);

  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
    return;
  }
  if (legalEntityId) {
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    return;
  }
  if (countryId) {
    assertScopeAccess(req, "country", countryId, "countryId");
    return;
  }
  if (groupCompanyId) {
    assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");
    return;
  }
  assertTenantWideScope(req);
}

function canReadAssignmentRow(req, row, assertScopeAccess) {
  try {
    assertAssignmentScopeAccess(req, row, assertScopeAccess);
    return true;
  } catch (err) {
    if (Number(err?.status) === 403) {
      return false;
    }
    throw err;
  }
}

function assertWorkflowInstanceScopeAccess(req, row, assertScopeAccess) {
  const operatingUnitId = parsePositiveInt(
    row?.target_operating_unit_id ?? row?.targetOperatingUnitId
  );
  const legalEntityId = parsePositiveInt(
    row?.target_legal_entity_id ?? row?.targetLegalEntityId
  );
  const countryId = parsePositiveInt(
    row?.target_country_id ?? row?.targetCountryId
  );
  const groupCompanyId = parsePositiveInt(
    row?.target_group_company_id ?? row?.targetGroupCompanyId
  );

  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
    return;
  }
  if (legalEntityId) {
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    return;
  }
  if (countryId) {
    assertScopeAccess(req, "country", countryId, "countryId");
    return;
  }
  if (groupCompanyId) {
    assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");
    return;
  }
  assertTenantWideScope(req, "workflow instance tenant fallback scope");
}

function canReadWorkflowInstanceRow(req, row, assertScopeAccess) {
  try {
    assertWorkflowInstanceScopeAccess(req, row, assertScopeAccess);
    return true;
  } catch (err) {
    if (Number(err?.status) === 403) {
      return false;
    }
    throw err;
  }
}

async function hydrateWorkflowResolutionScope({
  tenantId,
  scope = {},
  runQuery = query,
}) {
  const resolved = {
    operatingUnitId: parsePositiveInt(scope?.operatingUnitId) || null,
    legalEntityId: parsePositiveInt(scope?.legalEntityId) || null,
    countryId: parsePositiveInt(scope?.countryId) || null,
    groupCompanyId: parsePositiveInt(scope?.groupCompanyId) || null,
  };

  if (resolved.operatingUnitId) {
    const result = await runQuery(
      `SELECT
         ou.id,
         ou.legal_entity_id,
         le.group_company_id,
         le.country_id
       FROM operating_units ou
       JOIN legal_entities le
         ON le.tenant_id = ou.tenant_id
        AND le.id = ou.legal_entity_id
      WHERE ou.tenant_id = ?
        AND ou.id = ?
      LIMIT 1`,
      [tenantId, resolved.operatingUnitId]
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      throw badRequest("scope.operatingUnitId not found for tenant");
    }
    if (
      resolved.legalEntityId &&
      resolved.legalEntityId !== parsePositiveInt(row.legal_entity_id)
    ) {
      throw badRequest("scope.legalEntityId must match scope.operatingUnitId");
    }
    if (
      resolved.countryId &&
      resolved.countryId !== parsePositiveInt(row.country_id)
    ) {
      throw badRequest("scope.countryId must match scope.operatingUnitId hierarchy");
    }
    if (
      resolved.groupCompanyId &&
      resolved.groupCompanyId !== parsePositiveInt(row.group_company_id)
    ) {
      throw badRequest("scope.groupCompanyId must match scope.operatingUnitId hierarchy");
    }
    resolved.legalEntityId = parsePositiveInt(row.legal_entity_id) || null;
    resolved.countryId = parsePositiveInt(row.country_id) || null;
    resolved.groupCompanyId = parsePositiveInt(row.group_company_id) || null;
    return resolved;
  }

  if (resolved.legalEntityId) {
    const result = await runQuery(
      `SELECT id, group_company_id, country_id
         FROM legal_entities
        WHERE tenant_id = ?
          AND id = ?
        LIMIT 1`,
      [tenantId, resolved.legalEntityId]
    );
    const row = result.rows?.[0] || null;
    if (!row) {
      throw badRequest("scope.legalEntityId not found for tenant");
    }
    if (
      resolved.countryId &&
      resolved.countryId !== parsePositiveInt(row.country_id)
    ) {
      throw badRequest("scope.countryId must match scope.legalEntityId hierarchy");
    }
    if (
      resolved.groupCompanyId &&
      resolved.groupCompanyId !== parsePositiveInt(row.group_company_id)
    ) {
      throw badRequest("scope.groupCompanyId must match scope.legalEntityId hierarchy");
    }
    resolved.countryId = parsePositiveInt(row.country_id) || null;
    resolved.groupCompanyId = parsePositiveInt(row.group_company_id) || null;
    return resolved;
  }

  if (resolved.countryId) {
    const result = await runQuery(
      `SELECT id
         FROM countries
        WHERE id = ?
        LIMIT 1`,
      [resolved.countryId]
    );
    if (!result.rows?.[0]?.id) {
      throw badRequest("scope.countryId not found");
    }
  }

  if (resolved.groupCompanyId) {
    const result = await runQuery(
      `SELECT id
         FROM group_companies
        WHERE tenant_id = ?
          AND id = ?
        LIMIT 1`,
      [tenantId, resolved.groupCompanyId]
    );
    if (!result.rows?.[0]?.id) {
      throw badRequest("scope.groupCompanyId not found for tenant");
    }
  }

  return resolved;
}

async function isWorkflowGateFeatureEnabled(tenantId, runQuery = query) {
  try {
    const result = await runQuery(
      `SELECT is_enabled
       FROM tenant_features
       WHERE tenant_id = ?
         AND feature_code = ?
       LIMIT 1`,
      [tenantId, FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1]
    );
    return toDbBoolean(result.rows?.[0]?.is_enabled);
  } catch (err) {
    if (isMissingTableError(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * Resolve the most specific ACTIVE workflow assignment for one scoped target.
 */
export async function findActiveWorkflowAssignmentForScope({
  tenantId,
  processType,
  effectiveOn,
  scope = {},
  runQuery = query,
}) {
  const effectiveDate = toDateOnly(effectiveOn) || new Date().toISOString().slice(0, 10);
  const resolvedScope = await hydrateWorkflowResolutionScope({
    tenantId,
    scope,
    runQuery,
  });
  const operatingUnitId = parsePositiveInt(resolvedScope?.operatingUnitId) || -1;
  const legalEntityId = parsePositiveInt(resolvedScope?.legalEntityId) || -1;
  const countryId = parsePositiveInt(resolvedScope?.countryId) || -1;
  const groupCompanyId = parsePositiveInt(resolvedScope?.groupCompanyId) || -1;

  const result = await runQuery(
    `SELECT wa.*
     FROM workflow_assignments wa
     WHERE wa.tenant_id = ?
       AND wa.process_type = ?
       AND wa.status = 'ACTIVE'
       AND wa.effective_from <= ?
       AND (wa.effective_to IS NULL OR wa.effective_to >= ?)
       AND (
         (wa.operating_unit_id IS NOT NULL AND wa.operating_unit_id = ?)
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NOT NULL
           AND wa.legal_entity_id = ?
         )
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NOT NULL
           AND wa.country_id = ?
         )
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NULL
           AND wa.group_company_id IS NOT NULL
           AND wa.group_company_id = ?
         )
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NULL
           AND wa.group_company_id IS NULL
         )
       )
     ORDER BY
       CASE
         WHEN wa.operating_unit_id IS NOT NULL AND wa.operating_unit_id = ? THEN 1
         WHEN
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NOT NULL
           AND wa.legal_entity_id = ? THEN 2
         WHEN
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NOT NULL
           AND wa.country_id = ? THEN 3
         WHEN
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
           AND wa.country_id IS NULL
           AND wa.group_company_id IS NOT NULL
           AND wa.group_company_id = ? THEN 4
         ELSE 5
       END,
       wa.effective_from DESC,
       wa.id DESC
     LIMIT 1`,
    [
      tenantId,
      toUpper(processType),
      effectiveDate,
      effectiveDate,
      operatingUnitId,
      legalEntityId,
      countryId,
      groupCompanyId,
      operatingUnitId,
      legalEntityId,
      countryId,
      groupCompanyId,
    ]
  );
  return result.rows?.[0] || null;
}

/**
 * Load the latest workflow instance for one target tuple.
 */
export async function getWorkflowInstanceByTarget({
  tenantId,
  processType,
  targetType,
  targetId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
       FROM workflow_instances
      WHERE tenant_id = ?
        AND process_type = ?
        AND target_type = ?
        AND target_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [tenantId, toUpper(processType), toUpper(targetType), targetId]
  );
  return result.rows?.[0] || null;
}

function mapWorkflowGateInstanceRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    genericRequestId: parsePositiveInt(row.generic_request_id),
    status: toUpper(row.status),
    currentStepNo: Number(row.current_step_no || 0),
    workflowDefinitionId: parsePositiveInt(row.workflow_definition_id),
    requestedByUserId: parsePositiveInt(row.requested_by_user_id),
    requestedAt: row.requested_at || null,
    resolvedAt: row.resolved_at || null,
    resolutionNote: row.resolution_note || null,
  };
}

function makeWorkflowGateResult({
  enabled,
  required,
  approved,
  errorCode = "",
  message = "",
  assignmentRow = null,
  instanceRow = null,
  processType = "",
  targetType = "",
  targetId = null,
}) {
  return {
    enabled: Boolean(enabled),
    required: Boolean(required),
    approved: Boolean(approved),
    errorCode: String(errorCode || ""),
    message: String(message || ""),
    processType: toUpper(processType),
    targetType: toUpper(targetType),
    targetId: parsePositiveInt(targetId),
    assignment: assignmentRow
      ? {
          id: parsePositiveInt(assignmentRow.id),
          workflowDefinitionId: parsePositiveInt(assignmentRow.workflow_definition_id),
          processType: toUpper(assignmentRow.process_type),
          groupCompanyId: parsePositiveInt(assignmentRow.group_company_id),
          countryId: parsePositiveInt(assignmentRow.country_id),
          legalEntityId: parsePositiveInt(assignmentRow.legal_entity_id),
          operatingUnitId: parsePositiveInt(assignmentRow.operating_unit_id),
          effectiveFrom: toDateOnly(assignmentRow.effective_from),
          effectiveTo: toDateOnly(assignmentRow.effective_to),
          status: toUpper(assignmentRow.status),
        }
      : null,
    instance: mapWorkflowGateInstanceRow(instanceRow),
  };
}

async function getWorkflowDefinitionRowById({
  tenantId,
  definitionId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       wd.*,
       u.name AS created_by_user_name,
       (
         SELECT COUNT(*)
         FROM workflow_definition_steps wds
         WHERE wds.workflow_definition_id = wd.id
       ) AS step_count
     FROM workflow_definitions wd
     LEFT JOIN users u ON u.id = wd.created_by_user_id
     WHERE wd.tenant_id = ?
       AND wd.id = ?
     LIMIT 1`,
    [tenantId, definitionId]
  );
  return result.rows?.[0] || null;
}

async function getWorkflowAssignmentRowById({
  tenantId,
  assignmentId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       wa.*,
       wd.code AS workflow_definition_code,
       wd.name AS workflow_definition_name,
       gc.code AS group_company_code,
       gc.name AS group_company_name,
       c.iso2 AS country_iso2,
       c.name AS country_name,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       u.name AS created_by_user_name
     FROM workflow_assignments wa
     JOIN workflow_definitions wd ON wd.id = wa.workflow_definition_id
     LEFT JOIN group_companies gc ON gc.id = wa.group_company_id
     LEFT JOIN countries c ON c.id = wa.country_id
     LEFT JOIN legal_entities le ON le.id = wa.legal_entity_id
     LEFT JOIN operating_units ou ON ou.id = wa.operating_unit_id
     LEFT JOIN users u ON u.id = wa.created_by_user_id
     WHERE wa.tenant_id = ?
       AND wa.id = ?
     LIMIT 1`,
    [tenantId, assignmentId]
  );
  return result.rows?.[0] || null;
}

function buildWorkflowInstanceBaseSelect({ forUpdate = false } = {}) {
  return `SELECT
      wi.*,
      wd.code AS workflow_definition_code,
      wd.name AS workflow_definition_name,
      requester.name AS requested_by_user_name,
      ${WORKFLOW_INSTANCE_TARGET_SCOPE_SELECT_SQL}
    FROM workflow_instances wi
    JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
    LEFT JOIN users requester ON requester.id = wi.requested_by_user_id
    ${WORKFLOW_INSTANCE_TARGET_SCOPE_JOIN_SQL}
    WHERE wi.tenant_id = ?
      AND wi.id = ?
    LIMIT 1
    ${forUpdate ? "FOR UPDATE" : ""}`;
}

async function getWorkflowInstanceRowById({
  tenantId,
  instanceId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    buildWorkflowInstanceBaseSelect({ forUpdate }),
    [tenantId, instanceId]
  );
  return result.rows?.[0] || null;
}

/**
 * List the persisted legacy decision rows for one workflow instance.
 */
export async function listWorkflowInstanceDecisionRows({
  tenantId,
  instanceId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       wid.*,
       u.name AS decision_by_user_name
     FROM workflow_instance_decisions wid
     JOIN workflow_instances wi ON wi.id = wid.workflow_instance_id
     LEFT JOIN users u ON u.id = wid.decision_by_user_id
     WHERE wid.workflow_instance_id = ?
       AND wi.tenant_id = ?
     ORDER BY wid.step_no ASC, wid.id ASC`,
    [instanceId, tenantId]
  );
  return (result.rows || []).map(mapWorkflowInstanceDecisionRow);
}

async function getWorkflowDefinitionStepRowByNo({
  definitionId,
  stepNo,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM workflow_definition_steps
     WHERE workflow_definition_id = ?
       AND step_no = ?
     LIMIT 1`,
    [definitionId, stepNo]
  );
  return result.rows?.[0] || null;
}

async function getWorkflowDefinitionMaxStepNo(definitionId, runQuery = query) {
  const result = await runQuery(
    `SELECT MAX(step_no) AS max_step_no
     FROM workflow_definition_steps
     WHERE workflow_definition_id = ?`,
    [definitionId]
  );
  return Number(result.rows?.[0]?.max_step_no || 0);
}

async function listWorkflowDefinitionStepRowsRaw(definitionId, runQuery = query) {
  const result = await runQuery(
    `SELECT *
       FROM workflow_definition_steps
      WHERE workflow_definition_id = ?
      ORDER BY step_no ASC, id ASC`,
    [definitionId]
  );
  return result.rows || [];
}

async function listWorkflowAssignmentRowsByDefinitionId({
  tenantId,
  definitionId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
       FROM workflow_assignments
      WHERE tenant_id = ?
        AND workflow_definition_id = ?
      ORDER BY id ASC`,
    [tenantId, definitionId]
  );
  return result.rows || [];
}

async function getUnifiedWorkflowRequestRowById({
  tenantId,
  requestId,
  runQuery = query,
  forUpdate = false,
}) {
  const normalizedRequestId = parsePositiveInt(requestId);
  if (!normalizedRequestId) {
    return null;
  }
  const result = await runQuery(
    `SELECT *
       FROM approval_requests
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, normalizedRequestId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }
  return {
    ...row,
    policy_snapshot_json: parseJson(row.policy_snapshot_json, {}),
    target_snapshot_json: parseJson(row.target_snapshot_json, {}),
    action_payload_json: parseJson(row.action_payload_json, {}),
    execution_result_json: parseJson(row.execution_result_json, null),
  };
}

async function listUnifiedWorkflowDecisionRows({
  tenantId,
  requestId,
  runQuery = query,
}) {
  const normalizedRequestId = parsePositiveInt(requestId);
  if (!normalizedRequestId) {
    return [];
  }
  const result = await runQuery(
    `SELECT *
       FROM approval_decisions
      WHERE tenant_id = ?
        AND request_id = ?
      ORDER BY step_no ASC, id ASC`,
    [tenantId, normalizedRequestId]
  );
  return result.rows || [];
}

function resolveUnifiedWorkflowDecisionAccessFromRequestRow(
  requestRow,
  { stepNoOverride = null } = {}
) {
  const policySnapshot = parseJson(requestRow?.policy_snapshot_json, {});
  const targetSnapshot = parseJson(requestRow?.target_snapshot_json, {});
  const steps = Array.isArray(policySnapshot?.steps) ? policySnapshot.steps : [];
  const resolvedStepNo = Math.max(
    1,
    Number(stepNoOverride || requestRow?.current_step_no || 1)
  );
  const currentStep = steps.find(
    (step) => Number(step.step_no || step.stepNo || 1) === resolvedStepNo
  );
  if (!currentStep) {
    throw conflict(
      "Unified workflow request has no current approval step",
      "APPROVAL_STEP_PERMISSION_DENIED"
    );
  }

  const scopeResolutionMode = toUpper(
    currentStep.scope_resolution_mode ?? currentStep.scopeResolutionMode
  );
  let scopeType = toUpper(requestRow?.scope_type);
  let scopeId = parsePositiveInt(requestRow?.scope_id);
  if (
    scopeResolutionMode === "POLICY_SCOPE" &&
    policySnapshot?.scope_type &&
    policySnapshot?.scope_id
  ) {
    scopeType = toUpper(policySnapshot.scope_type);
    scopeId = parsePositiveInt(policySnapshot.scope_id);
  } else if (scopeResolutionMode === "TARGET_GROUP") {
    scopeType = "GROUP";
    scopeId =
      parsePositiveInt(targetSnapshot?.group_company_id) ||
      parsePositiveInt(targetSnapshot?.groupCompanyId) ||
      (toUpper(requestRow?.scope_type) === "GROUP"
        ? parsePositiveInt(requestRow?.scope_id)
        : null);
  } else if (scopeResolutionMode === "TARGET_COUNTRY") {
    scopeType = "COUNTRY";
    scopeId =
      parsePositiveInt(targetSnapshot?.country_id) ||
      parsePositiveInt(targetSnapshot?.countryId) ||
      (toUpper(requestRow?.scope_type) === "COUNTRY"
        ? parsePositiveInt(requestRow?.scope_id)
        : null);
  } else if (scopeResolutionMode === "TARGET_LEGAL_ENTITY") {
    scopeType = "LEGAL_ENTITY";
    scopeId =
      parsePositiveInt(requestRow?.legal_entity_id) ||
      parsePositiveInt(targetSnapshot?.legal_entity_id) ||
      parsePositiveInt(targetSnapshot?.legalEntityId);
  } else if (scopeResolutionMode === "TARGET_OPERATING_UNIT") {
    scopeType = "OPERATING_UNIT";
    scopeId =
      parsePositiveInt(requestRow?.operating_unit_id) ||
      parsePositiveInt(targetSnapshot?.operating_unit_id) ||
      parsePositiveInt(targetSnapshot?.operatingUnitId);
  }

  if (!scopeType || !scopeId) {
    throw conflict(
      "Unified workflow request cannot resolve the current decision scope",
      "APPROVAL_STEP_PERMISSION_DENIED"
    );
  }

  return {
    stepNo: Number(currentStep.step_no || currentStep.stepNo || 1),
    stageScopeType: mapUnifiedScopeResolutionModeToStageScopeType(
      currentStep.scope_resolution_mode ?? currentStep.scopeResolutionMode
    ),
    requiredPermissionCode: normalizeWorkflowStepPermissionCode(
      currentStep.required_permission_code ?? currentStep.requiredPermissionCode ?? null
    ),
    minApproverCount: Math.max(
      1,
      Number(currentStep.min_approvals ?? currentStep.minApprovals ?? 1)
    ),
    allowSelfApprove: Boolean(
      toDbBoolean(currentStep.allow_self_approve ?? currentStep.allowSelfApprove)
    ),
    scope: {
      scopeType,
      scopeId,
    },
  };
}

async function upsertUnifiedWorkflowPolicyMirrorTx({
  tenantId,
  definitionRow,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedDefinitionId = parsePositiveInt(definitionRow?.id);
  if (!normalizedTenantId || !normalizedDefinitionId) {
    throw badRequest("Workflow definition is required for generic policy mirroring");
  }

  const stepRows = await listWorkflowDefinitionStepRowsRaw(
    normalizedDefinitionId,
    runQuery
  );
  const assignmentRows = await listWorkflowAssignmentRowsByDefinitionId({
    tenantId: normalizedTenantId,
    definitionId: normalizedDefinitionId,
    runQuery,
  });
  const targetType = mapWorkflowProcessToUnifiedTargetType(
    definitionRow.process_type ?? definitionRow.processType
  );
  const firstStepPermissionCode =
    normalizeWorkflowStepPermissionCode(
      stepRows[0]?.required_permission_code ??
        stepRows[0]?.requiredPermissionCode ??
        null
    ) || "approvals.requests.approve";

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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 1, 0, 1, 0, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       policy_name = VALUES(policy_name),
       target_type = VALUES(target_type),
       step_count = VALUES(step_count),
       approver_permission_code = VALUES(approver_permission_code),
       is_active = VALUES(is_active),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      normalizedTenantId,
      WORKFLOW_UNIFIED_MODULE_CODE,
      String(definitionRow.code || "").trim().toUpperCase(),
      String(definitionRow.name || "").trim() ||
        String(definitionRow.code || "").trim().toUpperCase(),
      targetType,
      WORKFLOW_UNIFIED_ACTION_TYPE,
      Number(definitionRow.version_no ?? definitionRow.versionNo ?? 1),
      Math.max(1, stepRows.length),
      firstStepPermissionCode,
      toDbBoolean(definitionRow.is_active ?? definitionRow.isActive) ? 1 : 0,
      parsePositiveInt(
        definitionRow.created_by_user_id ?? definitionRow.createdByUserId
      ),
      parsePositiveInt(
        definitionRow.created_by_user_id ?? definitionRow.createdByUserId
      ),
    ]
  );
  const genericPolicyId = parsePositiveInt(insertResult.rows?.insertId);
  if (!genericPolicyId) {
    throw conflict("Failed to mirror workflow definition into approval_policies");
  }

  await runQuery(
    `UPDATE workflow_definitions
        SET generic_policy_id = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [genericPolicyId, normalizedTenantId, normalizedDefinitionId]
  );

  await runQuery(
    `DELETE FROM approval_policy_steps
      WHERE tenant_id = ?
        AND policy_id = ?`,
    [normalizedTenantId, genericPolicyId]
  );
  for (const stepRow of stepRows) {
    // eslint-disable-next-line no-await-in-loop
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
         escalation_after_hours
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        normalizedTenantId,
        genericPolicyId,
        Number(stepRow.step_no || 1),
        normalizeWorkflowStepPermissionCode(stepRow.required_permission_code),
        mapStageScopeTypeToUnifiedScopeResolutionMode(stepRow.stage_scope_type),
        Math.max(1, Number(stepRow.min_approver_count || 1)),
        toDbBoolean(stepRow.allow_self_approve) ? 1 : 0,
        parsePositiveInt(stepRow.escalation_after_hours) || null,
      ]
    );
  }

  await runQuery(
    `DELETE FROM approval_policy_assignments
      WHERE tenant_id = ?
        AND policy_id = ?`,
    [normalizedTenantId, genericPolicyId]
  );
  for (const assignmentRow of assignmentRows) {
    const assignmentScope = mapWorkflowAssignmentRowToUnifiedScope(assignmentRow);
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
      `INSERT INTO approval_policy_assignments (
         tenant_id,
         policy_id,
         scope_type,
         scope_id,
         effective_from,
         effective_to,
         is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedTenantId,
        genericPolicyId,
        assignmentScope.scopeType,
        assignmentScope.scopeId,
        assignmentRow.effective_from || null,
        assignmentRow.effective_to || null,
        toUpper(assignmentRow.status || "ACTIVE") === "ACTIVE" ? 1 : 0,
      ]
    );
  }

  return {
    genericPolicyId,
    stepRows,
    assignmentRows,
  };
}

/**
 * Ensure one workflow definition is mirrored into the generic approval-policy schema.
 */
export async function ensureUnifiedWorkflowPolicyForDefinition({
  tenantId,
  definitionId,
  runQuery = query,
}) {
  const definitionRow = await assertWorkflowDefinitionExists(
    tenantId,
    definitionId,
    runQuery
  );
  return upsertUnifiedWorkflowPolicyMirrorTx({
    tenantId,
    definitionRow,
    runQuery,
  });
}

async function syncUnifiedWorkflowRequestFromLegacyInstanceTx({
  tenantId,
  instanceRow,
  genericRequestId,
  policyId,
  runQuery = query,
  fallbackScope = {},
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedInstanceId = parsePositiveInt(instanceRow?.id);
  const normalizedRequestId = parsePositiveInt(genericRequestId);
  const normalizedPolicyId = parsePositiveInt(policyId);
  if (!normalizedTenantId || !normalizedInstanceId || !normalizedRequestId) {
    throw badRequest("Workflow instance bridge sync requires tenant, instance, and request ids");
  }

  const definitionRow = await assertWorkflowDefinitionExists(
    normalizedTenantId,
    parsePositiveInt(instanceRow.workflow_definition_id),
    runQuery
  );
  const stepRows = await listWorkflowDefinitionStepRowsRaw(
    parsePositiveInt(instanceRow.workflow_definition_id),
    runQuery
  );
  const requestScope = resolveWorkflowUnifiedRequestScope(instanceRow, fallbackScope);
  const targetSnapshot = buildWorkflowUnifiedTargetSnapshot(instanceRow, fallbackScope);
  const policySnapshot = buildWorkflowUnifiedPolicySnapshot(
    {
      ...definitionRow,
      generic_policy_id:
        normalizedPolicyId ||
        parsePositiveInt(definitionRow.generic_policy_id) ||
        null,
    },
    stepRows
  );
  const requestStatus = mapWorkflowInstanceStatusToUnifiedRequestStatus(
    instanceRow.status
  );
  const resolvedAt = instanceRow.resolved_at || instanceRow.updated_at || null;

  await runQuery(
    `UPDATE approval_requests
        SET policy_id = ?,
            policy_version_no = ?,
            module_code = ?,
            target_type = ?,
            target_id = ?,
            scope_type = ?,
            scope_id = ?,
            legal_entity_id = ?,
            operating_unit_id = ?,
            request_status = ?,
            current_step_no = ?,
            execution_status = 'NOT_EXECUTED',
            submitted_by_user_id = ?,
            submitted_at = ?,
            approved_at = ?,
            rejected_at = ?,
            withdrawn_at = ?,
            executed_at = NULL,
            executed_by_user_id = NULL,
            last_activity_at = CURRENT_TIMESTAMP,
            policy_snapshot_json = ?,
            target_snapshot_json = ?,
            action_payload_json = ?,
            execution_result_json = NULL,
            execution_error_text = NULL
      WHERE tenant_id = ?
        AND id = ?`,
    [
      normalizedPolicyId || parsePositiveInt(definitionRow.generic_policy_id),
      Number(definitionRow.version_no || 1),
      WORKFLOW_UNIFIED_MODULE_CODE,
      toUpper(instanceRow.target_type),
      parsePositiveInt(instanceRow.target_id),
      requestScope.scopeType,
      requestScope.scopeId,
      requestScope.legalEntityId || null,
      requestScope.operatingUnitId || null,
      requestStatus,
      Math.max(1, Number(instanceRow.current_step_no || 1)),
      parsePositiveInt(instanceRow.requested_by_user_id),
      instanceRow.requested_at || instanceRow.created_at || null,
      requestStatus === "APPROVED" ? resolvedAt : null,
      requestStatus === "REJECTED" ? resolvedAt : null,
      requestStatus === "WITHDRAWN" ? resolvedAt : null,
      safeJson(policySnapshot),
      safeJson(targetSnapshot),
      safeJson(
        buildWorkflowUnifiedActionPayload(instanceRow.id, instanceRow.process_type)
      ),
      normalizedTenantId,
      normalizedRequestId,
    ]
  );

  await runQuery(
    `DELETE FROM approval_decisions
      WHERE tenant_id = ?
        AND request_id = ?`,
    [normalizedTenantId, normalizedRequestId]
  );

  const legacyDecisionRows = await listWorkflowInstanceDecisionRows({
    tenantId: normalizedTenantId,
    instanceId: normalizedInstanceId,
    runQuery,
  });
  for (const row of legacyDecisionRows) {
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
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
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      [
        normalizedTenantId,
        normalizedRequestId,
        Number(row.stepNo || 1),
        toUpper(row.decision),
        parsePositiveInt(row.decisionByUserId),
        parsePositiveInt(row.decisionByUserId),
        parsePositiveInt(row.decisionByUserId),
        row.decisionNote || null,
        row.createdAt || null,
      ]
    );
  }
}

async function syncLegacyWorkflowInstanceFromUnifiedRequestTx({
  tenantId,
  genericRequestId,
  runQuery = query,
}) {
  const requestRow = await getUnifiedWorkflowRequestRowById({
    tenantId,
    requestId: genericRequestId,
    runQuery,
    forUpdate: true,
  });
  if (!requestRow) {
    throw notFound("Unified workflow approval request not found");
  }

  const result = await runQuery(
    `SELECT *
       FROM workflow_instances
      WHERE tenant_id = ?
        AND generic_request_id = ?
      LIMIT 1
      FOR UPDATE`,
    [tenantId, parsePositiveInt(genericRequestId)]
  );
  const legacyRow = result.rows?.[0] || null;
  if (!legacyRow) {
    throw notFound("Workflow instance bridge row not found");
  }

  const decisionRows = await listUnifiedWorkflowDecisionRows({
    tenantId,
    requestId: genericRequestId,
    runQuery,
  });
  const nextLegacyStatus = mapUnifiedRequestStatusToWorkflowStatus(
    requestRow.request_status
  );
  const legacyStatus =
    toUpper(legacyRow?.status) === "SUPERSEDED" ? "SUPERSEDED" : nextLegacyStatus;
  const latestDecision = decisionRows[decisionRows.length - 1] || null;
  const resolvedAt =
    requestRow.approved_at ||
    requestRow.rejected_at ||
    requestRow.withdrawn_at ||
    null;
  const resolutionNote =
    latestDecision?.comment ||
    legacyRow.resolution_note ||
    (legacyStatus === "APPROVED"
      ? "Approved through unified workflow engine"
      : legacyStatus === "REJECTED"
        ? "Rejected through unified workflow engine"
        : legacyStatus === "CANCELLED"
          ? "Cancelled from unified workflow bridge"
          : null);

  await runQuery(
    `UPDATE workflow_instances
        SET status = ?,
            current_step_no = ?,
            resolved_at = ?,
            resolution_note = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND id = ?`,
    [
      legacyStatus,
      Math.max(1, Number(requestRow.current_step_no || 1)),
      ["APPROVED", "REJECTED", "CANCELLED"].includes(legacyStatus)
        ? resolvedAt
        : null,
      ["APPROVED", "REJECTED", "CANCELLED"].includes(legacyStatus)
        ? resolutionNote
        : null,
      tenantId,
      parsePositiveInt(legacyRow.id),
    ]
  );

  await runQuery(
    `DELETE FROM workflow_instance_decisions
      WHERE workflow_instance_id = ?`,
    [parsePositiveInt(legacyRow.id)]
  );
  for (const decisionRow of decisionRows) {
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
      `INSERT INTO workflow_instance_decisions (
         workflow_instance_id,
         step_no,
         decision,
         decision_by_user_id,
         decision_note,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        parsePositiveInt(legacyRow.id),
        Number(decisionRow.step_no || 1),
        toUpper(decisionRow.decision),
        parsePositiveInt(decisionRow.decided_by_user_id),
        decisionRow.comment || null,
        decisionRow.decided_at || null,
      ]
    );
  }

  await syncCariDocumentFromWorkflowRequestTx({
    tenantId,
    requestRow,
    legacyInstanceRow: {
      ...legacyRow,
      ...requestRow,
      process_type: legacyRow.process_type,
      target_type: legacyRow.target_type,
      target_id: legacyRow.target_id,
      status: legacyStatus,
      resolution_note: resolutionNote,
    },
    decisionRows,
    runQuery,
  });

  return {
    row: await getWorkflowInstanceRowById({
      tenantId,
      instanceId: parsePositiveInt(legacyRow.id),
      runQuery,
    }),
    decisions: await listWorkflowInstanceDecisionRows({
      tenantId,
      instanceId: parsePositiveInt(legacyRow.id),
      runQuery,
    }),
    request: requestRow,
  };
}

/**
 * Ensure one workflow instance has a bridged generic approval request.
 */
export async function ensureUnifiedWorkflowInstanceBridge({
  tenantId,
  instanceId,
  requestedByUserId = null,
  fallbackScope = {},
  resetToPending = false,
  runQuery = query,
}) {
  const instanceRow = await getWorkflowInstanceRowById({
    tenantId,
    instanceId,
    runQuery,
    forUpdate: resetToPending,
  });
  if (!instanceRow) {
    throw notFound("Workflow instance not found");
  }

  const definitionMirror = await ensureUnifiedWorkflowPolicyForDefinition({
    tenantId,
    definitionId: parsePositiveInt(instanceRow.workflow_definition_id),
    runQuery,
  });
  const genericPolicyId = parsePositiveInt(definitionMirror.genericPolicyId);
  if (!genericPolicyId) {
    throw conflict("Workflow definition is missing a generic approval-policy mirror");
  }

  let genericRequestId = parsePositiveInt(instanceRow.generic_request_id);
  if (!genericRequestId) {
    const requestScope = resolveWorkflowUnifiedRequestScope(instanceRow, fallbackScope);
    const submitterUserId =
      parsePositiveInt(requestedByUserId) ||
      parsePositiveInt(instanceRow.requested_by_user_id);
    const submitResult = await submitRequest(
      genericPolicyId,
      mapWorkflowProcessToUnifiedTargetType(instanceRow.process_type),
      parsePositiveInt(instanceRow.target_id),
      { tenantId, userId: submitterUserId },
      {
        idempotencyKey: `WORKFLOW-INSTANCE:${parsePositiveInt(instanceRow.id)}`,
        scopeType: requestScope.scopeType,
        scopeId: requestScope.scopeId,
        legalEntityId: requestScope.legalEntityId || null,
        operatingUnitId: requestScope.operatingUnitId || null,
        targetSnapshot: buildWorkflowUnifiedTargetSnapshot(instanceRow, fallbackScope),
        actionPayload: buildWorkflowUnifiedActionPayload(
          instanceRow.id,
          instanceRow.process_type
        ),
      },
      { runQuery }
    );
    genericRequestId = parsePositiveInt(submitResult?.item?.id);
    if (!genericRequestId) {
      throw conflict("Failed to bridge workflow instance into approval_requests");
    }
    await runQuery(
      `UPDATE workflow_instances
          SET generic_request_id = ?
        WHERE tenant_id = ?
          AND id = ?`,
      [genericRequestId, tenantId, parsePositiveInt(instanceRow.id)]
    );
  }

  if (
    resetToPending ||
    toUpper(instanceRow.status) !== "PENDING" ||
    Number(instanceRow.current_step_no || 1) !== 1
  ) {
    await syncUnifiedWorkflowRequestFromLegacyInstanceTx({
      tenantId,
      instanceRow,
      genericRequestId,
      policyId: genericPolicyId,
      runQuery,
      fallbackScope,
    });
  }

  return getWorkflowInstanceRowById({
    tenantId,
    instanceId: parsePositiveInt(instanceRow.id),
    runQuery,
  });
}

/**
 * Cancel one bridged workflow approval request from a legacy compatibility path.
 */
export async function cancelUnifiedWorkflowInstanceBridge({
  tenantId,
  instanceId,
  resolutionNote = null,
  runQuery = query,
}) {
  const instanceRow = await getWorkflowInstanceRowById({
    tenantId,
    instanceId,
    runQuery,
    forUpdate: true,
  });
  if (!instanceRow || !parsePositiveInt(instanceRow.generic_request_id)) {
    return instanceRow;
  }

  await runQuery(
    `UPDATE approval_requests
        SET request_status = 'WITHDRAWN',
            withdrawn_at = COALESCE(withdrawn_at, CURRENT_TIMESTAMP),
            last_activity_at = CURRENT_TIMESTAMP,
            execution_error_text = NULL
      WHERE tenant_id = ?
        AND id = ?`,
    [tenantId, parsePositiveInt(instanceRow.generic_request_id)]
  );
  await runQuery(
    `UPDATE workflow_instances
        SET resolution_note = COALESCE(?, resolution_note)
      WHERE tenant_id = ?
        AND id = ?`,
    [resolutionNote || null, tenantId, parsePositiveInt(instanceRow.id)]
  );

  return getWorkflowInstanceRowById({
    tenantId,
    instanceId: parsePositiveInt(instanceRow.id),
    runQuery,
  });
}

async function assertWorkflowDefinitionExists(tenantId, definitionId, runQuery = query) {
  const row = await getWorkflowDefinitionRowById({
    tenantId,
    definitionId,
    runQuery,
  });
  if (!row) {
    throw notFound("workflowDefinitionId not found for tenant");
  }
  return row;
}

async function resolveAssignmentScopeReferences({
  tenantId,
  groupCompanyId,
  countryId,
  legalEntityId,
  operatingUnitId,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedGroupCompanyId = parsePositiveInt(groupCompanyId) || null;
  const normalizedCountryId = parsePositiveInt(countryId) || null;
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId) || null;
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId) || null;

  const scopeTargetCount = [
    normalizedGroupCompanyId,
    normalizedCountryId,
    normalizedLegalEntityId,
    normalizedOperatingUnitId,
  ].filter(Boolean).length;
  if (scopeTargetCount > 1) {
    throw badRequest(
      "Workflow assignments must set at most one of groupCompanyId, countryId, legalEntityId, or operatingUnitId"
    );
  }

  if (normalizedGroupCompanyId) {
    await assertGroupCompanyBelongsToTenant(
      normalizedTenantId,
      normalizedGroupCompanyId,
      "groupCompanyId"
    );
  }
  if (normalizedCountryId) {
    await assertCountryExists(normalizedCountryId, "countryId");
  }
  if (normalizedLegalEntityId) {
    await assertLegalEntityBelongsToTenant(
      normalizedTenantId,
      normalizedLegalEntityId,
      "legalEntityId"
    );
  }
  if (normalizedOperatingUnitId) {
    await assertOperatingUnitBelongsToTenant(
      normalizedTenantId,
      normalizedOperatingUnitId,
      "operatingUnitId"
    );
  }
}

function assertAssignmentWriteScope(req, input, assertScopeAccess) {
  const operatingUnitId = parsePositiveInt(input?.operatingUnitId);
  const legalEntityId = parsePositiveInt(input?.legalEntityId);
  const countryId = parsePositiveInt(input?.countryId);
  const groupCompanyId = parsePositiveInt(input?.groupCompanyId);

  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
  }
  if (legalEntityId) {
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  }
  if (countryId) {
    assertScopeAccess(req, "country", countryId, "countryId");
  }
  if (groupCompanyId) {
    assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");
  }

  if (!operatingUnitId && !legalEntityId && !countryId && !groupCompanyId) {
    assertTenantWideScope(req);
  }
}

/**
 * Resolve the effective RBAC scope for one workflow assignment row.
 */
export async function resolveWorkflowAssignmentScope(assignmentId, tenantId) {
  const normalizedAssignmentId = parsePositiveInt(assignmentId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedAssignmentId || !normalizedTenantId) {
    return null;
  }

  const row = await getWorkflowAssignmentRowById({
    tenantId: normalizedTenantId,
    assignmentId: normalizedAssignmentId,
  });
  if (!row) {
    return null;
  }

  const operatingUnitId = parsePositiveInt(row.operating_unit_id);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  const legalEntityId = parsePositiveInt(row.legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  const countryId = parsePositiveInt(row.country_id);
  if (countryId) {
    return { scopeType: "COUNTRY", scopeId: countryId };
  }
  const groupCompanyId = parsePositiveInt(row.group_company_id);
  if (groupCompanyId) {
    return { scopeType: "GROUP", scopeId: groupCompanyId };
  }

  return { scopeType: "TENANT", scopeId: normalizedTenantId };
}

/**
 * Resolve the effective RBAC scope for one workflow instance, including country fallback.
 */
export async function resolveWorkflowInstanceScope(instanceId, tenantId) {
  const normalizedInstanceId = parsePositiveInt(instanceId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedInstanceId || !normalizedTenantId) {
    return null;
  }

  const row = await getWorkflowInstanceRowById({
    tenantId: normalizedTenantId,
    instanceId: normalizedInstanceId,
  });
  if (!row) {
    return null;
  }

  const operatingUnitId = parsePositiveInt(row.target_operating_unit_id);
  if (operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: operatingUnitId };
  }
  const legalEntityId = parsePositiveInt(row.target_legal_entity_id);
  if (legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
  }
  const countryId = parsePositiveInt(row.target_country_id);
  if (countryId) {
    return { scopeType: "COUNTRY", scopeId: countryId };
  }
  const groupCompanyId = parsePositiveInt(row.target_group_company_id);
  if (groupCompanyId) {
    return { scopeType: "GROUP", scopeId: groupCompanyId };
  }

  return { scopeType: "TENANT", scopeId: normalizedTenantId };
}

/**
 * Evaluate whether one target action is blocked by the configured workflow gate.
 */
export async function evaluateWorkflowApprovalGate({
  tenantId,
  processType,
  targetType,
  targetId,
  requestedByUserId,
  scope = {},
  effectiveOn = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedTargetId = parsePositiveInt(targetId);
  const normalizedRequestedByUserId = parsePositiveInt(requestedByUserId);
  const normalizedProcessType = toUpper(processType);
  const normalizedTargetType = toUpper(targetType);

  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedTargetId) {
    throw badRequest("targetId is required");
  }
  if (!normalizedRequestedByUserId) {
    throw badRequest("requestedByUserId is required");
  }
  if (!normalizedProcessType) {
    throw badRequest("processType is required");
  }
  if (!normalizedTargetType) {
    throw badRequest("targetType is required");
  }

  const gateEnabled = await isWorkflowGateFeatureEnabled(normalizedTenantId, runQuery);
  if (!gateEnabled) {
    return makeWorkflowGateResult({
      enabled: false,
      required: false,
      approved: true,
      processType: normalizedProcessType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
    });
  }

  const assignmentRow = await findActiveWorkflowAssignmentForScope({
    tenantId: normalizedTenantId,
    processType: normalizedProcessType,
    effectiveOn,
    scope,
    runQuery,
  });
  if (!assignmentRow) {
    return makeWorkflowGateResult({
      enabled: true,
      required: true,
      approved: false,
      errorCode: "WORKFLOW_NOT_ASSIGNED",
      message:
        "Workflow approval gate is enabled but no ACTIVE workflow assignment was found for scope",
      processType: normalizedProcessType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
    });
  }

  const workflowDefinitionId = parsePositiveInt(assignmentRow.workflow_definition_id);
  const maxStepNo = await getWorkflowDefinitionMaxStepNo(workflowDefinitionId, runQuery);
  if (maxStepNo <= 0) {
    return makeWorkflowGateResult({
      enabled: true,
      required: true,
      approved: false,
      errorCode: "WORKFLOW_NOT_ASSIGNED",
      message:
        "Assigned workflow definition has no approval steps; define steps before finalization",
      assignmentRow,
      processType: normalizedProcessType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
    });
  }

  let instanceRow = await getWorkflowInstanceByTarget({
    tenantId: normalizedTenantId,
    processType: normalizedProcessType,
    targetType: normalizedTargetType,
    targetId: normalizedTargetId,
    runQuery,
  });

  if (!instanceRow) {
    try {
      await runQuery(
        `INSERT INTO workflow_instances (
           tenant_id,
           process_type,
           target_type,
           target_id,
           workflow_definition_id,
           status,
           current_step_no,
           requested_by_user_id
         ) VALUES (?, ?, ?, ?, ?, 'PENDING', 1, ?)`,
        [
          normalizedTenantId,
          normalizedProcessType,
          normalizedTargetType,
          normalizedTargetId,
          workflowDefinitionId,
          normalizedRequestedByUserId,
        ]
      );
    } catch (err) {
      if (!isDuplicateKeyError(err)) {
        throw err;
      }
    }
    instanceRow = await getWorkflowInstanceByTarget({
      tenantId: normalizedTenantId,
      processType: normalizedProcessType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      runQuery,
    });
  }

  if (parsePositiveInt(instanceRow?.id)) {
    const bridgedInstance = await ensureUnifiedWorkflowInstanceBridge({
      tenantId: normalizedTenantId,
      instanceId: parsePositiveInt(instanceRow.id),
      requestedByUserId: normalizedRequestedByUserId,
      fallbackScope: scope,
      runQuery,
    });
    if (parsePositiveInt(bridgedInstance?.generic_request_id)) {
      const synced = await syncLegacyWorkflowInstanceFromUnifiedRequestTx({
        tenantId: normalizedTenantId,
        genericRequestId: parsePositiveInt(bridgedInstance.generic_request_id),
        runQuery,
      });
      instanceRow = synced?.row || bridgedInstance;
    } else {
      instanceRow = bridgedInstance;
    }
  }

  const instanceStatus = toUpper(instanceRow?.status);
  if (instanceStatus === "APPROVED") {
    return makeWorkflowGateResult({
      enabled: true,
      required: true,
      approved: true,
      assignmentRow,
      instanceRow,
      processType: normalizedProcessType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
    });
  }
  if (instanceStatus === "REJECTED") {
    return makeWorkflowGateResult({
      enabled: true,
      required: true,
      approved: false,
      errorCode: "APPROVAL_INSTANCE_REJECTED",
      message: "Workflow instance is REJECTED; finalization is blocked",
      assignmentRow,
      instanceRow,
      processType: normalizedProcessType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
    });
  }

  return makeWorkflowGateResult({
    enabled: true,
    required: true,
    approved: false,
    errorCode: "APPROVAL_REQUIRED",
    message: "Workflow approval is required before finalization",
    assignmentRow,
    instanceRow,
    processType: normalizedProcessType,
    targetType: normalizedTargetType,
    targetId: normalizedTargetId,
  });
}

export async function listWorkflowInstances({
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

  const where = ["wi.tenant_id = ?"];
  const params = [normalizedTenantId];

  if (filters?.processType) {
    where.push("wi.process_type = ?");
    params.push(toUpper(filters.processType));
  }
  if (filters?.status) {
    where.push("wi.status = ?");
    params.push(toUpper(filters.status));
  }
  if (filters?.targetType) {
    where.push("wi.target_type = ?");
    params.push(toUpper(filters.targetType));
  }
  if (filters?.targetId) {
    where.push("wi.target_id = ?");
    params.push(parsePositiveInt(filters.targetId));
  }
  if (filters?.workflowDefinitionId) {
    where.push("wi.workflow_definition_id = ?");
    params.push(parsePositiveInt(filters.workflowDefinitionId));
  }

  const result = await runQuery(
    `SELECT
       wi.*,
       wd.code AS workflow_definition_code,
       wd.name AS workflow_definition_name,
       requester.name AS requested_by_user_name,
       ${WORKFLOW_INSTANCE_TARGET_SCOPE_SELECT_SQL}
     FROM workflow_instances wi
     JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
     LEFT JOIN users requester ON requester.id = wi.requested_by_user_id
     ${WORKFLOW_INSTANCE_TARGET_SCOPE_JOIN_SQL}
     WHERE ${where.join(" AND ")}
     ORDER BY wi.requested_at DESC, wi.id DESC`,
    params
  );

  const scopedRows = (result.rows || []).filter((row) =>
    canReadWorkflowInstanceRow(req, row, assertScopeAccess)
  );
  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;

  return {
    rows: scopedRows
      .slice(safeOffset, safeOffset + safeLimit)
      .map(mapWorkflowInstanceRow),
    total: scopedRows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Load one workflow instance after ensuring its unified approval bridge is current.
 */
export async function getWorkflowInstanceById({
  req,
  tenantId,
  instanceId,
  assertScopeAccess,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedInstanceId = parsePositiveInt(instanceId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedInstanceId) {
    throw badRequest("instanceId is required");
  }

  let row = await getWorkflowInstanceRowById({
    tenantId: normalizedTenantId,
    instanceId: normalizedInstanceId,
    runQuery,
  });
  if (!row) {
    throw notFound("Workflow instance not found");
  }
  row = await withTransaction(async (tx) => {
    const bridged = await ensureUnifiedWorkflowInstanceBridge({
      tenantId: normalizedTenantId,
      instanceId: normalizedInstanceId,
      requestedByUserId: parsePositiveInt(row?.requested_by_user_id),
      runQuery: tx.query,
    });
    if (!parsePositiveInt(bridged?.generic_request_id)) {
      return bridged || row;
    }
    const synced = await syncLegacyWorkflowInstanceFromUnifiedRequestTx({
      tenantId: normalizedTenantId,
      genericRequestId: parsePositiveInt(bridged.generic_request_id),
      runQuery: tx.query,
    });
    return synced?.row || bridged || row;
  });
  assertWorkflowInstanceScopeAccess(req, row, assertScopeAccess);

  const decisions = await listWorkflowInstanceDecisionRows({
    tenantId: normalizedTenantId,
    instanceId: normalizedInstanceId,
    runQuery,
  });

  return {
    ...mapWorkflowInstanceRow(row),
    decisions,
  };
}

function assertInstanceIsDecisionable(row) {
  const status = toUpper(row?.status);
  if (status === "REJECTED") {
    throw conflict(
      "Workflow instance is already rejected",
      "APPROVAL_INSTANCE_REJECTED"
    );
  }
  if (status !== "PENDING") {
    throw conflict(
      `Workflow instance status ${status || "UNKNOWN"} is not decisionable`,
      "APPROVAL_STEP_ALREADY_DECIDED"
    );
  }
}

/**
 * Resolve the current-step permission and scope needed to decide one workflow instance.
 */
export async function resolveWorkflowDecisionPermissionAccess({
  tenantId,
  instanceId,
  decisionCode = "APPROVE",
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedInstanceId = parsePositiveInt(instanceId);
  const normalizedDecisionCode = toUpper(decisionCode || "APPROVE");
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedInstanceId) {
    throw badRequest("instanceId must be a positive integer");
  }

  const instanceRow = await getWorkflowInstanceRowById({
    tenantId: normalizedTenantId,
    instanceId: normalizedInstanceId,
    runQuery,
  });
  if (!instanceRow) {
    throw notFound("Workflow instance not found");
  }
  const bridgedRow = await withTransaction(async (tx) =>
    ensureUnifiedWorkflowInstanceBridge({
      tenantId: normalizedTenantId,
      instanceId: normalizedInstanceId,
      requestedByUserId: parsePositiveInt(instanceRow.requested_by_user_id),
      runQuery: tx.query,
    })
  );
  if (!parsePositiveInt(bridgedRow?.generic_request_id)) {
    throw conflict(
      "Workflow instance is missing its unified approval bridge",
      "APPROVAL_STEP_PERMISSION_DENIED"
    );
  }

  const synced = await syncLegacyWorkflowInstanceFromUnifiedRequestTx({
    tenantId: normalizedTenantId,
    genericRequestId: parsePositiveInt(bridgedRow.generic_request_id),
    runQuery,
  });
  const effectiveInstanceRow = synced?.row || bridgedRow || instanceRow;
  const requestRow = await getUnifiedWorkflowRequestRowById({
    tenantId: normalizedTenantId,
    requestId: parsePositiveInt(effectiveInstanceRow.generic_request_id),
    runQuery,
  });
  const instanceStatus = toUpper(effectiveInstanceRow?.status);
  const isApprovedApReturn =
    normalizedDecisionCode === "RETURN" &&
    instanceStatus === "APPROVED" &&
    isApDocumentWorkflowInstanceRow(effectiveInstanceRow);
  if (!isApprovedApReturn) {
    assertInstanceIsDecisionable(effectiveInstanceRow);
  }
  const policySnapshot = parseJson(requestRow?.policy_snapshot_json, {});
  const policySteps = Array.isArray(policySnapshot?.steps) ? policySnapshot.steps : [];
  const finalStepNo =
    policySteps.reduce(
      (highest, step) => Math.max(highest, Number(step?.step_no || step?.stepNo || 1)),
      1
    ) || 1;
  const unifiedAccess = resolveUnifiedWorkflowDecisionAccessFromRequestRow(requestRow, {
    stepNoOverride: isApprovedApReturn ? finalStepNo : null,
  });

  return {
    requiredPermissionCode: unifiedAccess.requiredPermissionCode,
    scope: {
      scopeType: unifiedAccess.scope.scopeType,
      scopeId: unifiedAccess.scope.scopeId,
    },
    stepNo: unifiedAccess.stepNo,
    stageScopeType: unifiedAccess.stageScopeType,
    minApproverCount: unifiedAccess.minApproverCount,
    instanceStatus,
  };
}

async function createWorkflowDecision({
  req,
  input,
  decision,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const instanceId = parsePositiveInt(input?.instanceId);
  const userId = parsePositiveInt(input?.userId);
  const decisionCode = toUpper(decision);
  const decisionNote = input?.decisionNote ? String(input.decisionNote).trim() : null;

  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!instanceId) {
    throw badRequest("instanceId is required");
  }
  if (!userId) {
    throw badRequest("userId is required");
  }
  if (!["APPROVE", "REJECT", "RETURN"].includes(decisionCode)) {
    throw badRequest("decision must be APPROVE, REJECT, or RETURN");
  }
  let bridgedInstance = await getWorkflowInstanceRowById({
    tenantId,
    instanceId,
    runQuery,
  });
  if (!bridgedInstance) {
    throw notFound("Workflow instance not found");
  }

  bridgedInstance = await withTransaction(async (tx) =>
    ensureUnifiedWorkflowInstanceBridge({
      tenantId,
      instanceId,
      requestedByUserId: parsePositiveInt(bridgedInstance.requested_by_user_id),
      runQuery: tx.query,
    })
  );
  if (!parsePositiveInt(bridgedInstance?.generic_request_id)) {
    throw conflict(
      "Workflow instance is missing its unified approval bridge",
      "APPROVAL_STEP_PERMISSION_DENIED"
    );
  }
  assertWorkflowInstanceScopeAccess(req, bridgedInstance, assertScopeAccess);

  const bridgedInstanceStatus = toUpper(bridgedInstance?.status);
  if (
    decisionCode === "RETURN" &&
    bridgedInstanceStatus === "APPROVED" &&
    isApDocumentWorkflowInstanceRow(bridgedInstance)
  ) {
    const permissionAccess = await resolveWorkflowDecisionPermissionAccess({
      tenantId,
      instanceId,
      decisionCode,
      runQuery,
    });
    const superseded = await withTransaction(async (tx) => {
      const lockedInstance = await getWorkflowInstanceRowById({
        tenantId,
        instanceId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!lockedInstance) {
        throw notFound("Workflow instance not found");
      }
      if (toUpper(lockedInstance.status) !== "APPROVED") {
        throw conflict(
          `Workflow instance status ${toUpper(lockedInstance.status) || "UNKNOWN"} cannot be returned from approved state`,
          "APPROVAL_STEP_ALREADY_DECIDED"
        );
      }
      await supersedeApprovedCariDocumentWorkflowInstanceTx({
        tenantId,
        instanceRow: lockedInstance,
        decisionNote,
        runQuery: tx.query,
      });
      return getWorkflowInstanceRowById({
        tenantId,
        instanceId,
        runQuery: tx.query,
      });
    });
    const decisions = await listWorkflowInstanceDecisionRows({
      tenantId,
      instanceId,
      runQuery,
    });
    return {
      row: mapWorkflowInstanceRow(superseded),
      decisions,
      currentStepNo: permissionAccess.stepNo,
      minApproverCount: permissionAccess.minApproverCount,
      stageScopeType: permissionAccess.stageScopeType,
      requiredPermissionCode: permissionAccess.requiredPermissionCode,
      advanced: false,
      resolved: true,
      decision: decisionCode,
      executionResult: null,
    };
  }

  const unifiedRequestRow = await getUnifiedWorkflowRequestRowById({
    tenantId,
    requestId: parsePositiveInt(bridgedInstance.generic_request_id),
    runQuery,
  });
  const unifiedAccess = resolveUnifiedWorkflowDecisionAccessFromRequestRow(
    unifiedRequestRow
  );
  const decisionResult = await recordDecision(
    parsePositiveInt(bridgedInstance.generic_request_id),
    userId,
    decisionCode,
    decisionNote
  );
  const synced = await withTransaction(async (tx) =>
    syncLegacyWorkflowInstanceFromUnifiedRequestTx({
      tenantId,
      genericRequestId: parsePositiveInt(bridgedInstance.generic_request_id),
      runQuery: tx.query,
    })
  );
  const syncedRow = synced?.row || bridgedInstance;
  const syncedStatus = toUpper(syncedRow?.status);
  const advanced =
    decisionCode === "APPROVE" &&
    syncedStatus === "PENDING" &&
      Number(syncedRow?.current_step_no ?? syncedRow?.currentStepNo ?? 0) >
      unifiedAccess.stepNo;
  const resolved = ["APPROVED", "REJECTED", "CANCELLED", "SUPERSEDED"].includes(
    syncedStatus
  );

  return {
    row: mapWorkflowInstanceRow(syncedRow),
    decisions: synced?.decisions || [],
    currentStepNo: unifiedAccess.stepNo,
    minApproverCount: unifiedAccess.minApproverCount,
    stageScopeType: unifiedAccess.stageScopeType,
    requiredPermissionCode: unifiedAccess.requiredPermissionCode,
    advanced,
    resolved,
    decision: decisionCode,
    executionResult: decisionResult?.execution_result || null,
  };
}

/**
 * Record one approve decision against the current workflow step.
 */
export async function approveWorkflowInstance({
  req,
  input,
  assertScopeAccess,
}) {
  return createWorkflowDecision({
    req,
    input,
    decision: "APPROVE",
    assertScopeAccess,
  });
}

/**
 * Record one reject decision against the current workflow step.
 */
export async function rejectWorkflowInstance({
  req,
  input,
  assertScopeAccess,
}) {
  return createWorkflowDecision({
    req,
    input,
    decision: "REJECT",
    assertScopeAccess,
  });
}

/**
 * Record one return decision against the current workflow step, or supersede
 * one already-approved AP workflow instance back into correction.
 */
export async function returnWorkflowInstance({
  req,
  input,
  assertScopeAccess,
}) {
  return createWorkflowDecision({
    req,
    input,
    decision: "RETURN",
    assertScopeAccess,
  });
}

export async function listWorkflowDefinitions({
  tenantId,
  filters,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const where = ["wd.tenant_id = ?"];
  const params = [normalizedTenantId];

  if (filters?.processType) {
    where.push("wd.process_type = ?");
    params.push(toUpper(filters.processType));
  }
  if (filters?.isActive !== null && filters?.isActive !== undefined) {
    where.push("wd.is_active = ?");
    params.push(filters.isActive ? 1 : 0);
  }
  if (filters?.q) {
    where.push("(wd.code LIKE ? OR wd.name LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const whereSql = where.join(" AND ");
  const countResult = await runQuery(
    `SELECT COUNT(*) AS total
     FROM workflow_definitions wd
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;

  const rowsResult = await runQuery(
    `SELECT
       wd.*,
       u.name AS created_by_user_name,
       (
         SELECT COUNT(*)
         FROM workflow_definition_steps wds
         WHERE wds.workflow_definition_id = wd.id
       ) AS step_count
     FROM workflow_definitions wd
     LEFT JOIN users u ON u.id = wd.created_by_user_id
     WHERE ${whereSql}
     ORDER BY wd.process_type ASC, wd.code ASC, wd.version_no DESC, wd.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (rowsResult.rows || []).map(mapWorkflowDefinitionRow),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getWorkflowDefinitionById({
  tenantId,
  definitionId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedDefinitionId = parsePositiveInt(definitionId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedDefinitionId) {
    throw badRequest("definitionId must be a positive integer");
  }

  const row = await getWorkflowDefinitionRowById({
    tenantId: normalizedTenantId,
    definitionId: normalizedDefinitionId,
    runQuery,
  });
  if (!row) {
    throw notFound("Workflow definition not found");
  }
  return mapWorkflowDefinitionRow(row);
}

/**
 * Create one workflow definition and refresh its generic approval-policy mirror.
 */
export async function createWorkflowDefinition({
  input,
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

  try {
    const insertResult = await runQuery(
      `INSERT INTO workflow_definitions (
         tenant_id,
         code,
         name,
         process_type,
         is_active,
         version_no,
         created_by_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        toUpper(input.code),
        String(input.name || "").trim(),
        toUpper(input.processType),
        input.isActive ? 1 : 0,
        Number(input.versionNo || 1),
        userId,
      ]
    );
    const definitionId = parsePositiveInt(insertResult.rows?.insertId);
    let row = await getWorkflowDefinitionRowById({
      tenantId,
      definitionId,
      runQuery,
    });
    await ensureUnifiedWorkflowPolicyForDefinition({
      tenantId,
      definitionId,
      runQuery,
    });
    row = await getWorkflowDefinitionRowById({
      tenantId,
      definitionId,
      runQuery,
    });
    return mapWorkflowDefinitionRow(row);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict("Workflow definition code/version already exists for tenant");
    }
    throw err;
  }
}

/**
 * Update one workflow definition and refresh its generic approval-policy mirror.
 */
export async function updateWorkflowDefinition({
  input,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const definitionId = parsePositiveInt(input?.definitionId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!definitionId) {
    throw badRequest("definitionId is required");
  }

  const existing = await getWorkflowDefinitionRowById({
    tenantId,
    definitionId,
    runQuery,
  });
  if (!existing) {
    throw notFound("Workflow definition not found");
  }

  const updates = [];
  const params = [];

  if (input.code !== undefined) {
    updates.push("code = ?");
    params.push(toUpper(input.code));
  }
  if (input.name !== undefined) {
    updates.push("name = ?");
    params.push(String(input.name || "").trim());
  }
  if (input.processType !== undefined) {
    updates.push("process_type = ?");
    params.push(toUpper(input.processType));
  }
  if (input.isActive !== undefined) {
    updates.push("is_active = ?");
    params.push(input.isActive ? 1 : 0);
  }
  if (input.versionNo !== undefined) {
    updates.push("version_no = ?");
    params.push(Number(input.versionNo));
  }

  if (updates.length === 0) {
    return mapWorkflowDefinitionRow(existing);
  }

  try {
    await runQuery(
      `UPDATE workflow_definitions
       SET ${updates.join(", ")}
       WHERE tenant_id = ?
         AND id = ?`,
      [...params, tenantId, definitionId]
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict("Workflow definition code/version already exists for tenant");
    }
    throw err;
  }

  let updated = await getWorkflowDefinitionRowById({
    tenantId,
    definitionId,
    runQuery,
  });
  await ensureUnifiedWorkflowPolicyForDefinition({
    tenantId,
    definitionId,
    runQuery,
  });
  updated = await getWorkflowDefinitionRowById({
    tenantId,
    definitionId,
    runQuery,
  });
  return mapWorkflowDefinitionRow(updated);
}

export async function listWorkflowDefinitionSteps({
  tenantId,
  definitionId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedDefinitionId = parsePositiveInt(definitionId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedDefinitionId) {
    throw badRequest("definitionId is required");
  }

  await assertWorkflowDefinitionExists(
    normalizedTenantId,
    normalizedDefinitionId,
    runQuery
  );
  const result = await runQuery(
    `SELECT *
     FROM workflow_definition_steps
     WHERE workflow_definition_id = ?
     ORDER BY step_no ASC, id ASC`,
    [normalizedDefinitionId]
  );

  return (result.rows || []).map(mapWorkflowDefinitionStepRow);
}

/**
 * Replace the ordered step set for one workflow definition and refresh the generic mirror.
 */
export async function replaceWorkflowDefinitionSteps({ input }) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const definitionId = parsePositiveInt(input?.definitionId);
  const steps = Array.isArray(input?.steps) ? input.steps : [];
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!definitionId) {
    throw badRequest("definitionId is required");
  }
  if (steps.length === 0) {
    throw badRequest("steps must be a non-empty array");
  }

  return withTransaction(async (tx) => {
    const definitionRow = await assertWorkflowDefinitionExists(
      tenantId,
      definitionId,
      tx.query
    );

    await tx.query(
      `DELETE FROM workflow_definition_steps
       WHERE workflow_definition_id = ?`,
      [definitionId]
    );

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      assertWorkflowStepPermissionCompatibility(
        definitionRow.process_type ?? definitionRow.processType,
        step,
        index
      );
      // eslint-disable-next-line no-await-in-loop
      await tx.query(
        `INSERT INTO workflow_definition_steps (
           workflow_definition_id,
           step_no,
           stage_scope_type,
           required_permission_code,
           min_approver_count,
           allow_self_approve,
           escalation_after_hours
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          definitionId,
          Number(step.stepNo),
          toUpper(step.stageScopeType),
          normalizeWorkflowStepPermissionCode(step.requiredPermissionCode),
          Number(step.minApproverCount || 1),
          step.allowSelfApprove ? 1 : 0,
          step.escalationAfterHours || null,
        ]
      );
    }

    const rows = await tx.query(
      `SELECT *
       FROM workflow_definition_steps
       WHERE workflow_definition_id = ?
       ORDER BY step_no ASC, id ASC`,
      [definitionId]
    );
    await ensureUnifiedWorkflowPolicyForDefinition({
      tenantId,
      definitionId,
      runQuery: tx.query,
    });
    return (rows.rows || []).map(mapWorkflowDefinitionStepRow);
  });
}

export async function listWorkflowAssignments({
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

  const where = ["wa.tenant_id = ?"];
  const params = [normalizedTenantId];

  if (filters?.processType) {
    where.push("wa.process_type = ?");
    params.push(toUpper(filters.processType));
  }
  if (filters?.status) {
    where.push("wa.status = ?");
    params.push(toUpper(filters.status));
  }
  if (filters?.workflowDefinitionId) {
    where.push("wa.workflow_definition_id = ?");
    params.push(parsePositiveInt(filters.workflowDefinitionId));
  }
  if (filters?.groupCompanyId) {
    where.push("wa.group_company_id = ?");
    params.push(parsePositiveInt(filters.groupCompanyId));
  }
  if (filters?.countryId) {
    where.push("wa.country_id = ?");
    params.push(parsePositiveInt(filters.countryId));
  }
  if (filters?.legalEntityId) {
    where.push("wa.legal_entity_id = ?");
    params.push(parsePositiveInt(filters.legalEntityId));
  }
  if (filters?.operatingUnitId) {
    where.push("wa.operating_unit_id = ?");
    params.push(parsePositiveInt(filters.operatingUnitId));
  }
  if (filters?.effectiveOn) {
    where.push("wa.effective_from <= ?");
    where.push("(wa.effective_to IS NULL OR wa.effective_to >= ?)");
    params.push(filters.effectiveOn, filters.effectiveOn);
  }
  if (filters?.q) {
    where.push(
      `(wd.code LIKE ? OR wd.name LIKE ? OR gc.code LIKE ? OR gc.name LIKE ? OR c.iso2 LIKE ? OR c.name LIKE ? OR le.code LIKE ? OR le.name LIKE ? OR ou.code LIKE ? OR ou.name LIKE ?)`
    );
    const wildcard = `%${filters.q}%`;
    params.push(
      wildcard,
      wildcard,
      wildcard,
      wildcard,
      wildcard,
      wildcard,
      wildcard,
      wildcard,
      wildcard,
      wildcard
    );
  }

  const result = await runQuery(
    `SELECT
       wa.*,
       wd.code AS workflow_definition_code,
       wd.name AS workflow_definition_name,
       gc.code AS group_company_code,
       gc.name AS group_company_name,
       c.iso2 AS country_iso2,
       c.name AS country_name,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       u.name AS created_by_user_name
     FROM workflow_assignments wa
     JOIN workflow_definitions wd ON wd.id = wa.workflow_definition_id
     LEFT JOIN group_companies gc ON gc.id = wa.group_company_id
     LEFT JOIN countries c ON c.id = wa.country_id
     LEFT JOIN legal_entities le ON le.id = wa.legal_entity_id
     LEFT JOIN operating_units ou ON ou.id = wa.operating_unit_id
     LEFT JOIN users u ON u.id = wa.created_by_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY wa.process_type ASC, wa.id DESC`,
    params
  );

  const scopedRows = (result.rows || []).filter((row) =>
    canReadAssignmentRow(req, row, assertScopeAccess)
  );
  const safeLimit =
    Number.isInteger(filters?.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;

  return {
    rows: scopedRows
      .slice(safeOffset, safeOffset + safeLimit)
      .map(mapWorkflowAssignmentRow),
    total: scopedRows.length,
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * Create one workflow assignment and refresh the related generic approval-policy mirror.
 */
export async function createWorkflowAssignment({
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

  const definitionRow = await assertWorkflowDefinitionExists(
    tenantId,
    input.workflowDefinitionId,
    runQuery
  );
  if (toUpper(definitionRow.process_type) !== toUpper(input.processType)) {
    throw badRequest("processType must match workflow definition processType");
  }

  assertAssignmentWriteScope(req, input, assertScopeAccess);
  await resolveAssignmentScopeReferences({
    tenantId,
    groupCompanyId: input.groupCompanyId,
    countryId: input.countryId,
    legalEntityId: input.legalEntityId,
    operatingUnitId: input.operatingUnitId,
  });

  const insertResult = await runQuery(
    `INSERT INTO workflow_assignments (
       tenant_id,
       process_type,
       workflow_definition_id,
       group_company_id,
       country_id,
       legal_entity_id,
       operating_unit_id,
       effective_from,
       effective_to,
       status,
       created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      toUpper(input.processType),
      parsePositiveInt(input.workflowDefinitionId),
      parsePositiveInt(input.groupCompanyId) || null,
      parsePositiveInt(input.countryId) || null,
      parsePositiveInt(input.legalEntityId) || null,
      parsePositiveInt(input.operatingUnitId) || null,
      input.effectiveFrom,
      input.effectiveTo || null,
      toUpper(input.status || "ACTIVE"),
      userId,
    ]
  );

  const assignmentId = parsePositiveInt(insertResult.rows?.insertId);
  const row = await getWorkflowAssignmentRowById({
    tenantId,
    assignmentId,
    runQuery,
  });
  await ensureUnifiedWorkflowPolicyForDefinition({
    tenantId,
    definitionId: parsePositiveInt(input.workflowDefinitionId),
    runQuery,
  });
  return mapWorkflowAssignmentRow(row);
}

/**
 * Update one workflow assignment and refresh the affected generic approval-policy mirrors.
 */
export async function updateWorkflowAssignment({
  req,
  input,
  assertScopeAccess,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(input?.tenantId);
  const assignmentId = parsePositiveInt(input?.assignmentId);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  if (!assignmentId) {
    throw badRequest("assignmentId is required");
  }

  const existing = await getWorkflowAssignmentRowById({
    tenantId,
    assignmentId,
    runQuery,
  });
  if (!existing) {
    throw notFound("Workflow assignment not found");
  }
  assertAssignmentScopeAccess(req, existing, assertScopeAccess);

  const next = {
    processType:
      input.processType !== undefined
        ? toUpper(input.processType)
        : toUpper(existing.process_type),
    workflowDefinitionId:
      input.workflowDefinitionId !== undefined
        ? parsePositiveInt(input.workflowDefinitionId)
        : parsePositiveInt(existing.workflow_definition_id),
    groupCompanyId:
      input.groupCompanyId !== undefined
        ? parsePositiveInt(input.groupCompanyId) || null
        : parsePositiveInt(existing.group_company_id) || null,
    countryId:
      input.countryId !== undefined
        ? parsePositiveInt(input.countryId) || null
        : parsePositiveInt(existing.country_id) || null,
    legalEntityId:
      input.legalEntityId !== undefined
        ? parsePositiveInt(input.legalEntityId) || null
        : parsePositiveInt(existing.legal_entity_id) || null,
    operatingUnitId:
      input.operatingUnitId !== undefined
        ? parsePositiveInt(input.operatingUnitId) || null
        : parsePositiveInt(existing.operating_unit_id) || null,
    effectiveFrom:
      input.effectiveFrom !== undefined
        ? input.effectiveFrom
        : toDateOnly(existing.effective_from),
    effectiveTo:
      input.effectiveTo !== undefined
        ? input.effectiveTo
        : toDateOnly(existing.effective_to),
    status:
      input.status !== undefined ? toUpper(input.status) : toUpper(existing.status),
  };

  if (next.effectiveTo && next.effectiveFrom && next.effectiveTo < next.effectiveFrom) {
    throw badRequest("effectiveTo cannot be earlier than effectiveFrom");
  }

  assertAssignmentWriteScope(req, next, assertScopeAccess);
  await resolveAssignmentScopeReferences({
    tenantId,
    groupCompanyId: next.groupCompanyId,
    countryId: next.countryId,
    legalEntityId: next.legalEntityId,
    operatingUnitId: next.operatingUnitId,
  });

  const definitionRow = await assertWorkflowDefinitionExists(
    tenantId,
    next.workflowDefinitionId,
    runQuery
  );
  if (toUpper(definitionRow.process_type) !== next.processType) {
    throw badRequest("processType must match workflow definition processType");
  }

  await runQuery(
    `UPDATE workflow_assignments
     SET process_type = ?,
         workflow_definition_id = ?,
         group_company_id = ?,
         country_id = ?,
         legal_entity_id = ?,
         operating_unit_id = ?,
         effective_from = ?,
         effective_to = ?,
         status = ?
     WHERE tenant_id = ?
       AND id = ?`,
    [
      next.processType,
      next.workflowDefinitionId,
      next.groupCompanyId,
      next.countryId,
      next.legalEntityId,
      next.operatingUnitId,
      next.effectiveFrom,
      next.effectiveTo,
      next.status,
      tenantId,
      assignmentId,
    ]
  );

  const row = await getWorkflowAssignmentRowById({
    tenantId,
    assignmentId,
    runQuery,
  });
  await ensureUnifiedWorkflowPolicyForDefinition({
    tenantId,
    definitionId: next.workflowDefinitionId,
    runQuery,
  });
  if (
    parsePositiveInt(existing.workflow_definition_id) &&
    parsePositiveInt(existing.workflow_definition_id) !== next.workflowDefinitionId
  ) {
    await ensureUnifiedWorkflowPolicyForDefinition({
      tenantId,
      definitionId: parsePositiveInt(existing.workflow_definition_id),
      runQuery,
    });
  }
  return mapWorkflowAssignmentRow(row);
}

export default {
  findActiveWorkflowAssignmentForScope,
  getWorkflowInstanceByTarget,
  listWorkflowInstanceDecisionRows,
  resolveWorkflowAssignmentScope,
  resolveWorkflowInstanceScope,
  evaluateWorkflowApprovalGate,
  listWorkflowDefinitions,
  getWorkflowDefinitionById,
  createWorkflowDefinition,
  updateWorkflowDefinition,
  listWorkflowDefinitionSteps,
  replaceWorkflowDefinitionSteps,
  listWorkflowAssignments,
  listWorkflowInstances,
  getWorkflowInstanceById,
  createWorkflowAssignment,
  updateWorkflowAssignment,
  resolveWorkflowDecisionPermissionAccess,
  approveWorkflowInstance,
  rejectWorkflowInstance,
  returnWorkflowInstance,
};
