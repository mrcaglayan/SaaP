import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  approveWorkflowInstance,
  createWorkflowAssignment,
  createWorkflowDefinition,
  ensureUnifiedWorkflowPolicyForDefinition,
  evaluateWorkflowApprovalGate,
  replaceWorkflowDefinitionSteps,
  resolveWorkflowDecisionPermissionAccess,
} from "../src/services/workflows.service.js";
import {
  PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
  PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
  PERIOD_CLOSE_READINESS_PERMISSION_CODE,
  PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
} from "../../shared/periodCloseGovernance.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function noScopeGuard() {
  return true;
}

async function expectBadRequest(asyncFn, expectedMessageFragment) {
  let thrown = null;
  try {
    await asyncFn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, "Expected workflow write to throw");
  assert(Number(thrown?.status || 0) === 400, "Expected badRequest status 400");
  if (expectedMessageFragment) {
    assert(
      String(thrown?.message || "").includes(expectedMessageFragment),
      `Expected error message to include: ${expectedMessageFragment}`
    );
  }
}

async function createTenantFixture(stamp) {
  const tenantCode = `PR3E_T_${stamp}`;
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `PR3E Tenant ${stamp}`]
  );
  const tenantResult = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantResult.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to create PR-3E tenant");

  const countryResult = await query(
    `SELECT id, default_currency_code
       FROM countries
      WHERE iso2 = 'TR'
      LIMIT 1`
  );
  const countryId = toNumber(countryResult.rows?.[0]?.id);
  const currencyCode = String(countryResult.rows?.[0]?.default_currency_code || "TRY");
  assert(countryId > 0, "Missing country seed row for TR");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `PR3E_G_${stamp}`, `PR3E Group ${stamp}`]
  );
  const groupResult = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR3E_G_${stamp}`]
  );
  const groupCompanyId = toNumber(groupResult.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Failed to create PR-3E group company");

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
      `PR3E_LE_${stamp}`,
      `PR3E Legal Entity ${stamp}`,
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
    [tenantId, `PR3E_LE_${stamp}`]
  );
  const legalEntityId = toNumber(legalEntityResult.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create PR-3E legal entity");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
      ) VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `PR3E_CAL_${stamp}`, `PR3E Calendar ${stamp}`]
  );
  const calendarResult = await query(
    `SELECT id
       FROM fiscal_calendars
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR3E_CAL_${stamp}`]
  );
  const calendarId = toNumber(calendarResult.rows?.[0]?.id);
  assert(calendarId > 0, "Failed to create PR-3E calendar");

  await query(
    `INSERT INTO fiscal_periods (
        calendar_id,
        fiscal_year,
        period_no,
        period_name,
        start_date,
        end_date,
        is_adjustment
      ) VALUES
        (?, 2026, 3, 'Mar 2026', '2026-03-01', '2026-03-31', FALSE),
        (?, 2026, 4, 'Apr 2026', '2026-04-01', '2026-04-30', FALSE)`,
    [calendarId, calendarId]
  );
  const periodRows = await query(
    `SELECT id, period_no
       FROM fiscal_periods
      WHERE calendar_id = ?
      ORDER BY period_no ASC`,
    [calendarId]
  );
  const fiscalPeriodId = toNumber(
    periodRows.rows?.find((row) => Number(row.period_no) === 3)?.id
  );
  const nextFiscalPeriodId = toNumber(
    periodRows.rows?.find((row) => Number(row.period_no) === 4)?.id
  );
  assert(fiscalPeriodId > 0 && nextFiscalPeriodId > 0, "Failed to create fiscal periods");

  await query(
    `INSERT INTO books (
        tenant_id,
        legal_entity_id,
        calendar_id,
        code,
        name,
        book_type,
        base_currency_code
      ) VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)`,
    [
      tenantId,
      legalEntityId,
      calendarId,
      `PR3E_BOOK_${stamp}`,
      `PR3E Book ${stamp}`,
      currencyCode,
    ]
  );
  const bookResult = await query(
    `SELECT id
       FROM books
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR3E_BOOK_${stamp}`]
  );
  const bookId = toNumber(bookResult.rows?.[0]?.id);
  assert(bookId > 0, "Failed to create PR-3E book");

  return {
    tenantId,
    groupCompanyId,
    legalEntityId,
    bookId,
    fiscalPeriodId,
    nextFiscalPeriodId,
  };
}

async function createUser({ tenantId, email, name, passwordHash }) {
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
  const userId = toNumber(result.rows?.[0]?.id);
  assert(userId > 0, `Failed to create user ${email}`);
  return userId;
}

async function assignRole({ tenantId, userId, roleCode }) {
  const roleResult = await query(
    `SELECT id
       FROM roles
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = toNumber(roleResult.rows?.[0]?.id);
  assert(roleId > 0, `Role ${roleCode} not found`);
  await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
      ) VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
      ON DUPLICATE KEY UPDATE
        effect = VALUES(effect)`,
    [tenantId, userId, roleId, tenantId]
  );
}

async function enableWorkflowFeature(tenantId) {
  await query(
    `INSERT INTO tenant_features (
        tenant_id,
        feature_code,
        is_enabled
      ) VALUES (?, 'FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1', 1)
      ON DUPLICATE KEY UPDATE
        is_enabled = VALUES(is_enabled)`,
    [tenantId]
  );
}

async function createPeriodCloseRun({
  tenantId,
  bookId,
  fiscalPeriodId,
  nextFiscalPeriodId,
  userId,
  stamp,
}) {
  await query(
    `INSERT INTO period_close_runs (
        tenant_id,
        book_id,
        fiscal_period_id,
        next_fiscal_period_id,
        run_hash,
        close_status,
        status,
        year_end_closed,
        source_journal_count,
        source_debit_total,
        source_credit_total,
        started_by_user_id,
        note
      ) VALUES (?, ?, ?, ?, ?, 'SOFT_CLOSED', 'IN_PROGRESS', FALSE, 0, 0, 0, ?, ?)`,
    [
      tenantId,
      bookId,
      fiscalPeriodId,
      nextFiscalPeriodId,
      `pr3e-${stamp}-hash`,
      userId,
      "PR-3E smoke",
    ]
  );
  const result = await query(
    `SELECT id
       FROM period_close_runs
      WHERE tenant_id = ?
        AND book_id = ?
        AND fiscal_period_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [tenantId, bookId, fiscalPeriodId]
  );
  const runId = toNumber(result.rows?.[0]?.id);
  assert(runId > 0, "Failed to create PR-3E period close run");
  return runId;
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createTenantFixture(stamp);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash("PR3E#Smoke123", 10);
  const requesterUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3e_requester_${stamp}@example.com`,
    name: "PR3E Requester",
    passwordHash,
  });
  const approverUserId = await createUser({
    tenantId: fixture.tenantId,
    email: `pr3e_approver_${stamp}@example.com`,
    name: "PR3E Approver",
    passwordHash,
  });
  await assignRole({
    tenantId: fixture.tenantId,
    userId: approverUserId,
    roleCode: "GLOperator",
  });
  await assignRole({
    tenantId: fixture.tenantId,
    userId: approverUserId,
    roleCode: "PeriodCloseSupervisorAuthority",
  });
  await enableWorkflowFeature(fixture.tenantId);

  const definition = await createWorkflowDefinition({
    input: {
      tenantId: fixture.tenantId,
      userId: requesterUserId,
      code: `WF_PR3E_${stamp}`,
      name: "PR-3E Workflow Bridge Test",
      processType: "PERIOD_CLOSE",
      isActive: true,
      versionNo: 2,
    },
  });
  assert(toNumber(definition.id) > 0, "Workflow definition creation failed");

  const stepRows = await replaceWorkflowDefinitionSteps({
    input: {
      tenantId: fixture.tenantId,
      userId: requesterUserId,
      definitionId: definition.id,
      steps: [
        {
          stepNo: 1,
          stageScopeType: "LEGAL_ENTITY",
          requiredPermissionCode: PERIOD_CLOSE_READINESS_PERMISSION_CODE,
          minApproverCount: 1,
          allowSelfApprove: false,
          escalationAfterHours: 12,
        },
        {
          stepNo: 2,
          stageScopeType: "GROUP",
          requiredPermissionCode: PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
          minApproverCount: 1,
          allowSelfApprove: false,
          escalationAfterHours: 24,
        },
      ],
    },
  });
  assert(stepRows.length === 2, "Expected two workflow definition steps");

  for (const invalidPermissionCode of [
    PERIOD_CLOSE_EXECUTE_PERMISSION_CODE,
    PERIOD_CLOSE_REOPEN_PERMISSION_CODE,
    PERIOD_CLOSE_ADMIN_PERMISSION_CODE,
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await expectBadRequest(
      () =>
        replaceWorkflowDefinitionSteps({
          input: {
            tenantId: fixture.tenantId,
            userId: requesterUserId,
            definitionId: definition.id,
            steps: [
              {
                stepNo: 1,
                stageScopeType:
                  invalidPermissionCode === PERIOD_CLOSE_ADMIN_PERMISSION_CODE
                    ? "COUNTRY"
                    : "LEGAL_ENTITY",
                requiredPermissionCode: invalidPermissionCode,
                minApproverCount: 1,
                allowSelfApprove: false,
                escalationAfterHours: 12,
              },
            ],
          },
        }),
      "requiredPermissionCode must be one of"
    );
  }

  await expectBadRequest(
    () =>
      replaceWorkflowDefinitionSteps({
        input: {
          tenantId: fixture.tenantId,
          userId: requesterUserId,
          definitionId: definition.id,
          steps: [
            {
              stepNo: 1,
              stageScopeType: "LEGAL_ENTITY",
              requiredPermissionCode: PERIOD_CLOSE_READINESS_PERMISSION_CODE,
              minApproverCount: 1,
              allowSelfApprove: false,
              escalationAfterHours: 12,
            },
          ],
        },
    }),
    `must contain at least one ${PERIOD_CLOSE_APPROVE_PERMISSION_CODE} step`
  );

  const consolidationDefinition = await createWorkflowDefinition({
    input: {
      tenantId: fixture.tenantId,
      userId: requesterUserId,
      code: `WF_PR3E_CONS_${stamp}`,
      name: "PR-3E Consolidation Scope Contract Test",
      processType: "CONSOLIDATION_RUN",
      isActive: true,
      versionNo: 1,
    },
  });
  assert(
    toNumber(consolidationDefinition.id) > 0,
    "Consolidation workflow definition creation failed"
  );

  const consolidationStepRows = await replaceWorkflowDefinitionSteps({
    input: {
      tenantId: fixture.tenantId,
      userId: requesterUserId,
      definitionId: consolidationDefinition.id,
      steps: [
        {
          stepNo: 1,
          stageScopeType: "LEGAL_ENTITY",
          requiredPermissionCode: "consolidation.run.create",
          minApproverCount: 1,
          allowSelfApprove: false,
          escalationAfterHours: 12,
        },
        {
          stepNo: 2,
          stageScopeType: "GROUP",
          requiredPermissionCode: "consolidation.run.finalize",
          minApproverCount: 1,
          allowSelfApprove: false,
          escalationAfterHours: 24,
        },
      ],
    },
  });
  assert(
    consolidationStepRows.length === 2,
    "Consolidation workflow should accept Legal Entity preparation plus Group finalization steps"
  );

  await expectBadRequest(
    () =>
      replaceWorkflowDefinitionSteps({
        input: {
          tenantId: fixture.tenantId,
          userId: requesterUserId,
          definitionId: consolidationDefinition.id,
          steps: [
            {
              stepNo: 1,
              stageScopeType: "COUNTRY",
              requiredPermissionCode: "consolidation.run.create",
              minApproverCount: 1,
              allowSelfApprove: false,
              escalationAfterHours: 12,
            },
          ],
        },
      }),
    "stageScopeType COUNTRY is not allowed for consolidation.run.create"
  );

  await createWorkflowAssignment({
    req: null,
    input: {
      tenantId: fixture.tenantId,
      userId: requesterUserId,
      processType: "PERIOD_CLOSE",
      workflowDefinitionId: definition.id,
      groupCompanyId: fixture.groupCompanyId,
      legalEntityId: null,
      operatingUnitId: null,
      effectiveFrom: "2026-03-01",
      effectiveTo: "2026-12-31",
      status: "ACTIVE",
    },
    assertScopeAccess: noScopeGuard,
  });

  await ensureUnifiedWorkflowPolicyForDefinition({
    tenantId: fixture.tenantId,
    definitionId: definition.id,
  });

  const definitionMirror = await query(
    `SELECT generic_policy_id
       FROM workflow_definitions
      WHERE tenant_id = ?
        AND id = ?`,
    [fixture.tenantId, definition.id]
  );
  const genericPolicyId = toNumber(definitionMirror.rows?.[0]?.generic_policy_id);
  assert(genericPolicyId > 0, "Workflow definition should mirror into approval_policies");

  const policyStepRows = await query(
    `SELECT step_no, scope_resolution_mode
       FROM approval_policy_steps
      WHERE tenant_id = ?
        AND policy_id = ?
      ORDER BY step_no ASC`,
    [fixture.tenantId, genericPolicyId]
  );
  assert(
    String(policyStepRows.rows?.[0]?.scope_resolution_mode || "").toUpperCase() ===
      "TARGET_LEGAL_ENTITY",
    "Step 1 should mirror as TARGET_LEGAL_ENTITY"
  );
  assert(
    String(policyStepRows.rows?.[1]?.scope_resolution_mode || "").toUpperCase() ===
      "TARGET_GROUP",
    "Step 2 should mirror as TARGET_GROUP"
  );

  const mirroredAssignments = await query(
    `SELECT scope_type, scope_id, effective_from, effective_to
       FROM approval_policy_assignments
      WHERE tenant_id = ?
        AND policy_id = ?`,
    [fixture.tenantId, genericPolicyId]
  );
  assert(
    String(mirroredAssignments.rows?.[0]?.scope_type || "").toUpperCase() === "GROUP",
    "Workflow assignment should mirror as GROUP scope"
  );
  assert(
    String(mirroredAssignments.rows?.[0]?.effective_from || "").slice(0, 10) ===
      "2026-03-01",
    "Workflow assignment effective_from should be mirrored"
  );

  const runId = await createPeriodCloseRun({
    tenantId: fixture.tenantId,
    bookId: fixture.bookId,
    fiscalPeriodId: fixture.fiscalPeriodId,
    nextFiscalPeriodId: fixture.nextFiscalPeriodId,
    userId: requesterUserId,
    stamp,
  });

  const initialGate = await evaluateWorkflowApprovalGate({
    tenantId: fixture.tenantId,
    processType: "PERIOD_CLOSE",
    targetType: "PERIOD_CLOSE_RUN",
    targetId: runId,
    requestedByUserId: requesterUserId,
    scope: {
      legalEntityId: fixture.legalEntityId,
      groupCompanyId: fixture.groupCompanyId,
    },
    effectiveOn: "2026-03-31",
  });
  assert(initialGate.required === true, "Workflow gate should require approval");
  const workflowInstanceId = toNumber(initialGate.instance?.id);
  assert(workflowInstanceId > 0, "Workflow instance should be created");
  const genericRequestId = toNumber(initialGate.instance?.genericRequestId);
  assert(genericRequestId > 0, "Workflow instance should bridge to approval_requests");

  const firstAccess = await resolveWorkflowDecisionPermissionAccess({
    tenantId: fixture.tenantId,
    instanceId: workflowInstanceId,
  });
  assert(
    firstAccess.requiredPermissionCode === PERIOD_CLOSE_READINESS_PERMISSION_CODE,
    "First workflow step should require org.fiscal_period.read"
  );
  assert(
    String(firstAccess.scope.scopeType || "").toUpperCase() === "LEGAL_ENTITY" &&
      toNumber(firstAccess.scope.scopeId) === fixture.legalEntityId,
    "First workflow step should resolve decision scope at legal entity"
  );

  const firstDecision = await approveWorkflowInstance({
    req: { user: { tenantId: fixture.tenantId, userId: approverUserId } },
    input: {
      tenantId: fixture.tenantId,
      instanceId: workflowInstanceId,
      userId: approverUserId,
      decisionNote: "Approve legal-entity stage",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(firstDecision?.row?.status || "").toUpperCase() === "PENDING",
    "Workflow should remain pending after first step"
  );
  assert(
    Number(firstDecision?.row?.currentStepNo || 0) === 2,
    "Workflow should advance to step 2 after first approval"
  );

  const secondAccess = await resolveWorkflowDecisionPermissionAccess({
    tenantId: fixture.tenantId,
    instanceId: workflowInstanceId,
  });
  assert(
    secondAccess.requiredPermissionCode === PERIOD_CLOSE_APPROVE_PERMISSION_CODE,
    "Second workflow step should require gl.period.close.approve"
  );
  assert(
    String(secondAccess.scope.scopeType || "").toUpperCase() === "GROUP" &&
      toNumber(secondAccess.scope.scopeId) === fixture.groupCompanyId,
    "Second workflow step should resolve decision scope at group"
  );

  const finalDecision = await approveWorkflowInstance({
    req: { user: { tenantId: fixture.tenantId, userId: approverUserId } },
    input: {
      tenantId: fixture.tenantId,
      instanceId: workflowInstanceId,
      userId: approverUserId,
      decisionNote: "Approve group stage",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(finalDecision?.row?.status || "").toUpperCase() === "APPROVED",
    "Workflow should be approved after final step"
  );

  const genericRequest = await query(
    `SELECT request_status, current_step_no
       FROM approval_requests
      WHERE tenant_id = ?
        AND id = ?`,
    [fixture.tenantId, genericRequestId]
  );
  assert(
    String(genericRequest.rows?.[0]?.request_status || "").toUpperCase() === "APPROVED",
    "Generic workflow request should become APPROVED"
  );
  assert(
    toNumber(genericRequest.rows?.[0]?.current_step_no) === 2,
    "Generic workflow request should preserve the final current_step_no"
  );

  const decisionCounts = await query(
    `SELECT
        (SELECT COUNT(*)
           FROM workflow_instance_decisions
          WHERE workflow_instance_id = ?) AS legacy_count,
        (SELECT COUNT(*)
           FROM approval_decisions
          WHERE tenant_id = ?
            AND request_id = ?) AS generic_count`,
    [workflowInstanceId, fixture.tenantId, genericRequestId]
  );
  assert(
    toNumber(decisionCounts.rows?.[0]?.legacy_count) === 2,
    "Legacy workflow decisions should stay synchronized"
  );
  assert(
    toNumber(decisionCounts.rows?.[0]?.generic_count) === 2,
    "Generic approval decisions should be recorded for both workflow steps"
  );

  console.log(
    "PR-3E smoke test passed (workflow definition/assignment mirror + bridged workflow instance delegation)."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
