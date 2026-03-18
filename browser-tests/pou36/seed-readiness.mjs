import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query, withTransaction } from "../../backend/src/db.js";

const TENANT_CODE = "DEFAULT";
const LEGAL_ENTITY_CODE = "BROWSER_POU36_LE";
const USER_EMAIL = "test@example.com";

const CAPITAL_PARENT_ACCOUNT = Object.freeze({
  code: "P36EQCAP",
  name: "Browser Shareholder Capital Parent",
  accountType: "EQUITY",
  normalSide: "CREDIT",
  allowPosting: false,
});

const COMMITMENT_PARENT_ACCOUNT = Object.freeze({
  code: "P36EQCOM",
  name: "Browser Shareholder Commitment Parent",
  accountType: "EQUITY",
  normalSide: "DEBIT",
  allowPosting: false,
});

const SHAREHOLDER_PURPOSE_CODES = Object.freeze({
  capital: "SHAREHOLDER_CAPITAL_CREDIT_PARENT",
  commitment: "SHAREHOLDER_COMMITMENT_DEBIT_PARENT",
});

const SHAREHOLDER_ROW = Object.freeze({
  code: "POU36SH01",
  name: "POU36 Browser Shareholder",
  shareholderType: "INDIVIDUAL",
  ownershipPct: "100.000000",
  committedCapital: "100000.000000",
  paidCapital: "0.000000",
  status: "ACTIVE",
});

const WORKFLOW_DEFINITIONS = Object.freeze([
  Object.freeze({
    code: "BROWSER_POU36_PERIOD_CLOSE_V1",
    name: "Browser POU36 Period Close",
    processType: "PERIOD_CLOSE",
    requiredPermissionCode: "gl.period.close",
  }),
  Object.freeze({
    code: "BROWSER_POU36_CONSOLIDATION_V1",
    name: "Browser POU36 Consolidation",
    processType: "CONSOLIDATION_RUN",
    requiredPermissionCode: "consolidation.run.finalize",
  }),
]);

const ASSIGNMENT_EFFECTIVE_FROM = "2024-01-01";

function resolveFixtureDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

async function writeJson(filename, value) {
  const outputPath = path.join(resolveFixtureDir(), filename);
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return outputPath;
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function requireSingleRow(sql, params, message) {
  const result = await query(sql, params);
  const row = result.rows?.[0] || null;
  if (!row) {
    throw new Error(message);
  }
  return row;
}

async function ensureAccountTx(tx, { coaId, account }) {
  const existing = await tx.query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, account.code]
  );
  const existingId = toPositiveInt(existing.rows?.[0]?.id);
  if (existingId) {
    await tx.query(
      `UPDATE accounts
       SET name = ?,
           account_type = ?,
           normal_side = ?,
           allow_posting = ?,
           parent_account_id = NULL,
           is_active = 1,
           is_cash_controlled = 0
       WHERE id = ?
       LIMIT 1`,
      [
        account.name,
        account.accountType,
        account.normalSide,
        account.allowPosting ? 1 : 0,
        existingId,
      ]
    );
    return existingId;
  }

  const insertResult = await tx.query(
    `INSERT INTO accounts (
        coa_id,
        code,
        name,
        account_type,
        normal_side,
        allow_posting,
        parent_account_id,
        is_active,
        is_cash_controlled
     )
     VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 0)`,
    [
      coaId,
      account.code,
      account.name,
      account.accountType,
      account.normalSide,
      account.allowPosting ? 1 : 0,
    ]
  );
  const insertedId = toPositiveInt(insertResult.rows?.insertId);
  if (!insertedId) {
    throw new Error(`Failed to create account ${account.code}`);
  }
  return insertedId;
}

async function ensureJournalPurposeAccountTx(tx, {
  tenantId,
  legalEntityId,
  purposeCode,
  accountId,
}) {
  await tx.query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     )
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       account_id = VALUES(account_id),
       updated_at = CURRENT_TIMESTAMP`,
    [tenantId, legalEntityId, purposeCode, accountId]
  );
}

async function ensureShareholderTx(tx, {
  tenantId,
  legalEntityId,
  currencyCode,
}) {
  await tx.query(
    `INSERT INTO shareholders (
        tenant_id,
        legal_entity_id,
        code,
        name,
        shareholder_type,
        ownership_pct,
        committed_capital,
        paid_capital,
        currency_code,
        status,
        notes
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       shareholder_type = VALUES(shareholder_type),
       ownership_pct = VALUES(ownership_pct),
       committed_capital = VALUES(committed_capital),
       paid_capital = VALUES(paid_capital),
       currency_code = VALUES(currency_code),
       status = VALUES(status),
       notes = VALUES(notes),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      legalEntityId,
      SHAREHOLDER_ROW.code,
      SHAREHOLDER_ROW.name,
      SHAREHOLDER_ROW.shareholderType,
      SHAREHOLDER_ROW.ownershipPct,
      SHAREHOLDER_ROW.committedCapital,
      SHAREHOLDER_ROW.paidCapital,
      currencyCode,
      SHAREHOLDER_ROW.status,
      "Browser smoke readiness seed",
    ]
  );

  const result = await tx.query(
    `SELECT id
     FROM shareholders
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, SHAREHOLDER_ROW.code]
  );
  const shareholderId = toPositiveInt(result.rows?.[0]?.id);
  if (!shareholderId) {
    throw new Error("Failed to resolve seeded shareholder");
  }
  return shareholderId;
}

async function ensureWorkflowDefinitionTx(tx, {
  tenantId,
  userId,
  definition,
}) {
  const existing = await tx.query(
    `SELECT id
     FROM workflow_definitions
     WHERE tenant_id = ?
       AND code = ?
       AND version_no = 1
     LIMIT 1`,
    [tenantId, definition.code]
  );
  const existingId = toPositiveInt(existing.rows?.[0]?.id);
  if (existingId) {
    await tx.query(
      `UPDATE workflow_definitions
       SET name = ?,
           process_type = ?,
           is_active = 1
       WHERE id = ?
       LIMIT 1`,
      [definition.name, definition.processType, existingId]
    );
    return existingId;
  }

  const insertResult = await tx.query(
    `INSERT INTO workflow_definitions (
        tenant_id,
        code,
        name,
        process_type,
        is_active,
        version_no,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, 1, 1, ?)`,
    [tenantId, definition.code, definition.name, definition.processType, userId]
  );
  const definitionId = toPositiveInt(insertResult.rows?.insertId);
  if (!definitionId) {
    throw new Error(`Failed to create workflow definition ${definition.code}`);
  }
  return definitionId;
}

async function ensureWorkflowStepTx(tx, {
  definitionId,
  requiredPermissionCode,
}) {
  await tx.query(
    `DELETE FROM workflow_definition_steps
     WHERE workflow_definition_id = ?`,
    [definitionId]
  );
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
     VALUES (?, 1, 'LEGAL_ENTITY', ?, 1, 0, NULL)`,
    [definitionId, requiredPermissionCode]
  );
}

async function ensureWorkflowAssignmentTx(tx, {
  tenantId,
  userId,
  legalEntityId,
  definitionId,
  processType,
}) {
  const existing = await tx.query(
    `SELECT wa.id
     FROM workflow_assignments wa
     JOIN workflow_definitions wd ON wd.id = wa.workflow_definition_id
     WHERE wa.tenant_id = ?
       AND wa.legal_entity_id = ?
       AND wa.process_type = ?
       AND wa.status = 'ACTIVE'
       AND wa.workflow_definition_id = ?
       AND wa.effective_from = ?
       AND wa.effective_to IS NULL
     LIMIT 1`,
    [tenantId, legalEntityId, processType, definitionId, ASSIGNMENT_EFFECTIVE_FROM]
  );
  const existingId = toPositiveInt(existing.rows?.[0]?.id);
  if (existingId) {
    return existingId;
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
     VALUES (?, ?, ?, NULL, ?, NULL, ?, NULL, 'ACTIVE', ?)`,
    [
      tenantId,
      processType,
      definitionId,
      legalEntityId,
      ASSIGNMENT_EFFECTIVE_FROM,
      userId,
    ]
  );
  const assignmentId = toPositiveInt(insertResult.rows?.insertId);
  if (!assignmentId) {
    throw new Error(`Failed to create workflow assignment for ${processType}`);
  }
  return assignmentId;
}

async function main() {
  const tenant = await requireSingleRow(
    `SELECT id, code
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [TENANT_CODE],
    `Tenant ${TENANT_CODE} not found`
  );
  const tenantId = toPositiveInt(tenant.id);

  const legalEntity = await requireSingleRow(
    `SELECT le.id, le.code, le.functional_currency_code, c.id AS coa_id
     FROM legal_entities le
     JOIN charts_of_accounts c
       ON c.tenant_id = le.tenant_id
      AND c.legal_entity_id = le.id
     WHERE le.tenant_id = ?
       AND le.code = ?
     LIMIT 1`,
    [tenantId, LEGAL_ENTITY_CODE],
    `Legal entity ${LEGAL_ENTITY_CODE} not found. Seed the base payroll browser fixture first.`
  );
  const legalEntityId = toPositiveInt(legalEntity.id);
  const coaId = toPositiveInt(legalEntity.coa_id);
  const currencyCode = String(legalEntity.functional_currency_code || "TRY")
    .trim()
    .toUpperCase();

  const user = await requireSingleRow(
    `SELECT id, email
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, USER_EMAIL],
    `User ${USER_EMAIL} not found`
  );
  const userId = toPositiveInt(user.id);

  const [beforeShareholders, beforePurposeMappings, beforeAssignments] = await Promise.all([
    query(
      `SELECT COUNT(*) AS count
       FROM shareholders
       WHERE tenant_id = ?`,
      [tenantId]
    ),
    query(
      `SELECT COUNT(*) AS count
       FROM journal_purpose_accounts
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND purpose_code IN (?, ?)`,
      [
        tenantId,
        legalEntityId,
        SHAREHOLDER_PURPOSE_CODES.capital,
        SHAREHOLDER_PURPOSE_CODES.commitment,
      ]
    ),
    query(
      `SELECT COUNT(*) AS count
       FROM workflow_assignments
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND process_type IN ('PERIOD_CLOSE', 'CONSOLIDATION_RUN')
         AND status = 'ACTIVE'`,
      [tenantId, legalEntityId]
    ),
  ]);

  const summary = await withTransaction(async (tx) => {
    const capitalParentAccountId = await ensureAccountTx(tx, {
      coaId,
      account: CAPITAL_PARENT_ACCOUNT,
    });
    const commitmentParentAccountId = await ensureAccountTx(tx, {
      coaId,
      account: COMMITMENT_PARENT_ACCOUNT,
    });

    await ensureJournalPurposeAccountTx(tx, {
      tenantId,
      legalEntityId,
      purposeCode: SHAREHOLDER_PURPOSE_CODES.capital,
      accountId: capitalParentAccountId,
    });
    await ensureJournalPurposeAccountTx(tx, {
      tenantId,
      legalEntityId,
      purposeCode: SHAREHOLDER_PURPOSE_CODES.commitment,
      accountId: commitmentParentAccountId,
    });

    const shareholderId = await ensureShareholderTx(tx, {
      tenantId,
      legalEntityId,
      currencyCode,
    });

    const workflowIds = [];
    for (const definition of WORKFLOW_DEFINITIONS) {
      // eslint-disable-next-line no-await-in-loop
      const definitionId = await ensureWorkflowDefinitionTx(tx, {
        tenantId,
        userId,
        definition,
      });
      // eslint-disable-next-line no-await-in-loop
      await ensureWorkflowStepTx(tx, {
        definitionId,
        requiredPermissionCode: definition.requiredPermissionCode,
      });
      // eslint-disable-next-line no-await-in-loop
      const assignmentId = await ensureWorkflowAssignmentTx(tx, {
        tenantId,
        userId,
        legalEntityId,
        definitionId,
        processType: definition.processType,
      });
      workflowIds.push({
        code: definition.code,
        definitionId,
        assignmentId,
        processType: definition.processType,
        requiredPermissionCode: definition.requiredPermissionCode,
      });
    }

    return {
      tenantId,
      tenantCode: TENANT_CODE,
      legalEntityId,
      legalEntityCode: LEGAL_ENTITY_CODE,
      userId,
      userEmail: USER_EMAIL,
      currencyCode,
      capitalParentAccountId,
      commitmentParentAccountId,
      shareholderId,
      workflowDefinitions: workflowIds,
    };
  });

  const [afterShareholders, afterPurposeMappings, afterAssignments] = await Promise.all([
    query(
      `SELECT COUNT(*) AS count
       FROM shareholders
       WHERE tenant_id = ?`,
      [tenantId]
    ),
    query(
      `SELECT COUNT(*) AS count
       FROM journal_purpose_accounts
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND purpose_code IN (?, ?)`,
      [
        tenantId,
        legalEntityId,
        SHAREHOLDER_PURPOSE_CODES.capital,
        SHAREHOLDER_PURPOSE_CODES.commitment,
      ]
    ),
    query(
      `SELECT COUNT(*) AS count
       FROM workflow_assignments
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND process_type IN ('PERIOD_CLOSE', 'CONSOLIDATION_RUN')
         AND status = 'ACTIVE'`,
      [tenantId, legalEntityId]
    ),
  ]);

  const output = {
    seededAt: new Date().toISOString(),
    ...summary,
    beforeCounts: {
      shareholders: Number(beforeShareholders.rows?.[0]?.count || 0),
      shareholderPurposeMappings: Number(beforePurposeMappings.rows?.[0]?.count || 0),
      activeWorkflowAssignments: Number(beforeAssignments.rows?.[0]?.count || 0),
    },
    afterCounts: {
      shareholders: Number(afterShareholders.rows?.[0]?.count || 0),
      shareholderPurposeMappings: Number(afterPurposeMappings.rows?.[0]?.count || 0),
      activeWorkflowAssignments: Number(afterAssignments.rows?.[0]?.count || 0),
    },
  };

  const outputPath = await writeJson("readiness-seed-summary.json", output);
  console.log(JSON.stringify({ ok: true, outputPath, summary: output }, null, 2));
}

try {
  await main();
} finally {
  await closePool();
}
