import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  createCariDraftDocument,
  getCariDocumentByIdForTenant,
  submitCariDocumentById,
  updateCariDraftDocumentById,
} from "../src/services/cari.document.service.js";
import {
  createWorkflowAssignment,
  createWorkflowDefinition,
  updateWorkflowAssignment,
} from "../src/services/workflows.service.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
  CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
  getApWorkflowRequiredPermissionCode,
} from "../../shared/cariDocumentWorkflowGovernance.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "test-workflows-amx03-ap-gate-integration",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
  };
}

function allowAllScopes() { }

async function createTenant({ code, name }) {
  await query(
    `INSERT INTO tenants (code, name, status)
     VALUES (?, ?, 'ACTIVE')`,
    [code, name]
  );
  const result = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [code]
  );
  const tenantId = toPositiveInt(result.rows?.[0]?.id);
  assert(tenantId > 0, `Failed to create tenant ${code}`);
  return tenantId;
}

async function createUser({ tenantId, email, name, passwordHash = "test-hash" }) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name]
  );
  const result = await query(
    `SELECT id
       FROM users
      WHERE tenant_id = ?
        AND email = ?
      LIMIT 1`,
    [tenantId, email]
  );
  const userId = toPositiveInt(result.rows?.[0]?.id);
  assert(userId > 0, `Failed to create user ${email}`);
  return userId;
}

async function createOrgFixtures({ tenantId, stamp }) {
  const countryResult = await query(
    `SELECT id, default_currency_code
       FROM countries
      WHERE iso2 = 'US'
      LIMIT 1`
  );
  const countryId = toPositiveInt(countryResult.rows?.[0]?.id);
  const currencyCode = String(
    countryResult.rows?.[0]?.default_currency_code || "USD"
  ).toUpperCase();
  assert(countryId > 0, "US country row is required");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `AMX03GC${stamp}`, `AMX03 Group ${stamp}`]
  );
  const groupResult = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `AMX03GC${stamp}`]
  );
  const groupCompanyId = toPositiveInt(groupResult.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Failed to create group company");

  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code,
        status
     )
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      groupCompanyId,
      `AMX03LE${stamp}`,
      `AMX03 Legal Entity ${stamp}`,
      countryId,
      currencyCode,
    ]
  );
  const legalEntityResult = await query(
    `SELECT id
       FROM legal_entities
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `AMX03LE${stamp}`]
  );
  const legalEntityId = toPositiveInt(legalEntityResult.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity");

  await query(
    `INSERT INTO payment_terms (
        tenant_id,
        legal_entity_id,
        code,
        name,
        due_days,
        grace_days,
        status
     )
     VALUES (?, ?, ?, ?, 30, 0, 'ACTIVE')`,
    [tenantId, legalEntityId, `AMX03TERM${stamp}`, `AMX03 Term ${stamp}`]
  );
  const paymentTermResult = await query(
    `SELECT id
       FROM payment_terms
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `AMX03TERM${stamp}`]
  );
  const paymentTermId = toPositiveInt(paymentTermResult.rows?.[0]?.id);
  assert(paymentTermId > 0, "Failed to create payment term");

  await query(
    `INSERT INTO counterparties (
        tenant_id,
        legal_entity_id,
        code,
        name,
        is_customer,
        is_vendor,
        default_currency_code,
        default_payment_term_id,
        status
     )
     VALUES (?, ?, ?, ?, FALSE, TRUE, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      legalEntityId,
      `AMX03V${stamp}`,
      `AMX03 Vendor ${stamp}`,
      currencyCode,
      paymentTermId,
    ]
  );
  const vendorResult = await query(
    `SELECT id
       FROM counterparties
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `AMX03V${stamp}`]
  );
  const vendorId = toPositiveInt(vendorResult.rows?.[0]?.id);
  assert(vendorId > 0, "Failed to create vendor");
  await query(
    `INSERT INTO operating_units (
      tenant_id,
      legal_entity_id,
      code,
      name,
      status
   )
   VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      legalEntityId,
      `AMX03OU${stamp}`,
      `AMX03 Operating Unit ${stamp}`,
    ]
  );

  const operatingUnitResult = await query(
    `SELECT id
     FROM operating_units
    WHERE tenant_id = ?
      AND legal_entity_id = ?
      AND code = ?
    LIMIT 1`,
    [tenantId, legalEntityId, `AMX03OU${stamp}`]
  );

  const operatingUnitId = toPositiveInt(operatingUnitResult.rows?.[0]?.id);
  assert(operatingUnitId > 0, "Failed to create operating unit");
  return {
    countryId,
    currencyCode,
    legalEntityId,
    paymentTermId,
    operatingUnitId,
    vendorId,
  };
}

async function insertDefinitionStep({
  workflowDefinitionId,
  stageScopeType = "LEGAL_ENTITY",
}) {
  const steps = [
    {
      stepNo: 1,
      actionCode: "SUBMIT",
      stageScopeType: "OPERATING_UNIT",
      minApproverCount: 1,
      allowSelfApprove: false,
      escalationAfterHours: null,
    },
    {
      stepNo: 2,
      actionCode: "APPROVE",
      stageScopeType,
      minApproverCount: 1,
      allowSelfApprove: false,
      escalationAfterHours: null,
    },
    {
      stepNo: 3,
      actionCode: "POST",
      stageScopeType: "COUNTRY",
      minApproverCount: 1,
      allowSelfApprove: false,
      escalationAfterHours: null,
    },
  ];

  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    await query(
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
        workflowDefinitionId,
        step.stepNo,
        step.actionCode,
        step.stageScopeType,
        getApWorkflowRequiredPermissionCode(step.actionCode),
        step.minApproverCount,
        step.allowSelfApprove ? 1 : 0,
        step.escalationAfterHours,
      ]
    );
  }
}

async function createAmountRoute({
  tenantId,
  userId,
  code,
  name,
  legalEntityId,
  minAmount,
  maxAmount,
  priority = 100,
}) {
  const definition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code,
      name,
      processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      isActive: true,
      versionNo: 1,
    },
  });
  await insertDefinitionStep({
    workflowDefinitionId: definition.id,
    stageScopeType: "LEGAL_ENTITY",
  });
  const assignment = await createWorkflowAssignment({
    req: null,
    assertScopeAccess: allowAllScopes,
    input: {
      tenantId,
      userId,
      processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      workflowDefinitionId: definition.id,
      legalEntityId,
      amountBasis: "BASE_AMOUNT",
      minAmount,
      maxAmount,
      priority,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  return {
    definition,
    assignment,
  };
}

async function createDraftDocument({
  req,
  tenantId,
  userId,
  legalEntityId,
  operatingUnitId,
  counterpartyId,
  paymentTermId,
  currencyCode,
  amountTxn,
  amountBase,
  documentDate = "2026-02-10",
  dueDate = "2026-03-12",
}) {
  return createCariDraftDocument({
    req,
    payload: {
      tenantId,
      userId,
      legalEntityId,
      operatingUnitId,
      counterpartyId,
      paymentTermId,
      direction: "AP",
      documentType: "INVOICE",
      documentDate,
      dueDate,
      amountTxn,
      amountBase,
      currencyCode,
      fxRate: 1,
    },
    assertScopeAccess: allowAllScopes,
  });
}

async function listWorkflowInstancesForDocument({ tenantId, documentId }) {
  const result = await query(
    `SELECT
        id,
        workflow_definition_id,
        status,
        current_step_no,
        generic_request_id
     FROM workflow_instances
     WHERE tenant_id = ?
       AND process_type = ?
       AND target_type = ?
       AND target_id = ?
     ORDER BY id ASC`,
    [
      tenantId,
      AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
      documentId,
    ]
  );
  return result.rows || [];
}

async function getApprovalRequestSnapshots({ tenantId, genericRequestId }) {
  const result = await query(
    `SELECT
        id,
        target_snapshot_json,
        policy_snapshot_json
     FROM approval_requests
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, genericRequestId]
  );
  const row = result.rows?.[0] || null;
  return {
    id: toPositiveInt(row?.id),
    targetSnapshot: parseJson(row?.target_snapshot_json, {}),
    policySnapshot: parseJson(row?.policy_snapshot_json, {}),
  };
}

async function updateLatestWorkflowInstanceForDocument({
  tenantId,
  documentId,
  status,
  decision = "",
  decisionByUserId = null,
  decisionNote = null,
  resolvedAt = null,
}) {
  const workflowInstances = await listWorkflowInstancesForDocument({
    tenantId,
    documentId,
  });
  const latestInstance = workflowInstances[workflowInstances.length - 1] || null;
  const workflowInstanceId = toPositiveInt(latestInstance?.id);
  assert(workflowInstanceId > 0, `Workflow instance is required for document ${documentId}`);

  await query(
    `UPDATE workflow_instances
        SET status = ?,
            resolved_at = ?,
            resolution_note = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND id = ?`,
    [status, resolvedAt || null, decisionNote || null, tenantId, workflowInstanceId]
  );

  if (decision) {
    await query(
      `INSERT INTO workflow_instance_decisions (
          workflow_instance_id,
          step_no,
          decision,
          decision_by_user_id,
          decision_note,
          created_at
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        workflowInstanceId,
        Math.max(1, Number(latestInstance?.current_step_no || 1)),
        decision,
        toPositiveInt(decisionByUserId),
        decisionNote || null,
        resolvedAt || "2026-02-14 09:30:00",
      ]
    );
  }

  return workflowInstanceId;
}

async function setDocumentReturned({
  tenantId,
  documentId,
  returnReason,
  returnedAt = "2026-02-14 09:30:00",
}) {
  await query(
    `UPDATE cari_documents
        SET status = 'RETURNED',
            return_reason = ?,
            returned_at = ?,
            row_version = row_version + 1
      WHERE tenant_id = ?
        AND id = ?`,
    [returnReason, returnedAt, tenantId, documentId]
  );
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant({
    code: `AMX03T${stamp}`,
    name: `AMX03 Tenant ${stamp}`,
  });
  const userId = await createUser({
    tenantId,
    email: `amx03-${stamp}@example.com`,
    name: "AMX03 Admin",
  });
  const fixtures = await createOrgFixtures({ tenantId, stamp });
  const req = makeRequestContext({
    tenantId,
    userId,
    stamp,
    suffix: "submit",
  });

  const lowRoute = await createAmountRoute({
    tenantId,
    userId,
    code: `AMX03_LOW_${stamp}`,
    name: "AMX03 Low Route",
    legalEntityId: fixtures.legalEntityId,
    minAmount: 0,
    maxAmount: 50000,
  });
  const highRoute = await createAmountRoute({
    tenantId,
    userId,
    code: `AMX03_HIGH_${stamp}`,
    name: "AMX03 High Route",
    legalEntityId: fixtures.legalEntityId,
    minAmount: 50000.01,
    maxAmount: null,
  });

  const draft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    operatingUnitId: fixtures.operatingUnitId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    currencyCode: fixtures.currencyCode,
    amountTxn: 40000,
    amountBase: 40000,
  });
  const submitted = await submitCariDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  const submittedInstances = await listWorkflowInstancesForDocument({
    tenantId,
    documentId: draft.id,
  });
  const firstInstance = submittedInstances[submittedInstances.length - 1];
  const firstRequest = await getApprovalRequestSnapshots({
    tenantId,
    genericRequestId: firstInstance.generic_request_id,
  });
  assert(
    toPositiveInt(firstInstance.workflow_definition_id) ===
    toPositiveInt(lowRoute.definition.id),
    "AP submit should choose the low workflow definition from the base-amount band"
  );
  assert(
    toPositiveInt(firstRequest.targetSnapshot.workflow_assignment_id) ===
    toPositiveInt(lowRoute.assignment.id) &&
    toPositiveInt(firstRequest.targetSnapshot.workflow_definition_id) ===
    toPositiveInt(lowRoute.definition.id) &&
    String(firstRequest.targetSnapshot.workflow_definition_code || "") ===
    String(lowRoute.definition.code || "") &&
    String(firstRequest.targetSnapshot.workflow_definition_name || "") ===
    String(lowRoute.definition.name || "") &&
    toNumber(firstRequest.targetSnapshot.evaluated_amount) === 40000 &&
    String(firstRequest.targetSnapshot.evaluated_amount_basis || "").toUpperCase() ===
    "BASE_AMOUNT" &&
    String(firstRequest.targetSnapshot.routing_match_type || "").toUpperCase() ===
    "BAND" &&
    String(
      firstRequest.targetSnapshot.routing_matched_scope_layer || ""
    ).toUpperCase() === "LEGAL_ENTITY" &&
    toPositiveInt(
      firstRequest.targetSnapshot.routing_rule_snapshot?.assignment_id
    ) === toPositiveInt(lowRoute.assignment.id) &&
    toPositiveInt(
      firstRequest.targetSnapshot.routing_rule_snapshot?.workflow_definition_id
    ) === toPositiveInt(lowRoute.definition.id) &&
    String(firstRequest.targetSnapshot.routing_rule_snapshot?.workflow_definition_code || "") ===
    String(lowRoute.definition.code || "") &&
    String(firstRequest.targetSnapshot.routing_rule_snapshot?.workflow_definition_name || "") ===
    String(lowRoute.definition.name || ""),
    "Submit should persist the matched routing rule, evaluated amount, and route identity into the target snapshot"
  );
  assert(
    toPositiveInt(submitted.workflowGate?.workflowAssignmentId) ===
    toPositiveInt(lowRoute.assignment.id) &&
    toPositiveInt(submitted.workflowGate?.workflowDefinitionId) ===
    toPositiveInt(lowRoute.definition.id) &&
    String(submitted.workflowGate?.workflowDefinitionCode || "") ===
    String(lowRoute.definition.code || "") &&
    String(submitted.workflowGate?.workflowDefinitionName || "") ===
    String(lowRoute.definition.name || "") &&
    toNumber(submitted.workflowGate?.evaluatedAmount) === 40000 &&
    String(submitted.workflowGate?.evaluatedAmountBasis || "").toUpperCase() ===
    "BASE_AMOUNT" &&
    toPositiveInt(submitted.workflowGate?.routingRuleSnapshot?.assignment_id) ===
    toPositiveInt(lowRoute.assignment.id) &&
    String(submitted.workflowGate?.routingRuleSnapshot?.workflow_definition_code || "") ===
    String(lowRoute.definition.code || ""),
    "Workflow gate readback should expose the persisted routing diagnostics and route label after submit"
  );

  const replacementLowDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX03_LOW_REPL_${stamp}`,
      name: "AMX03 Replacement Low Route",
      processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      isActive: true,
      versionNo: 1,
    },
  });
  await insertDefinitionStep({
    workflowDefinitionId: replacementLowDefinition.id,
    stageScopeType: "LEGAL_ENTITY",
  });
  await updateWorkflowAssignment({
    req: null,
    input: {
      tenantId,
      userId,
      assignmentId: lowRoute.assignment.id,
      status: "INACTIVE",
    },
    assertScopeAccess: allowAllScopes,
  });
  const replacementLowAssignment = await createWorkflowAssignment({
    req: null,
    assertScopeAccess: allowAllScopes,
    input: {
      tenantId,
      userId,
      processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      workflowDefinitionId: replacementLowDefinition.id,
      legalEntityId: fixtures.legalEntityId,
      amountBasis: "BASE_AMOUNT",
      minAmount: 0,
      maxAmount: 50000,
      priority: 100,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  assert(
    toPositiveInt(replacementLowAssignment.id) > 0,
    "Replacement low assignment should be created after the original rule is inactivated"
  );

  const frozenReadback = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: draft.id,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    frozenReadback.workflowGate?.state === "pending" &&
    toPositiveInt(frozenReadback.workflowGate?.workflowDefinitionId) ===
    toPositiveInt(lowRoute.definition.id) &&
    String(frozenReadback.workflowGate?.workflowDefinitionCode || "") ===
    String(lowRoute.definition.code || "") &&
    String(frozenReadback.workflowGate?.workflowDefinitionName || "") ===
    String(lowRoute.definition.name || "") &&
    toPositiveInt(frozenReadback.workflowGate?.workflowAssignmentId) ===
    toPositiveInt(lowRoute.assignment.id) &&
    toPositiveInt(frozenReadback.workflowGate?.routingRuleSnapshot?.assignment_id) ===
    toPositiveInt(lowRoute.assignment.id) &&
    String(frozenReadback.workflowGate?.routingRuleSnapshot?.workflow_definition_code || "") ===
    String(lowRoute.definition.code || ""),
    "Existing workflow instances must keep their original routing snapshot and route label after admins edit the live matrix"
  );

  const returnReason = "Amount changed after requester correction";
  await updateLatestWorkflowInstanceForDocument({
    tenantId,
    documentId: draft.id,
    status: "REJECTED",
    decision: "RETURN",
    decisionByUserId: userId,
    decisionNote: returnReason,
    resolvedAt: "2026-02-14 09:30:00",
  });
  await setDocumentReturned({
    tenantId,
    documentId: draft.id,
    returnReason,
  });

  const returnedReadback = await getCariDocumentByIdForTenant({
    req,
    tenantId,
    documentId: draft.id,
    assertScopeAccess: allowAllScopes,
  });
  const corrected = await updateCariDraftDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: draft.id,
      rowVersion: returnedReadback.rowVersion,
      dueDate: "2026-03-20",
      amountTxn: 75000,
      amountBase: 75000,
      currencyCode: fixtures.currencyCode,
      fxRate: 1,
    },
    assertScopeAccess: allowAllScopes,
  });
  assert(
    corrected.status === "RETURNED" && toNumber(corrected.amountBase) === 75000,
    "Returned AP documents should remain editable before resubmission"
  );

  const resubmitted = await submitCariDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: draft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  const resubmittedInstances = await listWorkflowInstancesForDocument({
    tenantId,
    documentId: draft.id,
  });
  assert(
    resubmittedInstances.length === 2,
    "Returned AP resubmission should create a fresh workflow instance"
  );
  const secondInstance = resubmittedInstances[resubmittedInstances.length - 1];
  const secondRequest = await getApprovalRequestSnapshots({
    tenantId,
    genericRequestId: secondInstance.generic_request_id,
  });
  assert(
    toPositiveInt(secondInstance.workflow_definition_id) ===
    toPositiveInt(highRoute.definition.id) &&
    toPositiveInt(secondRequest.targetSnapshot.workflow_assignment_id) ===
    toPositiveInt(highRoute.assignment.id) &&
    String(secondRequest.targetSnapshot.workflow_definition_code || "") ===
    String(highRoute.definition.code || "") &&
    String(secondRequest.targetSnapshot.workflow_definition_name || "") ===
    String(highRoute.definition.name || "") &&
    toNumber(secondRequest.targetSnapshot.evaluated_amount) === 75000 &&
    toPositiveInt(
      secondRequest.targetSnapshot.routing_rule_snapshot?.workflow_definition_id
    ) === toPositiveInt(highRoute.definition.id) &&
    String(secondRequest.targetSnapshot.routing_rule_snapshot?.workflow_definition_code || "") ===
    String(highRoute.definition.code || ""),
    "Returned documents should re-evaluate against the current matrix and persist the new high-band route identity on resubmission"
  );
  assert(
    resubmitted.workflowGate?.state === "pending" &&
    toPositiveInt(resubmitted.workflowGate?.workflowDefinitionId) ===
    toPositiveInt(highRoute.definition.id) &&
    String(resubmitted.workflowGate?.workflowDefinitionCode || "") ===
    String(highRoute.definition.code || "") &&
    String(resubmitted.workflowGate?.workflowDefinitionName || "") ===
    String(highRoute.definition.name || "") &&
    toPositiveInt(resubmitted.workflowGate?.workflowAssignmentId) ===
    toPositiveInt(highRoute.assignment.id) &&
    toNumber(resubmitted.workflowGate?.evaluatedAmount) === 75000 &&
    String(resubmitted.workflowGate?.routingRuleSnapshot?.workflow_definition_code || "") ===
    String(highRoute.definition.code || ""),
    "Resubmitted workflow gate readback should expose the newly matched routing snapshot and route label"
  );

  console.log("AMX03 AP workflow gate integration smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
