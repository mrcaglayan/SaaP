const IGNORABLE_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME
]);

async function safeExecute(connection, sql, params = []) {
  try {
    await connection.execute(sql, params);
  } catch (err) {
    if (IGNORABLE_ERRNOS.has(Number(err?.errno))) {
      return;
    }
    throw err;
  }
}

function normalizeUpper(value, fallback = "") {
  return String(value || fallback).trim().toUpperCase();
}

const AP_DOCUMENT_WORKFLOW_PROCESS_TYPE = "AP_DOCUMENT_POSTING";
const CARI_DOCUMENT_WORKFLOW_TARGET_TYPE = "CARI_DOCUMENT";

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function toDateOnly(value) {
  if (!value) {
    return null;
  }
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

async function enumColumnIncludesValue(connection, tableName, columnName, enumValue) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  const columnType = String(rows?.[0]?.column_type || "").toUpperCase();
  return columnType.includes(`'${String(enumValue || "").trim().toUpperCase()}'`);
}

function mapWorkflowProcessToTargetType(processType) {
  const normalized = normalizeUpper(processType);
  if (normalized === "PERIOD_CLOSE") {
    return "PERIOD_CLOSE_RUN";
  }
  if (normalized === "CONSOLIDATION_RUN") {
    return "CONSOLIDATION_RUN";
  }
  if (normalized === "LOCAL_CLOSE_PACK") {
    return "LOCAL_CLOSE_PACK";
  }
  if (normalized === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return CARI_DOCUMENT_WORKFLOW_TARGET_TYPE;
  }
  return normalized;
}

function mapStageScopeTypeToResolutionMode(stageScopeType) {
  const normalized = normalizeUpper(stageScopeType);
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

function isApDocumentWorkflowProcessType(processType) {
  return normalizeUpper(processType) === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;
}

function normalizeWorkflowDefinitionStep(step = {}) {
  return {
    stepNo: Number(step.step_no || step.stepNo || 0),
    actionCode: normalizeUpper(step.action_code ?? step.actionCode),
    stageScopeType: normalizeUpper(step.stage_scope_type ?? step.stageScopeType),
    requiredPermissionCode: String(
      step.required_permission_code ?? step.requiredPermissionCode ?? ""
    ).trim(),
    minApproverCount: Math.max(
      1,
      Number(step.min_approver_count ?? step.minApproverCount ?? 1) || 1
    ),
    allowSelfApprove: parseDbBoolean(
      step.allow_self_approve ?? step.allowSelfApprove
    ),
    escalationAfterHours: parsePositiveInt(
      step.escalation_after_hours ?? step.escalationAfterHours
    ),
  };
}

function buildWorkflowApprovalBridgeContext(definitionRow, stepRows = []) {
  const normalizedSteps = (Array.isArray(stepRows) ? stepRows : [])
    .map(normalizeWorkflowDefinitionStep)
    .filter((step) => Number.isInteger(step.stepNo) && step.stepNo > 0)
    .sort((left, right) => left.stepNo - right.stepNo);
  const explicitToBridgeStepNo = new Map();

  if (!isApDocumentWorkflowProcessType(definitionRow?.process_type)) {
    normalizedSteps.forEach((step) => {
      explicitToBridgeStepNo.set(step.stepNo, step.stepNo);
    });
    return {
      isAp: false,
      bridgeSteps: normalizedSteps,
      explicitToBridgeStepNo,
      firstBridgeStepNo: normalizedSteps[0]?.stepNo || null,
      lastBridgeStepNo: normalizedSteps[normalizedSteps.length - 1]?.stepNo || null,
      finalApprovalExplicitStepNo:
        normalizedSteps[normalizedSteps.length - 1]?.stepNo || null,
    };
  }

  const explicitApproveSteps = normalizedSteps.filter(
    (step) => step.actionCode === "APPROVE"
  );
  const bridgeSteps = explicitApproveSteps.map((step, index) => {
    const bridgeStepNo = index + 1;
    explicitToBridgeStepNo.set(step.stepNo, bridgeStepNo);
    return {
      ...step,
      stepNo: bridgeStepNo,
    };
  });

  return {
    isAp: true,
    bridgeSteps,
    explicitToBridgeStepNo,
    firstBridgeStepNo: bridgeSteps[0]?.stepNo || null,
    lastBridgeStepNo: bridgeSteps[bridgeSteps.length - 1]?.stepNo || null,
    finalApprovalExplicitStepNo:
      explicitApproveSteps[explicitApproveSteps.length - 1]?.stepNo || null,
  };
}

function resolveWorkflowBridgeStepCount(definitionRow, bridgeSteps = []) {
  return isApDocumentWorkflowProcessType(definitionRow?.process_type)
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

function mapWorkflowAssignmentScope(row) {
  const operatingUnitId = parsePositiveInt(row?.operating_unit_id);
  if (operatingUnitId) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
    };
  }
  const legalEntityId = parsePositiveInt(row?.legal_entity_id);
  if (legalEntityId) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
    };
  }
  const countryId = parsePositiveInt(row?.country_id);
  if (countryId) {
    return {
      scopeType: "COUNTRY",
      scopeId: countryId,
    };
  }
  const groupCompanyId = parsePositiveInt(row?.group_company_id);
  if (groupCompanyId) {
    return {
      scopeType: "GROUP",
      scopeId: groupCompanyId,
    };
  }
  return {
    scopeType: "TENANT",
    scopeId: parsePositiveInt(row?.tenant_id),
  };
}

function resolveWorkflowRequestScope(row) {
  const operatingUnitId = parsePositiveInt(row?.target_operating_unit_id);
  if (operatingUnitId) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
      legalEntityId: parsePositiveInt(row?.target_legal_entity_id),
      countryId: parsePositiveInt(row?.target_country_id),
      operatingUnitId,
      groupCompanyId: parsePositiveInt(row?.target_group_company_id),
    };
  }
  const legalEntityId = parsePositiveInt(row?.target_legal_entity_id);
  if (legalEntityId) {
    return {
      scopeType: "LEGAL_ENTITY",
      scopeId: legalEntityId,
      legalEntityId,
      countryId: parsePositiveInt(row?.target_country_id),
      operatingUnitId: null,
      groupCompanyId: parsePositiveInt(row?.target_group_company_id),
    };
  }
  const countryId = parsePositiveInt(row?.target_country_id);
  if (countryId) {
    return {
      scopeType: "COUNTRY",
      scopeId: countryId,
      legalEntityId: null,
      countryId,
      operatingUnitId: null,
      groupCompanyId: parsePositiveInt(row?.target_group_company_id),
    };
  }
  const groupCompanyId = parsePositiveInt(row?.target_group_company_id);
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
    scopeId: parsePositiveInt(row?.tenant_id),
    legalEntityId: null,
    countryId: null,
    operatingUnitId: null,
    groupCompanyId: null,
  };
}

function mapLegacyWorkflowStatus(row) {
  const normalizedStatus = normalizeUpper(row?.status, "PENDING");
  const resolvedAt = row?.resolved_at || row?.updated_at || null;
  if (normalizedStatus === "APPROVED") {
    return {
      requestStatus: "APPROVED",
      approvedAt: resolvedAt,
      rejectedAt: null,
      withdrawnAt: null,
    };
  }
  if (normalizedStatus === "REJECTED") {
    return {
      requestStatus: "REJECTED",
      approvedAt: null,
      rejectedAt: resolvedAt,
      withdrawnAt: null,
    };
  }
  if (normalizedStatus === "CANCELLED") {
    return {
      requestStatus: "WITHDRAWN",
      approvedAt: null,
      rejectedAt: null,
      withdrawnAt: resolvedAt,
    };
  }
  return {
    requestStatus: "PENDING_REVIEW",
    approvedAt: null,
    rejectedAt: null,
    withdrawnAt: null,
  };
}

function buildWorkflowPolicySnapshot({ definitionRow, stepRows }) {
  const normalizedSteps = (stepRows || [])
    .map((step) => ({
      step_no: Number(step.stepNo || step.step_no || 1),
      required_permission_code: String(
        step.requiredPermissionCode ?? step.required_permission_code ?? ""
      ).trim(),
      scope_resolution_mode: mapStageScopeTypeToResolutionMode(
        step.stageScopeType ?? step.stage_scope_type
      ),
      custom_scope_resolver_key: null,
      min_approvals: Math.max(
        1,
        Number(step.minApproverCount ?? step.min_approver_count ?? 1)
      ),
      allow_self_approve: Boolean(
        parseDbBoolean(step.allowSelfApprove ?? step.allow_self_approve)
      ),
      escalation_after_hours: parsePositiveInt(
        step.escalationAfterHours ?? step.escalation_after_hours
      ),
    }))
    .sort((left, right) => left.step_no - right.step_no);

  return {
    id: parsePositiveInt(definitionRow?.generic_policy_id) || null,
    tenant_id: parsePositiveInt(definitionRow?.tenant_id),
    module_code: "WORKFLOW",
    policy_code: String(definitionRow?.code || "").trim().toUpperCase(),
    policy_name:
      String(definitionRow?.name || "").trim() ||
      String(definitionRow?.code || "").trim().toUpperCase(),
    target_type: mapWorkflowProcessToTargetType(definitionRow?.process_type),
    action_type: "APPROVE_WORKFLOW",
    version_no: Number(definitionRow?.version_no || 1),
    scope_type: null,
    scope_id: null,
    effective_from: null,
    effective_to: null,
    step_count: resolveWorkflowBridgeStepCount(definitionRow, normalizedSteps),
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

async function listWorkflowDefinitionSteps(connection, definitionId) {
  const [rows] = await connection.execute(
    `SELECT *
       FROM workflow_definition_steps
      WHERE workflow_definition_id = ?
      ORDER BY step_no ASC, id ASC`,
    [definitionId]
  );
  return rows || [];
}

async function listWorkflowAssignmentsForDefinition(connection, tenantId, definitionId) {
  const [rows] = await connection.execute(
    `SELECT *
       FROM workflow_assignments
      WHERE tenant_id = ?
        AND workflow_definition_id = ?
      ORDER BY id ASC`,
    [tenantId, definitionId]
  );
  return rows || [];
}

async function upsertGenericWorkflowPolicyMirror(connection, definitionRow) {
  const tenantId = parsePositiveInt(definitionRow?.tenant_id);
  const definitionId = parsePositiveInt(definitionRow?.id);
  if (!tenantId || !definitionId) {
    return null;
  }

  const stepRows = await listWorkflowDefinitionSteps(connection, definitionId);
  const bridgeContext = buildWorkflowApprovalBridgeContext(definitionRow, stepRows);
  const bridgeStepRows = bridgeContext.bridgeSteps;
  const workflowAssignments = await listWorkflowAssignmentsForDefinition(
    connection,
    tenantId,
    definitionId
  );
  const mappedTargetType = mapWorkflowProcessToTargetType(definitionRow?.process_type);
  const firstStepPermissionCode =
    String(
      bridgeStepRows[0]?.requiredPermissionCode ??
        bridgeStepRows[0]?.required_permission_code ??
        ""
    ).trim() ||
    "approvals.requests.approve";

  const [upsertResult] = await connection.execute(
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
     ) VALUES (?, 'WORKFLOW', ?, ?, ?, 'APPROVE_WORKFLOW', ?, NULL, NULL, NULL, NULL, ?, 1, 0, 1, 0, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       policy_name = VALUES(policy_name),
       target_type = VALUES(target_type),
       step_count = VALUES(step_count),
       approver_permission_code = VALUES(approver_permission_code),
       is_active = VALUES(is_active),
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [
      tenantId,
      String(definitionRow.code || "").trim().toUpperCase(),
      String(definitionRow.name || "").trim() ||
        String(definitionRow.code || "").trim().toUpperCase(),
      mappedTargetType,
      Number(definitionRow.version_no || 1),
      resolveWorkflowBridgeStepCount(definitionRow, bridgeStepRows),
      firstStepPermissionCode,
      parseDbBoolean(definitionRow.is_active) ? 1 : 0,
      parsePositiveInt(definitionRow.created_by_user_id),
      parsePositiveInt(definitionRow.created_by_user_id),
    ]
  );
  const genericPolicyId = parsePositiveInt(upsertResult?.insertId);
  if (!genericPolicyId) {
    return null;
  }

  await connection.execute(
    `UPDATE workflow_definitions
        SET generic_policy_id = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [genericPolicyId, tenantId, definitionId]
  );

  await connection.execute(
    `DELETE FROM approval_policy_steps
      WHERE tenant_id = ?
        AND policy_id = ?`,
    [tenantId, genericPolicyId]
  );
  for (const stepRow of bridgeStepRows) {
    // eslint-disable-next-line no-await-in-loop
    await connection.execute(
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
        tenantId,
        genericPolicyId,
        Number(stepRow.stepNo || stepRow.step_no || 1),
        String(
          stepRow.requiredPermissionCode ?? stepRow.required_permission_code ?? ""
        ).trim(),
        mapStageScopeTypeToResolutionMode(
          stepRow.stageScopeType ?? stepRow.stage_scope_type
        ),
        Math.max(
          1,
          Number(stepRow.minApproverCount ?? stepRow.min_approver_count ?? 1)
        ),
        parseDbBoolean(stepRow.allowSelfApprove ?? stepRow.allow_self_approve) ? 1 : 0,
        parsePositiveInt(
          stepRow.escalationAfterHours ?? stepRow.escalation_after_hours
        ),
      ]
    );
  }

  await connection.execute(
    `DELETE FROM approval_policy_assignments
      WHERE tenant_id = ?
        AND policy_id = ?`,
    [tenantId, genericPolicyId]
  );
  for (const assignmentRow of workflowAssignments) {
    const assignmentScope = mapWorkflowAssignmentScope(assignmentRow);
    // eslint-disable-next-line no-await-in-loop
    await connection.execute(
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
        tenantId,
        genericPolicyId,
        assignmentScope.scopeType,
        assignmentScope.scopeId,
        assignmentRow.effective_from || null,
        assignmentRow.effective_to || null,
        normalizeUpper(assignmentRow.status, "ACTIVE") === "ACTIVE" ? 1 : 0,
      ]
    );
  }

  return genericPolicyId;
}

async function getWorkflowDefinitionById(connection, tenantId, definitionId) {
  const [rows] = await connection.execute(
    `SELECT *
       FROM workflow_definitions
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, definitionId]
  );
  return rows?.[0] || null;
}

async function listWorkflowInstanceDecisionRows(connection, instanceId) {
  const [rows] = await connection.execute(
    `SELECT *
       FROM workflow_instance_decisions
      WHERE workflow_instance_id = ?
      ORDER BY step_no ASC, id ASC`,
    [instanceId]
  );
  return rows || [];
}

async function syncGenericWorkflowDecisionsFromLegacy(connection, {
  tenantId,
  genericRequestId,
  instanceId,
  bridgeContext = null,
}) {
  await connection.execute(
    `DELETE FROM approval_decisions
      WHERE tenant_id = ?
        AND request_id = ?`,
    [tenantId, genericRequestId]
  );

  const legacyDecisions = await listWorkflowInstanceDecisionRows(connection, instanceId);
  for (const row of legacyDecisions) {
    const bridgedStepNo = mapExplicitWorkflowStepNoToUnifiedBridgeStepNo(
      bridgeContext,
      row.step_no
    );
    if (!bridgedStepNo) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await connection.execute(
      `INSERT INTO approval_decisions (
         tenant_id,
         request_id,
         step_no,
         decision,
         decided_by_user_id,
         comment,
         decided_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        genericRequestId,
        bridgedStepNo,
        normalizeUpper(row.decision),
        parsePositiveInt(row.decision_by_user_id),
        row.decision_note || null,
        row.created_at || null,
      ]
    );
  }
}

async function upsertGenericWorkflowRequestMirror(connection, instanceRow) {
  const tenantId = parsePositiveInt(instanceRow?.tenant_id);
  const instanceId = parsePositiveInt(instanceRow?.id);
  const definitionId = parsePositiveInt(instanceRow?.workflow_definition_id);
  if (!tenantId || !instanceId || !definitionId) {
    return null;
  }

  const definitionRow = await getWorkflowDefinitionById(connection, tenantId, definitionId);
  if (!definitionRow) {
    return null;
  }
  const genericPolicyId =
    parsePositiveInt(definitionRow.generic_policy_id) ||
    (await upsertGenericWorkflowPolicyMirror(connection, definitionRow));
  if (!genericPolicyId) {
    return null;
  }

  const stepRows = await listWorkflowDefinitionSteps(connection, definitionId);
  const bridgeContext = buildWorkflowApprovalBridgeContext(definitionRow, stepRows);
  if (bridgeContext.isAp && bridgeContext.bridgeSteps.length === 0) {
    return null;
  }
  const requestScope = resolveWorkflowRequestScope(instanceRow);
  const statusMapping = mapLegacyWorkflowStatus(instanceRow);
  const requestCode = `WFR-${tenantId}-${instanceId}`;
  const policySnapshot = buildWorkflowPolicySnapshot({
    definitionRow: {
      ...definitionRow,
      generic_policy_id: genericPolicyId,
    },
    stepRows: bridgeContext.bridgeSteps,
  });
  const targetSnapshot = {
    module_code: "WORKFLOW",
    process_type: normalizeUpper(instanceRow.process_type),
    target_type: normalizeUpper(instanceRow.target_type),
    target_id: parsePositiveInt(instanceRow.target_id),
    workflow_definition_id: definitionId,
    country_id: parsePositiveInt(instanceRow.target_country_id),
    group_company_id: parsePositiveInt(instanceRow.target_group_company_id),
    legal_entity_id: parsePositiveInt(instanceRow.target_legal_entity_id),
    operating_unit_id: parsePositiveInt(instanceRow.target_operating_unit_id),
  };
  const actionPayload = {
    legacy_workflow_instance_id: instanceId,
    legacy_process_type: normalizeUpper(instanceRow.process_type),
    workflow_bridge: true,
  };

  const [upsertResult] = await connection.execute(
    `INSERT INTO approval_requests (
       tenant_id,
       request_code,
       idempotency_key,
       policy_id,
       policy_version_no,
       module_code,
       target_type,
       target_id,
       scope_type,
       scope_id,
       legal_entity_id,
       operating_unit_id,
       request_status,
       current_step_no,
       execution_status,
       submitted_by_user_id,
       submitted_at,
       approved_at,
       rejected_at,
       withdrawn_at,
       last_activity_at,
       policy_snapshot_json,
       target_snapshot_json,
       action_payload_json
     ) VALUES (?, ?, ?, ?, ?, 'WORKFLOW', ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_EXECUTED', ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       policy_id = VALUES(policy_id),
       policy_version_no = VALUES(policy_version_no),
       target_type = VALUES(target_type),
       target_id = VALUES(target_id),
       scope_type = VALUES(scope_type),
       scope_id = VALUES(scope_id),
       legal_entity_id = VALUES(legal_entity_id),
       operating_unit_id = VALUES(operating_unit_id),
       request_status = VALUES(request_status),
       current_step_no = VALUES(current_step_no),
       submitted_by_user_id = VALUES(submitted_by_user_id),
       submitted_at = VALUES(submitted_at),
       approved_at = VALUES(approved_at),
       rejected_at = VALUES(rejected_at),
       withdrawn_at = VALUES(withdrawn_at),
       last_activity_at = VALUES(last_activity_at),
       policy_snapshot_json = VALUES(policy_snapshot_json),
       target_snapshot_json = VALUES(target_snapshot_json),
       action_payload_json = VALUES(action_payload_json)`,
    [
      tenantId,
      requestCode,
      `WORKFLOW-INSTANCE:${instanceId}`,
      genericPolicyId,
      Number(definitionRow.version_no || 1),
      normalizeUpper(instanceRow.target_type),
      parsePositiveInt(instanceRow.target_id),
      requestScope.scopeType,
      requestScope.scopeId,
      requestScope.legalEntityId,
      requestScope.operatingUnitId,
      statusMapping.requestStatus,
      Math.max(
        1,
        Number(
          mapExplicitWorkflowStepNoToUnifiedBridgeStepNo(
            bridgeContext,
            instanceRow.current_step_no,
            {
              fallbackToLastBridgeStep:
                normalizeUpper(instanceRow.status) === "APPROVED",
            }
          ) || 1
        )
      ),
      parsePositiveInt(instanceRow.requested_by_user_id),
      instanceRow.requested_at || instanceRow.created_at || null,
      statusMapping.approvedAt,
      statusMapping.rejectedAt,
      statusMapping.withdrawnAt,
      instanceRow.updated_at || instanceRow.requested_at || instanceRow.created_at || null,
      safeJson(policySnapshot),
      safeJson(targetSnapshot),
      safeJson(actionPayload),
    ]
  );
  const genericRequestId = parsePositiveInt(upsertResult?.insertId);
  if (!genericRequestId) {
    return null;
  }

  await connection.execute(
    `UPDATE workflow_instances
        SET generic_request_id = ?
      WHERE tenant_id = ?
        AND id = ?`,
    [genericRequestId, tenantId, instanceId]
  );

  await syncGenericWorkflowDecisionsFromLegacy(connection, {
    tenantId,
    genericRequestId,
    instanceId,
    bridgeContext,
  });

  return genericRequestId;
}

const WORKFLOW_INSTANCE_SCOPE_SELECT_SQL = `COALESCE(
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

const WORKFLOW_INSTANCE_SCOPE_JOIN_SQL = `LEFT JOIN period_close_runs pcr
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
     AND wi.target_type = 'LOCAL_CLOSE_PACK'
     AND local_close_pack.tenant_id = wi.tenant_id
     LEFT JOIN legal_entities local_close_entity
      ON local_close_entity.id = local_close_pack.legal_entity_id
    LEFT JOIN cari_documents workflow_cari_doc
      ON workflow_cari_doc.id = wi.target_id
     AND wi.target_type = 'CARI_DOCUMENT'
     AND workflow_cari_doc.tenant_id = wi.tenant_id
    LEFT JOIN legal_entities workflow_cari_entity
      ON workflow_cari_entity.id = workflow_cari_doc.legal_entity_id`;

const migration166WorkflowGenericBridge = {
  key: "m166_workflow_generic_bridge",
  description:
    "Bridge legacy workflow definitions and instances to the generic approval engine while preserving the workflow tables for compatibility.",
  async up(connection) {
    if (
      !(await enumColumnIncludesValue(
        connection,
        "approval_policy_steps",
        "scope_resolution_mode",
        "TARGET_GROUP"
      )) ||
      !(await enumColumnIncludesValue(
        connection,
        "approval_policy_steps",
        "scope_resolution_mode",
        "TARGET_COUNTRY"
      ))
    ) {
      await connection.execute(
        `ALTER TABLE approval_policy_steps
           MODIFY COLUMN scope_resolution_mode ENUM(
              'REQUEST_SCOPE',
              'POLICY_SCOPE',
              'TARGET_GROUP',
              'TARGET_COUNTRY',
              'TARGET_LEGAL_ENTITY',
              'TARGET_OPERATING_UNIT',
              'CUSTOM'
           ) NOT NULL DEFAULT 'REQUEST_SCOPE'`
      );
    }

    await safeExecute(
      connection,
      `ALTER TABLE workflow_definitions
         ADD COLUMN generic_policy_id BIGINT UNSIGNED NULL AFTER created_by_user_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE workflow_definitions
         ADD UNIQUE KEY uk_wfd_generic_policy (tenant_id, generic_policy_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE workflow_definitions
         ADD CONSTRAINT fk_wfd_generic_policy
           FOREIGN KEY (tenant_id, generic_policy_id)
           REFERENCES approval_policies(tenant_id, id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );

    await safeExecute(
      connection,
      `ALTER TABLE workflow_instances
         ADD COLUMN generic_request_id BIGINT UNSIGNED NULL AFTER workflow_definition_id`
    );
    await safeExecute(
      connection,
      `ALTER TABLE workflow_instances
         ADD UNIQUE KEY uk_wfi_generic_request (tenant_id, generic_request_id)`
    );
    await safeExecute(
      connection,
      `ALTER TABLE workflow_instances
         ADD CONSTRAINT fk_wfi_generic_request
           FOREIGN KEY (tenant_id, generic_request_id)
           REFERENCES approval_requests(tenant_id, id)
           ON UPDATE RESTRICT ON DELETE RESTRICT`
    );

    const [definitionRows] = await connection.execute(
      `SELECT *
         FROM workflow_definitions
        ORDER BY tenant_id ASC, id ASC`
    );
    for (const definitionRow of definitionRows || []) {
      // eslint-disable-next-line no-await-in-loop
      await upsertGenericWorkflowPolicyMirror(connection, definitionRow);
    }

    const [instanceRows] = await connection.execute(
      `SELECT
         wi.*,
         ${WORKFLOW_INSTANCE_SCOPE_SELECT_SQL}
       FROM workflow_instances wi
       ${WORKFLOW_INSTANCE_SCOPE_JOIN_SQL}
       ORDER BY wi.tenant_id ASC, wi.id ASC`
    );
    for (const instanceRow of instanceRows || []) {
      // eslint-disable-next-line no-await-in-loop
      await upsertGenericWorkflowRequestMirror(connection, instanceRow);
    }
  },

  async down() {
    // Additive compatibility bridge only.
  },
};

export default migration166WorkflowGenericBridge;
