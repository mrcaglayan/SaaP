import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertGroupCompanyBelongsToTenant,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";

const FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1 =
  "FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1";

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
    requiredPermissionCode: String(row.required_permission_code || ""),
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
  const tenantWide = Boolean(req?.rbac?.scopeContext?.tenantWide);
  if (!tenantWide) {
    throw forbidden(`Data scope denied: ${label}`);
  }
}

function assertAssignmentScopeAccess(req, row, assertScopeAccess) {
  const operatingUnitId = parsePositiveInt(row?.operating_unit_id ?? row?.operatingUnitId);
  const legalEntityId = parsePositiveInt(row?.legal_entity_id ?? row?.legalEntityId);
  const groupCompanyId = parsePositiveInt(row?.group_company_id ?? row?.groupCompanyId);

  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
    return;
  }
  if (legalEntityId) {
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
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

function resolveDecisionScopeFromStep(instanceRow, stepRow) {
  const stageScopeType = toUpper(stepRow?.stage_scope_type ?? stepRow?.stageScopeType);
  if (stageScopeType === "OPERATING_UNIT") {
    const scopeId = parsePositiveInt(
      instanceRow?.target_operating_unit_id ?? instanceRow?.targetOperatingUnitId
    );
    if (!scopeId) {
      throw conflict(
        "Step scope OPERATING_UNIT cannot be resolved for workflow target",
        "APPROVAL_STEP_PERMISSION_DENIED"
      );
    }
    return { scopeType: "OPERATING_UNIT", scopeId, scopeKind: "operating_unit" };
  }
  if (stageScopeType === "LEGAL_ENTITY") {
    const scopeId = parsePositiveInt(
      instanceRow?.target_legal_entity_id ?? instanceRow?.targetLegalEntityId
    );
    if (!scopeId) {
      throw conflict(
        "Step scope LEGAL_ENTITY cannot be resolved for workflow target",
        "APPROVAL_STEP_PERMISSION_DENIED"
      );
    }
    return { scopeType: "LEGAL_ENTITY", scopeId, scopeKind: "legal_entity" };
  }
  if (stageScopeType === "GROUP") {
    const scopeId = parsePositiveInt(
      instanceRow?.target_group_company_id ?? instanceRow?.targetGroupCompanyId
    );
    if (!scopeId) {
      throw conflict(
        "Step scope GROUP cannot be resolved for workflow target",
        "APPROVAL_STEP_PERMISSION_DENIED"
      );
    }
    return { scopeType: "GROUP", scopeId, scopeKind: "group" };
  }
  throw badRequest(`Unsupported stageScopeType: ${stageScopeType}`);
}

function assertWorkflowDecisionScopeAccess(req, instanceRow, stepRow, assertScopeAccess) {
  const decisionScope = resolveDecisionScopeFromStep(instanceRow, stepRow);
  try {
    assertScopeAccess(
      req,
      decisionScope.scopeKind,
      decisionScope.scopeId,
      `${decisionScope.scopeKind} decision scope`
    );
  } catch (err) {
    if (Number(err?.status) === 403) {
      throw forbidden(
        "Approval decision scope denied for current step",
        "APPROVAL_STEP_PERMISSION_DENIED"
      );
    }
    throw err;
  }
  return decisionScope;
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
  return (result.rows || [])
    .map((row) => String(row.code || "").trim())
    .filter(Boolean);
}

async function assertWorkflowStepPermission({
  tenantId,
  userId,
  requiredPermissionCode,
  runQuery = query,
}) {
  const code = String(requiredPermissionCode || "").trim();
  if (!code) {
    throw conflict(
      "Workflow step is missing required_permission_code",
      "APPROVAL_STEP_PERMISSION_DENIED"
    );
  }
  const permissionCodes = await loadUserPermissionCodes({
    tenantId,
    userId,
    runQuery,
  });
  if (!permissionCodes.includes(code)) {
    throw forbidden(`Missing permission: ${code}`, "APPROVAL_STEP_PERMISSION_DENIED");
  }
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

async function findActiveWorkflowAssignmentForScope({
  tenantId,
  processType,
  effectiveOn,
  scope = {},
  runQuery = query,
}) {
  const effectiveDate = toDateOnly(effectiveOn) || new Date().toISOString().slice(0, 10);
  const operatingUnitId = parsePositiveInt(scope?.operatingUnitId) || -1;
  const legalEntityId = parsePositiveInt(scope?.legalEntityId) || -1;
  const groupCompanyId = parsePositiveInt(scope?.groupCompanyId) || -1;

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
           AND wa.group_company_id IS NOT NULL
           AND wa.group_company_id = ?
         )
         OR (
           wa.operating_unit_id IS NULL
           AND wa.legal_entity_id IS NULL
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
           AND wa.group_company_id IS NOT NULL
           AND wa.group_company_id = ? THEN 3
         ELSE 4
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
      groupCompanyId,
      operatingUnitId,
      legalEntityId,
      groupCompanyId,
    ]
  );
  return result.rows?.[0] || null;
}

async function getWorkflowInstanceByTarget({
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
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       u.name AS created_by_user_name
     FROM workflow_assignments wa
     JOIN workflow_definitions wd ON wd.id = wa.workflow_definition_id
     LEFT JOIN group_companies gc ON gc.id = wa.group_company_id
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
      b.legal_entity_id AS target_legal_entity_id,
      COALESCE(le_target.group_company_id, cg_target.group_company_id) AS target_group_company_id,
      NULL AS target_operating_unit_id
    FROM workflow_instances wi
    JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
    LEFT JOIN users requester ON requester.id = wi.requested_by_user_id
    LEFT JOIN period_close_runs pcr
      ON pcr.id = wi.target_id
     AND wi.target_type = 'PERIOD_CLOSE_RUN'
     AND pcr.tenant_id = wi.tenant_id
    LEFT JOIN books b ON b.id = pcr.book_id
    LEFT JOIN legal_entities le_target ON le_target.id = b.legal_entity_id
    LEFT JOIN consolidation_runs cr
      ON cr.id = wi.target_id
     AND wi.target_type = 'CONSOLIDATION_RUN'
    LEFT JOIN consolidation_groups cg_target
      ON cg_target.id = cr.consolidation_group_id
     AND cg_target.tenant_id = wi.tenant_id
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

async function listWorkflowInstanceDecisionRows({
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
  legalEntityId,
  operatingUnitId,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedGroupCompanyId = parsePositiveInt(groupCompanyId) || null;
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId) || null;
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId) || null;

  let groupCompanyRow = null;
  let legalEntityRow = null;
  let operatingUnitRow = null;

  if (normalizedGroupCompanyId) {
    groupCompanyRow = await assertGroupCompanyBelongsToTenant(
      normalizedTenantId,
      normalizedGroupCompanyId,
      "groupCompanyId"
    );
  }
  if (normalizedLegalEntityId) {
    legalEntityRow = await assertLegalEntityBelongsToTenant(
      normalizedTenantId,
      normalizedLegalEntityId,
      "legalEntityId"
    );
  }
  if (normalizedOperatingUnitId) {
    operatingUnitRow = await assertOperatingUnitBelongsToTenant(
      normalizedTenantId,
      normalizedOperatingUnitId,
      "operatingUnitId"
    );

    const operatingUnitLegalEntityId = parsePositiveInt(operatingUnitRow.legal_entity_id);
    if (
      legalEntityRow &&
      parsePositiveInt(legalEntityRow.id) !== operatingUnitLegalEntityId
    ) {
      throw badRequest("operatingUnitId must belong to selected legalEntityId");
    }
    if (!legalEntityRow) {
      legalEntityRow = await assertLegalEntityBelongsToTenant(
        normalizedTenantId,
        operatingUnitLegalEntityId,
        "operatingUnit legalEntity"
      );
    }
  }

  if (groupCompanyRow && legalEntityRow) {
    const groupCompanyFromLegalEntity = parsePositiveInt(legalEntityRow.group_company_id);
    if (groupCompanyFromLegalEntity !== parsePositiveInt(groupCompanyRow.id)) {
      throw badRequest("legalEntityId must belong to selected groupCompanyId");
    }
  }
}

function assertAssignmentWriteScope(req, input, assertScopeAccess) {
  const operatingUnitId = parsePositiveInt(input?.operatingUnitId);
  const legalEntityId = parsePositiveInt(input?.legalEntityId);
  const groupCompanyId = parsePositiveInt(input?.groupCompanyId);

  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
  }
  if (legalEntityId) {
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  }
  if (groupCompanyId) {
    assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");
  }

  if (!operatingUnitId && !legalEntityId && !groupCompanyId) {
    assertTenantWideScope(req);
  }
}

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
  const groupCompanyId = parsePositiveInt(row.group_company_id);
  if (groupCompanyId) {
    return { scopeType: "GROUP", scopeId: groupCompanyId };
  }

  return null;
}

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
  const groupCompanyId = parsePositiveInt(row.target_group_company_id);
  if (groupCompanyId) {
    return { scopeType: "GROUP", scopeId: groupCompanyId };
  }

  return null;
}

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
       b.legal_entity_id AS target_legal_entity_id,
       COALESCE(le_target.group_company_id, cg_target.group_company_id) AS target_group_company_id,
       NULL AS target_operating_unit_id
     FROM workflow_instances wi
     JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
     LEFT JOIN users requester ON requester.id = wi.requested_by_user_id
     LEFT JOIN period_close_runs pcr
       ON pcr.id = wi.target_id
      AND wi.target_type = 'PERIOD_CLOSE_RUN'
      AND pcr.tenant_id = wi.tenant_id
     LEFT JOIN books b ON b.id = pcr.book_id
     LEFT JOIN legal_entities le_target ON le_target.id = b.legal_entity_id
     LEFT JOIN consolidation_runs cr
       ON cr.id = wi.target_id
      AND wi.target_type = 'CONSOLIDATION_RUN'
     LEFT JOIN consolidation_groups cg_target
       ON cg_target.id = cr.consolidation_group_id
      AND cg_target.tenant_id = wi.tenant_id
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

  const row = await getWorkflowInstanceRowById({
    tenantId: normalizedTenantId,
    instanceId: normalizedInstanceId,
    runQuery,
  });
  if (!row) {
    throw notFound("Workflow instance not found");
  }
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

async function loadCurrentWorkflowStepOrThrow({
  workflowDefinitionId,
  stepNo,
  runQuery = query,
}) {
  const step = await getWorkflowDefinitionStepRowByNo({
    definitionId: workflowDefinitionId,
    stepNo,
    runQuery,
  });
  if (!step) {
    throw conflict(
      `Workflow definition step not found for step_no=${stepNo}`,
      "APPROVAL_STEP_PERMISSION_DENIED"
    );
  }
  return step;
}

export async function resolveWorkflowDecisionPermissionAccess({
  tenantId,
  instanceId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedInstanceId = parsePositiveInt(instanceId);
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
  assertInstanceIsDecisionable(instanceRow);

  const currentStep = await loadCurrentWorkflowStepOrThrow({
    workflowDefinitionId: parsePositiveInt(instanceRow.workflow_definition_id),
    stepNo: Number(instanceRow.current_step_no || 0),
    runQuery,
  });
  const requiredPermissionCode = String(
    currentStep.required_permission_code || ""
  ).trim();
  if (!requiredPermissionCode) {
    throw conflict(
      "Workflow step is missing required_permission_code",
      "APPROVAL_STEP_PERMISSION_DENIED"
    );
  }
  const scope = resolveDecisionScopeFromStep(instanceRow, currentStep);

  return {
    requiredPermissionCode,
    scope: {
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    },
    stepNo: Number(currentStep.step_no || 0),
    stageScopeType: toUpper(currentStep.stage_scope_type),
  };
}

async function createWorkflowDecision({
  req,
  input,
  decision,
  assertScopeAccess,
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
  if (!["APPROVE", "REJECT"].includes(decisionCode)) {
    throw badRequest("decision must be APPROVE or REJECT");
  }

  return withTransaction(async (tx) => {
    const instanceRow = await getWorkflowInstanceRowById({
      tenantId,
      instanceId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!instanceRow) {
      throw notFound("Workflow instance not found");
    }
    assertInstanceIsDecisionable(instanceRow);

    const currentStepNo = Number(instanceRow.current_step_no || 0);
    const workflowDefinitionId = parsePositiveInt(instanceRow.workflow_definition_id);
    const currentStep = await loadCurrentWorkflowStepOrThrow({
      workflowDefinitionId,
      stepNo: currentStepNo,
      runQuery: tx.query,
    });

    await assertWorkflowStepPermission({
      tenantId,
      userId,
      requiredPermissionCode: currentStep.required_permission_code,
      runQuery: tx.query,
    });
    assertWorkflowDecisionScopeAccess(req, instanceRow, currentStep, assertScopeAccess);

    if (
      decisionCode === "APPROVE" &&
      !toDbBoolean(currentStep.allow_self_approve) &&
      parsePositiveInt(instanceRow.requested_by_user_id) === userId
    ) {
      throw forbidden(
        "Maker-checker violation: requester cannot approve own step",
        "APPROVAL_STEP_PERMISSION_DENIED"
      );
    }

    const existingDecisionRes = await tx.query(
      `SELECT id
       FROM workflow_instance_decisions
       WHERE workflow_instance_id = ?
         AND step_no = ?
         AND decision_by_user_id = ?
       LIMIT 1`,
      [instanceId, currentStepNo, userId]
    );
    if (existingDecisionRes.rows?.[0]?.id) {
      throw conflict(
        "Decision already exists for this user at current step",
        "APPROVAL_STEP_ALREADY_DECIDED"
      );
    }

    try {
      await tx.query(
        `INSERT INTO workflow_instance_decisions (
           workflow_instance_id,
           step_no,
           decision,
           decision_by_user_id,
           decision_note
         ) VALUES (?, ?, ?, ?, ?)`,
        [instanceId, currentStepNo, decisionCode, userId, decisionNote]
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw conflict(
          "Decision already exists for this user at current step",
          "APPROVAL_STEP_ALREADY_DECIDED"
        );
      }
      throw err;
    }

    let advanced = false;
    let resolved = false;
    if (decisionCode === "REJECT") {
      await tx.query(
        `UPDATE workflow_instances
         SET status = 'REJECTED',
             resolved_at = CURRENT_TIMESTAMP,
             resolution_note = ?
         WHERE tenant_id = ?
           AND id = ?`,
        [decisionNote || "Rejected", tenantId, instanceId]
      );
      resolved = true;
    } else {
      const statsResult = await tx.query(
        `SELECT COUNT(DISTINCT decision_by_user_id) AS approve_count
         FROM workflow_instance_decisions
         WHERE workflow_instance_id = ?
           AND step_no = ?
           AND decision = 'APPROVE'`,
        [instanceId, currentStepNo]
      );
      const approveCount = Number(statsResult.rows?.[0]?.approve_count || 0);
      const minApproverCount = Math.max(
        1,
        Number(currentStep.min_approver_count || 1)
      );

      if (approveCount >= minApproverCount) {
        const maxStepNo = await getWorkflowDefinitionMaxStepNo(
          workflowDefinitionId,
          tx.query
        );
        if (currentStepNo >= maxStepNo) {
          await tx.query(
            `UPDATE workflow_instances
             SET status = 'APPROVED',
                 resolved_at = CURRENT_TIMESTAMP,
                 resolution_note = ?
             WHERE tenant_id = ?
               AND id = ?`,
            [
              decisionNote ||
                `Approved at final step ${currentStepNo} (min approvers: ${minApproverCount})`,
              tenantId,
              instanceId,
            ]
          );
          resolved = true;
        } else {
          await tx.query(
            `UPDATE workflow_instances
             SET current_step_no = ?
             WHERE tenant_id = ?
               AND id = ?`,
            [currentStepNo + 1, tenantId, instanceId]
          );
          advanced = true;
        }
      }
    }

    const instance = await getWorkflowInstanceRowById({
      tenantId,
      instanceId,
      runQuery: tx.query,
    });
    const decisions = await listWorkflowInstanceDecisionRows({
      tenantId,
      instanceId,
      runQuery: tx.query,
    });

    return {
      row: mapWorkflowInstanceRow(instance),
      decisions,
      currentStepNo,
      minApproverCount: Number(currentStep.min_approver_count || 1),
      stageScopeType: toUpper(currentStep.stage_scope_type),
      requiredPermissionCode: String(currentStep.required_permission_code || ""),
      advanced,
      resolved,
      decision: decisionCode,
    };
  });
}

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
    const row = await getWorkflowDefinitionRowById({
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

  const updated = await getWorkflowDefinitionRowById({
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
    await assertWorkflowDefinitionExists(tenantId, definitionId, tx.query);

    await tx.query(
      `DELETE FROM workflow_definition_steps
       WHERE workflow_definition_id = ?`,
      [definitionId]
    );

    for (const step of steps) {
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
          String(step.requiredPermissionCode || "").trim(),
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
      `(wd.code LIKE ? OR wd.name LIKE ? OR gc.code LIKE ? OR gc.name LIKE ? OR le.code LIKE ? OR le.name LIKE ? OR ou.code LIKE ? OR ou.name LIKE ?)`
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
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       u.name AS created_by_user_name
     FROM workflow_assignments wa
     JOIN workflow_definitions wd ON wd.id = wa.workflow_definition_id
     LEFT JOIN group_companies gc ON gc.id = wa.group_company_id
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
    legalEntityId: input.legalEntityId,
    operatingUnitId: input.operatingUnitId,
  });

  const insertResult = await runQuery(
    `INSERT INTO workflow_assignments (
       tenant_id,
       process_type,
       workflow_definition_id,
       group_company_id,
       legal_entity_id,
       operating_unit_id,
       effective_from,
       effective_to,
       status,
       created_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      toUpper(input.processType),
      parsePositiveInt(input.workflowDefinitionId),
      parsePositiveInt(input.groupCompanyId) || null,
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
  return mapWorkflowAssignmentRow(row);
}

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
  return mapWorkflowAssignmentRow(row);
}

export default {
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
};
