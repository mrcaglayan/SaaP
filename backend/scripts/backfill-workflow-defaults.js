import { closePool, query, withTransaction } from "../src/db.js";
import { ensureUnifiedWorkflowPolicyForDefinition } from "../src/services/workflows.service.js";

const PROCESS_DEFAULTS = Object.freeze([
  {
    processType: "PERIOD_CLOSE",
    definitionCode: "WF_STD_PERIOD_CLOSE_V1",
    definitionName: "Standard Period Close Approval Chain",
    requiredPermissionCode: "gl.period.close",
    steps: Object.freeze([
      Object.freeze({
        stageScopeType: "LEGAL_ENTITY",
        escalationAfterHours: 24,
      }),
      Object.freeze({
        stageScopeType: "GROUP",
        escalationAfterHours: 48,
      }),
    ]),
  },
  {
    processType: "CONSOLIDATION_RUN",
    definitionCode: "WF_STD_CONSOLIDATION_RUN_V1",
    definitionName: "Standard Consolidation Run Approval Chain",
    requiredPermissionCode: "consolidation.run.finalize",
    steps: Object.freeze([
      Object.freeze({
        stageScopeType: "GROUP",
        escalationAfterHours: 24,
      }),
    ]),
  },
]);

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseDateOnly(value, fallbackDate) {
  if (!value) {
    return fallbackDate;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return fallbackDate;
  }
  return normalized;
}

function parseArgs(argv) {
  const today = new Date().toISOString().slice(0, 10);
  const args = {
    tenantId: null,
    groupCompanyId: null,
    createdByUserId: null,
    effectiveFrom: today,
    limit: null,
    apply: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) {
      continue;
    }
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token.startsWith("--tenantId=")) {
      args.tenantId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--tenantId") {
      args.tenantId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--groupCompanyId=")) {
      args.groupCompanyId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--groupCompanyId") {
      args.groupCompanyId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--createdByUserId=")) {
      args.createdByUserId = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--createdByUserId") {
      args.createdByUserId = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--effectiveFrom=")) {
      args.effectiveFrom = parseDateOnly(token.split("=")[1], args.effectiveFrom);
      continue;
    }
    if (token === "--effectiveFrom") {
      args.effectiveFrom = parseDateOnly(argv[i + 1], args.effectiveFrom);
      i += 1;
      continue;
    }
    if (token.startsWith("--limit=")) {
      args.limit = parsePositiveIntOrNull(token.split("=")[1]);
      continue;
    }
    if (token === "--limit") {
      args.limit = parsePositiveIntOrNull(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

async function resolveTenantRows({ tenantId, limit }) {
  const where = [];
  const params = [];
  if (tenantId) {
    where.push("t.id = ?");
    params.push(tenantId);
  }
  const limitClause = limit ? `LIMIT ${limit}` : "";
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const result = await query(
    `SELECT t.id AS tenant_id
     FROM tenants t
     ${whereClause}
     ORDER BY t.id ASC
     ${limitClause}`,
    params
  );
  return result.rows || [];
}

async function resolveCreatedByUserId(tenantId, preferredUserId) {
  if (preferredUserId) {
    const preferred = await query(
      `SELECT id
       FROM users
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, preferredUserId]
    );
    if (preferred.rows?.[0]?.id) {
      return parsePositiveIntOrNull(preferred.rows[0].id);
    }
  }

  const fallback = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );
  return parsePositiveIntOrNull(fallback.rows?.[0]?.id);
}

async function resolveAssignmentScopes(tenantId, requestedGroupCompanyId) {
  if (requestedGroupCompanyId) {
    const result = await query(
      `SELECT id
       FROM group_companies
       WHERE tenant_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, requestedGroupCompanyId]
    );
    const id = parsePositiveIntOrNull(result.rows?.[0]?.id);
    return id ? [id] : [null];
  }

  const groups = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
     ORDER BY id ASC`,
    [tenantId]
  );
  const rows = (groups.rows || [])
    .map((row) => parsePositiveIntOrNull(row.id))
    .filter(Boolean);
  return rows.length > 0 ? rows : [null];
}

async function upsertDefinitionAndStepsTx(tx, { tenantId, createdByUserId, config }) {
  await tx.query(
    `INSERT INTO workflow_definitions (
        tenant_id,
        code,
        name,
        process_type,
        is_active,
        version_no,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, TRUE, 1, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       process_type = VALUES(process_type),
       is_active = VALUES(is_active),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      config.definitionCode,
      config.definitionName,
      config.processType,
      createdByUserId,
    ]
  );

  const definitionResult = await tx.query(
    `SELECT id
     FROM workflow_definitions
     WHERE tenant_id = ?
       AND code = ?
       AND version_no = 1
     LIMIT 1`,
    [tenantId, config.definitionCode]
  );
  const workflowDefinitionId = parsePositiveIntOrNull(definitionResult.rows?.[0]?.id);
  if (!workflowDefinitionId) {
    throw new Error(`Failed to resolve workflow definition id for ${config.definitionCode}`);
  }

  await tx.query(
    `DELETE FROM workflow_definition_steps
     WHERE workflow_definition_id = ?`,
    [workflowDefinitionId]
  );

  const steps = (config.steps || []).map((step, index) => ({
    stepNo: index + 1,
    stageScopeType: String(step?.stageScopeType || "")
      .trim()
      .toUpperCase(),
    escalationAfterHours: parsePositiveIntOrNull(step?.escalationAfterHours),
    minApproverCount: parsePositiveIntOrNull(step?.minApproverCount) || 1,
    allowSelfApprove: Boolean(step?.allowSelfApprove),
  }));
  if (steps.length <= 0) {
    throw new Error(`No workflow steps configured for ${config.definitionCode}`);
  }

  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO workflow_definition_steps (
          workflow_definition_id,
          step_no,
          stage_scope_type,
          required_permission_code,
          min_approver_count,
          allow_self_approve,
          escalation_after_hours
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        workflowDefinitionId,
        step.stepNo,
        step.stageScopeType,
        config.requiredPermissionCode,
        step.minApproverCount,
        step.allowSelfApprove ? 1 : 0,
        step.escalationAfterHours,
      ]
    );
  }

  return workflowDefinitionId;
}

async function upsertAssignmentTx(tx, { tenantId, createdByUserId, effectiveFrom, processType, workflowDefinitionId, groupCompanyId }) {
  const existing = await tx.query(
    `SELECT id
     FROM workflow_assignments
     WHERE tenant_id = ?
       AND process_type = ?
       AND status = 'ACTIVE'
       AND operating_unit_id IS NULL
       AND legal_entity_id IS NULL
       AND (
         ( ? IS NULL AND group_company_id IS NULL )
         OR group_company_id = ?
       )
       AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to >= ?)
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, processType, groupCompanyId, groupCompanyId, effectiveFrom, effectiveFrom]
  );
  const existingId = parsePositiveIntOrNull(existing.rows?.[0]?.id);
  if (existingId) {
    await tx.query(
      `UPDATE workflow_assignments
       SET workflow_definition_id = ?,
           effective_from = ?,
           effective_to = NULL,
           status = 'ACTIVE',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [workflowDefinitionId, effectiveFrom, existingId]
    );
    return { assignmentId: existingId, action: "updated" };
  }

  const insertResult = await tx.query(
    `INSERT INTO workflow_assignments (
        tenant_id,
        process_type,
        workflow_definition_id,
        group_company_id,
        legal_entity_id,
        operating_unit_id,
        effective_from,
        effective_to,
        status,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, 'ACTIVE', ?)`,
    [tenantId, processType, workflowDefinitionId, groupCompanyId, effectiveFrom, createdByUserId]
  );
  return {
    assignmentId: parsePositiveIntOrNull(insertResult.rows?.insertId),
    action: "inserted",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenants = await resolveTenantRows({
    tenantId: args.tenantId,
    limit: args.limit,
  });

  const plan = [];
  const metrics = {
    tenantCount: tenants.length,
    definitionTouchedCount: 0,
    assignmentInsertedCount: 0,
    assignmentUpdatedCount: 0,
    skippedTenantsNoUser: 0,
  };

  for (const tenant of tenants) {
    const tenantId = parsePositiveIntOrNull(tenant.tenant_id);
    if (!tenantId) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const createdByUserId = await resolveCreatedByUserId(tenantId, args.createdByUserId);
    if (!createdByUserId) {
      metrics.skippedTenantsNoUser += 1;
      plan.push({
        tenantId,
        skipped: true,
        reason: "No tenant user found for created_by_user_id",
      });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const scopes = await resolveAssignmentScopes(tenantId, args.groupCompanyId);

    for (const config of PROCESS_DEFAULTS) {
      for (const scopeGroupCompanyId of scopes) {
        plan.push({
          tenantId,
          processType: config.processType,
          definitionCode: config.definitionCode,
          requiredPermissionCode: config.requiredPermissionCode,
          groupCompanyId: scopeGroupCompanyId,
          effectiveFrom: args.effectiveFrom,
          createdByUserId,
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.apply ? "apply" : "dry-run",
        filters: {
          tenantId: args.tenantId,
          groupCompanyId: args.groupCompanyId,
          createdByUserId: args.createdByUserId,
          effectiveFrom: args.effectiveFrom,
          limit: args.limit,
        },
        planCount: plan.length,
        sample: plan.slice(0, 10),
      },
      null,
      2
    )
  );

  if (!args.apply) {
    console.log("Dry-run only. Re-run with --apply to write workflow defaults.");
    return;
  }

  for (const item of plan) {
    if (item.skipped) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await withTransaction(async (tx) => {
      const config = PROCESS_DEFAULTS.find((entry) => entry.processType === item.processType);
      if (!config) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      const definitionId = await upsertDefinitionAndStepsTx(tx, {
        tenantId: item.tenantId,
        createdByUserId: item.createdByUserId,
        config,
      });
      metrics.definitionTouchedCount += 1;

      // eslint-disable-next-line no-await-in-loop
      const assignment = await upsertAssignmentTx(tx, {
        tenantId: item.tenantId,
        createdByUserId: item.createdByUserId,
        effectiveFrom: item.effectiveFrom,
        processType: item.processType,
        workflowDefinitionId: definitionId,
        groupCompanyId: item.groupCompanyId,
      });
      await ensureUnifiedWorkflowPolicyForDefinition({
        tenantId: item.tenantId,
        definitionId,
        runQuery: tx.query,
      });
      if (assignment.action === "inserted") {
        metrics.assignmentInsertedCount += 1;
      } else {
        metrics.assignmentUpdatedCount += 1;
      }
    });
  }

  console.log(JSON.stringify({ ok: true, mode: "apply", ...metrics }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
