import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildPayrollAccrualComponentAmountsFromRunLines,
  EXPECTED_SIDE_BY_COMPONENT,
  findApplicablePayrollComponentMapping,
} from "./payroll.mappings.service.js";
import { assertLocalClosePackPostingAllowedForLines } from "./local.close-enforcement.service.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";
import {
  getPayrollRunOwnershipValidationDetails,
  reresolvePayrollRunOwnershipSnapshots,
} from "./payroll.ownership.service.js";

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function toAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(6));
}

function amountsEqual(a, b) {
  return toAmount(a) === toAmount(b);
}

function toDateOnly(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value.toISOString().slice(0, 10);
  }
  const asString = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(asString)) {
    return asString.slice(0, 10);
  }
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) {
    return asString.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function resolvePayrollAccrualDate(run) {
  const payrollPeriod = toDateOnly(run?.payroll_period);
  if (!payrollPeriod) {
    return toDateOnly(run?.pay_date);
  }

  const [yearText, monthText] = payrollPeriod.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return payrollPeriod;
  }

  const periodEnd = new Date(Date.UTC(year, month, 0));
  return periodEnd.toISOString().slice(0, 10);
}

function buildOwnershipFinalizeBlockedMessage(validation) {
  const samples = Array.isArray(validation?.sample_lines)
    ? validation.sample_lines
    : [];
  const sampleText = samples
    .slice(0, 5)
    .map((line) => {
      const employeeCode = String(line?.employee_code || "").trim() || "UNKNOWN";
      const status = String(line?.ownership_resolution_status || "").trim() || "UNRESOLVED";
      return `${employeeCode} [${status}]`;
    })
    .join(", ");
  const blockingCount = Number(validation?.blocking_line_count || 0);
  if (!sampleText) {
    return `Payroll ownership validation blocked finalize for ${blockingCount} line(s).`;
  }
  return `Payroll ownership validation blocked finalize for ${blockingCount} line(s): ${sampleText}`;
}

function createOwnershipFinalizeBlockedError(validation, extraDetails = {}) {
  const err = badRequest(buildOwnershipFinalizeBlockedMessage(validation));
  err.code = "PAYROLL_OWNERSHIP_FINALIZE_BLOCKED";
  err.details = {
    type: "OWNERSHIP_FINALIZE_BLOCKED",
    ...extraDetails,
    ownership_validation: validation,
  };
  return err;
}

async function findPayrollRunHeaderById({ tenantId, runId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
        r.id,
        r.tenant_id,
        r.legal_entity_id,
        r.run_no,
        r.provider_code,
        r.entity_code,
        r.payroll_period,
        r.pay_date,
        r.ownership_as_of_date,
        r.currency_code,
        r.status,
        r.total_base_salary,
        r.total_overtime_pay,
        r.total_bonus_pay,
        r.total_allowances,
        r.total_gross_pay,
        r.total_employee_tax,
        r.total_employee_social_security,
        r.total_other_deductions,
        r.total_net_pay,
        r.total_employer_tax,
        r.total_employer_social_security,
        r.reviewed_by_user_id,
        r.reviewed_at,
        r.finalized_by_user_id,
        r.finalized_at,
        r.accrual_journal_entry_id,
        r.accrual_posted_by_user_id,
        r.accrual_posted_at,
        r.imported_at,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name
     FROM payroll_runs r
     JOIN legal_entities le
       ON le.id = r.legal_entity_id
      AND le.tenant_id = r.tenant_id
     WHERE r.tenant_id = ?
       AND r.id = ?
     LIMIT 1`,
    [tenantId, runId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }
  return {
    ...row,
    payroll_period: toDateOnly(row.payroll_period),
    pay_date: toDateOnly(row.pay_date),
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
    finalized_at: row.finalized_at ? String(row.finalized_at) : null,
    imported_at: row.imported_at ? String(row.imported_at) : null,
  };
}

async function findPayrollRunHeaderForUpdate({ tenantId, runId, runQuery }) {
  const result = await runQuery(
    `SELECT *
     FROM payroll_runs
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, runId]
  );
  return result.rows?.[0] || null;
}

async function writePayrollRunAudit({
  tenantId,
  legalEntityId,
  runId,
  action = "STATUS",
  payload = null,
  userId = null,
  runQuery = query,
}) {
  await runQuery(
    `INSERT INTO payroll_run_audit (
        tenant_id,
        legal_entity_id,
        run_id,
        action,
        payload_json,
        acted_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, legalEntityId, runId, action, safeJson(payload), userId]
  );
}

async function writePayrollRunAuditImmediate({
  tenantId,
  legalEntityId,
  runId,
  action = "STATUS",
  payload = null,
  userId = null,
}) {
  await writePayrollRunAudit({
    tenantId,
    legalEntityId,
    runId,
    action,
    payload,
    userId,
    runQuery: query,
  });
}

async function getEffectivePeriodStatus(bookId, fiscalPeriodId, runQuery = query) {
  const result = await runQuery(
    `SELECT status
     FROM period_statuses
     WHERE book_id = ?
       AND fiscal_period_id = ?
     LIMIT 1`,
    [bookId, fiscalPeriodId]
  );
  return normalizeUpperText(result.rows?.[0]?.status || "OPEN") || "OPEN";
}

async function ensurePeriodOpen(bookId, fiscalPeriodId, actionLabel, runQuery = query) {
  const status = await getEffectivePeriodStatus(bookId, fiscalPeriodId, runQuery);
  if (status !== "OPEN") {
    throw badRequest(`Period is ${status}; cannot ${actionLabel}`);
  }
}

async function resolveBookAndPeriodForPayrollPostingTx(tx, { tenantId, legalEntityId, postDate }) {
  const bookResult = await tx.query(
    `SELECT id, calendar_id, code, name, base_currency_code, book_type
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY
       CASE WHEN book_type = 'LOCAL' THEN 0 ELSE 1 END,
       id ASC
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const book = bookResult.rows?.[0] || null;
  if (!book) {
    throw badRequest("No book found for payroll run legal entity");
  }

  const bookId = parsePositiveInt(book.id);
  const calendarId = parsePositiveInt(book.calendar_id);
  if (!bookId || !calendarId) {
    throw badRequest("Book configuration is invalid for payroll accrual posting");
  }

  const periodResult = await tx.query(
    `SELECT id, fiscal_year, period_no, period_name
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND ? BETWEEN start_date AND end_date
     ORDER BY is_adjustment ASC, id ASC
     LIMIT 1`,
    [calendarId, postDate]
  );
  const period = periodResult.rows?.[0] || null;
  if (!period) {
    throw badRequest("No fiscal period found for payroll accrual posting date");
  }

  const fiscalPeriodId = parsePositiveInt(period.id);
  if (!fiscalPeriodId) {
    throw badRequest("Fiscal period configuration is invalid for payroll accrual posting");
  }

  await ensurePeriodOpen(bookId, fiscalPeriodId, "post payroll accrual", tx.query.bind(tx));

  return {
    book,
    period,
    bookId,
    fiscalPeriodId,
  };
}

function validateMappingAccountForAccrual({ mapping, run }) {
  const issues = [];

  if (normalizeUpperText(mapping.coa_scope) !== "LEGAL_ENTITY") {
    issues.push("mapping_gl_account_not_legal_entity_scope");
  }
  if (parsePositiveInt(mapping.coa_legal_entity_id) !== parsePositiveInt(run.legal_entity_id)) {
    issues.push("mapping_gl_account_entity_mismatch");
  }
  if (!parseDbBoolean(mapping.account_is_active)) {
    issues.push("mapping_gl_account_inactive");
  }
  if (!parseDbBoolean(mapping.allow_posting)) {
    issues.push("mapping_gl_account_not_postable");
  }
  if (Number(mapping.child_count || 0) > 0) {
    issues.push("mapping_gl_account_not_leaf");
  }
  return issues;
}

function formatAccrualOwnerContextLabel(row) {
  const ownershipScope = normalizeUpperText(row?.ownership_scope);
  if (ownershipScope === "CENTRAL") {
    return "CENTRAL";
  }
  if (ownershipScope === "OPERATING_UNIT") {
    const operatingUnitCode = String(row?.operating_unit_code || "").trim();
    if (operatingUnitCode) {
      return operatingUnitCode;
    }
    const operatingUnitId = parsePositiveInt(row?.operating_unit_id);
    if (operatingUnitId) {
      return `OU#${operatingUnitId}`;
    }
    const operatingUnitName = String(row?.operating_unit_name || "").trim();
    if (operatingUnitName) {
      return operatingUnitName;
    }
    return "OPERATING_UNIT";
  }
  return "UNRESOLVED";
}

function buildAccrualPostingDescription({ runNo, componentCode, ownerContextLabel }) {
  return `Payroll accrual ${runNo} ${componentCode} [${ownerContextLabel}]`;
}

function buildAccrualSubledgerReferenceNo({
  runId,
  componentCode,
  ownershipScope,
  operatingUnitId,
}) {
  return [
    "PAYROLL_RUN",
    runId,
    componentCode,
    normalizeUpperText(ownershipScope) || "UNRESOLVED",
    parsePositiveInt(operatingUnitId) || 0,
  ].join(":");
}

async function listPayrollRunAccrualSourceLines({
  tenantId,
  legalEntityId,
  runId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        l.id,
        l.line_no,
        l.ownership_scope,
        l.operating_unit_id,
        l.base_salary,
        l.overtime_pay,
        l.bonus_pay,
        l.allowances_total,
        l.employee_tax,
        l.employee_social_security,
        l.other_deductions,
        l.net_pay,
        l.employer_tax,
        l.employer_social_security,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
     FROM payroll_run_lines l
     LEFT JOIN operating_units ou
       ON ou.id = l.operating_unit_id
      AND ou.tenant_id = l.tenant_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND l.run_id = ?
     ORDER BY l.line_no ASC, l.id ASC`,
    [tenantId, legalEntityId, runId]
  );
  return result.rows || [];
}

async function buildPayrollAccrualPreviewFromRun({
  run,
  ownershipValidation = null,
  runQuery = query,
}) {
  if (!run) {
    throw badRequest("Payroll run not found");
  }

  const componentAmounts = buildPayrollAccrualComponentAmountsFromRunLines(
    await listPayrollRunAccrualSourceLines({
      tenantId: parsePositiveInt(run.tenant_id),
      legalEntityId: parsePositiveInt(run.legal_entity_id),
      runId: parsePositiveInt(run.id),
      runQuery,
    })
  );
  const postingLines = [];
  const missingMappings = [];
  const accrualDate = resolvePayrollAccrualDate(run);

  for (const component of componentAmounts) {
    const ownerContextLabel = formatAccrualOwnerContextLabel(component);
    const mapping = await findApplicablePayrollComponentMapping({
      tenantId: parsePositiveInt(run.tenant_id),
      legalEntityId: parsePositiveInt(run.legal_entity_id),
      providerCode: run.provider_code,
      currencyCode: normalizeUpperText(run.currency_code),
      componentCode: component.componentCode,
      asOfDate: accrualDate,
      runQuery,
    });

    if (!mapping) {
      missingMappings.push({
        component_code: component.componentCode,
        entry_side: component.entrySide,
        amount: component.amount,
        ownership_scope: component.ownership_scope,
        operating_unit_id: parsePositiveInt(component.operating_unit_id),
        operating_unit_code: component.operating_unit_code || null,
        operating_unit_name: component.operating_unit_name || null,
        owner_context_label: ownerContextLabel,
        issue: "missing_mapping",
      });
      continue;
    }

    const expectedSide = EXPECTED_SIDE_BY_COMPONENT[component.componentCode];
    if (expectedSide && normalizeUpperText(mapping.entry_side) !== expectedSide) {
      missingMappings.push({
        component_code: component.componentCode,
        entry_side: component.entrySide,
        amount: component.amount,
        ownership_scope: component.ownership_scope,
        operating_unit_id: parsePositiveInt(component.operating_unit_id),
        operating_unit_code: component.operating_unit_code || null,
        operating_unit_name: component.operating_unit_name || null,
        owner_context_label: ownerContextLabel,
        issue: `mapping_entry_side_mismatch_expected_${expectedSide}`,
        mapping_id: parsePositiveInt(mapping.id),
      });
      continue;
    }
    if (normalizeUpperText(mapping.entry_side) !== normalizeUpperText(component.entrySide)) {
      missingMappings.push({
        component_code: component.componentCode,
        entry_side: component.entrySide,
        amount: component.amount,
        ownership_scope: component.ownership_scope,
        operating_unit_id: parsePositiveInt(component.operating_unit_id),
        operating_unit_code: component.operating_unit_code || null,
        operating_unit_name: component.operating_unit_name || null,
        owner_context_label: ownerContextLabel,
        issue: "mapping_entry_side_mismatch_component",
        mapping_id: parsePositiveInt(mapping.id),
      });
      continue;
    }

    const accountIssues = validateMappingAccountForAccrual({ mapping, run });
    if (accountIssues.length > 0) {
      missingMappings.push({
        component_code: component.componentCode,
        entry_side: component.entrySide,
        amount: component.amount,
        ownership_scope: component.ownership_scope,
        operating_unit_id: parsePositiveInt(component.operating_unit_id),
        operating_unit_code: component.operating_unit_code || null,
        operating_unit_name: component.operating_unit_name || null,
        owner_context_label: ownerContextLabel,
        issue: accountIssues.join(","),
        mapping_id: parsePositiveInt(mapping.id),
      });
      continue;
    }

    postingLines.push({
      component_code: component.componentCode,
      entry_side: normalizeUpperText(component.entrySide),
      amount: component.amount,
      ownership_scope: component.ownership_scope,
      operating_unit_id: parsePositiveInt(component.operating_unit_id),
      operating_unit_code: component.operating_unit_code || null,
      operating_unit_name: component.operating_unit_name || null,
      owner_context_label: ownerContextLabel,
      mapping_id: parsePositiveInt(mapping.id),
      provider_code: mapping.provider_code || null,
      gl_account_id: parsePositiveInt(mapping.gl_account_id),
      gl_account_code: mapping.gl_account_code || null,
      gl_account_name: mapping.gl_account_name || null,
      currency_code: normalizeUpperText(run.currency_code),
      description: buildAccrualPostingDescription({
        runNo: run.run_no,
        componentCode: component.componentCode,
        ownerContextLabel,
      }),
      subledger_reference_no: buildAccrualSubledgerReferenceNo({
        runId: parsePositiveInt(run.id),
        componentCode: component.componentCode,
        ownershipScope: component.ownership_scope,
        operatingUnitId: component.operating_unit_id,
      }),
    });
  }

  const debitTotal = toAmount(
    postingLines
      .filter((line) => line.entry_side === "DEBIT")
      .reduce((sum, line) => sum + toAmount(line.amount), 0)
  );
  const creditTotal = toAmount(
    postingLines
      .filter((line) => line.entry_side === "CREDIT")
      .reduce((sum, line) => sum + toAmount(line.amount), 0)
  );

  const isBalanced = amountsEqual(debitTotal, creditTotal);
  const normalizedStatus = normalizeUpperText(run.status);

  return {
    run: {
      id: parsePositiveInt(run.id),
      run_no: run.run_no,
      status: normalizedStatus,
      pay_date: toDateOnly(run.pay_date),
      payroll_period: toDateOnly(run.payroll_period),
      ownership_as_of_date: toDateOnly(run.ownership_as_of_date),
      accrual_date: accrualDate,
      currency_code: normalizeUpperText(run.currency_code),
      provider_code: normalizeUpperText(run.provider_code),
      accrual_journal_entry_id: parsePositiveInt(run.accrual_journal_entry_id),
      legal_entity_id: parsePositiveInt(run.legal_entity_id),
      legal_entity_code: run.legal_entity_code || run.entity_code || null,
      legal_entity_name: run.legal_entity_name || null,
    },
    component_totals: componentAmounts.map((row) => ({
      component_code: row.componentCode,
      entry_side: row.entrySide,
      amount: row.amount,
      ownership_scope: row.ownership_scope,
      operating_unit_id: parsePositiveInt(row.operating_unit_id),
      operating_unit_code: row.operating_unit_code || null,
      operating_unit_name: row.operating_unit_name || null,
      owner_context_label: formatAccrualOwnerContextLabel(row),
    })),
    posting_lines: postingLines,
    missing_mappings: missingMappings,
    ownership_validation: ownershipValidation,
    debit_total: debitTotal,
    credit_total: creditTotal,
    is_balanced: isBalanced,
    can_finalize:
      postingLines.length > 0 &&
      missingMappings.length === 0 &&
      Number(ownershipValidation?.blocking_line_count || 0) === 0 &&
      isBalanced &&
      normalizedStatus === "REVIEWED",
  };
}

async function findExistingPayrollAccrualJournalTx(tx, {
  tenantId,
  legalEntityId,
  bookId,
  journalNo,
}) {
  const result = await tx.query(
    `SELECT id, status
     FROM journal_entries
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND book_id = ?
       AND journal_no = ?
     LIMIT 1`,
    [tenantId, legalEntityId, bookId, journalNo]
  );
  return result.rows?.[0] || null;
}

async function createPayrollAccrualJournalTx(tx, {
  run,
  preview,
  tenantId,
  legalEntityId,
  userId,
  postingDate,
  note = null,
}) {
  const journalContext = await resolveBookAndPeriodForPayrollPostingTx(tx, {
    tenantId,
    legalEntityId,
    postDate: postingDate,
  });

  const bookBaseCurrencyCode = normalizeUpperText(journalContext.book?.base_currency_code);
  const runCurrency = normalizeUpperText(run.currency_code);
  if (bookBaseCurrencyCode && runCurrency && bookBaseCurrencyCode !== runCurrency) {
    throw badRequest(
      `Payroll run currency (${runCurrency}) must match book base currency (${bookBaseCurrencyCode})`
    );
  }

  const journalNo = `PRACR-${run.id}`;
  const existingJournal = await findExistingPayrollAccrualJournalTx(tx, {
    tenantId,
    legalEntityId,
    bookId: journalContext.bookId,
    journalNo,
  });

  if (existingJournal?.id) {
    await upsertJournalSourceLinkTx(tx, {
      tenantId,
      legalEntityId,
      journalEntryId: parsePositiveInt(existingJournal.id),
      sourceRefType: "PAYROLL_RUN",
      sourceRefId: parsePositiveInt(run.id),
    });
    return {
      journalEntryId: parsePositiveInt(existingJournal.id),
      journalNo,
      idempotentReplay: true,
      bookId: journalContext.bookId,
      fiscalPeriodId: journalContext.fiscalPeriodId,
    };
  }

  const description = note || `Payroll accrual ${run.run_no}`;
  const referenceNo = `PAYROLL-RUN:${run.id}`;
  const debitTotal = toAmount(
    (preview.posting_lines || [])
      .filter((line) => normalizeUpperText(line.entry_side) === "DEBIT")
      .reduce((sum, line) => sum + toAmount(line.amount), 0)
  );
  const creditTotal = toAmount(
    (preview.posting_lines || [])
      .filter((line) => normalizeUpperText(line.entry_side) === "CREDIT")
      .reduce((sum, line) => sum + toAmount(line.amount), 0)
  );
  await assertLocalClosePackPostingAllowedForLines({
    tenantId,
    legalEntityId,
    bookId: journalContext.bookId,
    fiscalPeriodId: journalContext.fiscalPeriodId,
    lines: (preview.posting_lines || []).map((line) => ({
      operatingUnitId: parsePositiveInt(line.operating_unit_id),
      operating_unit_id: parsePositiveInt(line.operating_unit_id),
    })),
    actionType: "POST_PAYROLL_ACCRUAL_JOURNAL",
    runQuery: tx.query.bind(tx),
  });

  const headerInsert = await tx.query(
    `INSERT INTO journal_entries (
        tenant_id,
        legal_entity_id,
        book_id,
        fiscal_period_id,
        journal_no,
        source_type,
        status,
        entry_date,
        document_date,
        currency_code,
        description,
        reference_no,
        total_debit_base,
        total_credit_base,
        created_by_user_id,
        posted_by_user_id,
        posted_at
      )
      VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      tenantId,
      legalEntityId,
      journalContext.bookId,
      journalContext.fiscalPeriodId,
      journalNo,
      postingDate,
      postingDate,
      runCurrency,
      description,
      referenceNo,
      debitTotal,
      creditTotal,
      userId,
      userId,
    ]
  );

  const journalEntryId = parsePositiveInt(headerInsert.rows?.insertId);
  if (!journalEntryId) {
    throw new Error("Failed to create payroll accrual journal");
  }
  await upsertJournalSourceLinkTx(tx, {
    tenantId,
    legalEntityId,
    journalEntryId,
    sourceRefType: "PAYROLL_RUN",
    sourceRefId: parsePositiveInt(run.id),
  });

  let lineNo = 1;
  for (const line of preview.posting_lines || []) {
    const amount = toAmount(line.amount);
    const isDebit = normalizeUpperText(line.entry_side) === "DEBIT";
    const amountTxn = isDebit ? amount : -amount;
    const debitBase = isDebit ? amount : 0;
    const creditBase = isDebit ? 0 : amount;
    const subledgerRef =
      line.subledger_reference_no ||
      buildAccrualSubledgerReferenceNo({
        runId: parsePositiveInt(run.id),
        componentCode: line.component_code,
        ownershipScope: line.ownership_scope,
        operatingUnitId: line.operating_unit_id,
      });
    const descriptionLine =
      line.description ||
      buildAccrualPostingDescription({
        runNo: run.run_no,
        componentCode: line.component_code,
        ownerContextLabel: formatAccrualOwnerContextLabel(line),
      });

    // eslint-disable-next-line no-await-in-loop
    await tx.query(
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
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        journalEntryId,
        lineNo,
        parsePositiveInt(line.gl_account_id),
        parsePositiveInt(line.operating_unit_id),
        descriptionLine,
        subledgerRef,
        runCurrency,
        amountTxn,
        debitBase,
        creditBase,
      ]
    );

    lineNo += 1;
  }

  return {
    journalEntryId,
    journalNo,
    idempotentReplay: false,
    bookId: journalContext.bookId,
    fiscalPeriodId: journalContext.fiscalPeriodId,
  };
}

export async function getPayrollRunAccrualPreview({
  req,
  tenantId,
  runId,
  assertScopeAccess,
}) {
  const run = await findPayrollRunHeaderById({ tenantId, runId });
  if (!run) {
    throw badRequest("Payroll run not found");
  }

  assertScopeAccess(req, "legal_entity", parsePositiveInt(run.legal_entity_id), "runId");
  const ownershipValidation = await getPayrollRunOwnershipValidationDetails({
    tenantId,
    legalEntityId: parsePositiveInt(run.legal_entity_id),
    runId,
    ownershipAsOfDate: toDateOnly(run.ownership_as_of_date),
    runQuery: query,
  });
  return buildPayrollAccrualPreviewFromRun({ run, ownershipValidation });
}

export async function markPayrollRunReviewed({
  req,
  tenantId,
  runId,
  userId,
  note,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const current = await findPayrollRunHeaderForUpdate({
      tenantId,
      runId,
      runQuery: tx.query,
    });
    if (!current) {
      throw badRequest("Payroll run not found");
    }

    assertScopeAccess(req, "legal_entity", parsePositiveInt(current.legal_entity_id), "runId");
    const currentStatus = normalizeUpperText(current.status);
    if (currentStatus === "FINALIZED") {
      return {
        runId: parsePositiveInt(current.id),
        idempotentReplay: true,
        status: currentStatus,
      };
    }
    if (currentStatus === "REVIEWED") {
      return {
        runId: parsePositiveInt(current.id),
        idempotentReplay: true,
        status: currentStatus,
      };
    }
    if (currentStatus !== "IMPORTED") {
      throw badRequest(`Payroll run status ${currentStatus} cannot be reviewed`);
    }

    await tx.query(
      `UPDATE payroll_runs
       SET status = 'REVIEWED',
           reviewed_by_user_id = ?,
           reviewed_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [userId, tenantId, runId]
    );

    await writePayrollRunAudit({
      tenantId,
      legalEntityId: parsePositiveInt(current.legal_entity_id),
      runId,
      action: "STATUS",
      payload: {
        fromStatus: currentStatus,
        toStatus: "REVIEWED",
        note: note || null,
      },
      userId,
      runQuery: tx.query,
    });

    return {
      runId,
      idempotentReplay: false,
      status: "REVIEWED",
    };
  });
}

export async function finalizePayrollRunAccrual({
  req,
  tenantId,
  runId,
  userId,
  note,
  forceFromImported = false,
  assertScopeAccess,
}) {
  return withTransaction(async (tx) => {
    const current = await findPayrollRunHeaderForUpdate({
      tenantId,
      runId,
      runQuery: tx.query,
    });
    if (!current) {
      throw badRequest("Payroll run not found");
    }

    assertScopeAccess(req, "legal_entity", parsePositiveInt(current.legal_entity_id), "runId");

    const currentStatus = normalizeUpperText(current.status);
    const currentAccrualJeId = parsePositiveInt(current.accrual_journal_entry_id);
    if (currentStatus === "FINALIZED" && currentAccrualJeId) {
      await upsertJournalSourceLinkTx(tx, {
        tenantId,
        legalEntityId: parsePositiveInt(current.legal_entity_id),
        journalEntryId: currentAccrualJeId,
        sourceRefType: "PAYROLL_RUN",
        sourceRefId: runId,
      });
      return {
        runId,
        accrualJournalEntryId: currentAccrualJeId,
        idempotentReplay: true,
      };
    }

    if (currentStatus === "IMPORTED" && !forceFromImported) {
      throw badRequest("Payroll run must be REVIEWED before finalize");
    }
    if (!["IMPORTED", "REVIEWED", "FINALIZED"].includes(currentStatus)) {
      throw badRequest(`Payroll run status ${currentStatus} cannot be finalized`);
    }
    const ownershipAsOfDate = toDateOnly(current.ownership_as_of_date);
    if (!ownershipAsOfDate) {
      const err = badRequest(
        "Payroll run ownership_as_of_date is missing; cancel and re-import the run under the ownership contract"
      );
      err.code = "PAYROLL_OWNERSHIP_AS_OF_DATE_MISSING";
      err.details = {
        type: "OWNERSHIP_AS_OF_DATE_MISSING",
        run_id: parsePositiveInt(current.id),
        run_type: normalizeUpperText(current.run_type || "REGULAR"),
      };
      throw err;
    }

    const ownershipReresolution = await reresolvePayrollRunOwnershipSnapshots({
      tenantId,
      legalEntityId: parsePositiveInt(current.legal_entity_id),
      runId,
      ownershipAsOfDate,
      runType: current.run_type,
      runQuery: tx.query,
    });

    if (Number(ownershipReresolution?.validation?.blocking_line_count || 0) > 0) {
      await writePayrollRunAuditImmediate({
        tenantId,
        legalEntityId: parsePositiveInt(current.legal_entity_id),
        runId,
        action: "VALIDATION",
        payload: {
          type: "OWNERSHIP_FINALIZE_BLOCKED",
          ownership_reresolution: {
            updatedLineCount: ownershipReresolution.updated_line_count,
            totalLineCount: ownershipReresolution.total_line_count,
            skipped: Boolean(ownershipReresolution.skipped),
            skipReason: ownershipReresolution.skip_reason || null,
          },
          ownership_validation: ownershipReresolution.validation,
        },
        userId,
      });
      throw createOwnershipFinalizeBlockedError(ownershipReresolution.validation, {
        run_id: parsePositiveInt(current.id),
        ownership_reresolution: {
          updatedLineCount: ownershipReresolution.updated_line_count,
          totalLineCount: ownershipReresolution.total_line_count,
          skipped: Boolean(ownershipReresolution.skipped),
          skipReason: ownershipReresolution.skip_reason || null,
        },
      });
    }

    const currentForPreview = {
      ...current,
      legal_entity_code: current.entity_code,
      legal_entity_name: null,
    };
    const preview = await buildPayrollAccrualPreviewFromRun({
      run: currentForPreview,
      ownershipValidation: ownershipReresolution.validation,
      runQuery: tx.query,
    });

    await writePayrollRunAudit({
      tenantId,
      legalEntityId: parsePositiveInt(current.legal_entity_id),
      runId,
      action: "VALIDATION",
      payload: {
        type: "OWNERSHIP_READY_FOR_FINALIZE",
        ownership_reresolution: {
          updatedLineCount: ownershipReresolution.updated_line_count,
          totalLineCount: ownershipReresolution.total_line_count,
          skipped: Boolean(ownershipReresolution.skipped),
          skipReason: ownershipReresolution.skip_reason || null,
        },
        ownership_validation: ownershipReresolution.validation,
      },
      userId,
      runQuery: tx.query,
    });

    if (preview.missing_mappings.length > 0) {
      const missingCodes = Array.from(
        new Set(preview.missing_mappings.map((m) => m.component_code).filter(Boolean))
      );

      await writePayrollRunAuditImmediate({
        tenantId,
        legalEntityId: parsePositiveInt(current.legal_entity_id),
        runId,
        action: "VALIDATION",
        payload: {
          type: "ACCRUAL_FINALIZE_BLOCKED",
          reason: "MISSING_MAPPINGS",
          missingComponents: missingCodes,
          missingMappings: preview.missing_mappings,
        },
        userId,
      });

      throw badRequest(`Missing payroll component mappings: ${missingCodes.join(", ")}`);
    }
    if ((preview.posting_lines || []).length === 0) {
      await writePayrollRunAuditImmediate({
        tenantId,
        legalEntityId: parsePositiveInt(current.legal_entity_id),
        runId,
        action: "VALIDATION",
        payload: {
          type: "ACCRUAL_FINALIZE_BLOCKED",
          reason: "NO_NONZERO_COMPONENTS",
        },
        userId,
      });
      throw badRequest("No non-zero payroll accrual components to post");
    }
    if (!preview.is_balanced) {
      await writePayrollRunAuditImmediate({
        tenantId,
        legalEntityId: parsePositiveInt(current.legal_entity_id),
        runId,
        action: "VALIDATION",
        payload: {
          type: "ACCRUAL_FINALIZE_BLOCKED",
          reason: "UNBALANCED_PREVIEW",
          debitTotal: preview.debit_total,
          creditTotal: preview.credit_total,
        },
        userId,
      });
      throw badRequest("Payroll accrual preview is not balanced");
    }

    const postingDate = resolvePayrollAccrualDate(current);
    const journalResult = await createPayrollAccrualJournalTx(tx, {
      run: current,
      preview,
      tenantId,
      legalEntityId: parsePositiveInt(current.legal_entity_id),
      userId,
      postingDate,
      note,
    });

    const shouldBackfillReview = currentStatus === "IMPORTED" && forceFromImported;

    await tx.query(
      `UPDATE payroll_runs
       SET status = 'FINALIZED',
           reviewed_by_user_id = COALESCE(reviewed_by_user_id, ?),
           reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
           finalized_by_user_id = ?,
           finalized_at = CURRENT_TIMESTAMP,
           accrual_journal_entry_id = ?,
           accrual_posted_by_user_id = ?,
           accrual_posted_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [
        shouldBackfillReview ? userId : null,
        userId,
        journalResult.journalEntryId,
        userId,
        tenantId,
        runId,
      ]
    );

    await writePayrollRunAudit({
      tenantId,
      legalEntityId: parsePositiveInt(current.legal_entity_id),
      runId,
      action: "STATUS",
      payload: {
        fromStatus: currentStatus,
        toStatus: "FINALIZED",
        forceFromImported: Boolean(forceFromImported),
        note: note || null,
        accrualJournalEntryId: journalResult.journalEntryId,
        journalNo: journalResult.journalNo,
        postingDate,
        debitTotal: preview.debit_total,
        creditTotal: preview.credit_total,
        lineCount: (preview.posting_lines || []).length,
        idempotentJournalReplay: Boolean(journalResult.idempotentReplay),
      },
      userId,
      runQuery: tx.query,
    });

    return {
      runId,
      accrualJournalEntryId: journalResult.journalEntryId,
      idempotentReplay: Boolean(journalResult.idempotentReplay),
      preview,
    };
  });
}
