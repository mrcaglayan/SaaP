import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  ensureDefaultApWorkflowDefinition,
  evaluateApWorkflowLegalEntityCoverage,
  getApWorkflowRolloutState,
  setApWorkflowRolloutPhase,
  DEFAULT_AP_WORKFLOW_DEFINITION_CODE,
} from "../src/services/ap.document.workflow.rollout.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function expectThrows(work, { includes, status } = {}) {
  try {
    await work();
  } catch (error) {
    if (includes) {
      assert(
        String(error?.message || "").includes(includes),
        `Expected error message to include "${includes}" but got "${String(
          error?.message || ""
        )}"`
      );
    }
    if (status !== undefined) {
      assert(
        Number(error?.status || 0) === Number(status),
        `Expected status ${status} but got ${String(error?.status || "")}`
      );
    }
    return error;
  }
  throw new Error("Expected failure but the operation succeeded");
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
    `SELECT id, code
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const row = result.rows?.[0] || null;
  assert(toPositiveInt(row?.id) > 0, `Failed to create legal entity ${code}`);
  return {
    id: toPositiveInt(row.id),
    code: String(row.code || "").trim(),
  };
}

async function createPeriodCloseAssignment({
  tenantId,
  userId,
  groupCompanyId,
  effectiveFrom,
}) {
  await query(
    `INSERT INTO workflow_definitions (
        tenant_id,
        code,
        name,
        process_type,
        is_active,
        version_no,
        created_by_user_id
     )
     VALUES (?, 'PR29_PERIOD_CLOSE_V1', 'PR29 Period Close', 'PERIOD_CLOSE', TRUE, 1, ?)`,
    [tenantId, userId]
  );
  const definitionResult = await query(
    `SELECT id
     FROM workflow_definitions
     WHERE tenant_id = ?
       AND code = 'PR29_PERIOD_CLOSE_V1'
       AND version_no = 1
     LIMIT 1`,
    [tenantId]
  );
  const definitionId = toPositiveInt(definitionResult.rows?.[0]?.id);
  assert(definitionId > 0, "Failed to create PERIOD_CLOSE definition");

  await query(
    `INSERT INTO workflow_definition_steps (
        workflow_definition_id,
        step_no,
        stage_scope_type,
        required_permission_code,
        min_approver_count,
        allow_self_approve,
        escalation_after_hours
     )
     VALUES (?, 1, 'GROUP', 'gl.period.close', 1, FALSE, NULL)`,
    [definitionId]
  );
  await query(
    `INSERT INTO workflow_assignments (
        tenant_id,
        process_type,
        workflow_definition_id,
        group_company_id,
        legal_entity_id,
        operating_unit_id,
        country_id,
        effective_from,
        effective_to,
        status,
        created_by_user_id
     )
     VALUES (?, 'PERIOD_CLOSE', ?, ?, NULL, NULL, NULL, ?, NULL, 'ACTIVE', ?)`,
    [tenantId, definitionId, groupCompanyId, effectiveFrom, userId]
  );
}

async function countAssignments(tenantId, processType) {
  const result = await query(
    `SELECT COUNT(*) AS row_count
     FROM workflow_assignments
     WHERE tenant_id = ?
       AND process_type = ?`,
    [tenantId, processType]
  );
  return Number(result.rows?.[0]?.row_count || 0);
}

async function main() {
  await seedCore({
    ensureDefaultTenantIfMissing: false,
  });

  const stamp = Date.now();
  const tenantId = await createTenant({
    code: `PR29T${stamp}`,
    name: `PR-29 AP Rollout ${stamp}`,
  });
  const userId = await createUser({
    tenantId,
    email: `pr29-${stamp}@example.com`,
    name: "PR-29 Admin",
  });
  const usCountryId = await resolveCountry("US");
  const deCountryId = await resolveCountry("DE");
  const groupCompanyId = await createGroupCompany({
    tenantId,
    code: `PR29GC${stamp}`,
    name: `PR-29 Group ${stamp}`,
  });
  const usEntityA = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId: usCountryId,
    code: `PR29USA${stamp}`,
    name: `PR-29 US A ${stamp}`,
  });
  const usEntityB = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId: usCountryId,
    code: `PR29USB${stamp}`,
    name: `PR-29 US B ${stamp}`,
  });
  const deEntity = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId: deCountryId,
    code: `PR29DE${stamp}`,
    name: `PR-29 DE ${stamp}`,
    currencyCode: "EUR",
  });

  const effectiveOn = "2026-04-06";
  await createPeriodCloseAssignment({
    tenantId,
    userId,
    groupCompanyId,
    effectiveFrom: effectiveOn,
  });

  const seededDefinition = await ensureDefaultApWorkflowDefinition({
    tenantId,
    userId,
  });
  assert(
    seededDefinition.code === DEFAULT_AP_WORKFLOW_DEFINITION_CODE &&
      seededDefinition.created === true &&
      seededDefinition.stepScopeTypes.length === 1 &&
      seededDefinition.stepScopeTypes[0] === "COUNTRY",
    "Default AP workflow seed should create the expected country-scoped definition"
  );
  const reseededDefinition = await ensureDefaultApWorkflowDefinition({
    tenantId,
    userId,
  });
  assert(
    reseededDefinition.created === false &&
      reseededDefinition.definitionId === seededDefinition.definitionId,
    "Default AP workflow seed should be idempotent"
  );

  const definitionRows = await query(
    `SELECT id
     FROM workflow_definitions
     WHERE tenant_id = ?
       AND code = ?
       AND process_type = 'AP_DOCUMENT_POSTING'`,
    [tenantId, DEFAULT_AP_WORKFLOW_DEFINITION_CODE]
  );
  assert(
    (definitionRows.rows || []).length === 1,
    "Tenant should keep exactly one default AP workflow definition row"
  );
  const stepRows = await query(
    `SELECT stage_scope_type, required_permission_code
     FROM workflow_definition_steps
     WHERE workflow_definition_id = ?`,
    [seededDefinition.definitionId]
  );
  assert(
    (stepRows.rows || []).length === 1 &&
      String(stepRows.rows[0]?.stage_scope_type || "").toUpperCase() === "COUNTRY" &&
      stepRows.rows[0]?.required_permission_code === null,
    "Default AP workflow seed should keep one COUNTRY step with null permission code"
  );
  assert(
    (await countAssignments(tenantId, "AP_DOCUMENT_POSTING")) === 0,
    "Default AP workflow seed must not auto-create AP assignments"
  );

  const initialState = await getApWorkflowRolloutState({
    tenantId,
    effectiveOn,
  });
  assert(
    initialState.featureEnabled === false &&
      initialState.compatModeEnabled === false &&
      initialState.coverage.uncoveredCount === 3,
    "Fresh tenant rollout state should start disabled with all legal entities uncovered"
  );

  const pilotState = await setApWorkflowRolloutPhase({
    tenantId,
    updatedByUserId: userId,
    phase: "PILOT",
    effectiveOn,
    note: "pilot wave",
  });
  assert(
    pilotState.after.featureEnabled === true &&
      pilotState.after.compatModeEnabled === true &&
      (await countAssignments(tenantId, "AP_DOCUMENT_POSTING")) === 0,
    "Pilot phase should enable AP workflow + compat without auto-creating assignments"
  );
  assert(
    (await countAssignments(tenantId, "PERIOD_CLOSE")) === 1,
    "AP rollout phases must not disturb existing PERIOD_CLOSE assignments"
  );

  await expectThrows(
    () =>
      setApWorkflowRolloutPhase({
        tenantId,
        updatedByUserId: userId,
        phase: "STRICT",
        effectiveOn,
      }),
    {
      includes: "Cannot disable AP workflow compat mode",
      status: 409,
    }
  );

  await query(
    `INSERT INTO workflow_assignments (
        tenant_id,
        process_type,
        workflow_definition_id,
        group_company_id,
        legal_entity_id,
        operating_unit_id,
        country_id,
        effective_from,
        effective_to,
        status,
        created_by_user_id
     )
     VALUES
       (?, 'AP_DOCUMENT_POSTING', ?, NULL, NULL, NULL, ?, ?, NULL, 'ACTIVE', ?),
       (?, 'AP_DOCUMENT_POSTING', ?, NULL, ?, NULL, NULL, ?, NULL, 'ACTIVE', ?)`,
    [
      tenantId,
      seededDefinition.definitionId,
      usCountryId,
      effectiveOn,
      userId,
      tenantId,
      seededDefinition.definitionId,
      deEntity.id,
      effectiveOn,
      userId,
    ]
  );

  const coverage = await evaluateApWorkflowLegalEntityCoverage({
    tenantId,
    effectiveOn,
  });
  const coverageByCode = Object.fromEntries(
    coverage.rows.map((row) => [row.legalEntityCode, row])
  );
  assert(
    coverage.coveredCount === 3 &&
      coverage.uncoveredCount === 0 &&
      coverageByCode[usEntityA.code]?.resolvedScopeType === "COUNTRY" &&
      coverageByCode[usEntityB.code]?.resolvedScopeType === "COUNTRY" &&
      coverageByCode[deEntity.code]?.resolvedScopeType === "LEGAL_ENTITY",
    "Coverage evaluation should respect country fallback and legal-entity override"
  );

  const strictState = await setApWorkflowRolloutPhase({
    tenantId,
    updatedByUserId: userId,
    phase: "STRICT",
    effectiveOn,
    note: "strict enforcement",
  });
  assert(
    strictState.after.featureEnabled === true &&
      strictState.after.compatModeEnabled === false &&
      strictState.after.coverage.uncoveredCount === 0,
    "Strict phase should disable compat only after full legal-entity coverage exists"
  );

  const rollbackState = await setApWorkflowRolloutPhase({
    tenantId,
    updatedByUserId: userId,
    phase: "ROLLBACK",
    effectiveOn,
    note: "rollback",
  });
  assert(
    rollbackState.after.featureEnabled === false &&
      rollbackState.after.compatModeEnabled === true &&
      (await countAssignments(tenantId, "AP_DOCUMENT_POSTING")) === 2,
    "Rollback should disable governed AP workflow without deleting explicit AP assignments"
  );
  assert(
    (await countAssignments(tenantId, "PERIOD_CLOSE")) === 1,
    "Rollback should not disturb non-AP workflow governance"
  );

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const providerSource = await readFile(
    path.resolve(root, "backend/src/routes/provider.js"),
    "utf8"
  );
  const seedSource = await readFile(path.resolve(root, "backend/src/seed.js"), "utf8");
  const starterSource = await readFile(
    path.resolve(root, "backend/src/seedStarter.js"),
    "utf8"
  );
  const rolloutScriptSource = await readFile(
    path.resolve(root, "backend/scripts/ap-document-workflow-rollout-pr6.js"),
    "utf8"
  );
  const trackerSource = await readFile(
    path.resolve(
      root,
      "PR-STEPS/57-COUNTRY-SCOPED-AP-WORKFLOW-ROLLOUT-UAT.md"
    ),
    "utf8"
  );
  const packageSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );

  assert(
    providerSource.includes("ensureDefaultApWorkflowDefinition") &&
      seedSource.includes("ensureDefaultApWorkflowDefinition") &&
      starterSource.includes("ensureDefaultApWorkflowDefinition"),
    "Fresh-tenant bootstrap seams should seed the default AP workflow definition"
  );
  assert(
    rolloutScriptSource.includes("PILOT") &&
      rolloutScriptSource.includes("STRICT") &&
      rolloutScriptSource.includes("ROLLBACK") &&
      rolloutScriptSource.includes("Dry-run only"),
    "PR-6 rollout CLI should expose pilot/strict/rollback phases and dry-run guidance"
  );
  const requiredTrackerTokens = [
    "Pilot rollout + rollback runbook",
    "Pilot wave plan",
    "Rollback path",
    "go/no-go criteria",
    "evidence",
    "Rollout Checklist (Operational)",
  ];
  for (const token of requiredTrackerTokens) {
    assert(
      trackerSource.toLowerCase().includes(token.toLowerCase()),
      `PR-6 rollout tracker is missing token: ${token}`
    );
  }
  assert(
    packageSource.includes("\"rollout:ap-workflow:pr6\"") &&
      packageSource.includes("\"test:followup:pr6-rollout\""),
    "backend/package.json should expose the PR-6 rollout CLI and smoke alias"
  );

  console.log("CARI PR-29 AP workflow rollout + UAT smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
