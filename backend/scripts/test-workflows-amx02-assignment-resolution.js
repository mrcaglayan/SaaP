import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  createWorkflowAssignment,
  createWorkflowDefinition,
  resolveWorkflowAssignmentForScope,
} from "../src/services/workflows.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function noScopeGuard() {
  return true;
}

async function createTenant({ code, name }) {
  await query(`INSERT INTO tenants (code, name, status) VALUES (?, ?, 'ACTIVE')`, [
    code,
    name,
  ]);
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

async function resolveCountry(iso2) {
  const result = await query(
    `SELECT id
       FROM countries
      WHERE iso2 = ?
      LIMIT 1`,
    [iso2]
  );
  const countryId = toPositiveInt(result.rows?.[0]?.id);
  assert(countryId > 0, `Country ${iso2} must exist`);
  return countryId;
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
  code,
  name,
  currencyCode = "USD",
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
    [tenantId, groupCompanyId, code, name, countryId, currencyCode]
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

async function insertPriorityOverrideAssignment({
  tenantId,
  userId,
  workflowDefinitionId,
  legalEntityId,
}) {
  await query(
    `INSERT INTO workflow_assignments (
       tenant_id,
       process_type,
       workflow_definition_id,
       legal_entity_id,
       effective_from,
       effective_to,
       status,
       created_by_user_id,
       amount_basis,
       min_amount,
       max_amount,
       priority,
       is_fallback
     )
     VALUES (?, 'AP_DOCUMENT_POSTING', ?, ?, '2026-01-01', NULL, 'ACTIVE', ?, 'BASE_AMOUNT', 0, 100000, 200, 0)`,
    [tenantId, workflowDefinitionId, legalEntityId, userId]
  );
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant({
    code: `AMX02T${stamp}`,
    name: `AMX02 Tenant ${stamp}`,
  });
  const userId = await createUser({
    tenantId,
    email: `amx02-${stamp}@example.com`,
    name: "AMX02 Admin",
  });
  const countryId = await resolveCountry("US");
  const groupCompanyId = await createGroupCompany({
    tenantId,
    code: `AMX02GC${stamp}`,
    name: `AMX02 Group ${stamp}`,
  });
  const primaryLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    code: `AMX02LEA${stamp}`,
    name: `AMX02 Legal Entity A ${stamp}`,
  });
  const legacyLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    code: `AMX02LEB${stamp}`,
    name: `AMX02 Legal Entity B ${stamp}`,
  });

  const lowDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX02_LOW_${stamp}`,
      name: "AMX02 Low Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });
  const highDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX02_HIGH_${stamp}`,
      name: "AMX02 High Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });
  const fallbackDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX02_FB_${stamp}`,
      name: "AMX02 Fallback Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });
  const legacyDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX02_LEGACY_${stamp}`,
      name: "AMX02 Legacy Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });
  const priorityDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX02_PRIORITY_${stamp}`,
      name: "AMX02 Priority Override Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });

  const lowAssignment = await createWorkflowAssignment({
    req: null,
    assertScopeAccess: noScopeGuard,
    input: {
      tenantId,
      userId,
      processType: "AP_DOCUMENT_POSTING",
      workflowDefinitionId: lowDefinition.id,
      legalEntityId: primaryLegalEntityId,
      amountBasis: "BASE_AMOUNT",
      minAmount: 0,
      maxAmount: 50000,
      priority: 100,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  await createWorkflowAssignment({
    req: null,
    assertScopeAccess: noScopeGuard,
    input: {
      tenantId,
      userId,
      processType: "AP_DOCUMENT_POSTING",
      workflowDefinitionId: highDefinition.id,
      legalEntityId: primaryLegalEntityId,
      amountBasis: "BASE_AMOUNT",
      minAmount: 50000.01,
      maxAmount: null,
      priority: 100,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  await createWorkflowAssignment({
    req: null,
    assertScopeAccess: noScopeGuard,
    input: {
      tenantId,
      userId,
      processType: "AP_DOCUMENT_POSTING",
      workflowDefinitionId: legacyDefinition.id,
      legalEntityId: legacyLegalEntityId,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });

  const lowResolution = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: primaryLegalEntityId },
    thresholdAmount: 50000,
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    toPositiveInt(lowResolution.assignmentRow?.id) === toPositiveInt(lowAssignment.id),
    "Amount-aware selection should resolve the legal-entity low band"
  );
  assert(
    lowResolution.diagnostics?.matchType === "BAND" &&
      lowResolution.diagnostics?.matchedScopeLayer === "LEGAL_ENTITY" &&
      lowResolution.diagnostics?.amountBasis === "BASE_AMOUNT" &&
      Number(lowResolution.diagnostics?.thresholdAmount) === 50000 &&
      toPositiveInt(lowResolution.diagnostics?.selectedAssignment?.id) ===
        toPositiveInt(lowAssignment.id),
    "Band diagnostics should expose the matched scope layer, amount basis, and selected assignment"
  );

  const missingThreshold = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: primaryLegalEntityId },
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    missingThreshold.assignmentRow === null,
    "Selection should return no assignment when the matched scope layer needs threshold context"
  );
  assert(
    missingThreshold.diagnostics?.matchType === "NONE" &&
      missingThreshold.diagnostics?.matchedScopeLayer === "LEGAL_ENTITY" &&
      missingThreshold.diagnostics?.noMatchReason === "THRESHOLD_AMOUNT_REQUIRED",
    "Missing-threshold diagnostics should explicitly explain why the specific scope did not match"
  );

  const fallbackAssignment = await createWorkflowAssignment({
    req: null,
    assertScopeAccess: noScopeGuard,
    input: {
      tenantId,
      userId,
      processType: "AP_DOCUMENT_POSTING",
      workflowDefinitionId: fallbackDefinition.id,
      legalEntityId: primaryLegalEntityId,
      isFallback: true,
      priority: 5,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  const fallbackResolution = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: primaryLegalEntityId },
    thresholdAmount: 999999,
    amountBasis: "TXN_AMOUNT",
  });
  assert(
    toPositiveInt(fallbackResolution.assignmentRow?.id) === toPositiveInt(fallbackAssignment.id),
    "Fallback should resolve when no non-fallback band matches inside the selected scope layer"
  );
  assert(
    fallbackResolution.diagnostics?.matchType === "FALLBACK" &&
      fallbackResolution.diagnostics?.selectedAssignment?.isFallback === true,
    "Fallback diagnostics should identify fallback selection explicitly"
  );

  const legacyResolution = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: legacyLegalEntityId },
  });
  assert(
    toPositiveInt(legacyResolution.assignmentRow?.workflow_definition_id) ===
      toPositiveInt(legacyDefinition.id),
    "Legacy rows without threshold metadata must still match"
  );
  assert(
    legacyResolution.diagnostics?.matchType === "LEGACY" &&
      legacyResolution.diagnostics?.noMatchReason === null,
    "Legacy diagnostics should report the legacy match path instead of a threshold failure"
  );

  await insertPriorityOverrideAssignment({
    tenantId,
    userId,
    workflowDefinitionId: priorityDefinition.id,
    legalEntityId: primaryLegalEntityId,
  });
  const priorityResolution = await resolveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: primaryLegalEntityId },
    thresholdAmount: 25000,
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    toPositiveInt(priorityResolution.assignmentRow?.workflow_definition_id) ===
      toPositiveInt(priorityDefinition.id),
    "Deterministic ordering should pick the highest-priority matching band when dirty overlapping data exists"
  );
  assert(
    priorityResolution.diagnostics?.priorityApplied === true &&
      Number(priorityResolution.diagnostics?.bandMatchCount || 0) === 2,
    "Priority diagnostics should show that multiple matching rows were reduced deterministically"
  );

  console.log("AMX02 assignment resolution smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
