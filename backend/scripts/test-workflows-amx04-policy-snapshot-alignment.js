import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  createCariDraftDocument,
  submitCariDocumentById,
} from "../src/services/cari.document.service.js";
import {
  createWorkflowAssignment,
  createWorkflowDefinition,
  replaceWorkflowDefinitionSteps,
} from "../src/services/workflows.service.js";
import { getRequestDiagnostics } from "../src/services/approval.engine.service.js";
import { getApprovalRequestById } from "../src/services/approvalPolicies.service.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
  CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
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

function allowAllScopes() {}

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "test-workflows-amx04-policy-snapshot-alignment",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
  };
}

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
    [tenantId, `AMX04GC${stamp}`, `AMX04 Group ${stamp}`]
  );
  const groupResult = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `AMX04GC${stamp}`]
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
      `AMX04LE${stamp}`,
      `AMX04 Legal Entity ${stamp}`,
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
    [tenantId, `AMX04LE${stamp}`]
  );
  const legalEntityId = toPositiveInt(legalEntityResult.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity");

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
      `AMX04OU${stamp}`,
      `AMX04 Operating Unit ${stamp}`,
    ]
  );
  const operatingUnitResult = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `AMX04OU${stamp}`]
  );
  const operatingUnitId = toPositiveInt(operatingUnitResult.rows?.[0]?.id);
  assert(operatingUnitId > 0, "Failed to create operating unit");

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
    [tenantId, legalEntityId, `AMX04TERM${stamp}`, `AMX04 Term ${stamp}`]
  );
  const paymentTermResult = await query(
    `SELECT id
       FROM payment_terms
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `AMX04TERM${stamp}`]
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
      `AMX04V${stamp}`,
      `AMX04 Vendor ${stamp}`,
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
    [tenantId, legalEntityId, `AMX04V${stamp}`]
  );
  const vendorId = toPositiveInt(vendorResult.rows?.[0]?.id);
  assert(vendorId > 0, "Failed to create vendor");

  return {
    countryId,
    currencyCode,
    legalEntityId,
    operatingUnitId,
    paymentTermId,
    vendorId,
  };
}

async function replaceBranchDefinitionSteps({
  tenantId,
  workflowDefinitionId,
}) {
  await replaceWorkflowDefinitionSteps({
    input: {
      tenantId,
      definitionId: workflowDefinitionId,
      steps: [
        { stepNo: 1, actionCode: "SUBMIT", stageScopeType: "OPERATING_UNIT" },
        { stepNo: 2, actionCode: "APPROVE", stageScopeType: "LEGAL_ENTITY" },
        { stepNo: 3, actionCode: "POST", stageScopeType: "COUNTRY" },
      ],
    },
  });
}

async function createAmountRoute({
  tenantId,
  userId,
  code,
  name,
  operatingUnitId,
  minAmount,
  maxAmount,
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
  await replaceBranchDefinitionSteps({
    tenantId,
    workflowDefinitionId: definition.id,
  });
  const assignment = await createWorkflowAssignment({
    req: null,
    assertScopeAccess: allowAllScopes,
    input: {
      tenantId,
      userId,
      processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      workflowDefinitionId: definition.id,
      operatingUnitId,
      amountBasis: "BASE_AMOUNT",
      minAmount,
      maxAmount,
      priority: 100,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  return { definition, assignment };
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
      documentDate: "2026-02-10",
      dueDate: "2026-03-12",
      amountTxn,
      amountBase,
      currencyCode,
      fxRate: 1,
    },
    assertScopeAccess: allowAllScopes,
  });
}

async function getLatestApprovalRequestForDocument({ tenantId, documentId }) {
  const instanceResult = await query(
    `SELECT generic_request_id
       FROM workflow_instances
      WHERE tenant_id = ?
        AND process_type = ?
        AND target_type = ?
        AND target_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [
      tenantId,
      AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      CARI_DOCUMENT_WORKFLOW_TARGET_TYPE,
      documentId,
    ]
  );
  const genericRequestId = toPositiveInt(instanceResult.rows?.[0]?.generic_request_id);
  assert(genericRequestId > 0, `Generic request not found for document ${documentId}`);

  const requestResult = await query(
    `SELECT
        id,
        policy_id,
        policy_snapshot_json,
        target_snapshot_json
     FROM approval_requests
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, genericRequestId]
  );
  const row = requestResult.rows?.[0] || null;
  return {
    id: genericRequestId,
    policyId: toPositiveInt(row?.policy_id),
    policySnapshot: parseJson(row?.policy_snapshot_json, {}),
    targetSnapshot: parseJson(row?.target_snapshot_json, {}),
  };
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant({
    code: `AMX04T${stamp}`,
    name: `AMX04 Tenant ${stamp}`,
  });
  const userId = await createUser({
    tenantId,
    email: `amx04-${stamp}@example.com`,
    name: "AMX04 Admin",
  });
  const fixtures = await createOrgFixtures({ tenantId, stamp });
  const req = makeRequestContext({
    tenantId,
    userId,
    stamp,
    suffix: "read",
  });

  const lowRoute = await createAmountRoute({
    tenantId,
    userId,
    code: `AMX04_LOW_${stamp}`,
    name: "AMX04 Low Route",
    operatingUnitId: fixtures.operatingUnitId,
    minAmount: 0,
    maxAmount: 50000,
  });
  const highRoute = await createAmountRoute({
    tenantId,
    userId,
    code: `AMX04_HIGH_${stamp}`,
    name: "AMX04 High Route",
    operatingUnitId: fixtures.operatingUnitId,
    minAmount: 50000.01,
    maxAmount: null,
  });

  const lowDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    operatingUnitId: fixtures.operatingUnitId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    currencyCode: fixtures.currencyCode,
    amountTxn: 42000,
    amountBase: 42000,
  });
  await submitCariDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: lowDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  const lowRequest = await getLatestApprovalRequestForDocument({
    tenantId,
    documentId: lowDraft.id,
  });
  assert(
    toPositiveInt(lowRequest.policySnapshot?.matched_assignment?.id) ===
      toPositiveInt(lowRoute.assignment.id) &&
      toPositiveInt(
        lowRequest.policySnapshot?.matched_assignment?.workflow_definition_id
      ) === toPositiveInt(lowRoute.definition.id) &&
      String(lowRequest.policySnapshot?.matched_assignment?.scope_type || "") ===
        "OPERATING_UNIT" &&
      String(lowRequest.policySnapshot?.matched_assignment?.scope_layer || "") ===
        "OPERATING_UNIT" &&
      String(lowRequest.policySnapshot?.matched_assignment?.amount_basis || "") ===
        "BASE_AMOUNT" &&
      toNumber(lowRequest.policySnapshot?.matched_assignment?.min_amount) === 0 &&
      toNumber(lowRequest.policySnapshot?.matched_assignment?.max_amount) === 50000 &&
      String(lowRequest.policySnapshot?.routing_context?.match_type || "") === "BAND" &&
      String(lowRequest.policySnapshot?.routing_context?.matched_scope_layer || "") ===
        "OPERATING_UNIT" &&
      toNumber(lowRequest.policySnapshot?.routing_context?.evaluated_amount) === 42000 &&
      String(lowRequest.policySnapshot?.routing_context?.amount_basis || "") ===
        "BASE_AMOUNT",
    "Workflow policy snapshot should persist the matched routing rule and routing context for audit/debug coherence"
  );
  assert(
    toPositiveInt(lowRequest.policySnapshot?.matched_assignment?.id) ===
      toPositiveInt(lowRequest.targetSnapshot?.workflow_assignment_id) &&
      toNumber(lowRequest.policySnapshot?.routing_context?.evaluated_amount) ===
        toNumber(lowRequest.targetSnapshot?.evaluated_amount),
    "Policy and target snapshots should agree on the matched workflow assignment and evaluated amount"
  );

  const diagnostics = await getRequestDiagnostics(lowRequest.id);
  assert(
    toPositiveInt(diagnostics?.routingSummary?.workflowDefinitionId) ===
      toPositiveInt(lowRoute.definition.id) &&
      toPositiveInt(diagnostics?.routingSummary?.matchedAssignment?.id) ===
        toPositiveInt(lowRoute.assignment.id) &&
      toPositiveInt(diagnostics?.routingSummary?.routingRule?.id) ===
        toPositiveInt(lowRoute.assignment.id) &&
      toNumber(diagnostics?.routingSummary?.evaluatedAmount) === 42000 &&
      String(diagnostics?.routingSummary?.amountBasis || "") === "BASE_AMOUNT" &&
      diagnostics?.routingSummary?.usedFallback === false,
    "Approval diagnostics should expose a normalized routing summary without re-running selection"
  );

  const approvalRequest = await getApprovalRequestById({
    req,
    tenantId,
    requestId: lowRequest.id,
    assertScopeAccess: allowAllScopes,
  });
  assert(
    toPositiveInt(approvalRequest?.routing_summary?.workflowDefinitionId) ===
      toPositiveInt(lowRoute.definition.id) &&
      toPositiveInt(approvalRequest?.routing_summary?.matchedAssignment?.id) ===
        toPositiveInt(lowRoute.assignment.id),
    "Unified approval request readback should surface the routing summary alongside raw snapshots"
  );

  const highDraft = await createDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fixtures.legalEntityId,
    operatingUnitId: fixtures.operatingUnitId,
    counterpartyId: fixtures.vendorId,
    paymentTermId: fixtures.paymentTermId,
    currencyCode: fixtures.currencyCode,
    amountTxn: 78000,
    amountBase: 78000,
  });
  await submitCariDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: highDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  const highRequest = await getLatestApprovalRequestForDocument({
    tenantId,
    documentId: highDraft.id,
  });
  assert(
    lowRequest.policyId !== highRequest.policyId &&
      String(lowRequest.policySnapshot?.policy_code || "") !==
        String(highRequest.policySnapshot?.policy_code || "") &&
      toPositiveInt(highRequest.policySnapshot?.matched_assignment?.id) ===
        toPositiveInt(highRoute.assignment.id) &&
      toPositiveInt(
        highRequest.policySnapshot?.matched_assignment?.workflow_definition_id
      ) === toPositiveInt(highRoute.definition.id),
    "Definition mirroring should remain coherent when different amount bands resolve to different workflow definitions"
  );

  console.log("AMX04 policy snapshot alignment smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
