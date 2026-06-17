import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  ensureDefaultApWorkflowDefinition,
  evaluateApWorkflowLegalEntityCoverage,
  getApWorkflowRolloutState,
  DEFAULT_AP_WORKFLOW_DEFINITION_CODE,
} from "../src/services/ap.document.workflow.rollout.service.js";
import { PERIOD_CLOSE_APPROVE_PERMISSION_CODE } from "../../shared/periodCloseGovernance.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
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
     VALUES (?, 1, 'GROUP', ?, 1, FALSE, NULL)`,
    [definitionId, PERIOD_CLOSE_APPROVE_PERMISSION_CODE]
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
      seededDefinition.stepScopeTypes.length === 3 &&
      seededDefinition.stepScopeTypes[0] === "OPERATING_UNIT" &&
      seededDefinition.stepScopeTypes[1] === "COUNTRY" &&
      seededDefinition.stepScopeTypes[2] === "COUNTRY",
    "Default AP workflow seed should create the expected branch submit and country approval/post chain"
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
    `SELECT action_code, stage_scope_type, required_permission_code
     FROM workflow_definition_steps
     WHERE workflow_definition_id = ?
     ORDER BY step_no ASC`,
    [seededDefinition.definitionId]
  );
  assert(
    (stepRows.rows || []).length === 3 &&
      String(stepRows.rows[0]?.action_code || "").toUpperCase() === "SUBMIT" &&
      String(stepRows.rows[0]?.stage_scope_type || "").toUpperCase() ===
        "OPERATING_UNIT" &&
      String(stepRows.rows[0]?.required_permission_code || "") === "cari.doc.submit" &&
      String(stepRows.rows[1]?.action_code || "").toUpperCase() === "APPROVE" &&
      String(stepRows.rows[1]?.stage_scope_type || "").toUpperCase() === "COUNTRY" &&
      String(stepRows.rows[1]?.required_permission_code || "") ===
        "approvals.requests.approve" &&
      String(stepRows.rows[2]?.action_code || "").toUpperCase() === "POST" &&
      String(stepRows.rows[2]?.stage_scope_type || "").toUpperCase() === "COUNTRY" &&
      String(stepRows.rows[2]?.required_permission_code || "") === "cari.doc.post",
    "Default AP workflow seed should keep the explicit branch AP action chain"
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
    initialState.defaultDefinition.definitionId === seededDefinition.definitionId &&
      !Object.hasOwn(initialState, "featureEnabled") &&
      !Object.hasOwn(initialState, "compatModeEnabled") &&
      initialState.coverage.coveredCount === 0 &&
      initialState.coverage.uncoveredCount === 3,
    "Fresh tenant coverage state should expose the seeded definition and show all legal entities uncovered without tenant feature flags"
  );
  assert(
    (await countAssignments(tenantId, "PERIOD_CLOSE")) === 1,
    "AP setup helpers must not disturb existing PERIOD_CLOSE assignments"
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
  const configuredState = await getApWorkflowRolloutState({
    tenantId,
    effectiveOn,
  });
  assert(
    configuredState.coverage.coveredCount === 3 &&
      configuredState.coverage.uncoveredCount === 0 &&
      configuredState.defaultDefinition.definitionId === seededDefinition.definitionId &&
      (await countAssignments(tenantId, "AP_DOCUMENT_POSTING")) === 2,
    "Coverage state should reflect the explicit AP assignments without any phase toggles"
  );
  assert(
    (await countAssignments(tenantId, "PERIOD_CLOSE")) === 1,
    "Explicit AP assignment rollout should not disturb non-AP workflow governance"
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
  const rolloutServiceSource = await readFile(
    path.resolve(root, "backend/src/services/ap.document.workflow.rollout.service.js"),
    "utf8"
  );
  const workflowSetupPageSource = await readFile(
    path.resolve(root, "frontend/src/pages/settings/WorkflowSetupPage.jsx"),
    "utf8"
  );
  const routingMatrixSource = await readFile(
    path.resolve(
      root,
      "frontend/src/pages/settings/workflows/components/ApprovalRoutingMatrixSection.jsx"
    ),
    "utf8"
  );
  const roadmapSource = await readFile(
    path.resolve(
      root,
      "PR-STEPS/57-COUNTRY-SCOPED-WORKFLOW-ASSIGNMENTS-AND-AP-DOCUMENT-APPROVAL-ROADMAP.md"
    ),
    "utf8"
  );
  const packageSource = await readFile(
    path.resolve(root, "backend/package.json"),
    "utf8"
  );
  const rolloutCliPath = path.resolve(root, "backend/scripts/ap-document-workflow-rollout-pr6.js");

  assert(
    !providerSource.includes("ensureDefaultApWorkflowDefinition") &&
      !seedSource.includes("ensureDefaultApWorkflowDefinition") &&
      !starterSource.includes("ensureDefaultApWorkflowDefinition"),
    "Fresh-tenant bootstrap seams should not auto-seed the AP workflow definition"
  );
  assert(
    rolloutServiceSource.includes("ensureDefaultApWorkflowDefinition") &&
      rolloutServiceSource.includes("evaluateApWorkflowLegalEntityCoverage") &&
      !rolloutServiceSource.includes("setApWorkflowRolloutPhase") &&
      !rolloutServiceSource.includes("AP_WORKFLOW_ROLLOUT_PHASES"),
    "AP workflow setup service should keep definition/coverage helpers and drop phase-based rollout APIs"
  );
  assert(
    !routingMatrixSource.includes('SelectItem value="preset"') &&
      !routingMatrixSource.includes("Choose a shipped AP preset") &&
      workflowSetupPageSource.includes(
        "AP routing matrix routes must use an existing workflow definition."
      ) &&
      !workflowSetupPageSource.includes("Preset-backed workflow definition could not be created."),
    "AP routing matrix should stay definition-only and should not create preset-backed AP workflows"
  );
  assert(
    !(await pathExists(rolloutCliPath)),
    "Legacy AP rollout CLI should be removed in the pure ERP model"
  );
  const requiredRoadmapTokens = [
    "pure ERP governance model",
    "assignment presence IS the rollout switch",
    "default-definition seeding and coverage helpers",
    "remove the phase-based rollout CLI script",
    "remove both flag constants from the shared module and features catalog",
  ];
  for (const token of requiredRoadmapTokens) {
    assert(
      roadmapSource.toLowerCase().includes(token.toLowerCase()),
      `PR-6 roadmap is missing token: ${token}`
    );
  }
  assert(
    !packageSource.includes("\"rollout:ap-workflow:pr6\"") &&
      packageSource.includes("\"test:followup:pr6-rollout\""),
    "backend/package.json should drop the deleted rollout CLI while keeping the PR-6 smoke alias"
  );

  console.log("CARI PR-29 AP workflow setup + coverage smoke passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
