import { closePool, query } from "../src/db.js";
import {
  approveWorkflowInstance,
  evaluateWorkflowApprovalGate,
} from "../src/services/workflows.service.js";
import {
  buildTaxJournalLines,
  computeTaxBreakdown,
  resolveTaxAccounts,
  resolveTaxCodeAndRule,
} from "../src/services/tax.engine.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseTenantIds(argv) {
  const parsed = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) {
      continue;
    }
    if (token.startsWith("--tenantIds=")) {
      for (const part of token.split("=")[1].split(",")) {
        const id = parsePositiveInt(part.trim());
        if (id) {
          parsed.push(id);
        }
      }
      continue;
    }
    if (token === "--tenantIds") {
      for (const part of String(argv[i + 1] || "").split(",")) {
        const id = parsePositiveInt(part.trim());
        if (id) {
          parsed.push(id);
        }
      }
      i += 1;
    }
  }
  const unique = Array.from(new Set(parsed));
  if (unique.length > 0) {
    return unique.sort((a, b) => a - b);
  }
  return [1, 2];
}

async function ensureApproverUserForTenant(tenantId) {
  const requesterRes = await query(
    `SELECT id, email, password_hash
     FROM users
     WHERE tenant_id = ?
       AND status = 'ACTIVE'
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );
  const requester = requesterRes.rows?.[0] || null;
  const requesterUserId = parsePositiveInt(requester?.id);
  assert(requesterUserId, `No ACTIVE requester user found for tenant ${tenantId}`);

  const approverEmail = `prf13.smoke.approver+${tenantId}@local.test`;
  const existingApproverRes = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, approverEmail]
  );
  let approverUserId = parsePositiveInt(existingApproverRes.rows?.[0]?.id);

  if (!approverUserId) {
    const fallbackHash =
      String(requester?.password_hash || "").trim() ||
      "$2b$10$O/zv0FuGBFOdXQMJHKb44eTTG44nhAqVNowUyM9dn49GfmGtapaj2";
    await query(
      `INSERT INTO users (tenant_id, email, password_hash, name, status)
       VALUES (?, ?, ?, ?, 'ACTIVE')`,
      [tenantId, approverEmail, fallbackHash, `PR-F13 Smoke Approver T${tenantId}`]
    );
    const createdApproverRes = await query(
      `SELECT id
       FROM users
       WHERE tenant_id = ?
         AND email = ?
       LIMIT 1`,
      [tenantId, approverEmail]
    );
    approverUserId = parsePositiveInt(createdApproverRes.rows?.[0]?.id);
  }

  assert(approverUserId, `Failed to create/resolve approver user for tenant ${tenantId}`);
  assert(
    approverUserId !== requesterUserId,
    `Approver user must differ from requester user for maker-checker (tenant ${tenantId})`
  );

  const roleRes = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = 'TenantAdmin'
     LIMIT 1`,
    [tenantId]
  );
  const roleId = parsePositiveInt(roleRes.rows?.[0]?.id);
  assert(roleId, `Missing TenantAdmin role for tenant ${tenantId}`);

  await query(
    `INSERT INTO user_role_scopes (
       tenant_id,
       user_id,
       role_id,
       scope_type,
       scope_id,
       effect
     )
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
     ON DUPLICATE KEY UPDATE
       effect = VALUES(effect)`,
    [tenantId, approverUserId, roleId, tenantId]
  );

  return {
    requesterUserId,
    approverUserId,
    approverEmail,
  };
}

async function createTempPeriodCloseRun(tenantId, requesterUserId) {
  const bookRes = await query(
    `SELECT
       b.id AS book_id,
       b.calendar_id,
       le.id AS legal_entity_id,
       le.group_company_id
     FROM books b
     JOIN legal_entities le ON le.id = b.legal_entity_id
     WHERE b.tenant_id = ?
     ORDER BY b.id ASC
     LIMIT 1`,
    [tenantId]
  );
  const book = bookRes.rows?.[0] || null;
  const bookId = parsePositiveInt(book?.book_id);
  const calendarId = parsePositiveInt(book?.calendar_id);
  const legalEntityId = parsePositiveInt(book?.legal_entity_id);
  const groupCompanyId = parsePositiveInt(book?.group_company_id);
  assert(bookId && calendarId && legalEntityId, `Missing book/calendar/legalEntity for tenant ${tenantId}`);

  const periodRes = await query(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
     ORDER BY fiscal_year DESC, period_no DESC, id DESC
     LIMIT 1`,
    [calendarId]
  );
  const fiscalPeriodId = parsePositiveInt(periodRes.rows?.[0]?.id);
  assert(fiscalPeriodId, `Missing fiscal period for calendar ${calendarId}`);

  const insertRes = await query(
    `INSERT INTO period_close_runs (
       tenant_id,
       book_id,
       fiscal_period_id,
       run_hash,
       close_status,
       status,
       year_end_closed,
       source_journal_count,
       source_debit_total,
       source_credit_total,
       started_by_user_id,
       note
     )
     VALUES (
       ?,
       ?,
       ?,
       SHA2(CONCAT('PRF13_OP_SMOKE_', UUID()), 256),
       'SOFT_CLOSED',
       'IN_PROGRESS',
       FALSE,
       0,
       0,
       0,
       ?,
       'PRF13_OP_SMOKE_TMP'
     )`,
    [tenantId, bookId, fiscalPeriodId, requesterUserId]
  );

  const runId = parsePositiveInt(insertRes.rows?.insertId);
  assert(runId, `Failed to create period_close_run for tenant ${tenantId}`);
  return {
    runId,
    legalEntityId,
    groupCompanyId,
  };
}

async function createTempConsolidationRun(tenantId, requesterUserId) {
  const groupRes = await query(
    `SELECT
       cg.id AS consolidation_group_id,
       cg.group_company_id,
       cg.calendar_id,
       cg.presentation_currency_code
     FROM consolidation_groups cg
     WHERE cg.tenant_id = ?
       AND cg.status = 'ACTIVE'
     ORDER BY cg.id ASC
     LIMIT 1`,
    [tenantId]
  );
  const group = groupRes.rows?.[0] || null;
  const consolidationGroupId = parsePositiveInt(group?.consolidation_group_id);
  const groupCompanyId = parsePositiveInt(group?.group_company_id);
  const calendarId = parsePositiveInt(group?.calendar_id);
  const presentationCurrencyCode = String(group?.presentation_currency_code || "").trim();
  assert(consolidationGroupId && groupCompanyId && calendarId, `Missing active consolidation group for tenant ${tenantId}`);
  assert(presentationCurrencyCode, `Missing presentation currency for consolidation group ${consolidationGroupId}`);

  const periodRes = await query(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
     ORDER BY fiscal_year DESC, period_no DESC, id DESC
     LIMIT 1`,
    [calendarId]
  );
  const fiscalPeriodId = parsePositiveInt(periodRes.rows?.[0]?.id);
  assert(fiscalPeriodId, `Missing fiscal period for consolidation calendar ${calendarId}`);

  const runName = `PRF13_OP_SMOKE_T${tenantId}_${Date.now()}`;
  const insertRes = await query(
    `INSERT INTO consolidation_runs (
       consolidation_group_id,
       fiscal_period_id,
       run_name,
       status,
       presentation_currency_code,
       started_by_user_id,
       notes
     )
     VALUES (?, ?, ?, 'DRAFT', ?, ?, 'PRF13_OP_SMOKE_TMP')`,
    [consolidationGroupId, fiscalPeriodId, runName, presentationCurrencyCode, requesterUserId]
  );
  const runId = parsePositiveInt(insertRes.rows?.insertId);
  assert(runId, `Failed to create consolidation_run for tenant ${tenantId}`);
  return {
    runId,
    groupCompanyId,
  };
}

async function approveGateToCompletion({
  tenantId,
  processType,
  targetType,
  targetId,
  scope,
  requesterUserId,
  approverUserId,
}) {
  const initialGate = await evaluateWorkflowApprovalGate({
    tenantId,
    processType,
    targetType,
    targetId,
    requestedByUserId: requesterUserId,
    scope,
  });
  assert(initialGate.enabled, `Workflow gate not enabled for tenant ${tenantId} ${processType}`);
  assert(initialGate.required, `Workflow gate not required for tenant ${tenantId} ${processType}`);
  const instanceId = parsePositiveInt(initialGate?.instance?.id);
  assert(instanceId, `Missing workflow instance for tenant ${tenantId} ${processType}`);

  let approved = false;
  let stepCount = 0;
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const decision = await approveWorkflowInstance({
      req: { user: { tenantId, userId: approverUserId } },
      input: {
        tenantId,
        instanceId,
        userId: approverUserId,
        decisionNote: `PR-F13 operational smoke approve step ${i + 1}`,
      },
      assertScopeAccess: () => {},
    });
    stepCount = decision?.decisions?.length || stepCount;
    if (String(decision?.row?.status || "").toUpperCase() === "APPROVED") {
      approved = true;
      break;
    }
  }
  assert(approved, `Failed to approve workflow instance ${instanceId} for tenant ${tenantId}`);

  const finalGate = await evaluateWorkflowApprovalGate({
    tenantId,
    processType,
    targetType,
    targetId,
    requestedByUserId: requesterUserId,
    scope,
  });
  assert(finalGate.approved, `Final workflow gate check not approved for tenant ${tenantId} ${processType}`);

  return {
    instanceId,
    stepCount,
  };
}

async function runTaxPipelineSmoke({ tenantId, legalEntityId }) {
  const postingDate = new Date().toISOString().slice(0, 10);
  const resolved = await resolveTaxCodeAndRule({
    tenantId,
    legalEntityId,
    postingDate,
    moduleCode: "CARI",
    taxCode: "VAT8",
    documentType: "INVOICE",
    counterpartyType: "CUSTOMER",
  });
  const breakdown = computeTaxBreakdown({
    baseAmount: 1000,
    mode: resolved.computation.calculationMode,
    ratePct: resolved.computation.ratePct,
    recoverability: resolved.computation.recoverability,
    recoverablePct: resolved.computation.recoverablePct,
  });
  const accounts = await resolveTaxAccounts({
    tenantId,
    legalEntityId,
    taxCodeId: parsePositiveInt(resolved.taxCodeRow?.id),
    taxRegimeId: parsePositiveInt(resolved.regimeRow?.id),
    direction: "SALE",
  });
  const lines = buildTaxJournalLines({
    breakdown,
    taxCode: resolved.taxCodeRow?.code,
    taxPurposeCode: accounts.taxPurposeCode,
    mappingRow: accounts.mappingRow,
    direction: "SALE",
    currencyCode: "USD",
  });
  assert(Array.isArray(lines) && lines.length === 1, `Expected one tax journal line for tenant ${tenantId}`);
  assert(
    Number(lines[0]?.creditBase || 0) > 0,
    `Expected SALE tax journal line creditBase > 0 for tenant ${tenantId}`
  );
  return {
    postingDate,
    taxCode: resolved.taxCodeRow?.code,
    taxPurposeCode: accounts.taxPurposeCode,
    taxAmount: breakdown.taxAmount,
  };
}

async function cleanupSmokeArtifacts(tenantId, periodCloseRunIds, consolidationRunIds, workflowInstanceIds) {
  for (const instanceId of workflowInstanceIds) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE wid
       FROM workflow_instance_decisions wid
       JOIN workflow_instances wi ON wi.id = wid.workflow_instance_id
       WHERE wi.tenant_id = ?
         AND wi.id = ?`,
      [tenantId, instanceId]
    );
    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE FROM workflow_instances
       WHERE tenant_id = ?
         AND id = ?`,
      [tenantId, instanceId]
    );
  }

  for (const runId of periodCloseRunIds) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE FROM period_close_runs
       WHERE tenant_id = ?
         AND id = ?`,
      [tenantId, runId]
    );
  }

  for (const runId of consolidationRunIds) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE cr
       FROM consolidation_runs cr
       JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
       WHERE cg.tenant_id = ?
         AND cr.id = ?`,
      [tenantId, runId]
    );
  }
}

async function runTenantSmoke(tenantId) {
  const periodCloseRunIds = [];
  const consolidationRunIds = [];
  const workflowInstanceIds = [];

  try {
    const users = await ensureApproverUserForTenant(tenantId);

    const periodClose = await createTempPeriodCloseRun(tenantId, users.requesterUserId);
    periodCloseRunIds.push(periodClose.runId);
    const periodGate = await approveGateToCompletion({
      tenantId,
      processType: "PERIOD_CLOSE",
      targetType: "PERIOD_CLOSE_RUN",
      targetId: periodClose.runId,
      scope: {
        legalEntityId: periodClose.legalEntityId,
        groupCompanyId: periodClose.groupCompanyId,
      },
      requesterUserId: users.requesterUserId,
      approverUserId: users.approverUserId,
    });
    workflowInstanceIds.push(periodGate.instanceId);

    const consolidation = await createTempConsolidationRun(tenantId, users.requesterUserId);
    consolidationRunIds.push(consolidation.runId);
    const consolidationGate = await approveGateToCompletion({
      tenantId,
      processType: "CONSOLIDATION_RUN",
      targetType: "CONSOLIDATION_RUN",
      targetId: consolidation.runId,
      scope: {
        groupCompanyId: consolidation.groupCompanyId,
      },
      requesterUserId: users.requesterUserId,
      approverUserId: users.approverUserId,
    });
    workflowInstanceIds.push(consolidationGate.instanceId);

    const tax = await runTaxPipelineSmoke({
      tenantId,
      legalEntityId: periodClose.legalEntityId,
    });

    return {
      tenantId,
      requesterUserId: users.requesterUserId,
      approverUserId: users.approverUserId,
      periodClose: {
        runId: periodClose.runId,
        workflowInstanceId: periodGate.instanceId,
        approvedStepCount: periodGate.stepCount,
      },
      consolidation: {
        runId: consolidation.runId,
        workflowInstanceId: consolidationGate.instanceId,
        approvedStepCount: consolidationGate.stepCount,
      },
      tax,
    };
  } finally {
    await cleanupSmokeArtifacts(
      tenantId,
      periodCloseRunIds,
      consolidationRunIds,
      workflowInstanceIds
    );
  }
}

async function main() {
  const tenantIds = parseTenantIds(process.argv.slice(2));
  const results = [];
  for (const tenantId of tenantIds) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runTenantSmoke(tenantId);
    results.push(result);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        tenantIds,
        smoke: results,
      },
      null,
      2
    )
  );
  console.log(
    `PR-F13 operational smoke passed (workflow-gated period close + consolidation and tax pipeline) for tenants: ${tenantIds.join(
      ", "
    )}.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
