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
} from "../src/services/payroll.liabilities.service.js";
import { upsertPayrollComponentMapping } from "../src/services/payroll.mappings.service.js";
import { createPayrollOwnershipAssignment } from "../src/services/payroll.ownership.service.js";
import { importPayrollRunCsv } from "../src/services/payroll.runs.service.js";
import { approvePaymentBatch, postPaymentBatch } from "../src/services/payments.service.js";

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

function assertJournalLine(lines, expected, message) {
  const matched = (lines || []).some((line) => {
    if (expected.accountId !== undefined && toNumber(line.account_id) !== toNumber(expected.accountId)) {
      return false;
    }
    if (
      Object.prototype.hasOwnProperty.call(expected, "operatingUnitId") &&
      toNumber(line.operating_unit_id) !== toNumber(expected.operatingUnitId)
    ) {
      return false;
    }
    if (expected.debitBase !== undefined && toAmount(line.debit_base) !== toAmount(expected.debitBase)) {
      return false;
    }
    if (expected.creditBase !== undefined && toAmount(line.credit_base) !== toAmount(expected.creditBase)) {
      return false;
    }
    return true;
  });
  assert(matched, message);
}

async function loadJournalLines(journalEntryId) {
  const result = await query(
    `SELECT
        line_no,
        account_id,
        operating_unit_id,
        debit_base,
        credit_base,
        description,
        subledger_reference_no
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no ASC`,
    [journalEntryId]
  );
  return result.rows || [];
}

async function createFixture(stamp) {
  const tenantCode = `POU07_T_${stamp}`;
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `POU07 Tenant ${stamp}`]
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
    [tenantId, `POU07_G_${stamp}`, `POU07 Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `POU07_G_${stamp}`]
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
      `POU07_LE_${stamp}`,
      `POU07 Legal Entity ${stamp}`,
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
    [tenantId, `POU07_LE_${stamp}`]
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
    [tenantId, legalEntityId, `POU07_OU_${stamp}`, `POU07 OU ${stamp}`]
  );
  const operatingUnitRows = await query(
    `SELECT id
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `POU07_OU_${stamp}`]
  );
  const operatingUnitId = toNumber(operatingUnitRows.rows?.[0]?.id);
  assert(operatingUnitId > 0, "Failed to create operating unit fixture");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id, code, name, year_start_month, year_start_day
      )
      VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `POU07_CAL_${stamp}`, `POU07 Calendar ${stamp}`]
  );
  const calendarRows = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `POU07_CAL_${stamp}`]
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
      `POU07_BOOK_${stamp}`,
      `POU07 Book ${stamp}`,
      currencyCode,
    ]
  );

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id, legal_entity_id, scope, code, name
      )
      VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, `POU07_COA_${stamp}`, `POU07 Chart ${stamp}`]
  );
  const coaRows = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `POU07_COA_${stamp}`]
  );
  const coaId = toNumber(coaRows.rows?.[0]?.id);
  assert(coaId > 0, "Failed to create chart fixture");

  const accountDefs = [
    [`POU07BANKC${stamp}`, `POU07 Central Bank GL ${stamp}`, "ASSET", "DEBIT"],
    [`POU07BANKO${stamp}`, `POU07 OU Bank GL ${stamp}`, "ASSET", "DEBIT"],
    [`POU07EXP${stamp}`, `POU07 Expense GL ${stamp}`, "EXPENSE", "DEBIT"],
    [`POU07LIA${stamp}`, `POU07 Liability GL ${stamp}`, "LIABILITY", "CREDIT"],
    [`POU07CDF${stamp}`, `POU07 Central Due From ${stamp}`, "ASSET", "DEBIT"],
    [`POU07CDT${stamp}`, `POU07 Central Due To ${stamp}`, "LIABILITY", "CREDIT"],
    [`POU07ODF${stamp}`, `POU07 OU Due From Central ${stamp}`, "ASSET", "DEBIT"],
    [`POU07ODT${stamp}`, `POU07 OU Due To Central ${stamp}`, "LIABILITY", "CREDIT"],
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

  async function selectAccountId(name) {
    const rows = await query(
      `SELECT id
       FROM accounts
       WHERE coa_id = ?
         AND name = ?
       LIMIT 1`,
      [coaId, name]
    );
    return toNumber(rows.rows?.[0]?.id);
  }

  const centralBankGlAccountId = await selectAccountId(`POU07 Central Bank GL ${stamp}`);
  const ouBankGlAccountId = await selectAccountId(`POU07 OU Bank GL ${stamp}`);
  const expenseGlAccountId = await selectAccountId(`POU07 Expense GL ${stamp}`);
  const liabilityGlAccountId = await selectAccountId(`POU07 Liability GL ${stamp}`);
  const centralDueFromAccountId = await selectAccountId(`POU07 Central Due From ${stamp}`);
  const centralDueToAccountId = await selectAccountId(`POU07 Central Due To ${stamp}`);
  const ouDueFromCentralAccountId = await selectAccountId(`POU07 OU Due From Central ${stamp}`);
  const ouDueToCentralAccountId = await selectAccountId(`POU07 OU Due To Central ${stamp}`);

  assert(centralBankGlAccountId > 0, "Missing central bank GL");
  assert(ouBankGlAccountId > 0, "Missing OU bank GL");
  assert(expenseGlAccountId > 0, "Missing expense GL");
  assert(liabilityGlAccountId > 0, "Missing liability GL");
  assert(centralDueFromAccountId > 0, "Missing central due-from account");
  assert(centralDueToAccountId > 0, "Missing central due-to account");
  assert(ouDueFromCentralAccountId > 0, "Missing OU due-from-central account");
  assert(ouDueToCentralAccountId > 0, "Missing OU due-to-central account");

  await query(
    `UPDATE operating_units
     SET central_due_from_account_id = ?,
         central_due_to_account_id = ?,
         ou_due_from_central_account_id = ?,
         ou_due_to_central_account_id = ?
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [
      centralDueFromAccountId,
      centralDueToAccountId,
      ouDueFromCentralAccountId,
      ouDueToCentralAccountId,
      tenantId,
      legalEntityId,
      operatingUnitId,
    ]
  );

  const passwordHash = await bcrypt.hash("POU07#Smoke123", 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `pou07_user_${stamp}@example.com`, passwordHash, "POU07 User"]
  );
  const userRows = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, `pou07_user_${stamp}@example.com`]
  );
  const userId = toNumber(userRows.rows?.[0]?.id);
  assert(userId > 0, "Failed to create user fixture");

  async function createBankAccount({
    code,
    name,
    glAccountId,
    bankOperatingUnitId,
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
    code: `POU07_BA_C_${stamp}`,
    name: `POU07 Central Bank ${stamp}`,
    glAccountId: centralBankGlAccountId,
    bankOperatingUnitId: null,
    ibanSeed: `${stamp}11`,
  });
  const ouBankAccountId = await createBankAccount({
    code: `POU07_BA_OU_${stamp}`,
    name: `POU07 OU Bank ${stamp}`,
    glAccountId: ouBankGlAccountId,
    bankOperatingUnitId: operatingUnitId,
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
    centralBankGlAccountId,
    ouBankGlAccountId,
    expenseGlAccountId,
    liabilityGlAccountId,
    centralDueFromAccountId,
    centralDueToAccountId,
    ouDueFromCentralAccountId,
    ouDueToCentralAccountId,
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
      notes: "POU07 central owner",
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
      notes: "POU07 OU owner",
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
        reason: "POU07 setup",
      },
      assertScopeAccess: noScopeGuard,
    });
  }
}

async function finalizeRunAndBuildLiabilities({
  fixture,
  providerCode,
  sourceBatchRef,
  csvText,
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
        notes: `POU07 mapping ${providerCode}`,
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

async function prepareNetPayBatch({
  fixture,
  providerCode,
  sourceBatchRef,
  csvText,
  bankAccountId,
  idempotencyKey,
  notes,
}) {
  const runId = await finalizeRunAndBuildLiabilities({
    fixture,
    providerCode,
    sourceBatchRef,
    csvText,
  });
  const prepared = await createPayrollRunPaymentBatchFromLiabilities({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    input: {
      scope: "NET_PAY",
      bankAccountId,
      idempotencyKey,
      notes,
    },
    assertScopeAccess: noScopeGuard,
  });
  const batchId = toNumber(prepared?.batch?.id);
  assert(batchId > 0, "Payment batch should be created");
  return {
    runId,
    batchId,
    prepared,
  };
}

async function approveAndPostBatch({ fixture, batchId, postingDate, note, externalRefPrefix }) {
  await approvePaymentBatch({
    req: null,
    tenantId: fixture.tenantId,
    batchId,
    userId: fixture.userId,
    approveInput: { note: `${note} approve` },
    assertScopeAccess: noScopeGuard,
  });

  return postPaymentBatch({
    req: null,
    tenantId: fixture.tenantId,
    batchId,
    userId: fixture.userId,
    postInput: {
      postingDate,
      note,
      externalPaymentRefPrefix: externalRefPrefix,
    },
    assertScopeAccess: noScopeGuard,
  });
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createFixture(stamp);
  await seedOwnershipAssignments(fixture);
  await seedBeneficiaries(fixture, stamp);

  const mixedBatch = await prepareNetPayBatch({
    fixture,
    providerCode: `POU07_MIXED_${stamp}`,
    sourceBatchRef: `pou07-mixed-${stamp}`,
    csvText: buildCsv([
      "E001,Alpha User,CC-01,1000,100,50,50,1200,120,80,20,150,100,980",
      "E002,Beta User,CC-02,900,0,0,100,1000,100,50,10,120,90,840",
    ]),
    bankAccountId: fixture.centralBankAccountId,
    idempotencyKey: `POU07-MIXED-CENTRAL-${stamp}`,
    notes: "POU07 mixed central-bank batch",
  });
  const mixedPosted = await approveAndPostBatch({
    fixture,
    batchId: mixedBatch.batchId,
    postingDate: "2026-02-20",
    note: "POU07 mixed central-bank post",
    externalRefPrefix: "POU07MC",
  });
  const mixedJournalEntryId = toNumber(mixedPosted?.posted_journal_entry_id);
  assert(mixedJournalEntryId > 0, "Mixed payroll batch should persist posted journal id");
  assert(
    (mixedPosted?.lines || []).length === 2 &&
      (mixedPosted.lines || []).every((line) => normalizeUpperText(line?.status) === "PAID"),
    "Mixed payroll batch lines should be PAID after post"
  );
  assert(
    String(mixedPosted?.lines?.[0]?.settlement_journal_line_ref || "").endsWith("/L1"),
    "First payroll payment line should reference its main liability settlement line"
  );
  assert(
    String(mixedPosted?.lines?.[1]?.settlement_journal_line_ref || "").endsWith("/L2"),
    "Second payroll payment line should reference its main liability settlement line"
  );
  const mixedJournalRows = await query(
    `SELECT total_debit_base, total_credit_base
     FROM journal_entries
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [fixture.tenantId, mixedJournalEntryId]
  );
  const mixedJournal = mixedJournalRows.rows?.[0] || null;
  assert(mixedJournal, "Mixed payroll journal should exist");
  assert(
    toAmount(mixedJournal.total_debit_base) === 2660 &&
      toAmount(mixedJournal.total_credit_base) === 2660,
    "Mixed payroll journal totals should be recomputed from self-balancing lines"
  );
  const mixedLines = await loadJournalLines(mixedJournalEntryId);
  assert(mixedLines.length === 5, `Mixed payroll settlement should post 5 lines, got ${mixedLines.length}`);
  assertJournalLine(
    mixedLines,
    {
      accountId: fixture.liabilityGlAccountId,
      operatingUnitId: null,
      debitBase: 980,
    },
    "Mixed payroll settlement should debit the central liability"
  );
  assertJournalLine(
    mixedLines,
    {
      accountId: fixture.liabilityGlAccountId,
      operatingUnitId: fixture.operatingUnitId,
      debitBase: 840,
    },
    "Mixed payroll settlement should debit the OU liability in the owner OU"
  );
  assertJournalLine(
    mixedLines,
    {
      accountId: fixture.ouDueToCentralAccountId,
      operatingUnitId: fixture.operatingUnitId,
      creditBase: 840,
    },
    "Central bank paying OU payroll liability should credit OU due-to-central"
  );
  assertJournalLine(
    mixedLines,
    {
      accountId: fixture.centralDueFromAccountId,
      operatingUnitId: null,
      debitBase: 840,
    },
    "Central bank paying OU payroll liability should debit central due-from-OU"
  );
  assertJournalLine(
    mixedLines,
    {
      accountId: fixture.centralBankGlAccountId,
      operatingUnitId: null,
      creditBase: 1820,
    },
    "Mixed payroll settlement should credit the central bank for the batch total"
  );

  const ouPaysCentralBatch = await prepareNetPayBatch({
    fixture,
    providerCode: `POU07_OU_TO_CENTRAL_${stamp}`,
    sourceBatchRef: `pou07-ou-to-central-${stamp}`,
    csvText: buildCsv([
      "E001,Alpha User,CC-01,1000,100,50,50,1200,120,80,20,150,100,980",
    ]),
    bankAccountId: fixture.ouBankAccountId,
    idempotencyKey: `POU07-OU-CENTRAL-${stamp}`,
    notes: "POU07 OU bank pays central liability",
  });
  const ouPaysCentralPosted = await approveAndPostBatch({
    fixture,
    batchId: ouPaysCentralBatch.batchId,
    postingDate: "2026-02-21",
    note: "POU07 OU bank central-liability post",
    externalRefPrefix: "POU07OC",
  });
  const ouPaysCentralJournalEntryId = toNumber(ouPaysCentralPosted?.posted_journal_entry_id);
  assert(ouPaysCentralJournalEntryId > 0, "OU-to-central payroll batch should persist posted journal id");
  assert(
    String(ouPaysCentralPosted?.lines?.[0]?.settlement_journal_line_ref || "").endsWith("/L1"),
    "OU-to-central payroll payment line should keep the main liability settlement ref"
  );
  const ouPaysCentralJournalRows = await query(
    `SELECT total_debit_base, total_credit_base
     FROM journal_entries
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [fixture.tenantId, ouPaysCentralJournalEntryId]
  );
  const ouPaysCentralJournal = ouPaysCentralJournalRows.rows?.[0] || null;
  assert(ouPaysCentralJournal, "OU-to-central payroll journal should exist");
  assert(
    toAmount(ouPaysCentralJournal.total_debit_base) === 1960 &&
      toAmount(ouPaysCentralJournal.total_credit_base) === 1960,
    "OU-to-central payroll journal totals should include the self-balancing pair"
  );
  const ouPaysCentralLines = await loadJournalLines(ouPaysCentralJournalEntryId);
  assert(
    ouPaysCentralLines.length === 4,
    `OU bank paying central payroll liability should post 4 lines, got ${ouPaysCentralLines.length}`
  );
  assertJournalLine(
    ouPaysCentralLines,
    {
      accountId: fixture.liabilityGlAccountId,
      operatingUnitId: null,
      debitBase: 980,
    },
    "OU bank paying central payroll liability should debit the central liability"
  );
  assertJournalLine(
    ouPaysCentralLines,
    {
      accountId: fixture.centralDueToAccountId,
      operatingUnitId: null,
      creditBase: 980,
    },
    "OU bank paying central payroll liability should credit central due-to-OU"
  );
  assertJournalLine(
    ouPaysCentralLines,
    {
      accountId: fixture.ouDueFromCentralAccountId,
      operatingUnitId: fixture.operatingUnitId,
      debitBase: 980,
    },
    "OU bank paying central payroll liability should debit OU due-from-central"
  );
  assertJournalLine(
    ouPaysCentralLines,
    {
      accountId: fixture.ouBankGlAccountId,
      operatingUnitId: fixture.operatingUnitId,
      creditBase: 980,
    },
    "OU bank paying central payroll liability should credit the OU bank"
  );

  const driftBatch = await prepareNetPayBatch({
    fixture,
    providerCode: `POU07_DRIFT_${stamp}`,
    sourceBatchRef: `pou07-drift-${stamp}`,
    csvText: buildCsv([
      "E001,Alpha User,CC-01,1000,100,50,50,1200,120,80,20,150,100,980",
      "E002,Beta User,CC-02,900,0,0,100,1000,100,50,10,120,90,840",
    ]),
    bankAccountId: fixture.centralBankAccountId,
    idempotencyKey: `POU07-DRIFT-${stamp}`,
    notes: "POU07 drifted-bank mixed batch",
  });
  await approvePaymentBatch({
    req: null,
    tenantId: fixture.tenantId,
    batchId: driftBatch.batchId,
    userId: fixture.userId,
    approveInput: { note: "approve drift batch" },
    assertScopeAccess: noScopeGuard,
  });
  await query(
    `UPDATE bank_accounts
     SET operating_unit_id = ?
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [
      fixture.operatingUnitId,
      fixture.tenantId,
      fixture.legalEntityId,
      fixture.centralBankAccountId,
    ]
  );
  await expectFailure(
    () =>
      postPaymentBatch({
        req: null,
        tenantId: fixture.tenantId,
        batchId: driftBatch.batchId,
        userId: fixture.userId,
        postInput: {
          postingDate: "2026-02-22",
          note: "post drift batch",
          externalPaymentRefPrefix: "POU07DR",
        },
        assertScopeAccess: noScopeGuard,
      }),
    {
      status: 400,
      includes: "OU bank payment is not allowed when payroll liabilities span multiple owner contexts",
    }
  );

  console.log(
    "PR-POU07 smoke test passed (central->OU posting, OU->central posting, and current-bank drift revalidation)."
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
