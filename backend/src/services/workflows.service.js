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
  findApWorkflowStepByNo,
  getApWorkflowRequiredPermissionCode,
  listApWorkflowApproveSteps,
  listApWorkflowSteps,
  resolveApWorkflowEditableStep,
} from "../../../shared/cariDocumentWorkflowGovernance.js";
import {
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_WORKFLOW_ALLOWED_PERMISSION_CODES,
  PERIOD_CLOSE_WORKFLOW_PROCESS_TYPE,
  isPeriodClosePermissionScopeAllowed,
  isPeriodCloseWorkflowStepPermissionCodeAllowed,
  periodCloseWorkflowHasApprovalStep,
} from "../../../shared/periodCloseGovernance.js";
import {
  getWorkflowStepAllowedScopeTypes,
  isWorkflowStepScopeAllowed,
} from "../../../shared/workflowStepScopeGovernance.js";

const FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1 =
  "FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1";
const WORKFLOW_UNIFIED_MODULE_CODE = "WORKFLOW";
const WORKFLOW_UNIFIED_ACTION_TYPE = "APPROVE_WORKFLOW";
const WORKFLOW_ASSIGNMENT_AMOUNT_BASES = ["BASE_AMOUNT"];
const DEFAULT_WORKFLOW_ASSIGNMENT_PRIORITY = 100;
const AP_DOCUMENT_STEP_ACTION_CODES = Object.freeze([
  "DRAFT",
  "SUBMIT",
  "APPROVE",
  "POST",
]);

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

function toAmount(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(6)) : null;
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

async function loadApWorkflowBridgeContext(instanceRow, runQuery = query) {
  if (!isApDocumentWorkflowInstanceRow(instanceRow)) {
    return null;
  }
  const definitionId = parsePositiveInt(
    instanceRow?.workflow_definition_id ?? instanceRow?.workflowDefinitionId
  );
  if (!definitionId) {
    return null;
  }
  const stepRows = await listWorkflowDefinitionStepRowsRaw(definitionId, runQuery);
  return buildWorkflowApprovalBridgeContext(
    {
      process_type: instanceRow?.process_type ?? instanceRow?.processType,
    },
    stepRows
  );
}

function normalizeWorkflowStepPermissionCode(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeWorkflowStepActionCode(value) {
  const normalized = toUpper(value);
  return normalized || null;
}

function normalizeWorkflowAssignmentAmountBasis(value) {
  const normalized = toUpper(value);
  return WORKFLOW_ASSIGNMENT_AMOUNT_BASES.includes(normalized) ? normalized : null;
}

function normalizeWorkflowAssignmentPriority(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_WORKFLOW_ASSIGNMENT_PRIORITY;
}

function resolveWorkflowAssignmentRoutingState(source = {}) {
  const minAmount = toAmount(source?.minAmount ?? source?.min_amount);
  const maxAmount = toAmount(source?.maxAmount ?? source?.max_amount);
  const isFallback = toDbBoolean(source?.isFallback ?? source?.is_fallback);
  let amountBasis = normalizeWorkflowAssignmentAmountBasis(
    source?.amountBasis ?? source?.amount_basis
  );
  if (!amountBasis && (minAmount !== null || maxAmount !== null || isFallback)) {
    amountBasis = "BASE_AMOUNT";
  }
  return {
    amountBasis,
    minAmount,
    maxAmount,
    priority: normalizeWorkflowAssignmentPriority(source?.priority),
    isFallback,
  };
}

function isLegacyWorkflowAssignmentRoutingRule(source = {}) {
  const routing = resolveWorkflowAssignmentRoutingState(source);
  return (
    routing.amountBasis === null &&
    routing.minAmount === null &&
    routing.maxAmount === null &&
    routing.isFallback === false
  );
}

function compareWorkflowAssignmentSelectionPriority(left, right) {
  const priorityDiff =
    normalizeWorkflowAssignmentPriority(right?.priority) -
    normalizeWorkflowAssignmentPriority(left?.priority);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  const effectiveFromDiff = String(right?.effective_from || "").localeCompare(
    String(left?.effective_from || "")
  );
  if (effectiveFromDiff !== 0) {
    return effectiveFromDiff;
  }
  return parsePositiveInt(right?.id) - parsePositiveInt(left?.id);
}

function evaluateWorkflowAssignmentBandMatch(
  assignmentRow,
  { thresholdAmount = null, amountBasis = null } = {}
) {
  const routing = resolveWorkflowAssignmentRoutingState(assignmentRow);
  if (routing.isFallback) {
    return { matches: false, reason: "FALLBACK_RULE" };
  }
  if (isLegacyWorkflowAssignmentRoutingRule(assignmentRow)) {
    return { matches: true, reason: "LEGACY_RULE" };
  }
  const normalizedAmountBasis = normalizeWorkflowAssignmentAmountBasis(amountBasis);
  if (!normalizedAmountBasis) {
    return { matches: false, reason: "AMOUNT_BASIS_REQUIRED" };
  }
  if (normalizedAmountBasis !== routing.amountBasis) {
    return { matches: false, reason: "AMOUNT_BASIS_MISMATCH" };
  }
  if (routing.minAmount === null && routing.maxAmount === null) {
    return { matches: true, reason: "AMOUNT_BAND_UNBOUNDED" };
  }
  const evaluatedAmount = toAmount(thresholdAmount);
  if (evaluatedAmount === null) {
    return { matches: false, reason: "THRESHOLD_AMOUNT_REQUIRED" };
  }
  if (routing.minAmount !== null && evaluatedAmount < routing.minAmount) {
    return { matches: false, reason: "BELOW_MIN_AMOUNT" };
  }
  if (routing.maxAmount !== null && evaluatedAmount > routing.maxAmount) {
    return { matches: false, reason: "ABOVE_MAX_AMOUNT" };
  }
  return { matches: true, reason: "AMOUNT_BAND_MATCH" };
}

function resolveWorkflowAssignmentScopeLayer(row, resolvedScope = {}) {
  const operatingUnitId = parsePositiveInt(resolvedScope?.operatingUnitId);
  if (
    parsePositiveInt(row?.operating_unit_id) &&
    parsePositiveInt(row?.operating_unit_id) === operatingUnitId
  ) {
    return "OPERATING_UNIT";
  }

  const legalEntityId = parsePositiveInt(resolvedScope?.legalEntityId);
  if (
    !parsePositiveInt(row?.operating_unit_id) &&
    parsePositiveInt(row?.legal_entity_id) &&
    parsePositiveInt(row?.legal_entity_id) === legalEntityId
  ) {
    return "LEGAL_ENTITY";
  }

  const countryId = parsePositiveInt(resolvedScope?.countryId);
  if (
    !parsePositiveInt(row?.operating_unit_id) &&
    !parsePositiveInt(row?.legal_entity_id) &&
    parsePositiveInt(row?.country_id) &&
    parsePositiveInt(row?.country_id) === countryId
  ) {
    return "COUNTRY";
  }

  const groupCompanyId = parsePositiveInt(resolvedScope?.groupCompanyId);
  if (
    !parsePositiveInt(row?.operating_unit_id) &&
    !parsePositiveInt(row?.legal_entity_id) &&
    !parsePositiveInt(row?.country_id) &&
    parsePositiveInt(row?.group_company_id) &&
    parsePositiveInt(row?.group_company_id) === groupCompanyId
  ) {
    return "GROUP";
  }

  if (
    !parsePositiveInt(row?.operating_unit_id) &&
    !parsePositiveInt(row?.legal_entity_id) &&
    !parsePositiveInt(row?.country_id) &&
    !parsePositiveInt(row?.group_company_id)
  ) {
    return "TENANT";
  }

  return null;
}

function listWorkflowAssignmentScopeLayers(resolvedScope = {}) {
  const layers = [];
  if (parsePositiveInt(resolvedScope?.operatingUnitId)) {
    layers.push("OPERATING_UNIT");
  }
  if (parsePositiveInt(resolvedScope?.legalEntityId)) {
    layers.push("LEGAL_ENTITY");
  }
  if (parsePositiveInt(resolvedScope?.countryId)) {
    layers.push("COUNTRY");
  }
  if (parsePositiveInt(resolvedScope?.groupCompanyId)) {
    layers.push("GROUP");
  }
  layers.push("TENANT");
  return layers;
}

function normalizeWorkflowAssignmentResolutionScope(resolvedScope = {}) {
  return {
    operatingUnitId: parsePositiveInt(resolvedScope?.operatingUnitId) || null,
    legalEntityId: parsePositiveInt(resolvedScope?.legalEntityId) || null,
    countryId: parsePositiveInt(resolvedScope?.countryId) || null,
    groupCompanyId: parsePositiveInt(resolvedScope?.groupCompanyId) || null,
  };
}

function mapWorkflowAssignmentSelectionCandidate(
  assignmentRow,
  resolvedScope,
  bandEvaluation
) {
  const routing = resolveWorkflowAssignmentRoutingState(assignmentRow);
  const assignmentScope = mapWorkflowAssignmentRowToUnifiedScope(assignmentRow);
  return {
    id: parsePositiveInt(assignmentRow?.id),
    workflowDefinitionId: parsePositiveInt(assignmentRow?.workflow_definition_id),
    workflowDefinitionCode: String(assignmentRow?.workflow_definition_code || "").trim() || null,
    workflowDefinitionName: String(assignmentRow?.workflow_definition_name || "").trim() || null,
    processType: toUpper(assignmentRow?.process_type),
    scopeType: assignmentScope.scopeType,
    scopeId: assignmentScope.scopeId,
    scopeLayer: resolveWorkflowAssignmentScopeLayer(assignmentRow, resolvedScope),
    amountBasis: routing.amountBasis,
    minAmount: routing.minAmount,
    maxAmount: routing.maxAmount,
    priority: routing.priority,
    isFallback: routing.isFallback,
    effectiveFrom: toDateOnly(assignmentRow?.effective_from),
    effectiveTo: toDateOnly(assignmentRow?.effective_to),
    status: toUpper(assignmentRow?.status),
    bandMatch: Boolean(bandEvaluation?.matches),
    bandReason: bandEvaluation?.reason || null,
  };
}

function resolveWorkflowAssignmentNoMatchReason(layerEvaluations = []) {
  const reasons = new Set(
    layerEvaluations
      .filter((entry) => !entry.summary.isFallback)
      .map((entry) => entry.bandEvaluation.reason)
  );
  if (reasons.has("THRESHOLD_AMOUNT_REQUIRED")) {
    return "THRESHOLD_AMOUNT_REQUIRED";
  }
  if (reasons.has("AMOUNT_BASIS_REQUIRED")) {
    return "AMOUNT_BASIS_REQUIRED";
  }
  if (reasons.has("AMOUNT_BASIS_MISMATCH")) {
    return "AMOUNT_BASIS_MISMATCH";
  }
  if (reasons.has("BELOW_MIN_AMOUNT") || reasons.has("ABOVE_MAX_AMOUNT")) {
    return "THRESHOLD_OUT_OF_RANGE";
  }
  return "NO_BAND_MATCH_IN_SCOPE";
}

function buildWorkflowAssignmentResolutionDiagnostics({
  effectiveOn,
  resolvedScope,
  thresholdAmount,
  amountBasis,
  scopeLayersTried,
  candidateCount,
  matchedScopeLayer = null,
  evaluatedAssignments = [],
  matchType = "NONE",
  noMatchReason = null,
  selectedAssignment = null,
  priorityApplied = false,
}) {
  const bandMatchCount = evaluatedAssignments.filter((item) => item.bandMatch).length;
  return {
    effectiveOn,
    resolvedScope: normalizeWorkflowAssignmentResolutionScope(resolvedScope),
    thresholdAmount: toAmount(thresholdAmount),
    amountBasis: normalizeWorkflowAssignmentAmountBasis(amountBasis),
    scopeLayersTried,
    matchedScopeLayer,
    matchType,
    noMatchReason,
    candidateCount,
    matchedScopeCandidateCount: evaluatedAssignments.length,
    bandMatchCount,
    fallbackCount: evaluatedAssignments.filter((item) => item.isFallback).length,
    priorityApplied: Boolean(priorityApplied),
    selectedAssignment,
    evaluatedAssignments,
  };
}

function normalizeWorkflowDefinitionStepWriteShape(step = {}) {
  const actionCode = normalizeWorkflowStepActionCode(
    step.actionCode ?? step.action_code ?? null
  );
  const rawRequiredPermissionCode = normalizeWorkflowStepPermissionCode(
    step.requiredPermissionCode ?? step.required_permission_code ?? null
  );
  return {
    stepNo: Number(step.stepNo ?? step.step_no ?? 0),
    stageScopeType: toUpper(step.stageScopeType ?? step.stage_scope_type),
    actionCode,
    requiredPermissionCode:
      actionCode
        ? rawRequiredPermissionCode || getApWorkflowRequiredPermissionCode(actionCode)
        : rawRequiredPermissionCode,
    minApproverCount: Math.max(
      1,
      Number(step.minApproverCount ?? step.min_approver_count ?? 1) || 1
    ),
    allowSelfApprove: Boolean(
      toDbBoolean(step.allowSelfApprove ?? step.allow_self_approve)
    ),
    escalationAfterHours:
      parsePositiveInt(step.escalationAfterHours ?? step.escalation_after_hours) || null,
  };
}

function assertApWorkflowDefinitionSteps(steps) {
  let previousStepNo = 0;
  let postStepCount = 0;
  let submitStepCount = 0;
  let approveStepCount = 0;
  let currentPhase = "START";

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepNo = Number(step.stepNo || 0);
    if (!Number.isInteger(stepNo) || stepNo <= previousStepNo) {
      throw badRequest(
        `steps[${index}].stepNo must be greater than the previous AP step number`
      );
    }
    previousStepNo = stepNo;

    if (!AP_DOCUMENT_STEP_ACTION_CODES.includes(step.actionCode)) {
      throw badRequest(`steps[${index}].actionCode is required for AP_DOCUMENT_POSTING`);
    }
    const expectedPermissionCode =
      getApWorkflowRequiredPermissionCode(step.actionCode);
    if (!step.requiredPermissionCode) {
      throw badRequest(
        `steps[${index}].requiredPermissionCode is required for AP_DOCUMENT_POSTING`
      );
    }
    if (step.requiredPermissionCode !== expectedPermissionCode) {
      throw badRequest(
        `steps[${index}].requiredPermissionCode must be ${expectedPermissionCode} for action ${step.actionCode}`
      );
    }
    if (step.actionCode !== "APPROVE" && step.minApproverCount > 1) {
      throw badRequest(
        `steps[${index}].minApproverCount greater than 1 is only valid for APPROVE`
      );
    }

    // First-pass AP grammar: DRAFT? SUBMIT? APPROVE* POST
    if (step.actionCode === "DRAFT") {
      if (currentPhase !== "START") {
        throw badRequest(`steps[${index}].actionCode DRAFT can only appear as the first AP step`);
      }
      currentPhase = "AFTER_DRAFT";
      continue;
    }
    if (step.actionCode === "SUBMIT") {
      if (!["START", "AFTER_DRAFT"].includes(currentPhase)) {
        throw badRequest(
          `steps[${index}].actionCode SUBMIT must appear before APPROVE and POST`
        );
      }
      submitStepCount += 1;
      currentPhase = "AFTER_SUBMIT";
      continue;
    }
    if (step.actionCode === "APPROVE") {
      if (!["AFTER_SUBMIT", "AFTER_APPROVE"].includes(currentPhase)) {
        throw badRequest(
          `steps[${index}].actionCode APPROVE must appear after SUBMIT and before POST`
        );
      }
      approveStepCount += 1;
      currentPhase = "AFTER_APPROVE";
      continue;
    }
    if (!["AFTER_SUBMIT", "AFTER_APPROVE"].includes(currentPhase)) {
      throw badRequest(`steps[${index}].actionCode POST must appear after SUBMIT`);
    }
    if (index !== steps.length - 1) {
      throw badRequest(`steps[${index}].actionCode POST must be the final AP step`);
    }
    postStepCount += 1;
    currentPhase = "AFTER_POST";
  }

  if (submitStepCount !== 1) {
    throw badRequest("AP_DOCUMENT_POSTING workflows must contain exactly one SUBMIT step");
  }
  if (approveStepCount < 1) {
    throw badRequest("AP_DOCUMENT_POSTING workflows must contain at least one APPROVE step");
  }
  if (postStepCount !== 1) {
    throw badRequest("AP_DOCUMENT_POSTING workflows must contain exactly one final POST step");
  }
}

function assertPeriodCloseWorkflowDefinitionSteps(steps) {
  let previousStepNo = 0;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepNo = Number(step.stepNo || 0);
    if (!Number.isInteger(stepNo) || stepNo <= previousStepNo) {
      throw badRequest(
        `steps[${index}].stepNo must be greater than the previous PERIOD_CLOSE step number`
      );
    }
    previousStepNo = stepNo;

    if (!step.requiredPermissionCode) {
      throw badRequest(`steps[${index}].requiredPermissionCode is required`);
    }
    if (step.actionCode) {
      throw badRequest(
        `steps[${index}].actionCode is not supported for ${PERIOD_CLOSE_WORKFLOW_PROCESS_TYPE}`
      );
    }
    if (
      !isPeriodCloseWorkflowStepPermissionCodeAllowed(step.requiredPermissionCode)
    ) {
      throw badRequest(
        `steps[${index}].requiredPermissionCode must be one of ${PERIOD_CLOSE_WORKFLOW_ALLOWED_PERMISSION_CODES.join(", ")} for ${PERIOD_CLOSE_WORKFLOW_PROCESS_TYPE}`
      );
    }
    if (
      !isPeriodClosePermissionScopeAllowed(
        step.requiredPermissionCode,
        step.stageScopeType
      )
    ) {
      throw badRequest(
        `steps[${index}].stageScopeType ${step.stageScopeType} is not allowed for ${step.requiredPermissionCode}`
      );
    }
  }

  // PERIOD_CLOSE runtime execution must always depend on at least one
  // workflow approval step, so readiness-only definitions are invalid.
  if (!periodCloseWorkflowHasApprovalStep(steps)) {
    throw badRequest(
      `PERIOD_CLOSE workflows must contain at least one ${PERIOD_CLOSE_APPROVE_PERMISSION_CODE} step`
    );
  }
}

function normalizeWorkflowDefinitionStepsForProcessType(processType, steps = []) {
  const normalizedProcessType = toUpper(processType);
  const normalizedSteps = steps.map((step) =>
    normalizeWorkflowDefinitionStepWriteShape(step)
  );

  if (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    const normalizedApSteps = normalizedSteps.map((step) => ({
      ...step,
      allowSelfApprove: step.actionCode === "APPROVE" ? step.allowSelfApprove : false,
    }));
    assertApWorkflowDefinitionSteps(normalizedApSteps);
    return normalizedApSteps;
  }

  if (normalizedProcessType === PERIOD_CLOSE_WORKFLOW_PROCESS_TYPE) {
    assertPeriodCloseWorkflowDefinitionSteps(normalizedSteps);
    return normalizedSteps;
  }

  normalizedSteps.forEach((step, index) => {
    if (!step.requiredPermissionCode) {
      throw badRequest(`steps[${index}].requiredPermissionCode is required`);
    }
    if (step.actionCode) {
      throw badRequest(
        `steps[${index}].actionCode is only supported for AP_DOCUMENT_POSTING`
      );
    }
    const allowedScopeTypes = getWorkflowStepAllowedScopeTypes(
      step.requiredPermissionCode
    );
    if (
      allowedScopeTypes.length > 0 &&
      !isWorkflowStepScopeAllowed(
        step.requiredPermissionCode,
        step.stageScopeType
      )
    ) {
      throw badRequest(
        `steps[${index}].stageScopeType ${step.stageScopeType} is not allowed for ${step.requiredPermissionCode}`
      );
    }
  });

  return normalizedSteps;
}

function mapWorkflowDefinitionStepToPolicySnapshot(step) {
  const normalized = normalizeWorkflowDefinitionStepWriteShape(step);
  return {
    step_no: normalized.stepNo,
    action_code: normalized.actionCode,
    required_permission_code: normalized.requiredPermissionCode,
    scope_resolution_mode: mapStageScopeTypeToUnifiedScopeResolutionMode(
      normalized.stageScopeType
    ),
    custom_scope_resolver_key: null,
    min_approvals: normalized.minApproverCount,
    allow_self_approve: normalized.allowSelfApprove,
    escalation_after_hours: normalized.escalationAfterHours,
  };
}

function buildWorkflowApprovalBridgeContext(definitionRow, stepRows = []) {
  const normalizedProcessType = toUpper(
    definitionRow?.process_type ?? definitionRow?.processType
  );
  const normalizedSourceSteps = (Array.isArray(stepRows) ? stepRows : [])
    .map(normalizeWorkflowDefinitionStepWriteShape)
    .filter((step) => Number.isInteger(step.stepNo) && step.stepNo > 0)
    .sort((left, right) => left.stepNo - right.stepNo);

  const explicitToBridgeStepNo = new Map();
  const bridgeToExplicitStepNo = new Map();

  if (!isApDocumentWorkflowProcessType(normalizedProcessType)) {
    normalizedSourceSteps.forEach((step) => {
      explicitToBridgeStepNo.set(step.stepNo, step.stepNo);
      bridgeToExplicitStepNo.set(step.stepNo, step.stepNo);
    });
    return {
      isAp: false,
      explicitSteps: normalizedSourceSteps,
      bridgeSteps: normalizedSourceSteps,
      explicitToBridgeStepNo,
      bridgeToExplicitStepNo,
      firstBridgeStepNo: normalizedSourceSteps[0]?.stepNo || null,
      lastBridgeStepNo:
        normalizedSourceSteps[normalizedSourceSteps.length - 1]?.stepNo || null,
      finalApprovalExplicitStepNo:
        normalizedSourceSteps[normalizedSourceSteps.length - 1]?.stepNo || null,
      postApprovalExplicitStepNo:
        normalizedSourceSteps[normalizedSourceSteps.length - 1]?.stepNo || null,
    };
  }

  const explicitSteps = listApWorkflowSteps(normalizedSourceSteps);
  const explicitApproveSteps = listApWorkflowApproveSteps(explicitSteps);
  const bridgeSteps = explicitApproveSteps.map((step, index) => {
    const bridgeStepNo = index + 1;
    explicitToBridgeStepNo.set(step.stepNo, bridgeStepNo);
    bridgeToExplicitStepNo.set(bridgeStepNo, step.stepNo);
    return {
      ...step,
      stepNo: bridgeStepNo,
      bridgeSourceStepNo: step.stepNo,
    };
  });
  const finalApprovalExplicitStepNo =
    explicitApproveSteps[explicitApproveSteps.length - 1]?.stepNo || null;
  const postApprovalExplicitStepNo = finalApprovalExplicitStepNo
    ? explicitSteps.find((step) => step.stepNo > finalApprovalExplicitStepNo)?.stepNo ||
      null
    : null;

  return {
    isAp: true,
    explicitSteps,
    bridgeSteps,
    explicitToBridgeStepNo,
    bridgeToExplicitStepNo,
    firstBridgeStepNo: bridgeSteps[0]?.stepNo || null,
    lastBridgeStepNo: bridgeSteps[bridgeSteps.length - 1]?.stepNo || null,
    finalApprovalExplicitStepNo,
    postApprovalExplicitStepNo,
  };
}

function resolveWorkflowUnifiedBridgeStepCount(definitionRow, bridgeSteps = []) {
  return isApDocumentWorkflowProcessType(
    definitionRow?.process_type ?? definitionRow?.processType
  )
    ? bridgeSteps.length
    : Math.max(1, bridgeSteps.length);
}

function mapExplicitWorkflowStepNoToUnifiedBridgeStepNo(
  bridgeContext,
  explicitStepNo,
  { fallbackToLastBridgeStep = false } = {}
) {
  const normalizedStepNo = Math.max(1, Number(explicitStepNo || 1));
  if (!bridgeContext?.isAp) {
    return normalizedStepNo;
  }

  const mappedStepNo = bridgeContext.explicitToBridgeStepNo.get(normalizedStepNo);
  if (mappedStepNo) {
    return mappedStepNo;
  }
  if (
    fallbackToLastBridgeStep &&
    bridgeContext.lastBridgeStepNo &&
    bridgeContext.finalApprovalExplicitStepNo &&
    normalizedStepNo > bridgeContext.finalApprovalExplicitStepNo
  ) {
    return bridgeContext.lastBridgeStepNo;
  }
  return null;
}

function mapUnifiedBridgeStepNoToExplicitWorkflowStepNo(bridgeContext, bridgeStepNo) {
  const normalizedStepNo = Math.max(1, Number(bridgeStepNo || 1));
  if (!bridgeContext?.isAp) {
    return normalizedStepNo;
  }
  return bridgeContext.bridgeToExplicitStepNo.get(normalizedStepNo) || null;
}

function resolveWorkflowLegacyStepNoFromUnifiedRequest(
  bridgeContext,
  requestStatus,
  currentBridgeStepNo
) {
  if (!bridgeContext?.isAp) {
    return Math.max(1, Number(currentBridgeStepNo || 1));
  }
  if (toUpper(requestStatus) === "APPROVED" && bridgeContext.postApprovalExplicitStepNo) {
    return bridgeContext.postApprovalExplicitStepNo;
  }
  return (
    mapUnifiedBridgeStepNoToExplicitWorkflowStepNo(
      bridgeContext,
      currentBridgeStepNo
    ) ||
    bridgeContext.postApprovalExplicitStepNo ||
    bridgeContext.finalApprovalExplicitStepNo ||
    bridgeContext.explicitSteps[0]?.stepNo ||
    1
  );
}

function mapWorkflowDefinitionStepRow(row) {
  if (!row) {
    return null;
  }
  const normalized = normalizeWorkflowDefinitionStepWriteShape(row);
  return {
    id: parsePositiveInt(row.id),
    workflowDefinitionId: parsePositiveInt(row.workflow_definition_id),
    stepNo: normalized.stepNo,
    actionCode: normalized.actionCode,
    stageScopeType: normalized.stageScopeType,
    requiredPermissionCode: normalized.requiredPermissionCode,
    minApproverCount: normalized.minApproverCount,
    allowSelfApprove: normalized.allowSelfApprove,
    escalationAfterHours: normalized.escalationAfterHours,
    createdAt: row.created_at || null,
  };
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

function buildWorkflowUnifiedTargetSnapshotWithOverrides(
  instanceRow,
  fallbackScope = {},
  existingSnapshot = null,
  targetSnapshotOverrides = null
) {
  const baseSnapshot = buildWorkflowUnifiedTargetSnapshot(instanceRow, fallbackScope);
  const preservedSnapshot =
    existingSnapshot && typeof existingSnapshot === "object" && !Array.isArray(existingSnapshot)
      ? existingSnapshot
      : {};
  const overrides =
    targetSnapshotOverrides &&
    typeof targetSnapshotOverrides === "object" &&
    !Array.isArray(targetSnapshotOverrides)
      ? targetSnapshotOverrides
      : {};
  return {
    ...preservedSnapshot,
    ...baseSnapshot,
    ...overrides,
  };
}

function normalizeWorkflowUnifiedRoutingRuleSnapshot(source = null) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const assignmentId = parsePositiveInt(
    source.assignment_id ?? source.assignmentId ?? source.id
  );
  const workflowDefinitionId = parsePositiveInt(
    source.workflow_definition_id ?? source.workflowDefinitionId
  );
  const scopeType = toUpper(source.scope_type ?? source.scopeType);
  const scopeId = parsePositiveInt(source.scope_id ?? source.scopeId);
  const scopeLayer = toUpper(source.scope_layer ?? source.scopeLayer);
  const amountBasis = normalizeWorkflowAssignmentAmountBasis(
    source.amount_basis ?? source.amountBasis
  );
  const minAmount = toAmount(source.min_amount ?? source.minAmount);
  const maxAmount = toAmount(source.max_amount ?? source.maxAmount);
  const priority = Number.isInteger(Number(source.priority)) ? Number(source.priority) : null;
  const isFallback = toDbBoolean(source.is_fallback ?? source.isFallback);
  const effectiveFrom = toDateOnly(source.effective_from ?? source.effectiveFrom);
  const effectiveTo = toDateOnly(source.effective_to ?? source.effectiveTo);
  const status = toUpper(source.status);
  if (
    !assignmentId &&
    !workflowDefinitionId &&
    !scopeType &&
    !scopeLayer &&
    minAmount === null &&
    maxAmount === null
  ) {
    return null;
  }
  return {
    id: assignmentId || null,
    workflow_definition_id: workflowDefinitionId || null,
    scope_type: scopeType || null,
    scope_id: scopeId || null,
    scope_layer: scopeLayer || null,
    amount_basis: amountBasis || null,
    min_amount: minAmount,
    max_amount: maxAmount,
    priority,
    is_fallback: isFallback,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    status: status || null,
  };
}

function buildWorkflowUnifiedPolicySnapshotOverrides(targetSnapshot = null) {
  const normalizedTargetSnapshot =
    targetSnapshot && typeof targetSnapshot === "object" && !Array.isArray(targetSnapshot)
      ? targetSnapshot
      : {};
  const matchedAssignment = normalizeWorkflowUnifiedRoutingRuleSnapshot(
    normalizedTargetSnapshot.routing_rule_snapshot ??
      normalizedTargetSnapshot.routingRuleSnapshot
  );
  const evaluatedAmount = toAmount(
    normalizedTargetSnapshot.evaluated_amount ??
      normalizedTargetSnapshot.evaluatedAmount
  );
  const amountBasis = normalizeWorkflowAssignmentAmountBasis(
    normalizedTargetSnapshot.evaluated_amount_basis ??
      normalizedTargetSnapshot.evaluatedAmountBasis
  );
  const matchType = toUpper(
    normalizedTargetSnapshot.routing_match_type ??
      normalizedTargetSnapshot.routingMatchType
  );
  const matchedScopeLayer = toUpper(
    normalizedTargetSnapshot.routing_matched_scope_layer ??
      normalizedTargetSnapshot.routingMatchedScopeLayer
  );
  const priorityApplied = toDbBoolean(
    normalizedTargetSnapshot.routing_priority_applied ??
      normalizedTargetSnapshot.routingPriorityApplied
  );
  const noMatchReason = toUpper(
    normalizedTargetSnapshot.routing_no_match_reason ??
      normalizedTargetSnapshot.routingNoMatchReason
  );

  if (
    !matchedAssignment &&
    evaluatedAmount === null &&
    !amountBasis &&
    !matchType &&
    !matchedScopeLayer &&
    !priorityApplied &&
    !noMatchReason
  ) {
    return null;
  }

  return {
    matched_assignment: matchedAssignment,
    routing_context: {
      match_type: matchType || null,
      matched_scope_layer: matchedScopeLayer || null,
      evaluated_amount: evaluatedAmount,
      amount_basis: amountBasis || null,
      priority_applied: priorityApplied,
      no_match_reason: noMatchReason || null,
      workflow_definition_id:
        parsePositiveInt(
          normalizedTargetSnapshot.workflow_definition_id ??
            normalizedTargetSnapshot.workflowDefinitionId
        ) ||
        matchedAssignment?.workflow_definition_id ||
        null,
    },
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

function buildWorkflowUnifiedPolicySnapshot(
  definitionRow,
  stepRows,
  snapshotOverrides = null
) {
  const normalizedSteps = (Array.isArray(stepRows) ? stepRows : []).map(
    mapWorkflowDefinitionStepToPolicySnapshot
  );

  const baseSnapshot = {
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
    step_count: resolveWorkflowUnifiedBridgeStepCount(definitionRow, normalizedSteps),
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
  const overrides =
    snapshotOverrides &&
    typeof snapshotOverrides === "object" &&
    !Array.isArray(snapshotOverrides)
      ? snapshotOverrides
      : null;
  return overrides ? { ...baseSnapshot, ...overrides } : baseSnapshot;
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

function mapWorkflowAssignmentRow(row) {
  if (!row) {
    return null;
  }
  const routing = resolveWorkflowAssignmentRoutingState(row);
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
    amountBasis: routing.amountBasis,
    minAmount: routing.minAmount,
    maxAmount: routing.maxAmount,
    priority: routing.priority,
    isFallback: routing.isFallback,
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
 * Resolve the most specific ACTIVE workflow assignment for one scoped target,
 * including structured routing diagnostics for explainability and audits.
 */
export async function resolveWorkflowAssignmentForScope({
  tenantId,
  processType,
  effectiveOn,
  scope = {},
  thresholdAmount = null,
  amountBasis = null,
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
    `SELECT
       wa.*,
       wd.code AS workflow_definition_code,
       wd.name AS workflow_definition_name
     FROM workflow_assignments wa
     JOIN workflow_definitions wd ON wd.id = wa.workflow_definition_id
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
     ORDER BY wa.effective_from DESC, wa.id DESC`,
    [
      tenantId,
      toUpper(processType),
      effectiveDate,
      effectiveDate,
      operatingUnitId,
      legalEntityId,
      countryId,
      groupCompanyId,
    ]
  );
  const candidates = result.rows || [];
  const scopeLayers = listWorkflowAssignmentScopeLayers(resolvedScope);

  for (const scopeLayer of scopeLayers) {
    const layerRows = candidates
      .filter((row) => resolveWorkflowAssignmentScopeLayer(row, resolvedScope) === scopeLayer)
      .sort(compareWorkflowAssignmentSelectionPriority);
    if (layerRows.length === 0) {
      continue;
    }

    const layerEvaluations = layerRows.map((row) => {
      const bandEvaluation = evaluateWorkflowAssignmentBandMatch(row, {
        thresholdAmount,
        amountBasis,
      });
      return {
        row,
        bandEvaluation,
        summary: mapWorkflowAssignmentSelectionCandidate(
          row,
          resolvedScope,
          bandEvaluation
        ),
      };
    });
    const evaluatedAssignments = layerEvaluations.map((entry) => entry.summary);
    const bandMatches = layerEvaluations.filter((entry) => entry.bandEvaluation.matches);
    if (bandMatches.length > 0) {
      const selected = bandMatches[0];
      return {
        assignmentRow: selected.row,
        diagnostics: buildWorkflowAssignmentResolutionDiagnostics({
          effectiveOn: effectiveDate,
          resolvedScope,
          thresholdAmount,
          amountBasis,
          scopeLayersTried: scopeLayers,
          candidateCount: candidates.length,
          matchedScopeLayer: scopeLayer,
          evaluatedAssignments,
          matchType:
            selected.bandEvaluation.reason === "LEGACY_RULE" ? "LEGACY" : "BAND",
          selectedAssignment: selected.summary,
          priorityApplied: bandMatches.length > 1,
        }),
      };
    }

    const fallbackMatches = layerEvaluations.filter((entry) => entry.summary.isFallback);
    if (fallbackMatches.length > 0) {
      const selectedFallback = fallbackMatches[0];
      return {
        assignmentRow: selectedFallback.row,
        diagnostics: buildWorkflowAssignmentResolutionDiagnostics({
          effectiveOn: effectiveDate,
          resolvedScope,
          thresholdAmount,
          amountBasis,
          scopeLayersTried: scopeLayers,
          candidateCount: candidates.length,
          matchedScopeLayer: scopeLayer,
          evaluatedAssignments,
          matchType: "FALLBACK",
          selectedAssignment: selectedFallback.summary,
          priorityApplied: fallbackMatches.length > 1,
        }),
      };
    }

    // Once a more-specific scope layer exists, broader scopes must not win as a
    // side effect of missing threshold context or a missing amount band.
    return {
      assignmentRow: null,
      diagnostics: buildWorkflowAssignmentResolutionDiagnostics({
        effectiveOn: effectiveDate,
        resolvedScope,
        thresholdAmount,
        amountBasis,
        scopeLayersTried: scopeLayers,
        candidateCount: candidates.length,
        matchedScopeLayer: scopeLayer,
        evaluatedAssignments,
        noMatchReason: resolveWorkflowAssignmentNoMatchReason(layerEvaluations),
      }),
    };
  }

  return {
    assignmentRow: null,
    diagnostics: buildWorkflowAssignmentResolutionDiagnostics({
      effectiveOn: effectiveDate,
      resolvedScope,
      thresholdAmount,
      amountBasis,
      scopeLayersTried: scopeLayers,
      candidateCount: candidates.length,
      noMatchReason: "NO_ACTIVE_SCOPE_ROWS",
    }),
  };
}

/**
 * Resolve the most specific ACTIVE workflow assignment row for one scoped
 * target. Threshold routing is evaluated only inside the first matched scope
 * layer. Pass `includeDiagnostics = true` to also receive the routing trace.
 */
export async function findActiveWorkflowAssignmentForScope({
  includeDiagnostics = false,
  ...selection
}) {
  const resolved = await resolveWorkflowAssignmentForScope(selection);
  return includeDiagnostics ? resolved : resolved.assignmentRow;
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
  routing = null,
  processType = "",
  targetType = "",
  targetId = null,
  currentStepAccess = null,
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
          amountBasis: resolveWorkflowAssignmentRoutingState(assignmentRow).amountBasis,
          minAmount: resolveWorkflowAssignmentRoutingState(assignmentRow).minAmount,
          maxAmount: resolveWorkflowAssignmentRoutingState(assignmentRow).maxAmount,
          priority: resolveWorkflowAssignmentRoutingState(assignmentRow).priority,
          isFallback: resolveWorkflowAssignmentRoutingState(assignmentRow).isFallback,
          effectiveFrom: toDateOnly(assignmentRow.effective_from),
          effectiveTo: toDateOnly(assignmentRow.effective_to),
          status: toUpper(assignmentRow.status),
        }
      : null,
    routing,
    instance: mapWorkflowGateInstanceRow(instanceRow),
    currentStepNo: Number(currentStepAccess?.stepNo || 0),
    stageScopeType: toUpper(currentStepAccess?.stageScopeType),
    requiredPermissionCode: normalizeWorkflowStepPermissionCode(
      currentStepAccess?.requiredPermissionCode || null
    ),
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

function assertWorkflowAssignmentRoutingState(assignment) {
  const rawAmountBasis = assignment?.amountBasis ?? assignment?.amount_basis;
  const rawPriority = assignment?.priority;
  const routing = resolveWorkflowAssignmentRoutingState(assignment);

  if (
    rawAmountBasis !== undefined &&
    rawAmountBasis !== null &&
    rawAmountBasis !== "" &&
    !routing.amountBasis
  ) {
    throw badRequest("amountBasis must be BASE_AMOUNT");
  }
  if (routing.minAmount !== null && routing.minAmount < 0) {
    throw badRequest("minAmount must be >= 0");
  }
  if (routing.maxAmount !== null && routing.maxAmount < 0) {
    throw badRequest("maxAmount must be >= 0");
  }
  if (
    routing.minAmount !== null &&
    routing.maxAmount !== null &&
    routing.maxAmount < routing.minAmount
  ) {
    throw badRequest("maxAmount cannot be earlier than minAmount");
  }
  if (
    rawPriority !== undefined &&
    rawPriority !== null &&
    rawPriority !== "" &&
    (!Number.isInteger(Number(rawPriority)) || Number(rawPriority) < 0)
  ) {
    throw badRequest("priority must be a non-negative integer");
  }
  if (routing.isFallback && (routing.minAmount !== null || routing.maxAmount !== null)) {
    throw badRequest("Fallback workflow assignment cannot set minAmount or maxAmount");
  }

  return routing;
}

function amountBandsOverlap(leftMinAmount, leftMaxAmount, rightMinAmount, rightMaxAmount) {
  if (leftMaxAmount !== null && rightMinAmount !== null && leftMaxAmount < rightMinAmount) {
    return false;
  }
  if (rightMaxAmount !== null && leftMinAmount !== null && rightMaxAmount < leftMinAmount) {
    return false;
  }
  return true;
}

function workflowAssignmentRoutingRulesOverlap(left, right) {
  const leftRouting = resolveWorkflowAssignmentRoutingState(left);
  const rightRouting = resolveWorkflowAssignmentRoutingState(right);

  if (leftRouting.isFallback || rightRouting.isFallback) {
    return false;
  }
  if (isLegacyWorkflowAssignmentRoutingRule(left) || isLegacyWorkflowAssignmentRoutingRule(right)) {
    return true;
  }
  if (leftRouting.amountBasis !== rightRouting.amountBasis) {
    return false;
  }

  return amountBandsOverlap(
    leftRouting.minAmount,
    leftRouting.maxAmount,
    rightRouting.minAmount,
    rightRouting.maxAmount
  );
}

async function listPotentiallyOverlappingWorkflowAssignments({
  tenantId,
  processType,
  groupCompanyId = null,
  countryId = null,
  legalEntityId = null,
  operatingUnitId = null,
  effectiveFrom,
  effectiveTo = null,
  ignoreAssignmentId = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedProcessType = toUpper(processType);
  const normalizedEffectiveFrom = toDateOnly(effectiveFrom);
  const normalizedEffectiveTo = toDateOnly(effectiveTo);
  const where = [
    "tenant_id = ?",
    "process_type = ?",
    "status = 'ACTIVE'",
  ];
  const params = [normalizedTenantId, normalizedProcessType];

  const applyNullableScopeFilter = (columnName, rawValue) => {
    const normalizedValue = parsePositiveInt(rawValue) || null;
    if (normalizedValue) {
      where.push(`${columnName} = ?`);
      params.push(normalizedValue);
      return;
    }
    where.push(`${columnName} IS NULL`);
  };

  applyNullableScopeFilter("group_company_id", groupCompanyId);
  applyNullableScopeFilter("country_id", countryId);
  applyNullableScopeFilter("legal_entity_id", legalEntityId);
  applyNullableScopeFilter("operating_unit_id", operatingUnitId);

  if (normalizedEffectiveTo) {
    where.push("effective_from <= ?");
    params.push(normalizedEffectiveTo);
  }
  where.push("(effective_to IS NULL OR effective_to >= ?)");
  params.push(normalizedEffectiveFrom);

  if (parsePositiveInt(ignoreAssignmentId)) {
    where.push("id <> ?");
    params.push(parsePositiveInt(ignoreAssignmentId));
  }

  const result = await runQuery(
    `SELECT *
       FROM workflow_assignments
      WHERE ${where.join(" AND ")}`,
    params
  );
  return result.rows || [];
}

async function validateWorkflowAssignmentRoutingWrite({
  tenantId,
  assignment,
  ignoreAssignmentId = null,
  runQuery = query,
}) {
  const routing = assertWorkflowAssignmentRoutingState(assignment);
  const normalizedAssignment = {
    ...assignment,
    amountBasis: routing.amountBasis,
    minAmount: routing.minAmount,
    maxAmount: routing.maxAmount,
    priority: routing.priority,
    isFallback: routing.isFallback,
  };

  if (toUpper(normalizedAssignment.status || "ACTIVE") !== "ACTIVE") {
    return normalizedAssignment;
  }

  const overlappingRows = await listPotentiallyOverlappingWorkflowAssignments({
    tenantId,
    processType: normalizedAssignment.processType,
    groupCompanyId: normalizedAssignment.groupCompanyId,
    countryId: normalizedAssignment.countryId,
    legalEntityId: normalizedAssignment.legalEntityId,
    operatingUnitId: normalizedAssignment.operatingUnitId,
    effectiveFrom: normalizedAssignment.effectiveFrom,
    effectiveTo: normalizedAssignment.effectiveTo,
    ignoreAssignmentId,
    runQuery,
  });

  if (routing.isFallback) {
    const conflictingFallbackRow = overlappingRows.find(
      (row) => resolveWorkflowAssignmentRoutingState(row).isFallback
    );
    if (conflictingFallbackRow) {
      throw conflict(
        "Only one ACTIVE fallback workflow assignment is allowed for the same process, scope, and effective window",
        "WORKFLOW_ASSIGNMENT_FALLBACK_CONFLICT"
      );
    }
    return normalizedAssignment;
  }

  const overlappingRoutingRow = overlappingRows.find((row) =>
    workflowAssignmentRoutingRulesOverlap(normalizedAssignment, row)
  );
  if (overlappingRoutingRow) {
    throw conflict(
      "ACTIVE workflow assignment amount bands cannot overlap for the same process, scope, and effective window",
      "WORKFLOW_ASSIGNMENT_AMOUNT_OVERLAP"
    );
  }

  return normalizedAssignment;
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

export async function getUnifiedWorkflowRequestRowById({
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
  const bridgeContext = buildWorkflowApprovalBridgeContext(definitionRow, stepRows);
  const bridgeStepRows = bridgeContext.bridgeSteps;
  const assignmentRows = await listWorkflowAssignmentRowsByDefinitionId({
    tenantId: normalizedTenantId,
    definitionId: normalizedDefinitionId,
    runQuery,
  });
  const targetType = mapWorkflowProcessToUnifiedTargetType(
    definitionRow.process_type ?? definitionRow.processType
  );
  // New workflow definitions are created before their first step payload is
  // saved. Keep the generic approval-policy mirror insertable during that
  // short window, then replace it with the real bridged step count on step save.
  const mirroredStepCount = Math.max(
    1,
    resolveWorkflowUnifiedBridgeStepCount(definitionRow, bridgeStepRows)
  );
  const firstStepPermissionCode =
    normalizeWorkflowStepPermissionCode(
      bridgeStepRows[0]?.requiredPermissionCode ??
        bridgeStepRows[0]?.required_permission_code ??
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
      mirroredStepCount,
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
  for (const stepRow of bridgeStepRows) {
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
        Number(stepRow.stepNo || stepRow.step_no || 1),
        normalizeWorkflowStepPermissionCode(
          stepRow.requiredPermissionCode ?? stepRow.required_permission_code
        ),
        mapStageScopeTypeToUnifiedScopeResolutionMode(
          stepRow.stageScopeType ?? stepRow.stage_scope_type
        ),
        Math.max(
          1,
          Number(stepRow.minApproverCount ?? stepRow.min_approver_count ?? 1)
        ),
        toDbBoolean(stepRow.allowSelfApprove ?? stepRow.allow_self_approve) ? 1 : 0,
        parsePositiveInt(
          stepRow.escalationAfterHours ?? stepRow.escalation_after_hours
        ) || null,
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
    bridgeStepRows,
    approvalBridgeStepCount: bridgeStepRows.length,
    hasApprovalBridgeSteps: bridgeStepRows.length > 0,
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
  targetSnapshotOverrides = null,
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
  const requestRow = await getUnifiedWorkflowRequestRowById({
    tenantId: normalizedTenantId,
    requestId: normalizedRequestId,
    runQuery,
  });
  const stepRows = await listWorkflowDefinitionStepRowsRaw(
    parsePositiveInt(instanceRow.workflow_definition_id),
    runQuery
  );
  const bridgeContext = buildWorkflowApprovalBridgeContext(definitionRow, stepRows);
  const requestScope = resolveWorkflowUnifiedRequestScope(instanceRow, fallbackScope);
  const targetSnapshot = buildWorkflowUnifiedTargetSnapshotWithOverrides(
    instanceRow,
    fallbackScope,
    requestRow?.target_snapshot_json,
    targetSnapshotOverrides
  );
  // Mirror the already-resolved workflow route into the unified policy snapshot
  // so audit/debug reads never need to re-run routing after admin edits.
  const policySnapshotOverrides =
    buildWorkflowUnifiedPolicySnapshotOverrides(targetSnapshot);
  const policySnapshot = buildWorkflowUnifiedPolicySnapshot(
    {
      ...definitionRow,
      generic_policy_id:
        normalizedPolicyId ||
        parsePositiveInt(definitionRow.generic_policy_id) ||
        null,
    },
    bridgeContext.bridgeSteps,
    policySnapshotOverrides
  );
  const bridgedCurrentStepNo = mapExplicitWorkflowStepNoToUnifiedBridgeStepNo(
    bridgeContext,
    instanceRow.current_step_no,
    {
      fallbackToLastBridgeStep: toUpper(instanceRow.status) === "APPROVED",
    }
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
      Math.max(1, Number(bridgedCurrentStepNo || 1)),
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
    const bridgedDecisionStepNo = mapExplicitWorkflowStepNoToUnifiedBridgeStepNo(
      bridgeContext,
      row.stepNo ?? row.step_no
    );
    if (!bridgedDecisionStepNo) {
      continue;
    }
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
        bridgedDecisionStepNo,
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
  let apDocumentStatus = null;
  if (isApDocumentWorkflowInstanceRow(legacyRow)) {
    const targetResult = await runQuery(
      `SELECT status
         FROM cari_documents
        WHERE tenant_id = ?
          AND id = ?
        LIMIT 1`,
      [tenantId, parsePositiveInt(legacyRow.target_id)]
    );
    apDocumentStatus = toUpper(targetResult.rows?.[0]?.status);
  }
  // Explicit AP POST completion is authoritative. Do not regress a posted
  // document's legacy workflow row back to PENDING when the bridged request
  // has not yet reflected the final POST step completion.
  const preserveExplicitPostCompletion =
    isApDocumentWorkflowInstanceRow(legacyRow) &&
    ["POSTED", "PARTIALLY_SETTLED", "SETTLED", "REVERSED"].includes(apDocumentStatus) &&
    nextLegacyStatus === "PENDING";
  const legacyStatus =
    toUpper(legacyRow?.status) === "SUPERSEDED"
      ? "SUPERSEDED"
      : preserveExplicitPostCompletion
        ? "APPROVED"
        : nextLegacyStatus;
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
  const bridgeContext = isApDocumentWorkflowInstanceRow(legacyRow)
    ? buildWorkflowApprovalBridgeContext(
        {
          process_type: legacyRow.process_type,
        },
        await listWorkflowDefinitionStepRowsRaw(
          parsePositiveInt(legacyRow.workflow_definition_id),
          runQuery
        )
      )
    : null;
  const explicitStepRows = bridgeContext?.isAp ? bridgeContext.explicitSteps : [];
  const editableApStep =
    legacyStatus === "REJECTED" && explicitStepRows.length > 0
      ? resolveApWorkflowEditableStep(explicitStepRows)
      : null;
  const nextLegacyStepNo =
    editableApStep?.stepNo ||
    resolveWorkflowLegacyStepNoFromUnifiedRequest(
      bridgeContext,
      requestRow.request_status,
      requestRow.current_step_no
    );

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
      nextLegacyStepNo,
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
    const legacyDecisionStepNo = mapUnifiedBridgeStepNoToExplicitWorkflowStepNo(
      bridgeContext,
      decisionRow.step_no
    );
    if (!legacyDecisionStepNo) {
      continue;
    }
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
        legacyDecisionStepNo,
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
 * Ensure one workflow instance has a bridged generic approval request. Optional
 * target-snapshot overrides let callers persist runtime routing context such as
 * matched assignment, evaluated amount, and amount basis.
 */
export async function ensureUnifiedWorkflowInstanceBridge({
  tenantId,
  instanceId,
  requestedByUserId = null,
  fallbackScope = {},
  targetSnapshotOverrides = null,
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
  if (
    isApDocumentWorkflowInstanceRow(instanceRow) &&
    !definitionMirror.hasApprovalBridgeSteps
  ) {
    // AP workflows with no explicit APPROVE step must not create a generic
    // approval request, otherwise the approval engine invents a fake review step.
    if (parsePositiveInt(instanceRow.generic_request_id)) {
      await runQuery(
        `UPDATE workflow_instances
            SET generic_request_id = NULL
          WHERE tenant_id = ?
            AND id = ?`,
        [tenantId, parsePositiveInt(instanceRow.id)]
      );
    }
    return getWorkflowInstanceRowById({
      tenantId,
      instanceId,
      runQuery,
    });
  }

  let genericRequestId = parsePositiveInt(instanceRow.generic_request_id);
  const initialTargetSnapshot = buildWorkflowUnifiedTargetSnapshotWithOverrides(
    instanceRow,
    fallbackScope,
    null,
    targetSnapshotOverrides
  );
  // First-write bridge inserts must carry the same persisted routing metadata
  // into both target and policy snapshots for later explainability.
  const initialPolicySnapshotOverrides =
    buildWorkflowUnifiedPolicySnapshotOverrides(initialTargetSnapshot);
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
        targetSnapshot: initialTargetSnapshot,
        policySnapshotOverrides: initialPolicySnapshotOverrides,
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
    Number(instanceRow.current_step_no || 1) !== 1 ||
    Boolean(initialPolicySnapshotOverrides)
  ) {
    await syncUnifiedWorkflowRequestFromLegacyInstanceTx({
      tenantId,
      instanceRow,
      genericRequestId,
      policyId: genericPolicyId,
      runQuery,
      fallbackScope,
      targetSnapshotOverrides,
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
 * Optional threshold context is forwarded into workflow-assignment resolution.
 */
export async function evaluateWorkflowApprovalGate({
  tenantId,
  processType,
  targetType,
  targetId,
  requestedByUserId,
  scope = {},
  effectiveOn = null,
  thresholdAmount = null,
  amountBasis = null,
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

  const assignmentResolution = await resolveWorkflowAssignmentForScope({
    tenantId: normalizedTenantId,
    processType: normalizedProcessType,
    effectiveOn,
    scope,
    thresholdAmount,
    amountBasis,
    runQuery,
  });
  const assignmentRow = assignmentResolution.assignmentRow;
  if (!assignmentRow) {
    return makeWorkflowGateResult({
      enabled: true,
      required: true,
      approved: false,
      errorCode: "WORKFLOW_NOT_ASSIGNED",
      message:
        "Workflow approval gate is enabled but no ACTIVE workflow assignment was found for scope",
      routing: assignmentResolution.diagnostics,
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
      routing: assignmentResolution.diagnostics,
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
  let currentStepAccess = null;
  if (instanceStatus === "PENDING" && parsePositiveInt(instanceRow?.generic_request_id)) {
    try {
      const requestRow = await getUnifiedWorkflowRequestRowById({
        tenantId: normalizedTenantId,
        requestId: parsePositiveInt(instanceRow.generic_request_id),
        runQuery,
      });
      if (requestRow) {
        // Explainability metadata should enrich the gate, not become a new blocker.
        currentStepAccess = resolveUnifiedWorkflowDecisionAccessFromRequestRow(requestRow);
      }
    } catch (err) {
      currentStepAccess = null;
    }
  }
  if (instanceStatus === "APPROVED") {
    return makeWorkflowGateResult({
      enabled: true,
      required: true,
      approved: true,
      assignmentRow,
      instanceRow,
      routing: assignmentResolution.diagnostics,
      processType: normalizedProcessType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      currentStepAccess,
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
      routing: assignmentResolution.diagnostics,
      processType: normalizedProcessType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      currentStepAccess,
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
    routing: assignmentResolution.diagnostics,
    processType: normalizedProcessType,
    targetType: normalizedTargetType,
    targetId: normalizedTargetId,
    currentStepAccess,
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
  const apBridgeContext = await loadApWorkflowBridgeContext(
    effectiveInstanceRow,
    runQuery
  );
  const currentApStep = apBridgeContext?.isAp
    ? findApWorkflowStepByNo(
        apBridgeContext.explicitSteps,
        effectiveInstanceRow?.current_step_no
      )
    : null;
  if (!isApprovedApReturn) {
    assertInstanceIsDecisionable(effectiveInstanceRow);
    if (isApDocumentWorkflowInstanceRow(effectiveInstanceRow) && currentApStep?.actionCode !== "APPROVE") {
      throw conflict(
        `Workflow instance is currently at explicit ${currentApStep?.actionCode || "UNKNOWN"} step, not APPROVE`,
        "APPROVAL_STEP_PERMISSION_DENIED"
      );
    }
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
    stepNo:
      mapUnifiedBridgeStepNoToExplicitWorkflowStepNo(
        apBridgeContext,
        unifiedAccess.stepNo
      ) || unifiedAccess.stepNo,
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

  const permissionAccess = await resolveWorkflowDecisionPermissionAccess({
    tenantId,
    instanceId,
    decisionCode,
    runQuery,
  });
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
      permissionAccess.stepNo;
  const resolved = ["APPROVED", "REJECTED", "CANCELLED", "SUPERSEDED"].includes(
    syncedStatus
  );

  return {
    row: mapWorkflowInstanceRow(syncedRow),
    decisions: synced?.decisions || [],
    currentStepNo: permissionAccess.stepNo,
    minApproverCount: permissionAccess.minApproverCount,
    stageScopeType: permissionAccess.stageScopeType,
    requiredPermissionCode: permissionAccess.requiredPermissionCode,
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
    const normalizedSteps = normalizeWorkflowDefinitionStepsForProcessType(
      definitionRow.process_type ?? definitionRow.processType,
      steps
    );

    await tx.query(
      `DELETE FROM workflow_definition_steps
       WHERE workflow_definition_id = ?`,
      [definitionId]
    );

    for (const step of normalizedSteps) {
      // eslint-disable-next-line no-await-in-loop
      await tx.query(
         `INSERT INTO workflow_definition_steps (
            workflow_definition_id,
            step_no,
            action_code,
            stage_scope_type,
            required_permission_code,
            min_approver_count,
            allow_self_approve,
            escalation_after_hours
           )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          definitionId,
          step.stepNo,
          step.actionCode,
          step.stageScopeType,
          step.requiredPermissionCode,
          step.minApproverCount,
          step.allowSelfApprove ? 1 : 0,
          step.escalationAfterHours,
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

/**
 * List workflow assignments, including optional routing-matrix metadata filters.
 */
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
  if (filters?.amountBasis) {
    where.push("wa.amount_basis = ?");
    params.push(normalizeWorkflowAssignmentAmountBasis(filters.amountBasis));
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
  if (filters?.isFallback !== null && filters?.isFallback !== undefined) {
    where.push("wa.is_fallback = ?");
    params.push(filters.isFallback ? 1 : 0);
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
 * ACTIVE rows are rejected when their amount bands or fallback rules collide.
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

  const next = {
    processType: toUpper(input.processType),
    workflowDefinitionId: parsePositiveInt(input.workflowDefinitionId),
    groupCompanyId: parsePositiveInt(input.groupCompanyId) || null,
    countryId: parsePositiveInt(input.countryId) || null,
    legalEntityId: parsePositiveInt(input.legalEntityId) || null,
    operatingUnitId: parsePositiveInt(input.operatingUnitId) || null,
    amountBasis: input.amountBasis,
    minAmount: input.minAmount,
    maxAmount: input.maxAmount,
    priority: input.priority,
    isFallback: input.isFallback,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo || null,
    status: toUpper(input.status || "ACTIVE"),
  };

  assertAssignmentWriteScope(req, next, assertScopeAccess);
  await resolveAssignmentScopeReferences({
    tenantId,
    groupCompanyId: next.groupCompanyId,
    countryId: next.countryId,
    legalEntityId: next.legalEntityId,
    operatingUnitId: next.operatingUnitId,
  });
  const validated = await validateWorkflowAssignmentRoutingWrite({
    tenantId,
    assignment: next,
    runQuery,
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
       amount_basis,
       min_amount,
       max_amount,
       priority,
       is_fallback,
       effective_from,
       effective_to,
       status,
       created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      validated.processType,
      validated.workflowDefinitionId,
      validated.groupCompanyId,
      validated.countryId,
      validated.legalEntityId,
      validated.operatingUnitId,
      validated.amountBasis,
      validated.minAmount,
      validated.maxAmount,
      validated.priority,
      validated.isFallback ? 1 : 0,
      validated.effectiveFrom,
      validated.effectiveTo,
      validated.status,
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
    definitionId: validated.workflowDefinitionId,
    runQuery,
  });
  return mapWorkflowAssignmentRow(row);
}

/**
 * Update one workflow assignment and refresh the affected generic approval-policy mirrors.
 * ACTIVE rows are rejected when their amount bands or fallback rules collide.
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
    amountBasis:
      input.amountBasis !== undefined
        ? input.amountBasis
        : normalizeWorkflowAssignmentAmountBasis(existing.amount_basis),
    minAmount:
      input.minAmount !== undefined
        ? input.minAmount
        : toAmount(existing.min_amount),
    maxAmount:
      input.maxAmount !== undefined
        ? input.maxAmount
        : toAmount(existing.max_amount),
    priority:
      input.priority !== undefined
        ? input.priority
        : normalizeWorkflowAssignmentPriority(existing.priority),
    isFallback:
      input.isFallback !== undefined
        ? Boolean(input.isFallback)
        : toDbBoolean(existing.is_fallback),
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
  const validated = await validateWorkflowAssignmentRoutingWrite({
    tenantId,
    assignment: next,
    ignoreAssignmentId: assignmentId,
    runQuery,
  });

  await runQuery(
    `UPDATE workflow_assignments
     SET process_type = ?,
         workflow_definition_id = ?,
         group_company_id = ?,
         country_id = ?,
         legal_entity_id = ?,
         operating_unit_id = ?,
         amount_basis = ?,
         min_amount = ?,
         max_amount = ?,
         priority = ?,
         is_fallback = ?,
         effective_from = ?,
         effective_to = ?,
         status = ?
     WHERE tenant_id = ?
       AND id = ?`,
    [
      validated.processType,
      validated.workflowDefinitionId,
      validated.groupCompanyId,
      validated.countryId,
      validated.legalEntityId,
      validated.operatingUnitId,
      validated.amountBasis,
      validated.minAmount,
      validated.maxAmount,
      validated.priority,
      validated.isFallback ? 1 : 0,
      validated.effectiveFrom,
      validated.effectiveTo,
      validated.status,
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
    definitionId: validated.workflowDefinitionId,
    runQuery,
  });
  if (
    parsePositiveInt(existing.workflow_definition_id) &&
    parsePositiveInt(existing.workflow_definition_id) !== validated.workflowDefinitionId
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
  resolveWorkflowAssignmentForScope,
  findActiveWorkflowAssignmentForScope,
  getWorkflowInstanceByTarget,
  getUnifiedWorkflowRequestRowById,
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
