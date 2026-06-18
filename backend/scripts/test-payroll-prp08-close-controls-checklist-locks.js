import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { closePool, query, withTransaction } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import { insertPostedJournalWithLinesTx } from "../src/services/inventory.service.js";
import {
  approveAndClosePayrollPeriod,
  assertPayrollPeriodActionAllowed,
  preparePayrollPeriodClose,
  reopenPayrollPeriodClose,
  requestPayrollPeriodClose,
} from "../src/services/payroll.close.service.js";

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

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function findCheck(result, checkCode) {
  return (result?.checks || []).find(
    (check) =>
      String(check?.check_code || "").trim().toUpperCase() ===
      String(checkCode || "").trim().toUpperCase()
  );
}

async function expectFailure(work, { status, code, includes }) {
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
    if (code !== undefined && String(error?.code || "") !== String(code)) {
      throw new Error(`Expected error code ${code} but got ${String(error?.code || "")}`);
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
  const tenantCode = `PRP08_T_${stamp}`;
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `PRP08 Tenant ${stamp}`]
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
    [tenantId, `PRP08_G_${stamp}`, `PRP08 Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PRP08_G_${stamp}`]
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
      `PRP08_LE_${stamp}`,
      `PRP08 Legal Entity ${stamp}`,
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
    [tenantId, `PRP08_LE_${stamp}`]
  );
  const legalEntityId = toNumber(legalEntityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity fixture");

  return {
    tenantId,
    legalEntityId,
    legalEntityCode: `PRP08_LE_${stamp}`,
    currencyCode,
  };
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

async function createOperatingUnit({ tenantId, legalEntityId, code, name }) {
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
    [tenantId, legalEntityId, code, name]
  );
  const rows = await query(
    `SELECT id
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  const operatingUnitId = toNumber(rows.rows?.[0]?.id);
  assert(operatingUnitId > 0, `Failed to create operating unit: ${code}`);
  return operatingUnitId;
}

async function createLiabilityPostingAccount({ tenantId, legalEntityId, stamp }) {
  const coaCode = `PRP08_COA_${stamp}`;
  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
      )
      VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, coaCode, `PRP08 CoA ${stamp}`]
  );
  const coaRows = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, coaCode]
  );
  const coaId = toNumber(coaRows.rows?.[0]?.id);
  assert(coaId > 0, "Failed to create PRP08 CoA fixture");

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
      )
      VALUES (?, ?, ?, 'LIABILITY', 'CREDIT', TRUE, NULL, TRUE)`,
    [coaId, `PRP08LIA${stamp}`, `PRP08 Liability GL ${stamp}`]
  );
  const accountRows = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, `PRP08LIA${stamp}`]
  );
  const accountId = toNumber(accountRows.rows?.[0]?.id);
  assert(accountId > 0, "Failed to create PRP08 liability GL fixture");
  return accountId;
}

async function createPaymentPostingFixture({
  tenantId,
  legalEntityId,
  userId,
  operatingUnitId,
  stamp,
  currencyCode,
}) {
  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
      )
      VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `PRP08_CAL_${stamp}`, `PRP08 Calendar ${stamp}`]
  );
  const calendarRows = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PRP08_CAL_${stamp}`]
  );
  const calendarId = toNumber(calendarRows.rows?.[0]?.id);
  assert(calendarId > 0, "Failed to create PRP08 fiscal calendar fixture");

  await query(
    `INSERT INTO fiscal_periods (
        calendar_id,
        fiscal_year,
        period_no,
        period_name,
        start_date,
        end_date,
        is_adjustment
      )
      VALUES (?, 2026, 2, '2026-02', '2026-02-01', '2026-02-28', FALSE)`,
    [calendarId]
  );
  const fiscalPeriodRows = await query(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND fiscal_year = 2026
       AND period_no = 2
     LIMIT 1`,
    [calendarId]
  );
  const fiscalPeriodId = toNumber(fiscalPeriodRows.rows?.[0]?.id);
  assert(fiscalPeriodId > 0, "Failed to create PRP08 fiscal period fixture");

  await query(
    `INSERT INTO books (
        tenant_id,
        legal_entity_id,
        calendar_id,
        code,
        name,
        book_type,
        base_currency_code
      )
      VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)`,
    [
      tenantId,
      legalEntityId,
      calendarId,
      `PRP08_BOOK_${stamp}`,
      `PRP08 Book ${stamp}`,
      currencyCode,
    ]
  );
  const bookRows = await query(
    `SELECT id
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `PRP08_BOOK_${stamp}`]
  );
  const bookId = toNumber(bookRows.rows?.[0]?.id);
  assert(bookId > 0, "Failed to create PRP08 book fixture");

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
      )
      VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, `PRP08_PAY_COA_${stamp}`, `PRP08 Pay CoA ${stamp}`]
  );
  const coaRows = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PRP08_PAY_COA_${stamp}`]
  );
  const coaId = toNumber(coaRows.rows?.[0]?.id);
  assert(coaId > 0, "Failed to create PRP08 payment chart fixture");

  const accountDefs = [
    [`PRP08BNK${stamp}`, `PRP08 Central Bank GL ${stamp}`, "ASSET", "DEBIT"],
    [`PRP08CDF${stamp}`, `PRP08 Central Due From ${stamp}`, "ASSET", "DEBIT"],
    [`PRP08ODT${stamp}`, `PRP08 OU Due To Central ${stamp}`, "LIABILITY", "CREDIT"],
  ];
  for (const [code, name, accountType, normalSide] of accountDefs) {
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

  const centralBankGlAccountId = await selectAccountId(`PRP08 Central Bank GL ${stamp}`);
  const centralDueFromAccountId = await selectAccountId(`PRP08 Central Due From ${stamp}`);
  const ouDueToCentralAccountId = await selectAccountId(`PRP08 OU Due To Central ${stamp}`);
  assert(centralBankGlAccountId > 0, "Missing PRP08 central bank GL");
  assert(centralDueFromAccountId > 0, "Missing PRP08 central due-from GL");
  assert(ouDueToCentralAccountId > 0, "Missing PRP08 OU due-to-central GL");

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
      VALUES (?, ?, NULL, ?, ?, ?, ?, 'PRP08 Bank', 'Main', ?, ?, TRUE, ?)`,
    [
      tenantId,
      legalEntityId,
      `PRP08_BA_C_${stamp}`,
      `PRP08 Central Bank ${stamp}`,
      currencyCode,
      centralBankGlAccountId,
      `TR${String(stamp).padStart(24, "0").slice(-24)}`,
      String(stamp).slice(-18),
      userId,
    ]
  );
  const bankRows = await query(
    `SELECT id
     FROM bank_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, `PRP08_BA_C_${stamp}`]
  );
  const centralBankAccountId = toNumber(bankRows.rows?.[0]?.id);
  assert(centralBankAccountId > 0, "Failed to create PRP08 central bank fixture");

  return {
    bookId,
    fiscalPeriodId,
    centralBankAccountId,
    centralBankGlAccountId,
    centralDueFromAccountId,
    ouDueToCentralAccountId,
    operatingUnitId,
    currencyCode,
  };
}

async function insertPostedPayrollBatchMissingSelfBalancing({
  tenantId,
  legalEntityId,
  runId,
  liabilityId,
  payableGlAccountId,
  bankAccountId,
  bankGlAccountId,
  ownerOperatingUnitId,
  bookId,
  fiscalPeriodId,
  currencyCode,
  batchNo,
  amount,
  postingDate,
  userId,
}) {
  return withTransaction(async (tx) => {
    const batchInsert = await tx.query(
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
          created_by_user_id,
          approved_by_user_id,
          posted_by_user_id,
          approved_at,
          posted_at
        )
        VALUES (?, ?, ?, 'PAYROLL', ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        tenantId,
        legalEntityId,
        batchNo,
        runId,
        bankAccountId,
        currencyCode,
        amount,
        `PRP08 broken posted payroll batch ${batchNo}`,
        userId,
        userId,
        userId,
      ]
    );
    const batchId = toNumber(batchInsert.rows?.insertId);
    assert(batchId > 0, "Failed to create PRP08 payment batch fixture");

    const lineInsert = await tx.query(
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
          external_payment_ref,
          notes
        )
        VALUES (?, ?, ?, 1, 'EMPLOYEE', NULL, ?, NULL, 'PAYROLL_LIABILITY', ?, ?, ?, ?, 'PAID', ?, ?)`,
      [
        tenantId,
        legalEntityId,
        batchId,
        "Broken Settlement Employee",
        liabilityId,
        payableGlAccountId,
        `PRP08-BATCH-${batchId}-L1`,
        amount,
        `PRP08-PAYREF-${batchId}`,
        "Broken self-balancing fixture",
      ]
    );
    const batchLineId = toNumber(lineInsert.rows?.insertId);
    assert(batchLineId > 0, "Failed to create PRP08 payment batch line fixture");

    const journalResult = await insertPostedJournalWithLinesTx(tx, {
      tenantId,
      legalEntityId,
      bookId,
      fiscalPeriodId,
      journalNo: `PRP08PB-${batchId}`,
      entryDate: postingDate,
      documentDate: postingDate,
      currencyCode,
      description: `PRP08 broken payroll settlement ${batchNo}`,
      referenceNo: `PRP08-PB-${batchId}`,
      userId,
      lines: [
        {
          accountId: payableGlAccountId,
          operatingUnitId: ownerOperatingUnitId,
          description: `Settlement ${batchNo} line 1 liability`,
          subledgerReferenceNo: `PAYBATCH:${batchId}:L1`,
          currencyCode,
          amountTxn: amount,
          debitBase: amount,
          creditBase: 0,
          counterpartyLegalEntityId: null,
          taxCode: null,
        },
        {
          accountId: bankGlAccountId,
          operatingUnitId: null,
          description: `Settlement ${batchNo} bank credit`,
          subledgerReferenceNo: `PAYBATCH:${batchId}`,
          currencyCode,
          amountTxn: amount * -1,
          debitBase: 0,
          creditBase: amount,
          counterpartyLegalEntityId: null,
          taxCode: null,
        },
      ],
    });
    const journalEntryId = toNumber(journalResult?.journalEntryId);
    assert(journalEntryId > 0, "Failed to create PRP08 broken settlement journal");

    await tx.query(
      `UPDATE payment_batches
       SET posted_journal_entry_id = ?
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id = ?`,
      [journalEntryId, tenantId, legalEntityId, batchId]
    );
    await tx.query(
      `UPDATE payment_batch_lines
       SET settlement_journal_line_ref = ?
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id = ?`,
      [`JE:${journalEntryId}/L1`, tenantId, legalEntityId, batchLineId]
    );

    return {
      batchId,
      batchLineId,
      journalEntryId,
    };
  });
}

async function insertActivePayrollBatch({
  tenantId,
  legalEntityId,
  runId,
  liabilityId,
  payableGlAccountId,
  bankAccountId,
  currencyCode,
  batchNo,
  amount,
  userId,
  batchStatus = "APPROVED",
}) {
  const normalizedBatchStatus = String(batchStatus || "APPROVED").trim().toUpperCase();
  assert(
    ["DRAFT", "APPROVED", "EXPORTED"].includes(normalizedBatchStatus),
    `Unsupported active payroll batch status fixture: ${normalizedBatchStatus}`
  );

  return withTransaction(async (tx) => {
    const approvedByUserId = normalizedBatchStatus === "DRAFT" ? null : userId;
    const approvedAt = normalizedBatchStatus === "DRAFT" ? null : new Date();
    const batchInsert = await tx.query(
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
          created_by_user_id,
          approved_by_user_id,
          approved_at
        )
        VALUES (?, ?, ?, 'PAYROLL', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        batchNo,
        runId,
        bankAccountId,
        currencyCode,
        amount,
        normalizedBatchStatus,
        `PRP08 active payroll batch ${batchNo}`,
        userId,
        approvedByUserId,
        approvedAt,
      ]
    );
    const batchId = toNumber(batchInsert.rows?.insertId);
    assert(batchId > 0, "Failed to create active payroll batch fixture");

    const lineInsert = await tx.query(
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
          external_payment_ref,
          notes
        )
        VALUES (?, ?, ?, 1, 'EMPLOYEE', NULL, ?, NULL, 'PAYROLL_LIABILITY', ?, ?, ?, ?, 'PENDING', ?, ?)`,
      [
        tenantId,
        legalEntityId,
        batchId,
        "Legacy In-Flight Employee",
        liabilityId,
        payableGlAccountId,
        `PRP08-ACTIVE-${batchId}-L1`,
        amount,
        `PRP08-ACTIVE-PAYREF-${batchId}`,
        "Legacy in-flight payroll batch fixture",
      ]
    );
    const batchLineId = toNumber(lineInsert.rows?.insertId);
    assert(batchLineId > 0, "Failed to create active payroll batch line fixture");

    return {
      batchId,
      batchLineId,
      batchStatus: normalizedBatchStatus,
    };
  });
}

async function insertFinalizedPayrollRunWithOwnershipLine({
  tenantId,
  legalEntityId,
  legalEntityCode,
  userId,
  runNo,
  payrollPeriod,
  payDate,
  ownershipAsOfDate = null,
  employeeCode,
  employeeName,
  ownershipResolutionStatus,
  ownershipScope = null,
  ownershipResolutionNote = null,
  lineNo = 1,
}) {
  const fileChecksum = hashToken(`run:${runNo}`);
  const lineHash = hashToken(`line:${runNo}:${lineNo}:${employeeCode}`);

  await query(
    `INSERT INTO payroll_runs (
        tenant_id,
        legal_entity_id,
        run_no,
        provider_code,
        entity_code,
        payroll_period,
        pay_date,
        ownership_as_of_date,
        currency_code,
        original_filename,
        file_checksum,
        status,
        run_type,
        line_count_total,
        line_count_inserted,
        line_count_duplicates,
        employee_count,
        total_base_salary,
        total_gross_pay,
        total_employee_tax,
        total_employee_social_security,
        total_net_pay,
        total_employer_tax,
        total_employer_social_security,
        raw_meta_json,
        imported_by_user_id,
        finalized_by_user_id,
        finalized_at,
        accrual_journal_entry_id,
        accrual_posted_by_user_id,
        accrual_posted_at
      )
      VALUES (
        ?, ?, ?, 'TEST_PROVIDER', ?, ?, ?, ?, 'TRY', ?, ?, 'FINALIZED', 'REGULAR',
        1, 1, 0, 1,
        100, 100, 10, 5, 85, 10, 5,
        ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP
      )`,
    [
      tenantId,
      legalEntityId,
      runNo,
      legalEntityCode,
      payrollPeriod,
      payDate,
      ownershipAsOfDate,
      `${runNo}.csv`,
      fileChecksum,
      JSON.stringify({ fixture: "prp08-close-check" }),
      userId,
      userId,
      700000 + lineNo,
      userId,
    ]
  );

  const runRows = await query(
    `SELECT id
     FROM payroll_runs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND run_no = ?
     LIMIT 1`,
    [tenantId, legalEntityId, runNo]
  );
  const runId = toNumber(runRows.rows?.[0]?.id);
  assert(runId > 0, `Failed to create payroll run fixture ${runNo}`);

  await query(
    `INSERT INTO payroll_run_lines (
        tenant_id,
        legal_entity_id,
        run_id,
        line_no,
        employee_code,
        employee_name,
        cost_center_code,
        ownership_scope,
        operating_unit_id,
        ownership_assignment_id,
        ownership_resolution_status,
        ownership_resolution_note,
        base_salary,
        gross_pay,
        employee_tax,
        employee_social_security,
        net_pay,
        employer_tax,
        employer_social_security,
        line_hash,
        raw_row_json
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, 'CC-001', ?, NULL, NULL, ?, ?,
        100, 100, 10, 5, 85, 10, 5, ?, ?
      )`,
    [
      tenantId,
      legalEntityId,
      runId,
      lineNo,
      employeeCode,
      employeeName,
      ownershipScope,
      ownershipResolutionStatus,
      ownershipResolutionNote,
      lineHash,
      JSON.stringify({ employee_code: employeeCode, employee_name: employeeName }),
    ]
  );

  return runId;
}

async function insertInFlightPayrollRunWithOwnershipLine({
  tenantId,
  legalEntityId,
  legalEntityCode,
  userId,
  runNo,
  payrollPeriod,
  payDate,
  ownershipAsOfDate = null,
  employeeCode,
  employeeName,
  ownershipResolutionStatus = "UNRESOLVED",
  ownershipScope = null,
  ownershipResolutionNote = null,
  lineNo = 1,
  status = "REVIEWED",
}) {
  const normalizedStatus = String(status || "REVIEWED").trim().toUpperCase();
  assert(
    ["DRAFT", "IMPORTED", "REVIEWED"].includes(normalizedStatus),
    `Unsupported in-flight payroll run status fixture: ${normalizedStatus}`
  );

  const fileChecksum = hashToken(`run:${runNo}`);
  const lineHash = hashToken(`line:${runNo}:${lineNo}:${employeeCode}`);

  await query(
    `INSERT INTO payroll_runs (
        tenant_id,
        legal_entity_id,
        run_no,
        provider_code,
        entity_code,
        payroll_period,
        pay_date,
        ownership_as_of_date,
        currency_code,
        original_filename,
        file_checksum,
        status,
        run_type,
        line_count_total,
        line_count_inserted,
        line_count_duplicates,
        employee_count,
        total_base_salary,
        total_gross_pay,
        total_employee_tax,
        total_employee_social_security,
        total_net_pay,
        total_employer_tax,
        total_employer_social_security,
        raw_meta_json,
        imported_by_user_id,
        finalized_by_user_id,
        finalized_at,
        accrual_journal_entry_id,
        accrual_posted_by_user_id,
        accrual_posted_at
      )
      VALUES (
        ?, ?, ?, 'TEST_PROVIDER', ?, ?, ?, ?, 'TRY', ?, ?, ?, 'REGULAR',
        1, 1, 0, 1,
        100, 100, 10, 5, 85, 10, 5,
        ?, ?, NULL, NULL, NULL, NULL, NULL
      )`,
    [
      tenantId,
      legalEntityId,
      runNo,
      legalEntityCode,
      payrollPeriod,
      payDate,
      ownershipAsOfDate,
      `${runNo}.csv`,
      fileChecksum,
      normalizedStatus,
      JSON.stringify({ fixture: "prp08-close-check-inflight" }),
      userId,
    ]
  );

  const runRows = await query(
    `SELECT id
     FROM payroll_runs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND run_no = ?
     LIMIT 1`,
    [tenantId, legalEntityId, runNo]
  );
  const runId = toNumber(runRows.rows?.[0]?.id);
  assert(runId > 0, `Failed to create in-flight payroll run fixture ${runNo}`);

  await query(
    `INSERT INTO payroll_run_lines (
        tenant_id,
        legal_entity_id,
        run_id,
        line_no,
        employee_code,
        employee_name,
        cost_center_code,
        ownership_scope,
        operating_unit_id,
        ownership_assignment_id,
        ownership_resolution_status,
        ownership_resolution_note,
        base_salary,
        gross_pay,
        employee_tax,
        employee_social_security,
        net_pay,
        employer_tax,
        employer_social_security,
        line_hash,
        raw_row_json
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, 'CC-001', ?, NULL, NULL, ?, ?,
        100, 100, 10, 5, 85, 10, 5, ?, ?
      )`,
    [
      tenantId,
      legalEntityId,
      runId,
      lineNo,
      employeeCode,
      employeeName,
      ownershipScope,
      ownershipResolutionStatus,
      ownershipResolutionNote,
      lineHash,
      JSON.stringify({ employee_code: employeeCode, employee_name: employeeName }),
    ]
  );

  return runId;
}

async function insertPayrollLiability({
  tenantId,
  legalEntityId,
  runId,
  liabilityKey,
  payableGlAccountId,
  liabilityType = "NET_PAY",
  liabilityGroup = "EMPLOYEE_NET",
  employeeCode = null,
  employeeName = null,
  ownershipScope = null,
  operatingUnitId = null,
  status = "OPEN",
  amount = 85,
}) {
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
        status
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'CC-001', ?, ?,
        'EMPLOYEE', NULL, ?, NULL, 'PAYROLL_NET_PAYABLE', ?, ?,
        ?, 0, ?, 'TRY', ?
      )`,
    [
      tenantId,
      legalEntityId,
      runId,
      liabilityKey,
      liabilityType,
      liabilityGroup,
      employeeCode,
      employeeName,
      ownershipScope,
      operatingUnitId,
      employeeName || "Payroll Liability",
      payableGlAccountId,
      liabilityKey,
      amount,
      amount,
      status,
    ]
  );
  const rows = await query(
    `SELECT id
     FROM payroll_run_liabilities
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND liability_key = ?
     LIMIT 1`,
    [tenantId, legalEntityId, liabilityKey]
  );
  const liabilityId = toNumber(rows.rows?.[0]?.id);
  assert(liabilityId > 0, `Failed to create payroll liability fixture ${liabilityKey}`);
  return liabilityId;
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const { tenantId, legalEntityId, legalEntityCode, currencyCode } =
    await createTenantWithLegalEntity(stamp);

  await seedCore({ ensureDefaultTenantIfMissing: true });

  const passwordHash = await bcrypt.hash("PRP08#Smoke123", 10);
  const makerUserId = await createUser({
    tenantId,
    email: `prp08_maker_${stamp}@example.com`,
    name: "PRP08 Maker",
    passwordHash,
  });
  const checkerUserId = await createUser({
    tenantId,
    email: `prp08_checker_${stamp}@example.com`,
    name: "PRP08 Checker",
    passwordHash,
  });
  const operatingUnitId = await createOperatingUnit({
    tenantId,
    legalEntityId,
    code: `PRP08_OU_${stamp}`,
    name: `PRP08 OU ${stamp}`,
  });
  const liabilityGlAccountId = await createLiabilityPostingAccount({
    tenantId,
    legalEntityId,
    stamp,
  });
  const paymentPostingFixture = await createPaymentPostingFixture({
    tenantId,
    legalEntityId,
    userId: makerUserId,
    operatingUnitId,
    stamp,
    currencyCode,
  });

  const periodStart = "2026-02-01";
  const periodEnd = "2026-02-28";

  const prepared = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare for PRP08 smoke",
    },
    assertScopeAccess: noScopeGuard,
  });
  const closeId = toNumber(prepared?.close?.id);
  assert(closeId > 0, "preparePayrollPeriodClose did not return close id");
  assert(
    String(prepared?.close?.status || "").toUpperCase() === "READY",
    "Prepared payroll period close should be READY when checklist passes"
  );
  const initialOwnershipCheck = findCheck(prepared, "FINALIZED_LINES_OWNERSHIP_RESOLVED");
  assert(initialOwnershipCheck, "Close checklist should include ownership-resolution check");
  assert(
    String(initialOwnershipCheck?.status || "").toUpperCase() === "PASS",
    "Ownership-resolution close check should pass for empty finalized-run set"
  );
  const initialLiabilityCheck = findCheck(prepared, "LIABILITIES_OWNER_CONTEXT_VALID");
  assert(initialLiabilityCheck, "Close checklist should include liability owner-context check");
  assert(
    String(initialLiabilityCheck?.status || "").toUpperCase() === "PASS",
    "Liability owner-context close check should pass when no liabilities exist in period"
  );
  const initialLegacyInflightCheck = findCheck(prepared, "PRE_POU_IN_FLIGHT_STATE_CLEARED");
  assert(initialLegacyInflightCheck, "Close checklist should include the legacy in-flight rollout check");
  assert(
    String(initialLegacyInflightCheck?.status || "").toUpperCase() === "PASS",
    "Legacy in-flight rollout check should pass when no pre-POU in-flight state exists"
  );

  const legacyRunId = await insertFinalizedPayrollRunWithOwnershipLine({
    tenantId,
    legalEntityId,
    legalEntityCode,
    userId: makerUserId,
    runNo: `PRP08-LEGACY-${stamp}`,
    payrollPeriod: "2026-02-12",
    payDate: "2026-02-12",
    ownershipAsOfDate: null,
    employeeCode: "LEGACY001",
    employeeName: "Legacy Employee",
    ownershipResolutionStatus: "UNRESOLVED",
    ownershipScope: null,
    ownershipResolutionNote: "Legacy row should be grandfathered",
  });
  await insertPayrollLiability({
    tenantId,
    legalEntityId,
    runId: legacyRunId,
    liabilityKey: `PRP08-LIA-LEGACY-${stamp}`,
    payableGlAccountId: liabilityGlAccountId,
    employeeCode: "LEGACY001",
    employeeName: "Legacy Employee",
    ownershipScope: null,
    operatingUnitId: null,
  });

  const preparedWithLegacyGrandfathering = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare with legacy finalized run",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedWithLegacyGrandfathering?.close?.status || "").toUpperCase() === "READY",
    "Grandfathered legacy finalized runs should not fail the ownership close check"
  );
  const legacyOwnershipCheck = findCheck(
    preparedWithLegacyGrandfathering,
    "FINALIZED_LINES_OWNERSHIP_RESOLVED"
  );
  assert(legacyOwnershipCheck, "Legacy prepare should still return the ownership check");
  assert(
    String(legacyOwnershipCheck?.status || "").toUpperCase() === "PASS",
    "Legacy finalized runs should be excluded from the ownership close failure count"
  );
  assert(
    toNumber(legacyOwnershipCheck?.details_json?.grandfathered_finalized_run_count) === 1,
    "Legacy prepare should report one grandfathered finalized run"
  );
  assert(
    toNumber(legacyOwnershipCheck?.details_json?.ownership_aware_finalized_run_count) === 0,
    "Legacy prepare should not count ownership-unaware finalized runs as ownership-aware"
  );
  const legacyLiabilityCheck = findCheck(
    preparedWithLegacyGrandfathering,
    "LIABILITIES_OWNER_CONTEXT_VALID"
  );
  assert(legacyLiabilityCheck, "Legacy prepare should include the liability owner-context check");
  assert(
    String(legacyLiabilityCheck?.status || "").toUpperCase() === "PASS",
    "Legacy liabilities should be excluded from the ownership-aware liability failure set"
  );
  assert(
    toNumber(legacyLiabilityCheck?.details_json?.grandfathered_liability_count) === 1,
    "Legacy prepare should report one grandfathered payroll liability"
  );
  assert(
    toNumber(legacyLiabilityCheck?.details_json?.ownership_aware_liability_count) === 0,
    "Legacy prepare should not count ownership-unaware liabilities as ownership-aware"
  );

  const legacyInFlightRunId = await insertInFlightPayrollRunWithOwnershipLine({
    tenantId,
    legalEntityId,
    legalEntityCode,
    userId: makerUserId,
    runNo: `PRP08-LEGACY-INFLIGHT-${stamp}`,
    payrollPeriod: "2026-02-14",
    payDate: "2026-02-14",
    ownershipAsOfDate: null,
    employeeCode: "LEGACYINF001",
    employeeName: "Legacy In-Flight Employee",
    ownershipResolutionStatus: "UNRESOLVED",
    ownershipScope: null,
    ownershipResolutionNote: "Legacy in-flight row must be cancelled and recreated",
    status: "REVIEWED",
  });
  const legacyInFlightLiabilityId = await insertPayrollLiability({
    tenantId,
    legalEntityId,
    runId: legacyInFlightRunId,
    liabilityKey: `PRP08-LIA-LEGACY-INFLIGHT-${stamp}`,
    payableGlAccountId: liabilityGlAccountId,
    employeeCode: "LEGACYINF001",
    employeeName: "Legacy In-Flight Employee",
    ownershipScope: null,
    operatingUnitId: null,
    status: "IN_BATCH",
  });
  const legacyInFlightBatch = await insertActivePayrollBatch({
    tenantId,
    legalEntityId,
    runId: legacyInFlightRunId,
    liabilityId: legacyInFlightLiabilityId,
    payableGlAccountId: liabilityGlAccountId,
    bankAccountId: paymentPostingFixture.centralBankAccountId,
    currencyCode,
    batchNo: `PRP08-LEGACY-ACTIVE-${stamp}`,
    amount: 85,
    userId: makerUserId,
    batchStatus: "APPROVED",
  });

  const preparedWithLegacyInflightState = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare with legacy in-flight payroll state",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedWithLegacyInflightState?.close?.status || "").toUpperCase() === "DRAFT",
    "Legacy pre-POU in-flight payroll state should fail the close checklist until it is cancelled and recreated"
  );
  const blockedLegacyInflightCheck = findCheck(
    preparedWithLegacyInflightState,
    "PRE_POU_IN_FLIGHT_STATE_CLEARED"
  );
  assert(blockedLegacyInflightCheck, "Blocked prepare should include the legacy in-flight rollout check");
  assert(
    String(blockedLegacyInflightCheck?.status || "").toUpperCase() === "FAIL",
    "Legacy in-flight rollout check should fail while ownership-unaware runs, liabilities, or batches remain active"
  );
  assert(
    toNumber(blockedLegacyInflightCheck?.details_json?.legacy_non_finalized_run_count) === 1,
    "Legacy in-flight rollout check should count the ownership-unaware non-finalized payroll run"
  );
  assert(
    toNumber(blockedLegacyInflightCheck?.details_json?.legacy_derived_liability_count) === 1,
    "Legacy in-flight rollout check should count the derived payroll liability"
  );
  assert(
    toNumber(blockedLegacyInflightCheck?.details_json?.legacy_active_batch_count) === 1,
    "Legacy in-flight rollout check should count the active payroll batch"
  );
  assert(
    toNumber(blockedLegacyInflightCheck?.details_json?.approved_batch_count) === 1,
    "Legacy in-flight rollout check should expose the approved-batch breakdown"
  );
  assert(
    Array.isArray(blockedLegacyInflightCheck?.details_json?.remediation_steps) &&
      blockedLegacyInflightCheck.details_json.remediation_steps.length >= 3,
    "Legacy in-flight rollout check should return explicit cancel/recreate remediation guidance"
  );
  assert(
    blockedLegacyInflightCheck?.details_json?.sample_runs?.[0]?.run_no ===
      `PRP08-LEGACY-INFLIGHT-${stamp}`,
    "Legacy in-flight rollout check should surface a blocking sample run"
  );
  assert(
    blockedLegacyInflightCheck?.details_json?.sample_liabilities?.[0]?.liability_id ===
      legacyInFlightLiabilityId,
    "Legacy in-flight rollout check should surface a blocking sample liability"
  );
  assert(
    blockedLegacyInflightCheck?.details_json?.sample_batches?.[0]?.batch_id ===
      legacyInFlightBatch.batchId,
    "Legacy in-flight rollout check should surface a blocking sample payment batch"
  );

  await query(
    `DELETE FROM payment_batch_lines
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND batch_id = ?`,
    [tenantId, legalEntityId, legacyInFlightBatch.batchId]
  );
  await query(
    `DELETE FROM payment_batches
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [tenantId, legalEntityId, legacyInFlightBatch.batchId]
  );
  await query(
    `DELETE FROM payroll_run_liabilities
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [tenantId, legalEntityId, legacyInFlightLiabilityId]
  );
  await query(
    `DELETE FROM payroll_run_lines
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND run_id = ?`,
    [tenantId, legalEntityId, legacyInFlightRunId]
  );
  await query(
    `DELETE FROM payroll_runs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [tenantId, legalEntityId, legacyInFlightRunId]
  );

  const preparedAfterLegacyInflightCleanup = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare after removing legacy in-flight payroll state",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedAfterLegacyInflightCleanup?.close?.status || "").toUpperCase() === "READY",
    "Close checklist should recover once legacy in-flight payroll state is cancelled and removed from the period"
  );
  const fixedLegacyInflightCheck = findCheck(
    preparedAfterLegacyInflightCleanup,
    "PRE_POU_IN_FLIGHT_STATE_CLEARED"
  );
  assert(fixedLegacyInflightCheck, "Recovered prepare should still include the legacy in-flight rollout check");
  assert(
    String(fixedLegacyInflightCheck?.status || "").toUpperCase() === "PASS",
    "Legacy in-flight rollout check should pass after the legacy state has been cancelled/recreated"
  );

  const ownershipAwareRunId = await insertFinalizedPayrollRunWithOwnershipLine({
    tenantId,
    legalEntityId,
    legalEntityCode,
    userId: makerUserId,
    runNo: `PRP08-OWN-AWARE-${stamp}`,
    payrollPeriod: "2026-02-18",
    payDate: "2026-02-18",
    ownershipAsOfDate: "2026-02-28",
    employeeCode: "OWN001",
    employeeName: "Ownership Gap Employee",
    ownershipResolutionStatus: "UNRESOLVED",
    ownershipScope: null,
    ownershipResolutionNote: "Ownership assignment missing",
  });

  const preparedWithOwnershipGap = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare with ownership gap",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedWithOwnershipGap?.close?.status || "").toUpperCase() === "DRAFT",
    "Ownership-aware finalized runs with unresolved ownership should fail the close checklist"
  );
  const blockedOwnershipCheck = findCheck(
    preparedWithOwnershipGap,
    "FINALIZED_LINES_OWNERSHIP_RESOLVED"
  );
  assert(blockedOwnershipCheck, "Blocked prepare should include the ownership close check");
  assert(
    String(blockedOwnershipCheck?.status || "").toUpperCase() === "FAIL",
    "Ownership close check should fail when finalized ownership-aware lines remain unresolved"
  );
  assert(
    toNumber(blockedOwnershipCheck?.metric_value) === 1,
    "Ownership close check should count the blocking finalized line"
  );
  assert(
    toNumber(blockedOwnershipCheck?.details_json?.affected_run_count) === 1,
    "Ownership close check should report one affected ownership-aware finalized run"
  );
  assert(
    toNumber(blockedOwnershipCheck?.details_json?.grandfathered_finalized_run_count) === 1,
    "Ownership close check should keep grandfathered finalized runs out of the blocking set"
  );
  assert(
    blockedOwnershipCheck?.details_json?.sample_lines?.[0]?.employee_code === "OWN001",
    "Ownership close check should surface a blocking sample employee"
  );

  await query(
    `UPDATE payroll_run_lines
     SET ownership_scope = 'CENTRAL',
         operating_unit_id = NULL,
         ownership_resolution_status = 'RESOLVED',
         ownership_resolution_note = NULL
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND run_id = ?`,
    [tenantId, legalEntityId, ownershipAwareRunId]
  );

  const preparedAfterOwnershipFix = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare after ownership fix",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedAfterOwnershipFix?.close?.status || "").toUpperCase() === "READY",
    "Close checklist should recover to READY after ownership gaps are fixed"
  );
  const fixedOwnershipCheck = findCheck(
    preparedAfterOwnershipFix,
    "FINALIZED_LINES_OWNERSHIP_RESOLVED"
  );
  assert(fixedOwnershipCheck, "Fixed prepare should still return the ownership check");
  assert(
    String(fixedOwnershipCheck?.status || "").toUpperCase() === "PASS",
    "Ownership close check should pass once blocking finalized lines are resolved"
  );
  assert(
    toNumber(fixedOwnershipCheck?.details_json?.ownership_aware_finalized_run_count) === 1,
    "Resolved ownership-aware finalized runs should stay visible in ownership-aware coverage"
  );

  await insertPayrollLiability({
    tenantId,
    legalEntityId,
    runId: ownershipAwareRunId,
    liabilityKey: `PRP08-LIA-CENTRAL-VALID-${stamp}`,
    payableGlAccountId: liabilityGlAccountId,
    employeeCode: "OWNCEN001",
    employeeName: "Central Liability Valid",
    ownershipScope: "CENTRAL",
    operatingUnitId: null,
  });
  const invalidLiabilityId = await insertPayrollLiability({
    tenantId,
    legalEntityId,
    runId: ownershipAwareRunId,
    liabilityKey: `PRP08-LIA-CENTRAL-INVALID-${stamp}`,
    payableGlAccountId: liabilityGlAccountId,
    employeeCode: "OWNOU001",
    employeeName: "OU Liability Invalid",
    ownershipScope: "CENTRAL",
    operatingUnitId,
  });

  const preparedWithInvalidLiability = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare with invalid liability owner context",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedWithInvalidLiability?.close?.status || "").toUpperCase() === "DRAFT",
    "Ownership-aware liabilities with invalid owner context should fail the close checklist"
  );
  const blockedLiabilityCheck = findCheck(
    preparedWithInvalidLiability,
    "LIABILITIES_OWNER_CONTEXT_VALID"
  );
  assert(blockedLiabilityCheck, "Blocked prepare should include the liability owner-context check");
  assert(
    String(blockedLiabilityCheck?.status || "").toUpperCase() === "FAIL",
    "Liability owner-context close check should fail when an ownership-aware liability is invalid"
  );
  assert(
    toNumber(blockedLiabilityCheck?.metric_value) === 1,
    "Liability owner-context close check should count the invalid ownership-aware liability"
  );
  assert(
    toNumber(blockedLiabilityCheck?.details_json?.central_with_operating_unit_count) === 1,
    "Liability close check should flag CENTRAL liabilities that still carry an operating unit"
  );
  assert(
    toNumber(blockedLiabilityCheck?.details_json?.grandfathered_liability_count) === 1,
    "Liability close check should keep grandfathered liabilities out of the blocking set"
  );
  assert(
    Array.isArray(blockedLiabilityCheck?.details_json?.validity_rules) &&
      blockedLiabilityCheck.details_json.validity_rules.length === 2,
    "Liability close check should return the owner-context validity rules"
  );
  assert(
    blockedLiabilityCheck?.details_json?.sample_liabilities?.[0]?.employee_code === "OWNOU001",
    "Liability close check should surface a blocking sample liability"
  );

  await query(
    `UPDATE payroll_run_liabilities
     SET ownership_scope = 'OPERATING_UNIT',
         operating_unit_id = ?
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [operatingUnitId, tenantId, legalEntityId, invalidLiabilityId]
  );

  const preparedAfterLiabilityFix = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare after liability owner-context fix",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedAfterLiabilityFix?.close?.status || "").toUpperCase() === "READY",
    "Close checklist should recover to READY after liability owner-context issues are fixed"
  );
  const fixedLiabilityCheck = findCheck(
    preparedAfterLiabilityFix,
    "LIABILITIES_OWNER_CONTEXT_VALID"
  );
  assert(fixedLiabilityCheck, "Fixed prepare should still include the liability owner-context check");
  assert(
    String(fixedLiabilityCheck?.status || "").toUpperCase() === "PASS",
    "Liability owner-context close check should pass once CENTRAL/OU ownership rules are satisfied"
  );
  assert(
    toNumber(fixedLiabilityCheck?.details_json?.ownership_aware_liability_count) === 2,
    "Resolved ownership-aware liabilities should remain visible in owner-context coverage"
  );

  const crossContextSettlementLiabilityId = await insertPayrollLiability({
    tenantId,
    legalEntityId,
    runId: ownershipAwareRunId,
    liabilityKey: `PRP08-LIA-CROSS-CONTEXT-${stamp}`,
    payableGlAccountId: liabilityGlAccountId,
    employeeCode: "OWNPAY001",
    employeeName: "Cross Context Settlement Employee",
    ownershipScope: "OPERATING_UNIT",
    operatingUnitId,
    amount: 85,
  });
  const brokenPostedPayrollBatch = await insertPostedPayrollBatchMissingSelfBalancing({
    tenantId,
    legalEntityId,
    runId: ownershipAwareRunId,
    liabilityId: crossContextSettlementLiabilityId,
    payableGlAccountId: liabilityGlAccountId,
    bankAccountId: paymentPostingFixture.centralBankAccountId,
    bankGlAccountId: paymentPostingFixture.centralBankGlAccountId,
    ownerOperatingUnitId: operatingUnitId,
    bookId: paymentPostingFixture.bookId,
    fiscalPeriodId: paymentPostingFixture.fiscalPeriodId,
    currencyCode,
    batchNo: `PRP08-BATCH-BROKEN-${stamp}`,
    amount: 85,
    postingDate: "2026-02-24",
    userId: makerUserId,
  });

  const preparedWithBrokenSettlementStructure = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare with broken posted payroll settlement structure",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedWithBrokenSettlementStructure?.close?.status || "").toUpperCase() === "DRAFT",
    "Cross-context posted payroll batches missing self-balancing lines should fail the close checklist"
  );
  const blockedSettlementCheck = findCheck(
    preparedWithBrokenSettlementStructure,
    "POSTED_PAYROLL_BATCHES_SELF_BALANCED"
  );
  assert(blockedSettlementCheck, "Blocked prepare should include the posted payroll settlement check");
  assert(
    String(blockedSettlementCheck?.status || "").toUpperCase() === "FAIL",
    "Posted payroll settlement close check should fail when cross-context self-balancing lines are missing"
  );
  assert(
    toNumber(blockedSettlementCheck?.metric_value) === 1,
    "Posted payroll settlement close check should count the broken cross-context payment line"
  );
  assert(
    toNumber(blockedSettlementCheck?.details_json?.cross_context_line_count) === 1,
    "Posted payroll settlement close check should identify the cross-context payroll payment line"
  );
  assert(
    toNumber(blockedSettlementCheck?.details_json?.self_balancing_owner_credit_missing_count) ===
      1,
    "Posted payroll settlement close check should flag the missing owner-context credit line"
  );
  assert(
    toNumber(blockedSettlementCheck?.details_json?.self_balancing_payer_debit_missing_count) ===
      1,
    "Posted payroll settlement close check should flag the missing payer-context debit line"
  );
  assert(
    blockedSettlementCheck?.details_json?.sample_lines?.[0]?.owner_context?.ownership_scope ===
      "OPERATING_UNIT",
    "Posted payroll settlement close check should surface the liability owner context"
  );
  assert(
    blockedSettlementCheck?.details_json?.sample_lines?.[0]?.payer_context?.ownership_scope ===
      "CENTRAL",
    "Posted payroll settlement close check should derive the payer context from the posted bank line"
  );

  await query(
    `INSERT INTO journal_lines (
        journal_entry_id,
        line_no,
        account_id,
        operating_unit_id,
        counterparty_legal_entity_id,
        description,
        subledger_reference_no,
        currency_code,
        amount_txn,
        debit_base,
        credit_base,
        tax_code
      )
      VALUES
        (?, 3, ?, ?, NULL, ?, ?, ?, ?, 0, ?, NULL),
        (?, 4, ?, NULL, NULL, ?, ?, ?, ?, ?, 0, NULL)`,
    [
      brokenPostedPayrollBatch.journalEntryId,
      paymentPostingFixture.ouDueToCentralAccountId,
      operatingUnitId,
      `Settlement PRP08-BATCH-BROKEN-${stamp} line 1 | payroll self-balance due to CENTRAL`,
      `PAYBATCH:${brokenPostedPayrollBatch.batchId}:L1`,
      currencyCode,
      -85,
      85,
      brokenPostedPayrollBatch.journalEntryId,
      paymentPostingFixture.centralDueFromAccountId,
      `Settlement PRP08-BATCH-BROKEN-${stamp} line 1 | payroll self-balance due from OU`,
      `PAYBATCH:${brokenPostedPayrollBatch.batchId}:L1`,
      currencyCode,
      85,
      85,
    ]
  );
  await query(
    `UPDATE journal_entries
     SET total_debit_base = 170,
         total_credit_base = 170
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [tenantId, legalEntityId, brokenPostedPayrollBatch.journalEntryId]
  );

  const preparedAfterSettlementRepair = await preparePayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    input: {
      legalEntityId,
      periodStart,
      periodEnd,
      lockRunChanges: true,
      lockManualSettlements: true,
      lockPaymentPrep: false,
      note: "prepare after repairing posted payroll settlement structure",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(preparedAfterSettlementRepair?.close?.status || "").toUpperCase() === "READY",
    "Close checklist should recover to READY after the posted payroll settlement structure is repaired"
  );
  const fixedSettlementCheck = findCheck(
    preparedAfterSettlementRepair,
    "POSTED_PAYROLL_BATCHES_SELF_BALANCED"
  );
  assert(fixedSettlementCheck, "Repaired prepare should still include the posted payroll settlement check");
  assert(
    String(fixedSettlementCheck?.status || "").toUpperCase() === "PASS",
    "Posted payroll settlement close check should pass once the missing self-balancing pair is restored"
  );
  assert(
    toNumber(fixedSettlementCheck?.details_json?.cross_context_line_count) === 1,
    "Repaired prepare should keep the cross-context payroll payment line visible in coverage"
  );

  const requestIdempotencyKey = `PRP08_REQ_${stamp}`;
  const requested1 = await requestPayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    closeId,
    note: "request close",
    requestIdempotencyKey,
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(requested1?.close?.status || "").toUpperCase() === "REQUESTED",
    "requestPayrollPeriodClose should move close to REQUESTED"
  );

  const requested2 = await requestPayrollPeriodClose({
    req: null,
    tenantId,
    userId: makerUserId,
    closeId,
    note: "request close idempotent retry",
    requestIdempotencyKey,
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(requested2?.close?.status || "").toUpperCase() === "REQUESTED",
    "Idempotent request-close retry should keep REQUESTED status"
  );

  await expectFailure(
    () =>
      approveAndClosePayrollPeriod({
        req: null,
        tenantId,
        userId: makerUserId,
        closeId,
        note: "self-approve should fail",
        closeIdempotencyKey: `PRP08_CLOSE_SELF_${stamp}`,
        assertScopeAccess: noScopeGuard,
        skipUnifiedApprovalGate: true,
      }),
    { status: 403, code: "SOD_VIOLATION" }
  );

  const closeIdempotencyKey = `PRP08_CLOSE_${stamp}`;
  const closed = await approveAndClosePayrollPeriod({
    req: null,
    tenantId,
    userId: checkerUserId,
    closeId,
    note: "approved and closed",
    closeIdempotencyKey,
    assertScopeAccess: noScopeGuard,
    skipUnifiedApprovalGate: true,
  });
  assert(
    String(closed?.close?.status || "").toUpperCase() === "CLOSED",
    "approveAndClosePayrollPeriod should move close to CLOSED"
  );

  const closedRetry = await approveAndClosePayrollPeriod({
    req: null,
    tenantId,
    userId: checkerUserId,
    closeId,
    note: "close retry",
    closeIdempotencyKey,
    assertScopeAccess: noScopeGuard,
    skipUnifiedApprovalGate: true,
  });
  assert(
    String(closedRetry?.close?.status || "").toUpperCase() === "CLOSED",
    "Idempotent close retry should remain CLOSED"
  );

  await expectFailure(
    () =>
      assertPayrollPeriodActionAllowed({
        tenantId,
        legalEntityId,
        payrollPeriod: "2026-02-10",
        actionType: "RUN_IMPORT",
      }),
    { status: 409, code: "PAYROLL_PERIOD_LOCKED" }
  );

  await expectFailure(
    () =>
      assertPayrollPeriodActionAllowed({
        tenantId,
        legalEntityId,
        payrollPeriod: "2026-02-10",
        actionType: "MANUAL_SETTLEMENT_OVERRIDE",
      }),
    { status: 409, code: "PAYROLL_PERIOD_LOCKED" }
  );

  const paymentPrepAllowed = await assertPayrollPeriodActionAllowed({
    tenantId,
    legalEntityId,
    payrollPeriod: "2026-02-10",
    actionType: "PAYMENT_PREP_BUILD",
  });
  assert(paymentPrepAllowed?.allowed === true, "PAYMENT_PREP action should be allowed when lock flag is false");

  const reopened = await reopenPayrollPeriodClose({
    req: null,
    tenantId,
    userId: checkerUserId,
    closeId,
    reason: "reopen for correction cycle",
    assertScopeAccess: noScopeGuard,
    skipUnifiedApprovalGate: true,
  });
  assert(
    String(reopened?.close?.status || "").toUpperCase() === "REOPENED",
    "reopenPayrollPeriodClose should move close to REOPENED"
  );

  const runAllowedAfterReopen = await assertPayrollPeriodActionAllowed({
    tenantId,
    legalEntityId,
    payrollPeriod: "2026-02-10",
    actionType: "RUN_IMPORT",
  });
  assert(
    runAllowedAfterReopen?.allowed === true,
    "RUN action should be allowed after period is reopened"
  );

  console.log(
    "PR-P08 smoke test passed (legacy grandfathering boundary, legacy in-flight rollout enforcement, ownership + liability close checks, posted payroll settlement structure, prepare/request/approve/reopen, maker-checker, lock enforcement, idempotency)."
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
