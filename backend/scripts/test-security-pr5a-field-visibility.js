import assert from "node:assert/strict";
import { closePool, query } from "../src/db.js";
import { applyFieldVisibility } from "../src/middleware/fieldVisibility.js";
import { seedCore } from "../src/seedCore.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function runMiddleware(middleware, req) {
  await new Promise((resolve, reject) => {
    middleware(req, {}, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function createRoleWithPermissions(tenantId, roleCode, permissionCodes) {
  await query(
    `INSERT INTO roles (tenant_id, code, name, is_system)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
    [tenantId, roleCode, roleCode]
  );
  const roleResult = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = parsePositiveInt(roleResult.rows?.[0]?.id);
  assert(roleId, `Role ${roleCode} must exist`);

  await query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
  const permissionResult = await query(
    `SELECT id, code
     FROM permissions
     WHERE code IN (${permissionCodes.map(() => "?").join(", ")})`,
    permissionCodes
  );
  assert.equal(
    (permissionResult.rows || []).length,
    permissionCodes.length,
    `All permissions for ${roleCode} must exist`
  );
  for (const permissionRow of permissionResult.rows || []) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES (?, ?)`,
      [roleId, permissionRow.id]
    );
  }

  return roleId;
}

async function assignRole({
  tenantId,
  userId,
  roleId,
  scopeType,
  scopeId,
}) {
  await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect
      )
     VALUES (?, ?, ?, ?, ?, 'ALLOW')`,
    [tenantId, userId, roleId, scopeType, scopeId]
  );
}

async function main() {
  const uniqueSuffix = Date.now();

  await seedCore();

  const countryResult = await query(
    `SELECT id, default_currency_code
     FROM countries
     ORDER BY id
     LIMIT 1`
  );
  const countryId = parsePositiveInt(countryResult.rows?.[0]?.id);
  const currencyCode = String(countryResult.rows?.[0]?.default_currency_code || "USD");
  assert(countryId, "Seeded country is required for PR-5A verification");

  const tenantInsert = await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [`PR5A_${uniqueSuffix}`, `PR5A Tenant ${uniqueSuffix}`]
  );
  const tenantId = parsePositiveInt(tenantInsert.rows?.insertId);
  assert(tenantId, "Expected tenant insert id");

  const groupInsert = await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `GRP${uniqueSuffix}`, "PR5A Group"]
  );
  const groupCompanyId = parsePositiveInt(groupInsert.rows?.insertId);
  assert(groupCompanyId, "Expected group company id");

  const entityOneInsert = await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
      )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, groupCompanyId, `LEA${uniqueSuffix}`, "PR5A Legal Entity A", countryId, currencyCode]
  );
  const legalEntityOneId = parsePositiveInt(entityOneInsert.rows?.insertId);
  const entityTwoInsert = await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
      )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, groupCompanyId, `LEB${uniqueSuffix}`, "PR5A Legal Entity B", countryId, currencyCode]
  );
  const legalEntityTwoId = parsePositiveInt(entityTwoInsert.rows?.insertId);
  assert(legalEntityOneId && legalEntityTwoId, "Expected two legal entities");

  const userInsert = await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pr5a-${uniqueSuffix}@example.com`, "x", "PR5A User"]
  );
  const userId = parsePositiveInt(userInsert.rows?.insertId);
  assert(userId, "Expected user id");

  await seedCore();

  const permissionCheck = await query(
    `SELECT code
     FROM permissions
     WHERE code IN (
       'security.field_visibility.read',
       'security.field_visibility.write',
       'payroll.sensitive.read'
     )
     ORDER BY code`
  );
  assert.equal(permissionCheck.rows.length, 3, "Expected new field-visibility permissions");

  const policyCountResult = await query(
    `SELECT COUNT(*) AS total
     FROM field_visibility_policies
     WHERE tenant_id = ?`,
    [tenantId]
  );
  assert.equal(
    Number(policyCountResult.rows?.[0]?.total || 0),
    7,
    "Expected seeded default field visibility policies"
  );

  const bankReadRoleId = await createRoleWithPermissions(tenantId, "PR5A_BANK_READ_ALL", [
    "bank.accounts.read",
  ]);
  const bankUnmaskRoleId = await createRoleWithPermissions(tenantId, "PR5A_BANK_UNMASK_LE1", [
    "security.sensitive_data.audit.read",
  ]);
  const payrollReadRoleId = await createRoleWithPermissions(tenantId, "PR5A_PAYROLL_READ_ALL", [
    "payroll.runs.read",
    "payroll.beneficiary.read",
    "payroll.beneficiary.snapshot.read",
  ]);
  const payrollUnmaskRoleId = await createRoleWithPermissions(
    tenantId,
    "PR5A_PAYROLL_UNMASK_LE1",
    ["payroll.sensitive.read"]
  );

  await assignRole({
    tenantId,
    userId,
    roleId: bankReadRoleId,
    scopeType: "TENANT",
    scopeId: tenantId,
  });
  await assignRole({
    tenantId,
    userId,
    roleId: bankUnmaskRoleId,
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityOneId,
  });
  await assignRole({
    tenantId,
    userId,
    roleId: payrollReadRoleId,
    scopeType: "TENANT",
    scopeId: tenantId,
  });
  await assignRole({
    tenantId,
    userId,
    roleId: payrollUnmaskRoleId,
    scopeType: "LEGAL_ENTITY",
    scopeId: legalEntityOneId,
  });

  const bankReq = {
    user: { userId },
    rbac: { tenantId },
  };
  await runMiddleware(applyFieldVisibility("BANK", "bank_account"), bankReq);
  const maskedBankRows = await bankReq.fieldVisibility.applyToRows([
    {
      id: 1001,
      tenant_id: tenantId,
      legal_entity_id: legalEntityOneId,
      iban: "TR330006100519786457841326",
      account_no: "1234567890123456",
    },
    {
      id: 1002,
      tenant_id: tenantId,
      legal_entity_id: legalEntityTwoId,
      iban: "TR440006100519786457841327",
      account_no: "6543210987654321",
    },
  ]);
  assert.equal(
    maskedBankRows[0].iban,
    "TR330006100519786457841326",
    "Override permission should keep LE1 bank IBAN visible"
  );
  assert.notEqual(
    maskedBankRows[1].iban,
    "TR440006100519786457841327",
    "LE2 bank IBAN should be masked without scoped override"
  );
  assert.match(String(maskedBankRows[1].iban), /^\*+1327$/, "Masked bank IBAN should preserve last digits");
  assert.match(
    String(maskedBankRows[1].account_no),
    /^\*+4321$/,
    "Masked bank account number should preserve last digits"
  );

  const payrollReq = {
    user: { userId },
    rbac: { tenantId },
  };
  await runMiddleware(applyFieldVisibility("PAYROLL", "payroll_run_line"), payrollReq);
  const maskedRunLines = await payrollReq.fieldVisibility.applyToRows([
    {
      id: 2001,
      tenant_id: tenantId,
      legal_entity_id: legalEntityOneId,
      operating_unit_id: null,
      base_salary: 7500,
      net_pay: 6200,
    },
    {
      id: 2002,
      tenant_id: tenantId,
      legal_entity_id: legalEntityTwoId,
      operating_unit_id: null,
      base_salary: 8100,
      net_pay: 6700,
    },
  ]);
  assert.equal(maskedRunLines[0].base_salary, 7500, "LE1 payroll salary should stay visible");
  assert.equal(maskedRunLines[0].net_pay, 6200, "LE1 payroll net pay should stay visible");
  assert.equal(maskedRunLines[1].base_salary, "***", "LE2 payroll salary should be masked");
  assert.equal(maskedRunLines[1].net_pay, "***", "LE2 payroll net pay should be masked");

  const beneficiaryReq = {
    user: { userId },
    rbac: { tenantId },
  };
  await runMiddleware(applyFieldVisibility("PAYROLL", "beneficiary"), beneficiaryReq);
  const maskedBeneficiary = await beneficiaryReq.fieldVisibility.applyToRow({
    id: 3001,
    tenant_id: tenantId,
    legal_entity_id: legalEntityTwoId,
    employee_code: "EMP001",
    iban: "TR560006100519786457841328",
    account_number: "9876543210004444",
  });
  assert.match(
    String(maskedBeneficiary.iban),
    /^\*+1328$/,
    "Payroll beneficiary IBAN should be masked"
  );
  assert.match(
    String(maskedBeneficiary.account_number),
    /^\*+4444$/,
    "Payroll beneficiary account number should be masked"
  );

  const auditResult = await query(
    `SELECT module_code, object_type, object_id, action, payload_json
     FROM sensitive_data_audit
     WHERE tenant_id = ?
       AND action = 'FIELD_MASKED_ACCESS'
     ORDER BY id ASC`,
    [tenantId]
  );
  assert.equal(
    auditResult.rows.length,
    3,
    "Expected one audit row per masked bank/payroll object"
  );
  const auditPayload =
    typeof auditResult.rows[0].payload_json === "string"
      ? JSON.parse(auditResult.rows[0].payload_json)
      : auditResult.rows[0].payload_json;
  assert(Array.isArray(auditPayload.maskedFields), "Masked-field audit payload must include field list");
  assert(auditPayload.maskedFields.length > 0, "Audit payload must describe masked fields");

  console.log("PR-5A verification passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
