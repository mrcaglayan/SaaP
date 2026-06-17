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
  resolveWorkflowAssignmentForScope,
} from "../src/services/workflows.service.js";
import { AP_DOCUMENT_WORKFLOW_PROCESS_TYPE } from "../../shared/cariDocumentWorkflowGovernance.js";

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

function makeRequestContext({ tenantId, userId, stamp, suffix }) {
  return {
    requestId: `${stamp}:${suffix}`.slice(0, 80),
    headers: {
      "user-agent": "test-workflows-amx07-routing-hardening",
    },
    ip: "127.0.0.1",
    user: {
      tenantId,
      userId,
    },
  };
}

function allowAllScopes() {}

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

async function createGroupCompany({ tenantId, code, name }) {
  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, code, name]
  );
  const result = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  const groupCompanyId = toPositiveInt(result.rows?.[0]?.id);
  assert(groupCompanyId > 0, `Failed to create group company ${code}`);
  return groupCompanyId;
}

async function createLegalEntity({
  tenantId,
  groupCompanyId,
  countryId,
  functionalCurrencyCode,
  code,
  name,
}) {
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
    [tenantId, groupCompanyId, code, name, countryId, functionalCurrencyCode]
  );
  const result = await query(
    `SELECT id
       FROM legal_entities
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, code]
  );
  const legalEntityId = toPositiveInt(result.rows?.[0]?.id);
  assert(legalEntityId > 0, `Failed to create legal entity ${code}`);
  return legalEntityId;
}

async function createPaymentTerm({ tenantId, legalEntityId, code, name }) {
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
    [tenantId, legalEntityId, code, name]
  );
  const result = await query(
    `SELECT id
       FROM payment_terms
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const paymentTermId = toPositiveInt(result.rows?.[0]?.id);
  assert(paymentTermId > 0, `Failed to create payment term ${code}`);
  return paymentTermId;
}

async function createOperatingUnit({ tenantId, legalEntityId, code, name }) {
  await query(
    `INSERT INTO operating_units (
        tenant_id,
        legal_entity_id,
        code,
        name,
        status
     )
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name]
  );
  const result = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const operatingUnitId = toPositiveInt(result.rows?.[0]?.id);
  assert(operatingUnitId > 0, `Failed to create operating unit ${code}`);
  return operatingUnitId;
}

async function createVendor({
  tenantId,
  legalEntityId,
  paymentTermId,
  defaultCurrencyCode,
  code,
  name,
}) {
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
    [tenantId, legalEntityId, code, name, defaultCurrencyCode, paymentTermId]
  );
  const result = await query(
    `SELECT id
       FROM counterparties
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const vendorId = toPositiveInt(result.rows?.[0]?.id);
  assert(vendorId > 0, `Failed to create vendor ${code}`);
  return vendorId;
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

async function createDefinition({
  tenantId,
  userId,
  code,
  name,
  withStep = false,
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
  if (withStep) {
    await replaceBranchDefinitionSteps({
      tenantId,
      workflowDefinitionId: definition.id,
    });
  }
  return definition;
}

async function createRoute({
  tenantId,
  userId,
  workflowDefinitionId,
  legalEntityId = null,
  operatingUnitId = null,
  groupCompanyId = null,
  minAmount = null,
  maxAmount = null,
  priority = 100,
  effectiveFrom = "2026-01-01",
  effectiveTo = null,
  status = "ACTIVE",
  isFallback = false,
}) {
  return createWorkflowAssignment({
    req: null,
    assertScopeAccess: allowAllScopes,
    input: {
      tenantId,
      userId,
      processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
      workflowDefinitionId,
      legalEntityId,
      operatingUnitId,
      groupCompanyId,
      amountBasis: "BASE_AMOUNT",
      minAmount,
      maxAmount,
      priority,
      effectiveFrom,
      effectiveTo,
      status,
      isFallback,
    },
  });
}

async function createFxDraftDocument({
  req,
  tenantId,
  userId,
  legalEntityId,
  operatingUnitId,
  counterpartyId,
  paymentTermId,
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
      documentDate: "2026-03-07",
      dueDate: "2026-04-07",
      amountTxn: 1000,
      amountBase: 65000,
      currencyCode: "USD",
      fxRate: 65,
    },
    assertScopeAccess: allowAllScopes,
  });
}

async function main() {
  await seedCore();

  const stamp = `${Date.now()}`;
  const tenantId = await createTenant({
    code: `AMX07_${stamp}`,
    name: `AMX07 Tenant ${stamp}`,
  });
  const userId = await createUser({
    tenantId,
    email: `amx07.${stamp}@example.com`,
    name: `AMX07 User ${stamp}`,
  });

  const afCountryResult = await query(
    `SELECT id, default_currency_code
       FROM countries
      WHERE iso2 = 'AF'
      LIMIT 1`
  );
  const countryId = toPositiveInt(afCountryResult.rows?.[0]?.id);
  const functionalCurrencyCode = String(
    afCountryResult.rows?.[0]?.default_currency_code || "AFN"
  ).toUpperCase();
  assert(countryId > 0, "AF country row is required for multi-currency routing smoke");
  assert(
    functionalCurrencyCode === "AFN",
    `Expected AF functional currency AFN, got ${functionalCurrencyCode}`
  );

  const groupCompanyId = await createGroupCompany({
    tenantId,
    code: `AMX07GC${stamp}`,
    name: `AMX07 Group ${stamp}`,
  });

  const specificEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    functionalCurrencyCode,
    code: `AMX07LEA${stamp}`,
    name: "AMX07 Specific Entity",
  });
  const noMatchEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    functionalCurrencyCode,
    code: `AMX07LEB${stamp}`,
    name: "AMX07 No-Match Entity",
  });
  const expiredEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    functionalCurrencyCode,
    code: `AMX07LEC${stamp}`,
    name: "AMX07 Expired Entity",
  });
  const inactiveEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    functionalCurrencyCode,
    code: `AMX07LED${stamp}`,
    name: "AMX07 Inactive Entity",
  });
  const fxEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    functionalCurrencyCode,
    code: `AMX07LEE${stamp}`,
    name: "AMX07 FX Entity",
  });
  const fxOperatingUnitId = await createOperatingUnit({
    tenantId,
    legalEntityId: fxEntityId,
    code: `AMX07OU${stamp}`,
    name: "AMX07 FX Operating Unit",
  });

  const paymentTermId = await createPaymentTerm({
    tenantId,
    legalEntityId: fxEntityId,
    code: `AMX07TERM${stamp}`,
    name: "AMX07 Term",
  });
  const vendorId = await createVendor({
    tenantId,
    legalEntityId: fxEntityId,
    paymentTermId,
    defaultCurrencyCode: functionalCurrencyCode,
    code: `AMX07V${stamp}`,
    name: "AMX07 Vendor",
  });

  const groupDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_GROUP_${stamp}`,
    name: "AMX07 Group Route",
  });
  const specificDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_SPECIFIC_${stamp}`,
    name: "AMX07 Specific Route",
  });
  const noMatchDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_NOMATCH_${stamp}`,
    name: "AMX07 No-Match Route",
  });
  const expiredDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_EXPIRED_${stamp}`,
    name: "AMX07 Expired Route",
  });
  const expiredActiveDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_EXPIRED_ACTIVE_${stamp}`,
    name: "AMX07 Current Route",
  });
  const inactiveDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_INACTIVE_${stamp}`,
    name: "AMX07 Inactive Route",
  });
  const inactiveActiveDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_INACTIVE_ACTIVE_${stamp}`,
    name: "AMX07 Active Route",
  });
  const lowFxDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_FX_LOW_${stamp}`,
    name: "AMX07 FX Low Route",
    withStep: true,
  });
  const highFxDefinition = await createDefinition({
    tenantId,
    userId,
    code: `AMX07_FX_HIGH_${stamp}`,
    name: "AMX07 FX High Route",
    withStep: true,
  });

  await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: groupDefinition.id,
    groupCompanyId,
    minAmount: 0,
    maxAmount: null,
    priority: 10,
  });
  await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: specificDefinition.id,
    legalEntityId: specificEntityId,
    minAmount: 0,
    maxAmount: null,
    priority: 100,
  });
  await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: noMatchDefinition.id,
    legalEntityId: noMatchEntityId,
    minAmount: 50000.01,
    maxAmount: null,
    priority: 100,
  });
  await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: expiredDefinition.id,
    legalEntityId: expiredEntityId,
    minAmount: 0,
    maxAmount: null,
    priority: 200,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-01-31",
  });
  await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: expiredActiveDefinition.id,
    legalEntityId: expiredEntityId,
    minAmount: 0,
    maxAmount: null,
    priority: 100,
    effectiveFrom: "2026-02-01",
    effectiveTo: null,
  });
  await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: inactiveDefinition.id,
    legalEntityId: inactiveEntityId,
    minAmount: 0,
    maxAmount: null,
    priority: 200,
    status: "INACTIVE",
  });
  await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: inactiveActiveDefinition.id,
    legalEntityId: inactiveEntityId,
    minAmount: 0,
    maxAmount: null,
    priority: 100,
    status: "ACTIVE",
  });
  const lowFxRoute = await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: lowFxDefinition.id,
    operatingUnitId: fxOperatingUnitId,
    minAmount: 0,
    maxAmount: 50000,
    priority: 100,
  });
  const highFxRoute = await createRoute({
    tenantId,
    userId,
    workflowDefinitionId: highFxDefinition.id,
    operatingUnitId: fxOperatingUnitId,
    minAmount: 50000.01,
    maxAmount: null,
    priority: 100,
  });

  const specificResolution = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: specificEntityId },
    thresholdAmount: 1000,
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    toPositiveInt(specificResolution.assignmentRow?.workflow_definition_id) ===
      toPositiveInt(specificDefinition.id) &&
      specificResolution.diagnostics?.matchedScopeLayer === "LEGAL_ENTITY",
    "More specific legal-entity rules must beat broader group rules when both match"
  );

  const noMatchResolution = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: noMatchEntityId },
    thresholdAmount: 40000,
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    noMatchResolution.assignmentRow === null &&
      noMatchResolution.diagnostics?.matchType === "NONE" &&
      noMatchResolution.diagnostics?.matchedScopeLayer === "LEGAL_ENTITY" &&
      noMatchResolution.diagnostics?.noMatchReason === "THRESHOLD_OUT_OF_RANGE",
    "Specific-scope no-match should stay unresolved instead of silently falling back to a broader rule"
  );

  const expiredResolution = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: expiredEntityId },
    thresholdAmount: 1000,
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    toPositiveInt(expiredResolution.assignmentRow?.workflow_definition_id) ===
      toPositiveInt(expiredActiveDefinition.id),
    "Expired routing rules must be ignored during selection"
  );

  const inactiveResolution = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: inactiveEntityId },
    thresholdAmount: 1000,
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    toPositiveInt(inactiveResolution.assignmentRow?.workflow_definition_id) ===
      toPositiveInt(inactiveActiveDefinition.id),
    "Inactive routing rules must be ignored during selection"
  );

  const req = makeRequestContext({
    tenantId,
    userId,
    stamp,
    suffix: "fx-submit",
  });
  const fxDraft = await createFxDraftDocument({
    req,
    tenantId,
    userId,
    legalEntityId: fxEntityId,
    operatingUnitId: fxOperatingUnitId,
    counterpartyId: vendorId,
    paymentTermId,
  });
  const submittedFxDraft = await submitCariDocumentById({
    req,
    payload: {
      tenantId,
      userId,
      documentId: fxDraft.id,
    },
    assertScopeAccess: allowAllScopes,
  });
  assert(
    toPositiveInt(submittedFxDraft.workflowGate?.workflowDefinitionId) ===
      toPositiveInt(highFxDefinition.id) &&
      toPositiveInt(submittedFxDraft.workflowGate?.workflowAssignmentId) ===
        toPositiveInt(highFxRoute.id) &&
      String(submittedFxDraft.workflowGate?.workflowDefinitionCode || "") ===
        String(highFxDefinition.code || "") &&
      toNumber(submittedFxDraft.workflowGate?.evaluatedAmount) === 65000 &&
      String(submittedFxDraft.workflowGate?.evaluatedAmountBasis || "").toUpperCase() ===
        "BASE_AMOUNT" &&
      toPositiveInt(submittedFxDraft.workflowGate?.routingRuleSnapshot?.assignment_id) ===
        toPositiveInt(highFxRoute.id) &&
      toPositiveInt(lowFxRoute.id) > 0,
    "Multi-currency AP routing must evaluate the document base amount, not the foreign transaction amount"
  );

  console.log("AMX07 routing hardening smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
