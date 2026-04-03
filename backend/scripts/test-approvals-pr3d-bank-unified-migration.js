import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  approveBankApprovalRequest,
  rejectBankApprovalRequest,
  submitBankApprovalRequest,
} from "../src/services/bank.approvals.service.js";
import { createBankApprovalPolicy } from "../src/services/bank.approvalPolicies.service.js";
import {
  evaluateApprovalNeed,
  submitApprovalRequest,
} from "../src/services/approvalPolicies.service.js";

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

async function expectFailure(work, { status, includes }) {
  try {
    await work();
  } catch (error) {
    if (status !== undefined && Number(error?.status || 0) !== Number(status)) {
      throw new Error(
        `Expected error status ${status} but got ${String(error?.status)} message=${String(
          error?.message || ""
        )}`
      );
    }
    if (includes && !String(error?.message || "").includes(includes)) {
      throw new Error(
        `Expected error message to include "${includes}" but got "${String(error?.message || "")}"`
      );
    }
    return;
  }
  throw new Error("Expected operation to fail, but it succeeded");
}

async function createTenantWithLegalEntity(stamp) {
  const tenantCode = `PR3D_T_${stamp}`;
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `PR3D Tenant ${stamp}`]
  );
  const tenantRows = await query(
    `SELECT id
     FROM tenants
     WHERE code = ?
     LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantRows.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to create tenant fixture");

  const countryRows = await query(
    `SELECT id, default_currency_code
     FROM countries
     WHERE iso2 = 'TR'
     LIMIT 1`
  );
  const countryId = toNumber(countryRows.rows?.[0]?.id);
  const currencyCode = String(countryRows.rows?.[0]?.default_currency_code || "TRY");
  assert(countryId > 0, "Missing country seed row (TR)");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `PR3D_G_${stamp}`, `PR3D Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PR3D_G_${stamp}`]
  );
  const groupCompanyId = toNumber(groupRows.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Failed to create group company fixture");

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
      `PR3D_LE_${stamp}`,
      `PR3D Legal Entity ${stamp}`,
      countryId,
      currencyCode,
    ]
  );
  const legalEntityRows = await query(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PR3D_LE_${stamp}`]
  );
  const legalEntityId = toNumber(legalEntityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity fixture");

  return { tenantId, legalEntityId };
}

async function createUser({ tenantId, email, name, passwordHash }) {
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name]
  );
  const rows = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email]
  );
  const userId = toNumber(rows.rows?.[0]?.id);
  assert(userId > 0, `Failed to create user: ${email}`);
  return userId;
}

async function assignRole({ tenantId, userId, roleCode }) {
  const roleRows = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, roleCode]
  );
  const roleId = toNumber(roleRows.rows?.[0]?.id);
  assert(roleId > 0, `${roleCode} role not found for tenant`);

  await query(
    `INSERT INTO user_role_scopes (
        tenant_id, user_id, role_id, scope_type, scope_id, effect
      )
      VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
      ON DUPLICATE KEY UPDATE
        effect = VALUES(effect)`,
    [tenantId, userId, roleId, tenantId]
  );
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const { tenantId, legalEntityId } = await createTenantWithLegalEntity(stamp);
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash("PR3D#Smoke123", 10);
  const requesterUserId = await createUser({
    tenantId,
    email: `pr3d_requester_${stamp}@example.com`,
    name: "PR3D Requester",
    passwordHash,
  });
  const approverUserId = await createUser({
    tenantId,
    email: `pr3d_approver_${stamp}@example.com`,
    name: "PR3D Approver",
    passwordHash,
  });
  await assignRole({
    tenantId,
    userId: requesterUserId,
    roleCode: "TreasuryApprover",
  });
  await assignRole({
    tenantId,
    userId: approverUserId,
    roleCode: "TreasuryApprover",
  });

  const bankPolicy = await createBankApprovalPolicy({
    req: null,
    assertScopeAccess: noScopeGuard,
    input: {
      tenantId,
      userId: requesterUserId,
      policyCode: `PR3D_BANK_${stamp}`,
      policyName: "PR3D bank policy",
      moduleCode: "BANK",
      status: "ACTIVE",
      targetType: "RECON_RULE",
      actionType: "UPDATE",
      scopeType: "LEGAL_ENTITY",
      legalEntityId,
      bankAccountId: null,
      currencyCode: "TRY",
      minAmount: 0,
      maxAmount: 100000,
      requiredApprovals: 1,
      makerCheckerRequired: true,
      approverPermissionCode: "bank.approvals.requests.approve",
      autoExecuteOnFinalApproval: false,
      effectiveFrom: null,
      effectiveTo: null,
    },
  });
  const bankPolicyRowRes = await query(
    `SELECT generic_policy_id
     FROM bank_approval_policies
     WHERE tenant_id = ?
       AND id = ?`,
    [tenantId, bankPolicy.id]
  );
  const genericPolicyId = toNumber(bankPolicyRowRes.rows?.[0]?.generic_policy_id);
  assert(genericPolicyId > 0, "Legacy bank policy should be bridged to approval_policies");

  const genericPolicyRes = await query(
    `SELECT module_code, target_type, action_type
     FROM approval_policies
     WHERE tenant_id = ?
       AND id = ?`,
    [tenantId, genericPolicyId]
  );
  assert(
    String(genericPolicyRes.rows?.[0]?.module_code || "").toUpperCase() === "BANK",
    "Generic bridged policy should keep module_code=BANK"
  );

  const submitBankRes = await submitBankApprovalRequest({
    tenantId,
    userId: requesterUserId,
    requestInput: {
      moduleCode: "BANK",
      requestKey: `PR3D_BANK_REQ_${stamp}`,
      policyCode: bankPolicy.policy_code,
      targetType: "RECON_RULE",
      targetId: 9101,
      actionType: "UPDATE",
      legalEntityId,
      thresholdAmount: 1250.5,
      currencyCode: "TRY",
      targetSnapshot: {
        target_type: "RECON_RULE",
        target_id: 9101,
        legal_entity_id: legalEntityId,
      },
      actionPayload: {
        ruleId: 9101,
        draftVersion: 4,
      },
    },
  });
  assert(submitBankRes.approval_required === true, "Bank submit should require approval");
  const legacyBankRequestId = toNumber(submitBankRes.item?.id);
  const genericBankRequestId = toNumber(submitBankRes.item?.generic_request_id);
  assert(legacyBankRequestId > 0, "Legacy bank request id missing");
  assert(genericBankRequestId > 0, "Generic bridged bank request id missing");

  const genericBankRequestRes = await query(
    `SELECT module_code, request_status, execution_status
     FROM approval_requests
     WHERE tenant_id = ?
       AND id = ?`,
    [tenantId, genericBankRequestId]
  );
  assert(
    String(genericBankRequestRes.rows?.[0]?.module_code || "").toUpperCase() === "BANK",
    "Bridged generic request should keep module_code=BANK"
  );
  assert(
    String(genericBankRequestRes.rows?.[0]?.request_status || "").toUpperCase() ===
      "PENDING_REVIEW",
    "New generic bank request should start in PENDING_REVIEW"
  );

  await expectFailure(
    () =>
      approveBankApprovalRequest({
        req: null,
        tenantId,
        requestId: legacyBankRequestId,
        userId: requesterUserId,
        decisionComment: "self-approval should fail",
        assertScopeAccess: noScopeGuard,
      }),
    { status: 403, includes: "Maker-checker violation" }
  );

  const approveBankRes = await approveBankApprovalRequest({
    req: null,
    tenantId,
    requestId: legacyBankRequestId,
    userId: approverUserId,
    decisionComment: "approved through bridged generic engine",
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(approveBankRes?.item?.request_status || "").toUpperCase() === "APPROVED",
    "Legacy bank bridge row should become APPROVED"
  );
  const approvedGenericRes = await query(
    `SELECT request_status, execution_status
     FROM approval_requests
     WHERE tenant_id = ?
       AND id = ?`,
    [tenantId, genericBankRequestId]
  );
  assert(
    String(approvedGenericRes.rows?.[0]?.request_status || "").toUpperCase() === "APPROVED",
    "Generic bridged bank request should become APPROVED"
  );

  const decisionBridgeCounts = await query(
    `SELECT
        (SELECT COUNT(*) FROM bank_approval_request_decisions WHERE tenant_id = ? AND bank_approval_request_id = ?) AS legacy_count,
        (SELECT COUNT(*) FROM approval_decisions WHERE tenant_id = ? AND request_id = ?) AS generic_count`,
    [tenantId, legacyBankRequestId, tenantId, genericBankRequestId]
  );
  assert(
    toNumber(decisionBridgeCounts.rows?.[0]?.legacy_count) >= 1,
    "Legacy decision table should stay populated for bridged bank approvals"
  );
  assert(
    toNumber(decisionBridgeCounts.rows?.[0]?.generic_count) >= 1,
    "Generic decision table should record bridged bank approvals"
  );

  const rejectSubmit = await submitBankApprovalRequest({
    tenantId,
    userId: requesterUserId,
    requestInput: {
      moduleCode: "BANK",
      requestKey: `PR3D_BANK_REJECT_${stamp}`,
      policyCode: bankPolicy.policy_code,
      targetType: "RECON_RULE",
      targetId: 9102,
      actionType: "UPDATE",
      legalEntityId,
      thresholdAmount: 300,
      currencyCode: "TRY",
      targetSnapshot: {
        target_type: "RECON_RULE",
        target_id: 9102,
        legal_entity_id: legalEntityId,
      },
      actionPayload: { ruleId: 9102 },
    },
  });
  const rejectLegacyRequestId = toNumber(rejectSubmit.item?.id);
  const rejectGenericRequestId = toNumber(rejectSubmit.item?.generic_request_id);
  assert(rejectLegacyRequestId > 0 && rejectGenericRequestId > 0, "Reject bridge rows should exist");

  const rejectBankRes = await rejectBankApprovalRequest({
    req: null,
    tenantId,
    requestId: rejectLegacyRequestId,
    userId: approverUserId,
    decisionComment: "reject through bridged generic engine",
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(rejectBankRes?.item?.request_status || "").toUpperCase() === "REJECTED",
    "Legacy reject bridge row should become REJECTED"
  );
  const rejectGenericRes = await query(
    `SELECT request_status
     FROM approval_requests
     WHERE tenant_id = ?
       AND id = ?`,
    [tenantId, rejectGenericRequestId]
  );
  assert(
    String(rejectGenericRes.rows?.[0]?.request_status || "").toUpperCase() === "REJECTED",
    "Generic bridged bank request should become REJECTED"
  );

  const payrollPolicy = await createBankApprovalPolicy({
    req: null,
    assertScopeAccess: noScopeGuard,
    input: {
      tenantId,
      userId: requesterUserId,
      policyCode: `PR3D_PAYROLL_${stamp}`,
      policyName: "PR3D payroll policy",
      moduleCode: "PAYROLL",
      status: "ACTIVE",
      targetType: "PAYROLL_PROVIDER_IMPORT",
      actionType: "APPLY",
      scopeType: "LEGAL_ENTITY",
      legalEntityId,
      bankAccountId: null,
      currencyCode: "TRY",
      minAmount: 0,
      maxAmount: 500000,
      requiredApprovals: 1,
      makerCheckerRequired: true,
      approverPermissionCode: "approvals.requests.approve",
      autoExecuteOnFinalApproval: false,
      effectiveFrom: null,
      effectiveTo: null,
    },
  });
  const payrollPolicyBridgeRes = await query(
    `SELECT generic_policy_id
     FROM bank_approval_policies
     WHERE tenant_id = ?
       AND id = ?`,
    [tenantId, payrollPolicy.id]
  );
  const payrollGenericPolicyId = toNumber(payrollPolicyBridgeRes.rows?.[0]?.generic_policy_id);
  assert(payrollGenericPolicyId > 0, "PAYROLL policy should also mirror into approval_policies");

  const payrollGov = await evaluateApprovalNeed({
    moduleCode: "PAYROLL",
    tenantId,
    targetType: "PAYROLL_PROVIDER_IMPORT",
    actionType: "APPLY",
    legalEntityId,
    thresholdAmount: 1400,
    currencyCode: "TRY",
  });
  assert(payrollGov?.approval_required === true, "PAYROLL generic evaluation should require approval");
  assert(
    toNumber(payrollGov?.policy?.id) === payrollGenericPolicyId,
    "PAYROLL generic evaluation should resolve the mirrored generic policy"
  );

  const payrollSubmit = await submitApprovalRequest({
    tenantId,
    userId: requesterUserId,
    requestInput: {
      moduleCode: "PAYROLL",
      requestKey: `PR3D_PAYROLL_REQ_${stamp}`,
      targetType: "PAYROLL_PROVIDER_IMPORT",
      targetId: 77,
      actionType: "APPLY",
      legalEntityId,
      thresholdAmount: 1400,
      currencyCode: "TRY",
      actionPayload: { importJobId: 77 },
      targetSnapshot: {
        module_code: "PAYROLL",
        target_type: "PAYROLL_PROVIDER_IMPORT",
        target_id: 77,
        legal_entity_id: legalEntityId,
      },
    },
  });
  assert(
    payrollSubmit?.approval_required === true && toNumber(payrollSubmit?.item?.id) > 0,
    "PAYROLL generic submit should create a generic approval request"
  );

  const payrollGenericRequestId = toNumber(payrollSubmit.item?.id);
  const payrollGenericRequestRes = await query(
    `SELECT module_code
     FROM approval_requests
     WHERE tenant_id = ?
       AND id = ?`,
    [tenantId, payrollGenericRequestId]
  );
  assert(
    String(payrollGenericRequestRes.rows?.[0]?.module_code || "").toUpperCase() === "PAYROLL",
    "PAYROLL submit should write to approval_requests"
  );
  const payrollLegacyBridgeRes = await query(
    `SELECT COUNT(*) AS total
     FROM bank_approval_requests
     WHERE tenant_id = ?
       AND generic_request_id = ?`,
    [tenantId, payrollGenericRequestId]
  );
  assert(
    toNumber(payrollLegacyBridgeRes.rows?.[0]?.total) === 0,
    "PAYROLL generic submit should not create a legacy bank approval request row"
  );

  console.log(
    "PR-3D smoke test passed (policy bridge + bank unified engine delegation + payroll generic facade)."
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
