import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  finalizePayrollRunAccrual,
  getPayrollRunAccrualPreview,
  markPayrollRunReviewed,
} from "../src/services/payroll.accruals.service.js";
import { createPayrollEmployeeBeneficiaryBankAccount } from "../src/services/payroll.beneficiaries.service.js";
import {
  buildPayrollRunLiabilities,
  createPayrollRunPaymentBatchFromLiabilities,
  getPayrollRunLiabilityPaymentBatchPreview,
} from "../src/services/payroll.liabilities.service.js";
import { upsertPayrollComponentMapping } from "../src/services/payroll.mappings.service.js";
import { createPayrollOwnershipAssignment } from "../src/services/payroll.ownership.service.js";
import { importPayrollRunCsv } from "../src/services/payroll.runs.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(6));
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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

function buildCsv(rows) {
  return [
    "employee_code,employee_name,cost_center_code,base_salary,overtime_pay,bonus_pay,allowances_total,gross_pay,employee_tax,employee_social_security,other_deductions,employer_tax,employer_social_security,net_pay",
    ...rows,
  ].join("\n");
}

async function createFixture(stamp) {
  const tenantCode = `POU06_T_${stamp}`;
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `POU06 Tenant ${stamp}`]
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
  assert(countryId > 0, "Missing TR country seed");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `POU06_G_${stamp}`, `POU06 Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `POU06_G_${stamp}`]
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
      `POU06_LE_${stamp}`,
      `POU06 Legal Entity ${stamp}`,
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
    [tenantId, `POU06_LE_${stamp}`]
  );
  const legalEntityId = toNumber(legalEntityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity fixture");

  await query(
    `INSERT INTO operating_units (
        tenant_id,
        legal_entity_id,
        code,
        name,
        unit_type,
        has_subledger,
        status
      )
      VALUES (?, ?, ?, ?, 'BRANCH', TRUE, 'ACTIVE')`,
    [tenantId, legalEntityId, `POU06_OU_${stamp}`, `POU06 OU ${stamp}`]
  );
  const operatingUnitRows = await query(
    `SELECT id
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `POU06_OU_${stamp}`]
  );
  const operatingUnitId = toNumber(operatingUnitRows.rows?.[0]?.id);
  assert(operatingUnitId > 0, "Failed to create operating unit fixture");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id, code, name, year_start_month, year_start_day
      )
      VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `POU06_CAL_${stamp}`, `POU06 Calendar ${stamp}`]
  );
  const calendarRows = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `POU06_CAL_${stamp}`]
  );
  const calendarId = toNumber(calendarRows.rows?.[0]?.id);
  assert(calendarId > 0, "Failed to create fiscal calendar fixture");

  await query(
    `INSERT INTO fiscal_periods (
        calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
      )
      VALUES (?, 2026, 2, '2026-02', '2026-02-01', '2026-02-28', FALSE)`,
    [calendarId]
  );

  await query(
    `INSERT INTO books (
        tenant_id, legal_entity_id, calendar_id, code, name, book_type, base_currency_code
      )
      VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)`,
    [
      tenantId,
      legalEntityId,
      calendarId,
      `POU06_BOOK_${stamp}`,
      `POU06 Book ${stamp}`,
      currencyCode,
    ]
  );

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id, legal_entity_id, scope, code, name
      )
      VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, `POU06_COA_${stamp}`, `POU06 Chart ${stamp}`]
  );
  const coaRows = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `POU06_COA_${stamp}`]
  );
  const coaId = toNumber(coaRows.rows?.[0]?.id);
  assert(coaId > 0, "Failed to create chart fixture");

  const accountDefs = [
    [`POU06BANKC${stamp}`, `POU06 Central Bank GL ${stamp}`, "ASSET", "DEBIT"],
    [`POU06BANKO${stamp}`, `POU06 OU Bank GL ${stamp}`, "ASSET", "DEBIT"],
    [`POU06EXP${stamp}`, `POU06 Expense GL ${stamp}`, "EXPENSE", "DEBIT"],
    [`POU06LIA${stamp}`, `POU06 Liability GL ${stamp}`, "LIABILITY", "CREDIT"],
  ];
  for (const [code, name, accountType, normalSide] of accountDefs) {
    await query(
      `INSERT INTO accounts (
          coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id, is_active
        )
        VALUES (?, ?, ?, ?, ?, TRUE, NULL, TRUE)`,
      [coaId, code, name, accountType, normalSide]
    );
  }

  const centralBankGlRows = await query(
    `SELECT id FROM accounts WHERE coa_id = ? AND name = ? LIMIT 1`,
    [coaId, `POU06 Central Bank GL ${stamp}`]
  );
  const ouBankGlRows = await query(
    `SELECT id FROM accounts WHERE coa_id = ? AND name = ? LIMIT 1`,
    [coaId, `POU06 OU Bank GL ${stamp}`]
  );
  const expenseRows = await query(
    `SELECT id FROM accounts WHERE coa_id = ? AND name = ? LIMIT 1`,
    [coaId, `POU06 Expense GL ${stamp}`]
  );
  const liabilityRows = await query(
    `SELECT id FROM accounts WHERE coa_id = ? AND name = ? LIMIT 1`,
    [coaId, `POU06 Liability GL ${stamp}`]
  );
  const centralBankGlAccountId = toNumber(centralBankGlRows.rows?.[0]?.id);
  const ouBankGlAccountId = toNumber(ouBankGlRows.rows?.[0]?.id);
  const expenseGlAccountId = toNumber(expenseRows.rows?.[0]?.id);
  const liabilityGlAccountId = toNumber(liabilityRows.rows?.[0]?.id);
  assert(centralBankGlAccountId > 0, "Missing central bank GL");
  assert(ouBankGlAccountId > 0, "Missing OU bank GL");
  assert(expenseGlAccountId > 0, "Missing expense GL");
  assert(liabilityGlAccountId > 0, "Missing liability GL");

  const passwordHash = await bcrypt.hash("POU06#Smoke123", 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pou06_user_${stamp}@example.com`, passwordHash, "POU06 User"]
  );
  const userRows = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, `pou06_user_${stamp}@example.com`]
  );
  const userId = toNumber(userRows.rows?.[0]?.id);
  assert(userId > 0, "Failed to create user fixture");

  async function createBankAccount({
    code,
    name,
    glAccountId,
    operatingUnitId: bankOperatingUnitId,
    ibanSeed,
  }) {
    await query(
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
      [
        tenantId,
        legalEntityId,
        bankOperatingUnitId || null,
        code,
        name,
        currencyCode,
        glAccountId,
        "Smoke Bank",
        "Main",
        `TR${String(ibanSeed).padStart(24, "0").slice(-24)}`,
        String(ibanSeed).slice(-18),
        userId,
      ]
    );
    const rows = await query(
      `SELECT id
       FROM bank_accounts
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, legalEntityId, code]
    );
    return toNumber(rows.rows?.[0]?.id);
  }

  const centralBankAccountId = await createBankAccount({
    code: `POU06_BA_C_${stamp}`,
    name: `POU06 Central Bank ${stamp}`,
    glAccountId: centralBankGlAccountId,
    operatingUnitId: null,
    ibanSeed: `${stamp}11`,
  });
  const ouBankAccountId = await createBankAccount({
    code: `POU06_BA_OU_${stamp}`,
    name: `POU06 OU Bank ${stamp}`,
    glAccountId: ouBankGlAccountId,
    operatingUnitId,
    ibanSeed: `${stamp}22`,
  });
  assert(centralBankAccountId > 0, "Failed to create central bank account");
  assert(ouBankAccountId > 0, "Failed to create OU bank account");

  return {
    tenantId,
    legalEntityId,
    operatingUnitId,
    userId,
    currencyCode,
    centralBankAccountId,
    ouBankAccountId,
    expenseGlAccountId,
    liabilityGlAccountId,
  };
}

async function seedOwnershipAssignments(fixture) {
  await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "E001",
      employeeNameSnapshot: "Alpha User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-01",
      sourceType: "MANUAL",
      notes: "POU06 central owner",
    },
    assertScopeAccess: noScopeGuard,
  });

  await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "E002",
      employeeNameSnapshot: "Beta User",
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: fixture.operatingUnitId,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-02",
      sourceType: "MANUAL",
      notes: "POU06 OU owner",
    },
    assertScopeAccess: noScopeGuard,
  });
}

async function seedBeneficiaries(fixture, stamp) {
  for (const employee of [
    { code: "E001", name: "Alpha User", suffix: "01" },
    { code: "E002", name: "Beta User", suffix: "02" },
  ]) {
    await createPayrollEmployeeBeneficiaryBankAccount({
      req: null,
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      input: {
        legalEntityId: fixture.legalEntityId,
        employeeCode: employee.code,
        employeeName: employee.name,
        accountHolderName: employee.name,
        bankName: "Smoke Bank",
        bankBranchName: "Main",
        countryCode: "TR",
        currencyCode: fixture.currencyCode,
        iban: `TR00${employee.code}${String(stamp).slice(-8)}${employee.suffix}`,
        accountNumber: null,
        routingNumber: null,
        swiftBic: null,
        isPrimary: true,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        verificationStatus: "VERIFIED",
        sourceType: "MANUAL",
        externalRef: null,
        reason: "POU06 setup",
      },
      assertScopeAccess: noScopeGuard,
    });
  }
}

async function finalizeRunAndBuildLiabilities({
  fixture,
  providerCode,
  csvText,
  sourceBatchRef,
}) {
  const imported = await importPayrollRunCsv({
    req: null,
    payload: {
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      legalEntityId: fixture.legalEntityId,
      providerCode,
      payrollPeriod: "2026-02-01",
      payDate: "2026-02-15",
      currencyCode: fixture.currencyCode,
      sourceBatchRef,
      originalFilename: `${sourceBatchRef}.csv`,
      csvText,
    },
    assertScopeAccess: noScopeGuard,
  });
  const runId = toNumber(imported?.id);
  assert(runId > 0, "importPayrollRunCsv should return run id");

  const accrualPreview = await getPayrollRunAccrualPreview({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    assertScopeAccess: noScopeGuard,
  });
  const uniqueComponents = Array.from(
    new Set(
      (accrualPreview.component_totals || []).map((component) =>
        normalizeUpperText(component?.component_code)
      )
    )
  );
  for (const componentCode of uniqueComponents) {
    const component = (accrualPreview.component_totals || []).find(
      (row) => normalizeUpperText(row?.component_code) === componentCode
    );
    const entrySide = normalizeUpperText(component?.entry_side);
    await upsertPayrollComponentMapping({
      req: null,
      payload: {
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        legalEntityId: fixture.legalEntityId,
        entityCodeInput: null,
        providerCode,
        currencyCode: fixture.currencyCode,
        componentCode,
        entrySide,
        glAccountId:
          entrySide === "DEBIT" ? fixture.expenseGlAccountId : fixture.liabilityGlAccountId,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        closePreviousOpenMapping: true,
        notes: `POU06 mapping ${providerCode}`,
      },
      assertScopeAccess: noScopeGuard,
    });
  }

  await markPayrollRunReviewed({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    note: `review ${providerCode}`,
    assertScopeAccess: noScopeGuard,
  });

  await finalizePayrollRunAccrual({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    note: `finalize ${providerCode}`,
    forceFromImported: false,
    assertScopeAccess: noScopeGuard,
  });

  await buildPayrollRunLiabilities({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    note: `build liabilities ${providerCode}`,
    assertScopeAccess: noScopeGuard,
  });

  return runId;
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createFixture(stamp);
  await seedOwnershipAssignments(fixture);
  await seedBeneficiaries(fixture, stamp);

  const mixedRunId = await finalizeRunAndBuildLiabilities({
    fixture,
    providerCode: `POU06_MIXED_${stamp}`,
    sourceBatchRef: `pou06-mixed-${stamp}`,
    csvText: buildCsv([
      "E001,Alpha User,CC-01,1000,100,50,50,1200,120,80,20,150,100,980",
      "E002,Beta User,CC-02,900,0,0,100,1000,100,50,10,120,90,840",
    ]),
  });

  const baselinePreview = await getPayrollRunLiabilityPaymentBatchPreview({
    req: null,
    tenantId: fixture.tenantId,
    runId: mixedRunId,
    scope: "NET_PAY",
    assertScopeAccess: noScopeGuard,
  });
  assert(
    baselinePreview?.selected_bank_evaluation === null,
    "Baseline preview should stay usable without bank selection"
  );
  assert(
    (baselinePreview?.owner_context_summary || []).length === 2,
    "Mixed NET_PAY preview should expose two owner contexts"
  );

  const centralPreview = await getPayrollRunLiabilityPaymentBatchPreview({
    req: null,
    tenantId: fixture.tenantId,
    runId: mixedRunId,
    scope: "NET_PAY",
    bankAccountId: fixture.centralBankAccountId,
    assertScopeAccess: noScopeGuard,
  });
  assert(
    centralPreview?.selected_bank_account?.payer_context_scope === "CENTRAL",
    "Central bank preview should expose CENTRAL payer context"
  );
  assert(
    centralPreview?.selected_bank_evaluation?.can_prepare_payment_batch === true,
    "Central bank should remain allowed for mixed owner-context payroll liabilities"
  );
  assert(
    centralPreview?.selected_bank_evaluation?.settlement_mode === "CROSS_CONTEXT_SELF_BALANCING",
    "Central bank mixed preview should require cross-context self-balancing"
  );

  const ouPreview = await getPayrollRunLiabilityPaymentBatchPreview({
    req: null,
    tenantId: fixture.tenantId,
    runId: mixedRunId,
    scope: "NET_PAY",
    bankAccountId: fixture.ouBankAccountId,
    assertScopeAccess: noScopeGuard,
  });
  assert(
    ouPreview?.selected_bank_account?.payer_context_scope === "OPERATING_UNIT",
    "OU bank preview should expose OPERATING_UNIT payer context"
  );
  assert(
    ouPreview?.selected_bank_evaluation?.can_prepare_payment_batch === false,
    "OU bank should be blocked for mixed owner-context payroll liabilities"
  );
  assert(
    (ouPreview?.selected_bank_evaluation?.validation_errors || []).some(
      (item) => item?.code === "OU_BANK_MIXED_OWNER_CONTEXT_NOT_ALLOWED"
    ),
    "OU bank preview should explain mixed owner-context restriction"
  );

  await expectFailure(
    () =>
      createPayrollRunPaymentBatchFromLiabilities({
        req: null,
        tenantId: fixture.tenantId,
        runId: mixedRunId,
        userId: fixture.userId,
        input: {
          scope: "NET_PAY",
          bankAccountId: fixture.ouBankAccountId,
          idempotencyKey: `POU06-MIXED-OU-${stamp}`,
          notes: "should fail for mixed OU-bank batch",
        },
        assertScopeAccess: noScopeGuard,
      }),
    {
      status: 400,
      includes: "OU bank payment is not allowed when selected payroll liabilities span multiple owner contexts",
    }
  );

  const centralOnlyRunId = await finalizeRunAndBuildLiabilities({
    fixture,
    providerCode: `POU06_CENTRAL_${stamp}`,
    sourceBatchRef: `pou06-central-${stamp}`,
    csvText: buildCsv([
      "E001,Alpha User,CC-01,1000,100,50,50,1200,120,80,20,150,100,980",
    ]),
  });

  const ouPaysCentralPreview = await getPayrollRunLiabilityPaymentBatchPreview({
    req: null,
    tenantId: fixture.tenantId,
    runId: centralOnlyRunId,
    scope: "NET_PAY",
    bankAccountId: fixture.ouBankAccountId,
    assertScopeAccess: noScopeGuard,
  });
  assert(
    ouPaysCentralPreview?.selected_bank_evaluation?.can_prepare_payment_batch === true,
    "OU bank should be allowed for central-owned payroll liabilities in V1"
  );
  assert(
    ouPaysCentralPreview?.selected_bank_evaluation?.settlement_mode === "CROSS_CONTEXT_SELF_BALANCING",
    "OU bank paying central liability should be marked as cross-context self-balancing"
  );

  const prepared = await createPayrollRunPaymentBatchFromLiabilities({
    req: null,
    tenantId: fixture.tenantId,
    runId: centralOnlyRunId,
    userId: fixture.userId,
    input: {
      scope: "NET_PAY",
      bankAccountId: fixture.ouBankAccountId,
      idempotencyKey: `POU06-CENTRAL-OU-${stamp}`,
      notes: "OU bank pays central-owned payroll liability",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    normalizeUpperText(prepared?.batch?.payer_context_scope) === "OPERATING_UNIT",
    "Prepared batch detail should expose OU payer context"
  );
  assert(
    (prepared?.batch?.lines || []).length === 1,
    "Central-only NET_PAY batch should contain one line"
  );
  assert(
    normalizeUpperText(prepared?.batch?.lines?.[0]?.liability_ownership_scope) === "CENTRAL",
    "Prepared batch line should expose central liability owner context"
  );

  console.log(
    "PR-POU06 smoke test passed (bank-aware preview, mixed OU restriction, and OU-to-central prepare visibility)."
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
