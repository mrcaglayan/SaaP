import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  approveApprovalRequest,
  createApprovalPolicy,
  rejectApprovalRequest,
} from "../src/services/approvalPolicies.service.js";
import {
  createPaymentBatch,
  approvePaymentBatch,
  getPaymentBatchDetailByIdForTenant,
} from "../src/services/payments.service.js";
import {
  createInventoryTransfer,
  approveInventoryTransferById,
  getInventoryTransferById,
} from "../src/services/inventory.transfer.service.js";
import { createInventoryWarehouse } from "../src/services/inventory.service.js";
import { createItemCard } from "../src/services/item.card.service.js";
import {
  createLocalClosePack,
  getLocalClosePackById,
} from "../src/services/local.close-packs.service.js";
import {
  createLocalClosePackReopenRequest,
} from "../src/services/local.close-reopen.service.js";
import {
  createPayrollManualSettlementRequest,
} from "../src/services/payroll.settlementOverrides.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function noScopeGuard() {
  return true;
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
  const roleId = toNumber(roleResult.rows?.[0]?.id);
  assert(roleId > 0, `Role ${roleCode} not found`);

  await query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
  const permissionResult = await query(
    `SELECT id, code
       FROM permissions
      WHERE code IN (${permissionCodes.map(() => "?").join(", ")})`,
    permissionCodes
  );
  assert(
    (permissionResult.rows || []).length === permissionCodes.length,
    `Missing permissions for ${roleCode}`
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

async function assignGovernanceReviewerRole({ tenantId, userId }) {
  const roleId = await createRoleWithPermissions(tenantId, "PR3F_GOVERNANCE_REVIEWER", [
    "approvals.requests.read",
    "approvals.requests.approve",
    "approvals.requests.reject",
  ]);

  const roleResult = await query(
    `INSERT INTO user_role_scopes (
        tenant_id,
        user_id,
        role_id,
        scope_type,
        scope_id,
        effect,
        effective_from,
        effective_to
      ) VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW', NULL, NULL)
      ON DUPLICATE KEY UPDATE
        effect = VALUES(effect)`,
    [tenantId, userId, roleId, tenantId]
  );
}

async function createBaseFixture(stamp) {
  const tenantCode = `PR3F_T_${stamp}`;
  await query(`INSERT INTO tenants (code, name) VALUES (?, ?)`, [
    tenantCode,
    `PR3F Tenant ${stamp}`,
  ]);
  const tenantResult = await query(
    `SELECT id
       FROM tenants
      WHERE code = ?
      LIMIT 1`,
    [tenantCode]
  );
  const tenantId = toNumber(tenantResult.rows?.[0]?.id);
  assert(tenantId > 0, "Failed to create PR-3F tenant");

  const countryResult = await query(
    `SELECT id, default_currency_code
       FROM countries
      WHERE iso2 = 'TR'
      LIMIT 1`
  );
  const countryId = toNumber(countryResult.rows?.[0]?.id);
  const currencyCode = String(countryResult.rows?.[0]?.default_currency_code || "TRY");
  assert(countryId > 0, "Missing TR country row");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `PR3F_G_${stamp}`, `PR3F Group ${stamp}`]
  );
  const groupResult = await query(
    `SELECT id
       FROM group_companies
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR3F_G_${stamp}`]
  );
  const groupCompanyId = toNumber(groupResult.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Failed to create group company");

  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    [
      tenantId,
      groupCompanyId,
      `PR3F_LE_${stamp}`,
      `PR3F Legal Entity ${stamp}`,
      countryId,
      currencyCode,
    ]
  );
  const entityResult = await query(
    `SELECT id
       FROM legal_entities
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR3F_LE_${stamp}`]
  );
  const legalEntityId = toNumber(entityResult.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity");

  await query(
    `INSERT INTO operating_units (
        tenant_id,
        legal_entity_id,
        code,
        name,
        unit_type,
        has_subledger,
        status
      ) VALUES (?, ?, ?, ?, 'BRANCH', 1, 'ACTIVE')`,
    [tenantId, legalEntityId, `PR3F_OU_${stamp}`, `PR3F OU ${stamp}`]
  );
  const ouResult = await query(
    `SELECT id
       FROM operating_units
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `PR3F_OU_${stamp}`]
  );
  const operatingUnitId = toNumber(ouResult.rows?.[0]?.id);
  assert(operatingUnitId > 0, "Failed to create operating unit");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
      ) VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `PR3F_CAL_${stamp}`, `PR3F Calendar ${stamp}`]
  );
  const calendarResult = await query(
    `SELECT id
       FROM fiscal_calendars
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR3F_CAL_${stamp}`]
  );
  const calendarId = toNumber(calendarResult.rows?.[0]?.id);
  assert(calendarId > 0, "Failed to create fiscal calendar");

  await query(
    `INSERT INTO fiscal_periods (
        calendar_id,
        fiscal_year,
        period_no,
        period_name,
        start_date,
        end_date,
        is_adjustment
      ) VALUES (?, 2026, 4, 'Apr 2026', '2026-04-01', '2026-04-30', FALSE)`,
    [calendarId]
  );
  const periodResult = await query(
    `SELECT id
       FROM fiscal_periods
      WHERE calendar_id = ?
        AND fiscal_year = 2026
        AND period_no = 4
      LIMIT 1`,
    [calendarId]
  );
  const fiscalPeriodId = toNumber(periodResult.rows?.[0]?.id);
  assert(fiscalPeriodId > 0, "Failed to create fiscal period");

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
      `PR3F_BOOK_${stamp}`,
      `PR3F Book ${stamp}`,
      currencyCode,
    ]
  );
  const bookResult = await query(
    `SELECT id
       FROM books
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR3F_BOOK_${stamp}`]
  );
  const bookId = toNumber(bookResult.rows?.[0]?.id);
  assert(bookId > 0, "Failed to create book");

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
      ) VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, `PR3F_COA_${stamp}`, `PR3F Chart ${stamp}`]
  );
  const coaResult = await query(
    `SELECT id
       FROM charts_of_accounts
      WHERE tenant_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, `PR3F_COA_${stamp}`]
  );
  const coaId = toNumber(coaResult.rows?.[0]?.id);
  assert(coaId > 0, "Failed to create chart of accounts");

  const accountSpecs = [
    ["BANK", `PR3F Bank GL ${stamp}`, "ASSET", "DEBIT"],
    ["PAYABLE", `PR3F Payable GL ${stamp}`, "LIABILITY", "CREDIT"],
    ["INVAST", `PR3F Inventory Asset ${stamp}`, "ASSET", "DEBIT"],
    ["INVTRN", `PR3F Inventory Transit ${stamp}`, "ASSET", "DEBIT"],
    ["COGS", `PR3F COGS ${stamp}`, "EXPENSE", "DEBIT"],
  ];
  for (const [codePrefix, name, accountType, normalSide] of accountSpecs) {
    await query(
      `INSERT INTO accounts (
          coa_id,
          code,
          name,
          account_type,
          normal_side,
          allow_posting,
          parent_account_id,
          is_active
        ) VALUES (?, ?, ?, ?, ?, TRUE, NULL, TRUE)`,
      [coaId, `${codePrefix}_${stamp}`, name, accountType, normalSide]
    );
  }
  const accountRows = await query(
    `SELECT id, name
       FROM accounts
      WHERE coa_id = ?`,
    [coaId]
  );
  const accountsByName = new Map(
    (accountRows.rows || []).map((row) => [String(row.name || ""), toNumber(row.id)])
  );

  const bankGlAccountId = accountsByName.get(`PR3F Bank GL ${stamp}`) || 0;
  const payableGlAccountId = accountsByName.get(`PR3F Payable GL ${stamp}`) || 0;
  const inventoryAssetAccountId = accountsByName.get(`PR3F Inventory Asset ${stamp}`) || 0;
  const inventoryTransitAccountId = accountsByName.get(`PR3F Inventory Transit ${stamp}`) || 0;
  const cogsAccountId = accountsByName.get(`PR3F COGS ${stamp}`) || 0;
  assert(bankGlAccountId > 0, "Missing bank GL account");
  assert(payableGlAccountId > 0, "Missing payable GL account");
  assert(inventoryAssetAccountId > 0, "Missing inventory asset account");
  assert(inventoryTransitAccountId > 0, "Missing inventory transit account");
  assert(cogsAccountId > 0, "Missing COGS account");

  const passwordHash = await bcrypt.hash("PR3F#Smoke123", 10);
  const requesterUserId = await createUser({
    tenantId,
    email: `pr3f_requester_${stamp}@example.com`,
    name: "PR3F Requester",
    passwordHash,
  });
  const approverUserId = await createUser({
    tenantId,
    email: `pr3f_approver_${stamp}@example.com`,
    name: "PR3F Approver",
    passwordHash,
  });

  await query(
    `INSERT INTO bank_accounts (
        tenant_id,
        legal_entity_id,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
    [
      tenantId,
      legalEntityId,
      `PR3F_BA_${stamp}`,
      `PR3F Bank Account ${stamp}`,
      currencyCode,
      bankGlAccountId,
      "PR3F Bank",
      "Main",
      `TR${String(stamp).slice(-20)}`,
      `PR3F${stamp}`,
      requesterUserId,
    ]
  );
  const bankAccountResult = await query(
    `SELECT id
       FROM bank_accounts
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND code = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `PR3F_BA_${stamp}`]
  );
  const bankAccountId = toNumber(bankAccountResult.rows?.[0]?.id);
  assert(bankAccountId > 0, "Failed to create bank account");

  return {
    tenantId,
    legalEntityId,
    operatingUnitId,
    fiscalPeriodId,
    bookId,
    currencyCode,
    requesterUserId,
    approverUserId,
    bankAccountId,
    payableGlAccountId,
    inventoryAssetAccountId,
    inventoryTransitAccountId,
    cogsAccountId,
  };
}

async function createModulePolicy({
  tenantId,
  userId,
  legalEntityId,
  stamp,
  suffix,
  moduleCode,
  targetType,
  actionType,
}) {
  return createApprovalPolicy({
    req: null,
    assertScopeAccess: noScopeGuard,
    input: {
      tenantId,
      userId,
      policyCode: `PR3F_${suffix}_${stamp}`,
      policyName: `PR3F ${suffix} policy`,
      moduleCode,
      status: "ACTIVE",
      targetType,
      actionType,
      scopeType: "LEGAL_ENTITY",
      legalEntityId,
      bankAccountId: null,
      currencyCode: null,
      minAmount: null,
      maxAmount: null,
      requiredApprovals: 1,
      makerCheckerRequired: true,
      approverPermissionCode: "approvals.requests.approve",
      autoExecuteOnFinalApproval: false,
      effectiveFrom: null,
      effectiveTo: null,
    },
  });
}

async function createInventoryFixture({
  tenantId,
  legalEntityId,
  operatingUnitId,
  inventoryAssetAccountId,
  inventoryTransitAccountId,
  cogsAccountId,
  stamp,
}) {
  const sourceWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId,
      legalEntityId,
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId,
      code: `PR3F_WH_SRC_${stamp}`,
      name: `PR3F Source Warehouse ${stamp}`,
      status: "ACTIVE",
    },
  });
  const targetWarehouse = await createInventoryWarehouse({
    payload: {
      tenantId,
      legalEntityId,
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      code: `PR3F_WH_TGT_${stamp}`,
      name: `PR3F Target Warehouse ${stamp}`,
      status: "ACTIVE",
    },
  });
  const itemCard = await createItemCard({
    payload: {
      tenantId,
      legalEntityId,
      code: `PR3F_ITEM_${stamp}`,
      name: `PR3F Item ${stamp}`,
      itemType: "STOCK_ITEM",
      inventoryAssetAccountId,
      inventoryTransitAccountId,
      defaultCogsAccountId: cogsAccountId,
      status: "ACTIVE",
    },
  });

  return {
    sourceWarehouseId: toNumber(sourceWarehouse?.id),
    targetWarehouseId: toNumber(targetWarehouse?.id),
    itemCardId: toNumber(itemCard?.id),
  };
}

async function createPayrollLiabilityFixture({
  tenantId,
  legalEntityId,
  requesterUserId,
  bankAccountId,
  payableGlAccountId,
  currencyCode,
  stamp,
}) {
  await query(
    `INSERT INTO payroll_runs (
        tenant_id,
        legal_entity_id,
        run_no,
        provider_code,
        entity_code,
        payroll_period,
        pay_date,
        currency_code,
        source_batch_ref,
        original_filename,
        file_checksum,
        status,
        line_count_total,
        line_count_inserted,
        employee_count,
        total_net_pay,
        imported_by_user_id
      ) VALUES (?, ?, ?, 'MANUAL', ?, '2026-04-01', '2026-04-30', ?, ?, ?, ?, 'FINALIZED', 1, 1, 1, 250, ?)`,
    [
      tenantId,
      legalEntityId,
      `PR3F_PAYRUN_${stamp}`,
      `PR3F_LE_${stamp}`,
      currencyCode,
      `PR3F_BATCH_${stamp}`,
      `pr3f-payrun-${stamp}.csv`,
      `pr3f-payrun-${stamp}`.padEnd(64, "0").slice(0, 64),
      requesterUserId,
    ]
  );
  const runResult = await query(
    `SELECT id
       FROM payroll_runs
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND run_no = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `PR3F_PAYRUN_${stamp}`]
  );
  const runId = toNumber(runResult.rows?.[0]?.id);
  assert(runId > 0, "Failed to create payroll run");

  await query(
    `INSERT INTO payment_batches (
        tenant_id,
        legal_entity_id,
        batch_no,
        source_type,
        source_id,
        bank_account_id,
        currency_code,
        total_amount,
        status,
        notes,
        created_by_user_id
      ) VALUES (?, ?, ?, 'PAYROLL', ?, ?, ?, 250, 'APPROVED', ?, ?)`,
    [
      tenantId,
      legalEntityId,
      `PR3F_PAYBATCH_${stamp}`,
      runId,
      bankAccountId,
      currencyCode,
      "PR3F payroll batch fixture",
      requesterUserId,
    ]
  );
  const paymentBatchResult = await query(
    `SELECT id
       FROM payment_batches
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND batch_no = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `PR3F_PAYBATCH_${stamp}`]
  );
  const paymentBatchId = toNumber(paymentBatchResult.rows?.[0]?.id);
  assert(paymentBatchId > 0, "Failed to create payroll payment batch");

  await query(
    `INSERT INTO payment_batch_lines (
        tenant_id,
        legal_entity_id,
        batch_id,
        line_no,
        beneficiary_type,
        beneficiary_id,
        beneficiary_name,
        beneficiary_bank_ref,
        payable_entity_type,
        payable_entity_id,
        payable_gl_account_id,
        payable_ref,
        amount,
        status,
        notes
      ) VALUES (?, ?, ?, 1, 'EMPLOYEE', 1, 'PR3F Payroll Employee', 'TRPR3FEMP', 'PAYROLL_LIABILITY', 1, ?, ?, 250, 'PENDING', 'PR3F payroll link fixture')`,
    [
      tenantId,
      legalEntityId,
      paymentBatchId,
      payableGlAccountId,
      `PR3F-LIAB-${stamp}`,
    ]
  );
  const paymentBatchLineResult = await query(
    `SELECT id
       FROM payment_batch_lines
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND batch_id = ?
        AND line_no = 1
      LIMIT 1`,
    [tenantId, legalEntityId, paymentBatchId]
  );
  const paymentBatchLineId = toNumber(paymentBatchLineResult.rows?.[0]?.id);
  assert(paymentBatchLineId > 0, "Failed to create payroll payment batch line");

  await query(
    `INSERT INTO payroll_run_liabilities (
        tenant_id,
        legal_entity_id,
        run_id,
        liability_key,
        liability_type,
        liability_group,
        source_run_line_id,
        employee_code,
        employee_name,
        cost_center_code,
        ownership_scope,
        operating_unit_id,
        beneficiary_type,
        beneficiary_id,
        beneficiary_name,
        beneficiary_bank_ref,
        payable_component_code,
        payable_gl_account_id,
        payable_ref,
        amount,
        settled_amount,
        outstanding_amount,
        currency_code,
        status,
        reserved_payment_batch_id
      ) VALUES (?, ?, ?, ?, 'NET_PAY', 'EMPLOYEE_NET', NULL, 'E001', 'PR3F Employee', 'CC-01', 'CENTRAL', NULL, 'EMPLOYEE', 1, 'PR3F Employee', 'TRPR3FEMP', 'NET_PAY', ?, ?, 250, 0, 250, ?, 'IN_BATCH', ?)`,
    [
      tenantId,
      legalEntityId,
      runId,
      `PR3F_LIAB_${stamp}`,
      payableGlAccountId,
      `PR3F-PAYABLE-${stamp}`,
      currencyCode,
      paymentBatchId,
    ]
  );
  const liabilityResult = await query(
    `SELECT id
       FROM payroll_run_liabilities
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND liability_key = ?
      LIMIT 1`,
    [tenantId, legalEntityId, `PR3F_LIAB_${stamp}`]
  );
  const liabilityId = toNumber(liabilityResult.rows?.[0]?.id);
  assert(liabilityId > 0, "Failed to create payroll liability");

  await query(
    `INSERT INTO payroll_liability_payment_links (
        tenant_id,
        legal_entity_id,
        run_id,
        payroll_liability_id,
        payment_batch_id,
        payment_batch_line_id,
        allocated_amount,
        settled_amount,
        settled_at,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, 250, 0, NULL, 'LINKED')`,
    [tenantId, legalEntityId, runId, liabilityId, paymentBatchId, paymentBatchLineId]
  );

  return { runId, liabilityId };
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createBaseFixture(stamp);
  await seedCore({ ensureDefaultTenantIfMissing: true });
  await assignGovernanceReviewerRole({
    tenantId: fixture.tenantId,
    userId: fixture.approverUserId,
  });

  await createModulePolicy({
    tenantId: fixture.tenantId,
    userId: fixture.requesterUserId,
    legalEntityId: fixture.legalEntityId,
    stamp,
    suffix: "PAYMENTS",
    moduleCode: "PAYMENTS",
    targetType: "PAYMENT_BATCH",
    actionType: "APPROVE",
  });
  await createModulePolicy({
    tenantId: fixture.tenantId,
    userId: fixture.requesterUserId,
    legalEntityId: fixture.legalEntityId,
    stamp,
    suffix: "INVENTORY",
    moduleCode: "INVENTORY",
    targetType: "INVENTORY_TRANSFER",
    actionType: "APPROVE",
  });
  await createModulePolicy({
    tenantId: fixture.tenantId,
    userId: fixture.requesterUserId,
    legalEntityId: fixture.legalEntityId,
    stamp,
    suffix: "PAYROLL",
    moduleCode: "PAYROLL",
    targetType: "PAYROLL_MANUAL_SETTLEMENT_OVERRIDE",
    actionType: "APPLY",
  });
  await createModulePolicy({
    tenantId: fixture.tenantId,
    userId: fixture.requesterUserId,
    legalEntityId: fixture.legalEntityId,
    stamp,
    suffix: "LOCAL_CLOSE",
    moduleCode: "LOCAL_CLOSE",
    targetType: "LOCAL_CLOSE_PACK_REOPEN_REQUEST",
    actionType: "REOPEN",
  });

  const paymentBatch = await createPaymentBatch({
    req: null,
    payload: {
      tenantId: fixture.tenantId,
      userId: fixture.requesterUserId,
      sourceType: "MANUAL",
      sourceId: null,
      bankAccountId: fixture.bankAccountId,
      currencyCode: fixture.currencyCode,
      idempotencyKey: `PR3F-PAY-${stamp}`,
      notes: "PR3F payment batch",
      lines: [
        {
          beneficiaryType: "VENDOR",
          beneficiaryId: 1001,
          beneficiaryName: "PR3F Vendor",
          beneficiaryBankRef: "TR00PR3FVENDOR",
          payableEntityType: "AP",
          payableEntityId: 1001,
          payableGlAccountId: fixture.payableGlAccountId,
          payableRef: `PR3F-AP-${stamp}`,
          amount: 150,
          notes: "PR3F payment line",
        },
      ],
    },
    assertScopeAccess: noScopeGuard,
  });
  const paymentApprovalSubmission = await approvePaymentBatch({
    req: null,
    tenantId: fixture.tenantId,
    batchId: toNumber(paymentBatch?.id),
    userId: fixture.requesterUserId,
    approveInput: { note: "Submit payment batch approval" },
    assertScopeAccess: noScopeGuard,
  });
  const paymentApprovalRequestId = toNumber(paymentApprovalSubmission?.approvalRequestId);
  assert(
    toUpper(paymentApprovalSubmission?.status) === "DRAFT" && paymentApprovalRequestId > 0,
    "Payment batch should stay DRAFT while unified approval is pending"
  );
  const paymentApproval = await approveApprovalRequest({
    req: null,
    tenantId: fixture.tenantId,
    requestId: paymentApprovalRequestId,
    userId: fixture.approverUserId,
    decisionComment: "PR3F payment approve",
    assertScopeAccess: noScopeGuard,
  });
  assert(
    toUpper(paymentApproval?.item?.executionStatus ?? paymentApproval?.item?.execution_status) ===
      "EXECUTED",
    "Payment approval request should execute on final approval"
  );
  const approvedPaymentBatch = await getPaymentBatchDetailByIdForTenant({
    req: null,
    tenantId: fixture.tenantId,
    batchId: toNumber(paymentBatch?.id),
    assertScopeAccess: noScopeGuard,
  });
  assert(
    toUpper(approvedPaymentBatch?.status) === "APPROVED" &&
      toNumber(approvedPaymentBatch?.approvalRequestId) === paymentApprovalRequestId,
    "Payment batch should sync back to APPROVED with unified approval_request_id"
  );

  const inventoryFixture = await createInventoryFixture({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    operatingUnitId: fixture.operatingUnitId,
    inventoryAssetAccountId: fixture.inventoryAssetAccountId,
    inventoryTransitAccountId: fixture.inventoryTransitAccountId,
    cogsAccountId: fixture.cogsAccountId,
    stamp,
  });
  const inventoryTransfer = await createInventoryTransfer({
    payload: {
      tenantId: fixture.tenantId,
      userId: fixture.requesterUserId,
      legalEntityId: fixture.legalEntityId,
      transferDate: "2026-04-15",
      sourceWarehouseId: inventoryFixture.sourceWarehouseId,
      targetWarehouseId: inventoryFixture.targetWarehouseId,
      note: "PR3F inventory transfer",
      lines: [
        {
          itemCardId: inventoryFixture.itemCardId,
          quantityRequested: "5.000000",
        },
      ],
    },
  });
  const inventoryApprovalSubmission = await approveInventoryTransferById({
    payload: {
      tenantId: fixture.tenantId,
      transferId: toNumber(inventoryTransfer?.id),
      userId: fixture.requesterUserId,
      note: "Submit inventory approval",
    },
  });
  const inventoryApprovalRequestId = toNumber(inventoryApprovalSubmission?.approvalRequestId);
  assert(
    toUpper(inventoryApprovalSubmission?.status) === "INITIATED" &&
      inventoryApprovalRequestId > 0,
    "Inventory transfer should remain INITIATED while unified approval is pending"
  );
  const inventoryApproval = await approveApprovalRequest({
    req: null,
    tenantId: fixture.tenantId,
    requestId: inventoryApprovalRequestId,
    userId: fixture.approverUserId,
    decisionComment: "PR3F inventory approve",
    assertScopeAccess: noScopeGuard,
  });
  assert(
    toUpper(
      inventoryApproval?.item?.executionStatus ?? inventoryApproval?.item?.execution_status
    ) === "EXECUTED",
    "Inventory approval request should execute on final approval"
  );
  const approvedTransfer = await getInventoryTransferById({
    tenantId: fixture.tenantId,
    transferId: toNumber(inventoryTransfer?.id),
  });
  assert(
    toUpper(approvedTransfer?.status) === "APPROVED" &&
      toNumber(approvedTransfer?.approvalRequestId) === inventoryApprovalRequestId,
    "Inventory transfer should sync back to APPROVED with unified approval_request_id"
  );

  const localClosePack = await createLocalClosePack({
    req: null,
    input: {
      tenantId: fixture.tenantId,
      userId: fixture.requesterUserId,
      legalEntityId: fixture.legalEntityId,
      bookId: fixture.bookId,
      fiscalPeriodId: fixture.fiscalPeriodId,
      closeScopeType: "CENTRAL",
      operatingUnitId: null,
      status: "APPROVED",
      note: "PR3F local close pack",
    },
    assertScopeAccess: noScopeGuard,
  });
  const localCloseRequest = await createLocalClosePackReopenRequest({
    req: null,
    input: {
      tenantId: fixture.tenantId,
      userId: fixture.requesterUserId,
      packId: toNumber(localClosePack?.id),
      reasonCode: "PR3F_REOPEN",
      requestedActionType: "RECLASS_REQUIRED",
      explanation: "PR3F financial reopen",
      materialityLevel: "MATERIAL",
      estimatedImpactNote: "PR3F reopen impact",
      downstreamStage: "ENTITY_SUBMITTED",
    },
    assertScopeAccess: noScopeGuard,
  });
  const localCloseApprovalRequestId = toNumber(localCloseRequest?.row?.approvalRequestId);
  assert(
    toUpper(localCloseRequest?.row?.requestStatus) === "REQUESTED" &&
      localCloseApprovalRequestId > 0,
    "Local close reopen request should bridge to unified approval"
  );
  const localCloseApproval = await approveApprovalRequest({
    req: null,
    tenantId: fixture.tenantId,
    requestId: localCloseApprovalRequestId,
    userId: fixture.approverUserId,
    decisionComment: "PR3F local close approve",
    assertScopeAccess: noScopeGuard,
  });
  assert(
    toUpper(
      localCloseApproval?.item?.executionStatus ?? localCloseApproval?.item?.execution_status
    ) === "EXECUTED",
    "Local close reopen approval should execute on final approval"
  );
  const reopenedPack = await getLocalClosePackById({
    req: null,
    tenantId: fixture.tenantId,
    packId: toNumber(localClosePack?.id),
    assertScopeAccess: noScopeGuard,
  });
  assert(
    toUpper(reopenedPack?.status) === "REOPENED",
    "Local close pack should move to REOPENED after unified execution"
  );

  const payrollFixture = await createPayrollLiabilityFixture({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    requesterUserId: fixture.requesterUserId,
    bankAccountId: fixture.bankAccountId,
    payableGlAccountId: fixture.payableGlAccountId,
    currencyCode: fixture.currencyCode,
    stamp,
  });
  const payrollRequest = await createPayrollManualSettlementRequest({
    req: null,
    tenantId: fixture.tenantId,
    liabilityId: payrollFixture.liabilityId,
    userId: fixture.requesterUserId,
    input: {
      amount: 50,
      settledAt: "2026-04-20 11:00:00",
      reason: "PR3F payroll override",
      externalRef: `PR3F-PAYROLL-${stamp}`,
      idempotencyKey: `PR3F-PAYROLL-REQ-${stamp}`,
    },
    assertScopeAccess: noScopeGuard,
  });
  const payrollApprovalRequestId = toNumber(payrollRequest?.request?.approvalRequestId);
  assert(
    toUpper(payrollRequest?.request?.status) === "REQUESTED" &&
      payrollApprovalRequestId > 0,
    "Payroll manual override request should bridge to unified approval"
  );
  const payrollReject = await rejectApprovalRequest({
    req: null,
    tenantId: fixture.tenantId,
    requestId: payrollApprovalRequestId,
    userId: fixture.approverUserId,
    decisionComment: "PR3F payroll reject",
    assertScopeAccess: noScopeGuard,
  });
  assert(
    toUpper(payrollReject?.item?.requestStatus ?? payrollReject?.item?.request_status) ===
      "REJECTED",
    "Payroll override approval request should be rejected through the generic queue"
  );
  const payrollRows = await query(
    `SELECT status, approval_request_id
       FROM payroll_liability_override_requests
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [fixture.tenantId, toNumber(payrollRequest?.request?.id)]
  );
  const payrollRow = payrollRows.rows?.[0] || null;
  assert(
    toUpper(payrollRow?.status) === "REJECTED" &&
      toNumber(payrollRow?.approval_request_id) === payrollApprovalRequestId,
    "Payroll override request should sync back to REJECTED with unified approval_request_id"
  );

  console.log(
    "PR-3F smoke passed (payments, inventory transfer, payroll override reject, and local close reopen all bridge through the unified approval engine)."
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
