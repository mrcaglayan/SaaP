import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, query, withTransaction } from "../../backend/src/db.js";
import {
  applyOperatingUnitCurrentAccountConfigTx,
  upsertOperatingUnitCurrentAccountConfigTx,
} from "../../backend/src/services/org.write.service.js";

const TENANT_CODE = "DEFAULT";
const LEGAL_ENTITY_CODE = "BROWSER_POU36_LE";
const USER_EMAIL = "test@example.com";
const OU1_CODE = "BROWSER_POU36_OU";
const OU2_CODE = "BROWSER_POU36_OU2";
const OU2_NAME = "Browser Payroll Ownership OU 2";
const OU2_BANK_GL = Object.freeze({
  code: "P36BANK2",
  name: "Browser Payroll OU2 Bank GL",
});
const OU_CURRENT_PARENT_ACCOUNTS = Object.freeze({
  dueFrom: Object.freeze({
    code: "136",
    name: "DIGER CESITLI ALACAKLAR",
    accountType: "ASSET",
    normalSide: "DEBIT",
  }),
  dueTo: Object.freeze({
    code: "336",
    name: "DIGER CESITLI BORCLAR",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  }),
});
const OU2_BANK = Object.freeze({
  code: "BROWSER_POU36_BANK_OU2",
  name: "Browser Payroll OU2 Bank",
  bankName: "Browser Payroll Bank OU2",
  branchName: "OU2 Branch",
  accountNo: "P36-OU2-0001",
});
const EMPLOYEE_CODE = "EMP003";
const EMPLOYEE_NAME = "Mehmet Kaya";
const EFFECTIVE_FROM = "2026-01-01";

function fixtureDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function writeJson(filename, value) {
  const filePath = path.join(fixtureDir(), filename);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

async function requireSingleRow(sql, params, message) {
  const result = await query(sql, params);
  const row = result.rows?.[0] || null;
  if (!row) {
    throw new Error(message);
  }
  return row;
}

async function ensureOperatingUnitTx(tx, { tenantId, legalEntityId, code, name }) {
  const existing = await tx.query(
    `SELECT id
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const existingId = toPositiveInt(existing.rows?.[0]?.id);
  if (existingId) {
    await tx.query(
      `UPDATE operating_units
       SET name = ?,
           unit_type = 'DEPARTMENT',
           has_subledger = 0,
           status = 'ACTIVE'
       WHERE id = ?
       LIMIT 1`,
      [name, existingId]
    );
    return existingId;
  }

  const insertResult = await tx.query(
    `INSERT INTO operating_units (
        tenant_id,
        legal_entity_id,
        code,
        name,
        unit_type,
        has_subledger,
        status
     )
     VALUES (?, ?, ?, ?, 'DEPARTMENT', 0, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name]
  );
  const operatingUnitId = toPositiveInt(insertResult.rows?.insertId);
  if (!operatingUnitId) {
    throw new Error(`Failed to create operating unit ${code}`);
  }
  return operatingUnitId;
}

async function ensureAccountTx(tx, { coaId, code, name }) {
  const existing = await tx.query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, code]
  );
  const existingId = toPositiveInt(existing.rows?.[0]?.id);
  if (existingId) {
    await tx.query(
      `UPDATE accounts
       SET name = ?,
           account_type = 'ASSET',
           normal_side = 'DEBIT',
           allow_posting = 1,
           parent_account_id = NULL,
           is_active = 1,
           is_cash_controlled = 0
       WHERE id = ?
       LIMIT 1`,
      [name, existingId]
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
     VALUES (?, ?, ?, 'ASSET', 'DEBIT', 1, NULL, 1, 0)`,
    [coaId, code, name]
  );
  const accountId = toPositiveInt(insertResult.rows?.insertId);
  if (!accountId) {
    throw new Error(`Failed to create account ${code}`);
  }
  return accountId;
}

async function ensureControlParentAccountTx(tx, { coaId, account }) {
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
           allow_posting = 0,
           parent_account_id = NULL,
           is_active = 1,
           is_cash_controlled = 0
       WHERE id = ?
       LIMIT 1`,
      [account.name, account.accountType, account.normalSide, existingId]
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
     VALUES (?, ?, ?, ?, ?, 0, NULL, 1, 0)`,
    [coaId, account.code, account.name, account.accountType, account.normalSide]
  );
  const accountId = toPositiveInt(insertResult.rows?.insertId);
  if (!accountId) {
    throw new Error(`Failed to create control account ${account.code}`);
  }
  return accountId;
}

async function ensureBankAccountTx(tx, {
  tenantId,
  legalEntityId,
  operatingUnitId,
  userId,
  currencyCode,
  glAccountId,
}) {
  const existing = await tx.query(
    `SELECT id
     FROM bank_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, OU2_BANK.code]
  );
  const existingId = toPositiveInt(existing.rows?.[0]?.id);
  if (existingId) {
    await tx.query(
      `UPDATE bank_accounts
       SET operating_unit_id = ?,
           name = ?,
           currency_code = ?,
           gl_account_id = ?,
           bank_name = ?,
           branch_name = ?,
           iban = NULL,
           account_no = ?,
           is_active = 1
       WHERE id = ?
       LIMIT 1`,
      [
        operatingUnitId,
        OU2_BANK.name,
        currencyCode,
        glAccountId,
        OU2_BANK.bankName,
        OU2_BANK.branchName,
        OU2_BANK.accountNo,
        existingId,
      ]
    );
    return existingId;
  }

  const insertResult = await tx.query(
    `INSERT INTO bank_accounts (
        tenant_id,
        legal_entity_id,
        operating_unit_id,
        code,
        name,
        currency_code,
        gl_account_id,
        bank_name,
        branch_name,
        iban,
        account_no,
        is_active,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?)`,
    [
      tenantId,
      legalEntityId,
      operatingUnitId,
      OU2_BANK.code,
      OU2_BANK.name,
      currencyCode,
      glAccountId,
      OU2_BANK.bankName,
      OU2_BANK.branchName,
      OU2_BANK.accountNo,
      userId,
    ]
  );
  const bankAccountId = toPositiveInt(insertResult.rows?.insertId);
  if (!bankAccountId) {
    throw new Error(`Failed to create bank account ${OU2_BANK.code}`);
  }
  return bankAccountId;
}

async function ensureEmp003OwnershipTx(tx, {
  tenantId,
  legalEntityId,
  operatingUnitId,
  userId,
}) {
  const rows = await tx.query(
    `SELECT id
     FROM payroll_employee_owner_context_assignments
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND employee_code = ?
     ORDER BY effective_from DESC, id DESC`,
    [tenantId, legalEntityId, EMPLOYEE_CODE]
  );
  const targetId = toPositiveInt(rows.rows?.[0]?.id);

  if (targetId) {
    await tx.query(
      `UPDATE payroll_employee_owner_context_assignments
       SET employee_name_snapshot = ?,
           ownership_scope = 'OPERATING_UNIT',
           operating_unit_id = ?,
           effective_from = ?,
           effective_to = NULL,
           status = 'ACTIVE',
           expected_cost_center_code = 'OPS',
           source_type = 'MANUAL',
           notes = 'Browser two-OU scenario',
           updated_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       LIMIT 1`,
      [EMPLOYEE_NAME, operatingUnitId, EFFECTIVE_FROM, userId, targetId]
    );
    return targetId;
  }

  const insertResult = await tx.query(
    `INSERT INTO payroll_employee_owner_context_assignments (
        tenant_id,
        legal_entity_id,
        employee_code,
        employee_name_snapshot,
        ownership_scope,
        operating_unit_id,
        effective_from,
        effective_to,
        status,
        expected_cost_center_code,
        source_type,
        notes,
        created_by_user_id,
        updated_by_user_id
     )
     VALUES (?, ?, ?, ?, 'OPERATING_UNIT', ?, ?, NULL, 'ACTIVE', 'OPS', 'MANUAL', 'Browser two-OU scenario', ?, ?)`,
    [tenantId, legalEntityId, EMPLOYEE_CODE, EMPLOYEE_NAME, operatingUnitId, EFFECTIVE_FROM, userId, userId]
  );
  const assignmentId = toPositiveInt(insertResult.rows?.insertId);
  if (!assignmentId) {
    throw new Error(`Failed to create ownership assignment for ${EMPLOYEE_CODE}`);
  }
  return assignmentId;
}

async function ensureEmp003BeneficiaryTx(tx, {
  tenantId,
  legalEntityId,
  userId,
  currencyCode,
}) {
  const rows = await tx.query(
    `SELECT id
     FROM payroll_beneficiary_bank_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND employee_code = ?
     ORDER BY is_primary DESC, id DESC`,
    [tenantId, legalEntityId, EMPLOYEE_CODE]
  );
  const accountId = toPositiveInt(rows.rows?.[0]?.id);
  if (accountId) {
    await tx.query(
      `UPDATE payroll_beneficiary_bank_accounts
       SET employee_name = ?,
           account_holder_name = ?,
           bank_name = 'Browser Payroll Beneficiary Bank OU2',
           currency_code = ?,
           account_number = 'EMP0030002',
           account_last4 = '0002',
           is_primary = 1,
           status = 'ACTIVE',
           effective_from = ?,
           effective_to = NULL,
           verification_status = 'VERIFIED',
           source_type = 'MANUAL',
           updated_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
       LIMIT 1`,
      [EMPLOYEE_NAME, EMPLOYEE_NAME, currencyCode, EFFECTIVE_FROM, userId, accountId]
    );
    return accountId;
  }

  const insertResult = await tx.query(
    `INSERT INTO payroll_beneficiary_bank_accounts (
        tenant_id,
        legal_entity_id,
        employee_code,
        employee_name,
        account_holder_name,
        bank_name,
        currency_code,
        account_number,
        account_last4,
        is_primary,
        status,
        effective_from,
        verification_status,
        source_type,
        created_by_user_id,
        updated_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, 'Browser Payroll Beneficiary Bank OU2', ?, 'EMP0030002', '0002', 1, 'ACTIVE', ?, 'VERIFIED', 'MANUAL', ?, ?)`,
    [tenantId, legalEntityId, EMPLOYEE_CODE, EMPLOYEE_NAME, EMPLOYEE_NAME, currencyCode, EFFECTIVE_FROM, userId, userId]
  );
  return toPositiveInt(insertResult.rows?.insertId);
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
    `Legal entity ${LEGAL_ENTITY_CODE} not found`
  );
  const legalEntityId = toPositiveInt(legalEntity.id);
  const coaId = toPositiveInt(legalEntity.coa_id);
  const currencyCode = String(legalEntity.functional_currency_code || "TRY").trim().toUpperCase();

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

  const ou1 = await requireSingleRow(
    `SELECT id, code, name
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, OU1_CODE],
    `Base fixture missing operating unit ${OU1_CODE}`
  );

  const summary = await withTransaction(async (tx) => {
    const ou2Id = await ensureOperatingUnitTx(tx, {
      tenantId,
      legalEntityId,
      code: OU2_CODE,
      name: OU2_NAME,
    });
    const glAccountId = await ensureAccountTx(tx, {
      coaId,
      code: OU2_BANK_GL.code,
      name: OU2_BANK_GL.name,
    });
    const bankAccountId = await ensureBankAccountTx(tx, {
      tenantId,
      legalEntityId,
      operatingUnitId: ou2Id,
      userId,
      currencyCode,
      glAccountId,
    });
    const assignmentId = await ensureEmp003OwnershipTx(tx, {
      tenantId,
      legalEntityId,
      operatingUnitId: ou2Id,
      userId,
    });
    const beneficiaryId = await ensureEmp003BeneficiaryTx(tx, {
      tenantId,
      legalEntityId,
      userId,
      currencyCode,
    });
    const dueFromParentAccountId = await ensureControlParentAccountTx(tx, {
      coaId,
      account: OU_CURRENT_PARENT_ACCOUNTS.dueFrom,
    });
    const dueToParentAccountId = await ensureControlParentAccountTx(tx, {
      coaId,
      account: OU_CURRENT_PARENT_ACCOUNTS.dueTo,
    });
    await upsertOperatingUnitCurrentAccountConfigTx(tx, {
      tenantId,
      legalEntityId,
      dueFromParentAccountId,
      dueToParentAccountId,
      autoProvisionOnOperatingUnitCreate: true,
    });
    const currentAccountApplySummary = await applyOperatingUnitCurrentAccountConfigTx(tx, {
      tenantId,
      legalEntityId,
      repairMissingOnly: true,
    });
    return {
      tenantId,
      tenantCode: TENANT_CODE,
      legalEntityId,
      legalEntityCode: LEGAL_ENTITY_CODE,
      currencyCode,
      userId,
      userEmail: USER_EMAIL,
      ou1: {
        id: toPositiveInt(ou1.id),
        code: OU1_CODE,
        name: ou1.name,
      },
      ou2: {
        id: ou2Id,
        code: OU2_CODE,
        name: OU2_NAME,
      },
      ou2BankGlAccountId: glAccountId,
      ou2BankAccountId: bankAccountId,
      emp003AssignmentId: assignmentId,
      emp003BeneficiaryId: beneficiaryId,
      operatingUnitCurrentAccounts: {
        dueFromParentAccountId,
        dueToParentAccountId,
        dueFromParentCode: OU_CURRENT_PARENT_ACCOUNTS.dueFrom.code,
        dueToParentCode: OU_CURRENT_PARENT_ACCOUNTS.dueTo.code,
        lastAppliedAt: currentAccountApplySummary.lastAppliedAt,
        createdAccounts: currentAccountApplySummary.createdAccounts,
        reusedAccounts: currentAccountApplySummary.reusedAccounts,
        updatedOperatingUnits: currentAccountApplySummary.updatedOperatingUnits,
        updatedPartnerMappings: currentAccountApplySummary.updatedPartnerMappings,
        warnings: currentAccountApplySummary.warnings,
      },
      scenario: {
        centralEmployeeCode: "EMP001",
        ou1EmployeeCode: "EMP002",
        ou2EmployeeCode: "EMP003",
      },
    };
  });

  const outPath = await writeJson("two-ou-seed-summary.json", {
    seededAt: new Date().toISOString(),
    ...summary,
  });
  console.log(JSON.stringify({ ok: true, outPath, summary }, null, 2));
}

try {
  await main();
} finally {
  await closePool();
}
