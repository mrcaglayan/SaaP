import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  createWorkflowAssignment,
  createWorkflowDefinition,
  findActiveWorkflowAssignmentForScope,
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

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const tenantId = await createTenant({
    code: `AMX01T${stamp}`,
    name: `AMX01 Tenant ${stamp}`,
  });
  const userId = await createUser({
    tenantId,
    email: `amx01-${stamp}@example.com`,
    name: "AMX01 Admin",
  });
  const countryId = await resolveCountry("US");
  const groupCompanyId = await createGroupCompany({
    tenantId,
    code: `AMX01GC${stamp}`,
    name: `AMX01 Group ${stamp}`,
  });
  const primaryLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    code: `AMX01LEA${stamp}`,
    name: `AMX01 Legal Entity A ${stamp}`,
  });
  const legacyLegalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    code: `AMX01LEB${stamp}`,
    name: `AMX01 Legal Entity B ${stamp}`,
  });

  const lowDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX01_LOW_${stamp}`,
      name: "AMX01 Low Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });
  const highDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX01_HIGH_${stamp}`,
      name: "AMX01 High Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });
  const groupFallbackDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX01_GROUP_FB_${stamp}`,
      name: "AMX01 Group Fallback Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });
  const legalEntityFallbackDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX01_LE_FB_${stamp}`,
      name: "AMX01 Legal Entity Fallback Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });
  const legacyDefinition = await createWorkflowDefinition({
    input: {
      tenantId,
      userId,
      code: `AMX01_LEGACY_${stamp}`,
      name: "AMX01 Legacy Route",
      processType: "AP_DOCUMENT_POSTING",
      isActive: true,
      versionNo: 1,
    },
  });

  await createWorkflowAssignment({
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
      workflowDefinitionId: groupFallbackDefinition.id,
      groupCompanyId,
      isFallback: true,
      priority: 10,
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

  const lowMatch = await findActiveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: primaryLegalEntityId },
    thresholdAmount: 50000,
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    toPositiveInt(lowMatch?.workflow_definition_id) === toPositiveInt(lowDefinition.id),
    "50,000 should resolve to the low route using the inclusive upper bound"
  );

  const highMatch = await findActiveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: primaryLegalEntityId },
    thresholdAmount: 50000.01,
    amountBasis: "BASE_AMOUNT",
  });
  assert(
    toPositiveInt(highMatch?.workflow_definition_id) === toPositiveInt(highDefinition.id),
    "50,000.01 should resolve to the high route"
  );

  const missingThresholdSpecificScope = await findActiveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: primaryLegalEntityId },
  });
  assert(
    missingThresholdSpecificScope === null,
    "A specific scope with amount-band rows should not silently drop to a broader fallback without threshold context"
  );

  const legacyMatch = await findActiveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: legacyLegalEntityId },
  });
  assert(
    toPositiveInt(legacyMatch?.workflow_definition_id) === toPositiveInt(legacyDefinition.id),
    "Legacy rows without amount metadata should keep matching safely"
  );

  const legalEntityFallback = await createWorkflowAssignment({
    req: null,
    assertScopeAccess: noScopeGuard,
    input: {
      tenantId,
      userId,
      processType: "AP_DOCUMENT_POSTING",
      workflowDefinitionId: legalEntityFallbackDefinition.id,
      legalEntityId: primaryLegalEntityId,
      isFallback: true,
      priority: 5,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
    },
  });
  const specificFallbackMatch = await findActiveWorkflowAssignmentForScope({
    tenantId,
    processType: "AP_DOCUMENT_POSTING",
    effectiveOn: "2026-06-01",
    scope: { legalEntityId: primaryLegalEntityId },
  });
  assert(
    toPositiveInt(specificFallbackMatch?.id) === toPositiveInt(legalEntityFallback.id),
    "A fallback in the matched specific scope should resolve when no amount band matches"
  );

  let overlapBlocked = false;
  try {
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
        minAmount: 40000,
        maxAmount: 60000,
        priority: 90,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        status: "ACTIVE",
      },
    });
  } catch (error) {
    overlapBlocked =
      Number(error?.status) === 409 &&
      String(error?.code || "") === "WORKFLOW_ASSIGNMENT_AMOUNT_OVERLAP";
  }
  assert(overlapBlocked, "Overlapping amount bands must be rejected");

  let duplicateFallbackBlocked = false;
  try {
    await createWorkflowAssignment({
      req: null,
      assertScopeAccess: noScopeGuard,
      input: {
        tenantId,
        userId,
        processType: "AP_DOCUMENT_POSTING",
        workflowDefinitionId: highDefinition.id,
        legalEntityId: primaryLegalEntityId,
        isFallback: true,
        priority: 1,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        status: "ACTIVE",
      },
    });
  } catch (error) {
    duplicateFallbackBlocked =
      Number(error?.status) === 409 &&
      String(error?.code || "") === "WORKFLOW_ASSIGNMENT_FALLBACK_CONFLICT";
  }
  assert(duplicateFallbackBlocked, "A second active fallback must be rejected");

  console.log("AMX01 routing matrix smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
