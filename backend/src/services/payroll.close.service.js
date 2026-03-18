import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { evaluateApprovalNeed, submitApprovalRequest } from "./approvalPolicies.service.js";

const CLOSE_STATUS_VALUES = new Set(["DRAFT", "READY", "REQUESTED", "CLOSED", "REOPENED"]);
const PAYROLL_OWNERSHIP_BLOCKING_STATUSES = Object.freeze([
  "UNRESOLVED",
  "AMBIGUOUS",
  "MISMATCH",
]);
const PAYROLL_NON_FINALIZED_RUN_STATUSES = Object.freeze(["DRAFT", "IMPORTED", "REVIEWED"]);
const PAYROLL_OWNERSHIP_SCOPE_VALUES = new Set(["CENTRAL", "OPERATING_UNIT"]);
const PAYROLL_CLOSE_OWNERSHIP_SAMPLE_LIMIT = 10;
const PRE_POU_ACTIVE_PAYROLL_BATCH_STATUSES = Object.freeze(["DRAFT", "APPROVED", "EXPORTED"]);
const PRE_POU_IN_FLIGHT_REMEDIATION_STEPS = Object.freeze([
  "Cancel pre-POU non-finalized payroll runs and recreate them under the locked owner-context contract",
  "Cancel pre-POU derived payroll liabilities instead of retrofitting owner context in place",
  "Cancel pre-POU DRAFT/APPROVED/EXPORTED payroll payment batches and rebuild them from recreated liabilities",
]);
const PAYROLL_LIABILITY_OWNERSHIP_VALIDITY_RULES = Object.freeze([
  "CENTRAL requires operating_unit_id to be NULL",
  "OPERATING_UNIT requires operating_unit_id to be non-null",
]);
const PAYROLL_POSTED_BATCH_SETTLEMENT_REQUIREMENTS = Object.freeze([
  "Posted payroll batches must keep one payer-context bank journal line via PAYBATCH:{batchId}",
  "Cross-context payroll batch lines must keep the main liability settlement line ref",
  "Cross-context payroll batch lines must include an owner-context credit self-balancing line",
  "Cross-context payroll batch lines must include a payer-context debit self-balancing line",
]);
const PAYROLL_POSTED_BATCH_SETTLEMENT_ISSUE_CODES = Object.freeze([
  "posted_journal_missing",
  "payer_context_journal_line_missing",
  "payer_context_journal_line_ambiguous",
  "settlement_journal_ref_missing",
  "settlement_journal_ref_invalid",
  "main_settlement_line_missing",
  "main_settlement_line_invalid",
  "self_balancing_owner_credit_missing",
  "self_balancing_payer_debit_missing",
]);

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(6));
}

function toOptionalPositiveInt(value) {
  return parsePositiveInt(value) || null;
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseOptionalJson(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeNotFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function makeConflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function noopScopeAccess() {
  return true;
}

async function getPeriodCloseScopeRow({ tenantId, closeId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, tenant_id, legal_entity_id
     FROM payroll_period_closes
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, closeId]
  );
  return result.rows?.[0] || null;
}

async function getPeriodCloseById({ tenantId, closeId, runQuery = query, forUpdate = false }) {
  const result = await runQuery(
    `SELECT *
     FROM payroll_period_closes
     WHERE tenant_id = ? AND id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, closeId]
  );
  return result.rows?.[0] || null;
}

function mapCloseRow(row) {
  if (!row) return null;
  return {
    ...row,
    status: normalizeUpperText(row.status),
    period_start: toDateOnly(row.period_start),
    period_end: toDateOnly(row.period_end),
  };
}

function mapCheckRow(row) {
  if (!row) return null;
  return {
    ...row,
    severity: normalizeUpperText(row.severity),
    status: normalizeUpperText(row.status),
    metric_value: row.metric_value == null ? null : toAmount(row.metric_value),
    details_json: parseOptionalJson(row.details_json),
  };
}

function mapAuditRow(row) {
  if (!row) return null;
  return {
    ...row,
    action: normalizeUpperText(row.action),
    action_status: normalizeUpperText(row.action_status),
    payload_json: parseOptionalJson(row.payload_json),
  };
}

function mapPayrollCloseOwnershipSampleRow(row) {
  if (!row) return null;
  return {
    run_id: parsePositiveInt(row.run_id) || null,
    run_no: row.run_no || null,
    payroll_period: toDateOnly(row.payroll_period),
    ownership_as_of_date: toDateOnly(row.ownership_as_of_date),
    line_id: parsePositiveInt(row.line_id) || null,
    line_no: parsePositiveInt(row.line_no) || null,
    employee_code: String(row.employee_code || "").trim() || null,
    employee_name: String(row.employee_name || "").trim() || null,
    ownership_resolution_status: normalizeUpperText(row.ownership_resolution_status) || null,
    ownership_resolution_note: row.ownership_resolution_note || null,
  };
}

function mapPrePouInFlightRunSampleRow(row) {
  if (!row) return null;
  return {
    run_id: parsePositiveInt(row.run_id) || null,
    run_no: row.run_no || null,
    run_status: normalizeUpperText(row.run_status) || null,
    run_type: normalizeUpperText(row.run_type) || null,
    payroll_period: toDateOnly(row.payroll_period),
    pay_date: toDateOnly(row.pay_date),
    ownership_as_of_date: toDateOnly(row.ownership_as_of_date),
  };
}

function mapPrePouInFlightLiabilitySampleRow(row) {
  if (!row) return null;
  return {
    liability_id: parsePositiveInt(row.liability_id) || null,
    liability_key: row.liability_key || null,
    liability_status: normalizeUpperText(row.liability_status) || null,
    run_id: parsePositiveInt(row.run_id) || null,
    run_no: row.run_no || null,
    run_status: normalizeUpperText(row.run_status) || null,
    payroll_period: toDateOnly(row.payroll_period),
    ownership_as_of_date: toDateOnly(row.ownership_as_of_date),
    employee_code: String(row.employee_code || "").trim() || null,
    employee_name: String(row.employee_name || "").trim() || null,
  };
}

function mapPrePouInFlightBatchSampleRow(row) {
  if (!row) return null;
  return {
    batch_id: parsePositiveInt(row.batch_id) || null,
    batch_no: row.batch_no || null,
    batch_status: normalizeUpperText(row.batch_status) || null,
    batch_line_id: parsePositiveInt(row.batch_line_id) || null,
    batch_line_no: parsePositiveInt(row.batch_line_no) || null,
    batch_line_status: normalizeUpperText(row.batch_line_status) || null,
    liability_id: parsePositiveInt(row.liability_id) || null,
    liability_key: row.liability_key || null,
    run_id: parsePositiveInt(row.run_id) || null,
    run_no: row.run_no || null,
    run_status: normalizeUpperText(row.run_status) || null,
    payroll_period: toDateOnly(row.payroll_period),
    ownership_as_of_date: toDateOnly(row.ownership_as_of_date),
  };
}

function normalizePayrollOwnershipScope(value) {
  const normalized = normalizeUpperText(value);
  return PAYROLL_OWNERSHIP_SCOPE_VALUES.has(normalized) ? normalized : null;
}

function listPayrollLiabilityOwnershipIssues(row) {
  const ownershipScope = normalizePayrollOwnershipScope(row?.ownership_scope);
  const operatingUnitId = parsePositiveInt(row?.operating_unit_id) || null;
  const issues = [];
  if (!ownershipScope) {
    issues.push("ownership_scope_missing_or_invalid");
    return issues;
  }
  if (ownershipScope === "CENTRAL" && operatingUnitId) {
    issues.push("central_liability_must_not_set_operating_unit");
  }
  if (ownershipScope === "OPERATING_UNIT" && !operatingUnitId) {
    issues.push("operating_unit_liability_requires_operating_unit");
  }
  return issues;
}

function mapPayrollCloseLiabilitySampleRow(row) {
  if (!row) return null;
  return {
    run_id: parsePositiveInt(row.run_id) || null,
    run_no: row.run_no || null,
    payroll_period: toDateOnly(row.payroll_period),
    ownership_as_of_date: toDateOnly(row.ownership_as_of_date),
    liability_id: parsePositiveInt(row.liability_id) || null,
    liability_type: row.liability_type || null,
    liability_group: row.liability_group || null,
    employee_code: String(row.employee_code || "").trim() || null,
    employee_name: String(row.employee_name || "").trim() || null,
    ownership_scope: normalizePayrollOwnershipScope(row.ownership_scope),
    operating_unit_id: parsePositiveInt(row.operating_unit_id) || null,
    operating_unit_code: String(row.operating_unit_code || "").trim() || null,
    operating_unit_name: String(row.operating_unit_name || "").trim() || null,
    status: normalizeUpperText(row.status) || null,
    issues: listPayrollLiabilityOwnershipIssues(row),
  };
}

function buildInvalidPayrollLiabilityOwnershipPredicate(alias) {
  return `(
    ${alias}.ownership_scope IS NULL
    OR ${alias}.ownership_scope NOT IN ('CENTRAL', 'OPERATING_UNIT')
    OR (${alias}.ownership_scope = 'CENTRAL' AND ${alias}.operating_unit_id IS NOT NULL)
    OR (${alias}.ownership_scope = 'OPERATING_UNIT' AND ${alias}.operating_unit_id IS NULL)
  )`;
}

function buildPayrollOwnershipContextKey(scope, operatingUnitId) {
  const normalizedScope = normalizePayrollOwnershipScope(scope);
  const normalizedOperatingUnitId = toOptionalPositiveInt(operatingUnitId);
  if (normalizedScope === "CENTRAL") {
    return "CENTRAL";
  }
  if (normalizedScope === "OPERATING_UNIT" && normalizedOperatingUnitId) {
    return `OPERATING_UNIT:${normalizedOperatingUnitId}`;
  }
  return null;
}

function buildJournalOperatingUnitOwnershipContext(operatingUnitId) {
  const normalizedOperatingUnitId = toOptionalPositiveInt(operatingUnitId);
  return {
    scope: normalizedOperatingUnitId ? "OPERATING_UNIT" : "CENTRAL",
    operatingUnitId: normalizedOperatingUnitId,
  };
}

function samePayrollOwnershipContext(left, right) {
  const leftKey = buildPayrollOwnershipContextKey(left?.scope, left?.operatingUnitId);
  const rightKey = buildPayrollOwnershipContextKey(right?.scope, right?.operatingUnitId);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function parseJournalLineRef(value) {
  const match = /^JE:(\d+)\/L(\d+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  return {
    journalEntryId: parsePositiveInt(match[1]) || null,
    lineNo: parsePositiveInt(match[2]) || null,
  };
}

function mapPayrollClosePostedBatchSampleRow(row, evaluation = {}) {
  if (!row) return null;
  const ownerOperatingUnitId = toOptionalPositiveInt(row.operating_unit_id);
  const payerOperatingUnitId = toOptionalPositiveInt(evaluation?.payerContext?.operatingUnitId);
  return {
    batch_id: toOptionalPositiveInt(row.batch_id),
    batch_no: row.batch_no || null,
    batch_status: normalizeUpperText(row.batch_status) || null,
    posted_journal_entry_id: toOptionalPositiveInt(row.posted_journal_entry_id),
    batch_line_id: toOptionalPositiveInt(row.batch_line_id),
    batch_line_no: toOptionalPositiveInt(row.batch_line_no),
    amount: toAmount(row.amount),
    settlement_journal_line_ref: row.settlement_journal_line_ref || null,
    run_id: toOptionalPositiveInt(row.run_id),
    run_no: row.run_no || null,
    payroll_period: toDateOnly(row.payroll_period),
    ownership_as_of_date: toDateOnly(row.ownership_as_of_date),
    liability_id: toOptionalPositiveInt(row.liability_id),
    liability_key: row.liability_key || null,
    employee_code: String(row.employee_code || "").trim() || null,
    employee_name: String(row.employee_name || "").trim() || null,
    owner_context: {
      ownership_scope: normalizePayrollOwnershipScope(row.ownership_scope),
      operating_unit_id: ownerOperatingUnitId,
      operating_unit_code: String(row.operating_unit_code || "").trim() || null,
      operating_unit_name: String(row.operating_unit_name || "").trim() || null,
    },
    payer_context: evaluation?.payerContext
      ? {
          ownership_scope: normalizePayrollOwnershipScope(evaluation.payerContext.scope),
          operating_unit_id: payerOperatingUnitId,
        }
      : null,
    issues: Array.isArray(evaluation?.issues) ? [...evaluation.issues] : [],
  };
}

function evaluatePostedPayrollBatchSettlementCandidate({ row, journalLines = [] }) {
  const issues = [];
  const batchId = toOptionalPositiveInt(row?.batch_id);
  const batchLineNo = toOptionalPositiveInt(row?.batch_line_no);
  const postedJournalEntryId = toOptionalPositiveInt(row?.posted_journal_entry_id);
  const payableGlAccountId = toOptionalPositiveInt(row?.payable_gl_account_id);
  const ownerContext = {
    scope: normalizePayrollOwnershipScope(row?.ownership_scope),
    operatingUnitId: toOptionalPositiveInt(row?.operating_unit_id),
  };
  const amount = toAmount(row?.amount);
  const candidateJournalLines = Array.isArray(journalLines) ? journalLines : [];

  let payerContext = null;
  if (!postedJournalEntryId) {
    issues.push("posted_journal_missing");
  }

  const bankSubledgerReferenceNo = batchId ? `PAYBATCH:${batchId}` : null;
  const bankContextLines =
    postedJournalEntryId && bankSubledgerReferenceNo
      ? candidateJournalLines.filter(
          (line) =>
            String(line?.subledger_reference_no || "") === bankSubledgerReferenceNo &&
            toAmount(line?.credit_base) > 0
        )
      : [];
  if (postedJournalEntryId) {
    if (bankContextLines.length === 0) {
      issues.push("payer_context_journal_line_missing");
    } else if (bankContextLines.length > 1) {
      issues.push("payer_context_journal_line_ambiguous");
    } else {
      payerContext = buildJournalOperatingUnitOwnershipContext(bankContextLines[0].operating_unit_id);
    }
  }

  const isCrossContext =
    payerContext && !samePayrollOwnershipContext(ownerContext, payerContext);
  if (!isCrossContext) {
    return {
      isCrossContext: false,
      payerContext,
      issues,
    };
  }

  const lineSubledgerReferenceNo =
    batchId && batchLineNo ? `PAYBATCH:${batchId}:L${batchLineNo}` : null;
  const lineJournalLines = lineSubledgerReferenceNo
    ? candidateJournalLines.filter(
        (line) => String(line?.subledger_reference_no || "") === lineSubledgerReferenceNo
      )
    : [];

  const settlementJournalLineRef = String(row?.settlement_journal_line_ref || "").trim();
  const parsedSettlementJournalLineRef = parseJournalLineRef(settlementJournalLineRef);
  let mainSettlementLine = null;
  if (!settlementJournalLineRef) {
    issues.push("settlement_journal_ref_missing");
  } else if (
    !parsedSettlementJournalLineRef ||
    parsedSettlementJournalLineRef.journalEntryId !== postedJournalEntryId ||
    !parsedSettlementJournalLineRef.lineNo
  ) {
    issues.push("settlement_journal_ref_invalid");
  } else {
    mainSettlementLine =
      candidateJournalLines.find(
        (line) => toOptionalPositiveInt(line?.line_no) === parsedSettlementJournalLineRef.lineNo
      ) || null;
  }

  if (!mainSettlementLine) {
    issues.push("main_settlement_line_missing");
  } else {
    const mainSettlementLineValid =
      toOptionalPositiveInt(mainSettlementLine?.account_id) === payableGlAccountId &&
      toOptionalPositiveInt(mainSettlementLine?.operating_unit_id) ===
        ownerContext.operatingUnitId &&
      toAmount(mainSettlementLine?.debit_base) === amount &&
      toAmount(mainSettlementLine?.credit_base) === 0 &&
      String(mainSettlementLine?.subledger_reference_no || "") === lineSubledgerReferenceNo;
    if (!mainSettlementLineValid) {
      issues.push("main_settlement_line_invalid");
    }
  }

  const hasOwnerContextCredit = lineJournalLines.some(
    (line) =>
      toOptionalPositiveInt(line?.account_id) !== payableGlAccountId &&
      toOptionalPositiveInt(line?.operating_unit_id) === ownerContext.operatingUnitId &&
      toAmount(line?.credit_base) === amount &&
      toAmount(line?.debit_base) === 0
  );
  if (!hasOwnerContextCredit) {
    issues.push("self_balancing_owner_credit_missing");
  }

  const hasPayerContextDebit = lineJournalLines.some(
    (line) =>
      toOptionalPositiveInt(line?.account_id) !== payableGlAccountId &&
      toOptionalPositiveInt(line?.operating_unit_id) === payerContext?.operatingUnitId &&
      toAmount(line?.debit_base) === amount &&
      toAmount(line?.credit_base) === 0
  );
  if (!hasPayerContextDebit) {
    issues.push("self_balancing_payer_debit_missing");
  }

  return {
    isCrossContext: true,
    payerContext,
    issues,
  };
}

async function computePostedPayrollBatchSettlementIntegrity({
  tenantId,
  legalEntityId,
  periodStart,
  periodEnd,
  invalidLiabilityOwnershipPredicate,
  runQuery = query,
}) {
  const eligiblePostedPayrollLinesResult = await runQuery(
    `SELECT
        pb.id AS batch_id,
        pb.batch_no,
        pb.status AS batch_status,
        pb.posted_journal_entry_id,
        l.id AS batch_line_id,
        l.line_no AS batch_line_no,
        l.amount,
        l.settlement_journal_line_ref,
        l.payable_gl_account_id,
        pr.id AS run_id,
        pr.run_no,
        pr.payroll_period,
        pr.ownership_as_of_date,
        prl.id AS liability_id,
        prl.liability_key,
        prl.employee_code,
        prl.employee_name,
        prl.ownership_scope,
        prl.operating_unit_id,
        owner_ou.code AS operating_unit_code,
        owner_ou.name AS operating_unit_name
     FROM payment_batch_lines l
     JOIN payment_batches pb
       ON pb.id = l.batch_id
      AND pb.tenant_id = l.tenant_id
      AND pb.legal_entity_id = l.legal_entity_id
     JOIN payroll_run_liabilities prl
       ON prl.tenant_id = l.tenant_id
      AND prl.legal_entity_id = l.legal_entity_id
      AND prl.id = l.payable_entity_id
     JOIN payroll_runs pr
       ON pr.tenant_id = prl.tenant_id
      AND pr.legal_entity_id = prl.legal_entity_id
      AND pr.id = prl.run_id
     LEFT JOIN operating_units owner_ou
       ON owner_ou.id = prl.operating_unit_id
      AND owner_ou.tenant_id = prl.tenant_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND UPPER(COALESCE(l.payable_entity_type, '')) = 'PAYROLL_LIABILITY'
       AND pb.status = 'POSTED'
       AND pr.payroll_period BETWEEN ? AND ?
       AND pr.ownership_as_of_date IS NOT NULL
       AND COALESCE(prl.status, 'OPEN') <> 'CANCELLED'
       AND NOT ${invalidLiabilityOwnershipPredicate}
     ORDER BY pr.payroll_period DESC, pb.id DESC, l.line_no ASC, l.id ASC`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const eligiblePostedPayrollLines = eligiblePostedPayrollLinesResult.rows || [];

  const grandfatheredPostedPayrollStatsResult = await runQuery(
    `SELECT
        COUNT(DISTINCT pb.id) AS grandfathered_posted_batch_count,
        COUNT(*) AS grandfathered_posted_line_count
     FROM payment_batch_lines l
     JOIN payment_batches pb
       ON pb.id = l.batch_id
      AND pb.tenant_id = l.tenant_id
      AND pb.legal_entity_id = l.legal_entity_id
     JOIN payroll_run_liabilities prl
       ON prl.tenant_id = l.tenant_id
      AND prl.legal_entity_id = l.legal_entity_id
      AND prl.id = l.payable_entity_id
     JOIN payroll_runs pr
       ON pr.tenant_id = prl.tenant_id
      AND pr.legal_entity_id = prl.legal_entity_id
      AND pr.id = prl.run_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND UPPER(COALESCE(l.payable_entity_type, '')) = 'PAYROLL_LIABILITY'
       AND pb.status = 'POSTED'
       AND pr.payroll_period BETWEEN ? AND ?
       AND pr.ownership_as_of_date IS NULL`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const grandfatheredPostedPayrollStats =
    grandfatheredPostedPayrollStatsResult.rows?.[0] || {};

  const eligiblePostedBatchIds = new Set();
  const journalEntryIds = new Set();
  for (const row of eligiblePostedPayrollLines) {
    const batchId = toOptionalPositiveInt(row.batch_id);
    const postedJournalEntryId = toOptionalPositiveInt(row.posted_journal_entry_id);
    if (batchId) {
      eligiblePostedBatchIds.add(batchId);
    }
    if (postedJournalEntryId) {
      journalEntryIds.add(postedJournalEntryId);
    }
  }

  const journalLinesByEntryId = new Map();
  if (journalEntryIds.size > 0) {
    const placeholders = Array.from(journalEntryIds)
      .map(() => "?")
      .join(", ");
    const journalLineRows = await runQuery(
      `SELECT
          journal_entry_id,
          line_no,
          account_id,
          operating_unit_id,
          subledger_reference_no,
          debit_base,
          credit_base
       FROM journal_lines
       WHERE journal_entry_id IN (${placeholders})
       ORDER BY journal_entry_id ASC, line_no ASC`,
      [...journalEntryIds]
    );
    for (const row of journalLineRows.rows || []) {
      const journalEntryId = toOptionalPositiveInt(row.journal_entry_id);
      if (!journalEntryId) {
        continue;
      }
      if (!journalLinesByEntryId.has(journalEntryId)) {
        journalLinesByEntryId.set(journalEntryId, []);
      }
      journalLinesByEntryId.get(journalEntryId).push(row);
    }
  }

  const issueCounts = Object.fromEntries(
    PAYROLL_POSTED_BATCH_SETTLEMENT_ISSUE_CODES.map((code) => [code, 0])
  );
  const blockingSamples = [];
  const affectedBatchIds = new Set();
  let crossContextLineCount = 0;
  let blockingLineCount = 0;

  for (const row of eligiblePostedPayrollLines) {
    const postedJournalEntryId = toOptionalPositiveInt(row.posted_journal_entry_id);
    const evaluation = evaluatePostedPayrollBatchSettlementCandidate({
      row,
      journalLines: journalLinesByEntryId.get(postedJournalEntryId) || [],
    });
    if (evaluation.isCrossContext) {
      crossContextLineCount += 1;
    }
    if ((evaluation.issues || []).length === 0) {
      continue;
    }
    blockingLineCount += 1;
    const batchId = toOptionalPositiveInt(row.batch_id);
    if (batchId) {
      affectedBatchIds.add(batchId);
    }
    for (const issueCode of evaluation.issues) {
      if (Object.prototype.hasOwnProperty.call(issueCounts, issueCode)) {
        issueCounts[issueCode] += 1;
      }
    }
    if (blockingSamples.length < PAYROLL_CLOSE_OWNERSHIP_SAMPLE_LIMIT) {
      blockingSamples.push(mapPayrollClosePostedBatchSampleRow(row, evaluation));
    }
  }

  return {
    eligiblePostedBatchCount: eligiblePostedBatchIds.size,
    eligiblePostedLineCount: eligiblePostedPayrollLines.length,
    crossContextLineCount,
    affectedBatchCount: affectedBatchIds.size,
    blockingLineCount,
    issueCounts,
    grandfatheredPostedBatchCount: Number(
      grandfatheredPostedPayrollStats.grandfathered_posted_batch_count || 0
    ),
    grandfatheredPostedLineCount: Number(
      grandfatheredPostedPayrollStats.grandfathered_posted_line_count || 0
    ),
    sampleLines: blockingSamples,
  };
}

async function writeCloseAudit({
  tenantId,
  legalEntityId,
  closeId,
  action,
  note = null,
  payload = null,
  userId = null,
  runQuery = query,
}) {
  await runQuery(
    `INSERT INTO payroll_period_close_audit (
        tenant_id, legal_entity_id, payroll_period_close_id,
        action, action_status, note, payload_json, acted_by_user_id
      )
      VALUES (?, ?, ?, ?, 'CONFIRMED', ?, ?, ?)`,
    [tenantId, legalEntityId, closeId, normalizeUpperText(action), note || null, safeJson(payload), userId]
  );
}

async function getOrCreatePeriodCloseForUpdate({
  tenantId,
  legalEntityId,
  periodStart,
  periodEnd,
  runQuery,
}) {
  const existing = await runQuery(
    `SELECT *
     FROM payroll_period_closes
     WHERE tenant_id = ? AND legal_entity_id = ? AND period_start = ? AND period_end = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  if (existing.rows?.[0]) return existing.rows[0];

  await runQuery(
    `INSERT INTO payroll_period_closes (
        tenant_id, legal_entity_id, period_start, period_end, status
      )
      VALUES (?, ?, ?, ?, 'DRAFT')`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );

  const created = await runQuery(
    `SELECT *
     FROM payroll_period_closes
     WHERE tenant_id = ? AND legal_entity_id = ? AND period_start = ? AND period_end = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  return created.rows?.[0] || null;
}

function summarizeChecks(checks = []) {
  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;
  let warningChecks = 0;

  for (const check of checks) {
    totalChecks += 1;
    const severity = normalizeUpperText(check.severity);
    const status = normalizeUpperText(check.status);
    if (status === "PASS") {
      passedChecks += 1;
    }
    if (severity === "ERROR" && status === "FAIL") {
      failedChecks += 1;
    }
    if (status === "WARN" || (severity === "WARN" && status === "FAIL")) {
      warningChecks += 1;
    }
  }

  return {
    totalChecks,
    passedChecks,
    failedChecks,
    warningChecks,
  };
}

async function computeChecklist({
  tenantId,
  legalEntityId,
  periodStart,
  periodEnd,
  runQuery = query,
}) {
  const invalidLiabilityOwnershipPredicate = buildInvalidPayrollLiabilityOwnershipPredicate("l");
  const invalidSettlementLiabilityOwnershipPredicate =
    buildInvalidPayrollLiabilityOwnershipPredicate("prl");

  const runsStats = await runQuery(
    `SELECT
        COUNT(*) AS run_count,
        COALESCE(SUM(CASE WHEN status IN ('DRAFT','IMPORTED','REVIEWED') THEN 1 ELSE 0 END), 0)
          AS non_finalized_runs,
        COALESCE(SUM(CASE WHEN status = 'FINALIZED' AND accrual_journal_entry_id IS NULL THEN 1 ELSE 0 END), 0)
          AS finalized_missing_accrual_journal
     FROM payroll_runs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND payroll_period BETWEEN ? AND ?`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const runStats = runsStats.rows?.[0] || {};

  const correctionDraftStats = await runQuery(
    `SELECT
        COALESCE(SUM(CASE WHEN run_type = 'RETRO' AND status = 'DRAFT' THEN 1 ELSE 0 END), 0)
          AS retro_draft_count,
        COALESCE(SUM(CASE WHEN run_type = 'OFF_CYCLE' AND status = 'DRAFT' THEN 1 ELSE 0 END), 0)
          AS off_cycle_draft_count
     FROM payroll_runs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND payroll_period BETWEEN ? AND ?`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const corrStats = correctionDraftStats.rows?.[0] || {};

  const prePouInFlightRunStatsResult = await runQuery(
    `SELECT
        COUNT(*) AS legacy_non_finalized_run_count,
        COALESCE(SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END), 0) AS draft_run_count,
        COALESCE(SUM(CASE WHEN status = 'IMPORTED' THEN 1 ELSE 0 END), 0) AS imported_run_count,
        COALESCE(SUM(CASE WHEN status = 'REVIEWED' THEN 1 ELSE 0 END), 0) AS reviewed_run_count
     FROM payroll_runs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND payroll_period BETWEEN ? AND ?
       AND ownership_as_of_date IS NULL
       AND status IN ('DRAFT', 'IMPORTED', 'REVIEWED')`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const prePouInFlightRunStats = prePouInFlightRunStatsResult.rows?.[0] || {};

  let prePouInFlightRunSamples = [];
  if (Number(prePouInFlightRunStats.legacy_non_finalized_run_count || 0) > 0) {
    const prePouInFlightRunSamplesResult = await runQuery(
      `SELECT
          id AS run_id,
          run_no,
          status AS run_status,
          run_type,
          payroll_period,
          pay_date,
          ownership_as_of_date
       FROM payroll_runs
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND payroll_period BETWEEN ? AND ?
         AND ownership_as_of_date IS NULL
         AND status IN ('DRAFT', 'IMPORTED', 'REVIEWED')
       ORDER BY payroll_period DESC, id DESC
       LIMIT ${PAYROLL_CLOSE_OWNERSHIP_SAMPLE_LIMIT}`,
      [tenantId, legalEntityId, periodStart, periodEnd]
    );
    prePouInFlightRunSamples = (prePouInFlightRunSamplesResult.rows || []).map(
      mapPrePouInFlightRunSampleRow
    );
  }

  const prePouInFlightLiabilityStatsResult = await runQuery(
    `SELECT
        COUNT(*) AS legacy_derived_liability_count,
        COUNT(DISTINCT pr.id) AS affected_run_count,
        COALESCE(SUM(CASE WHEN COALESCE(l.status, 'OPEN') = 'OPEN' THEN 1 ELSE 0 END), 0)
          AS open_liability_count,
        COALESCE(SUM(CASE WHEN COALESCE(l.status, 'OPEN') = 'IN_BATCH' THEN 1 ELSE 0 END), 0)
          AS in_batch_liability_count,
        COALESCE(SUM(CASE WHEN COALESCE(l.status, 'OPEN') = 'PARTIALLY_PAID' THEN 1 ELSE 0 END), 0)
          AS partially_paid_liability_count,
        COALESCE(SUM(CASE WHEN COALESCE(l.status, 'OPEN') = 'PAID' THEN 1 ELSE 0 END), 0)
          AS paid_liability_count
     FROM payroll_run_liabilities l
     JOIN payroll_runs pr
       ON pr.tenant_id = l.tenant_id
      AND pr.legal_entity_id = l.legal_entity_id
      AND pr.id = l.run_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND pr.payroll_period BETWEEN ? AND ?
       AND pr.ownership_as_of_date IS NULL
       AND pr.status IN ('DRAFT', 'IMPORTED', 'REVIEWED')
       AND COALESCE(l.status, 'OPEN') <> 'CANCELLED'`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const prePouInFlightLiabilityStats = prePouInFlightLiabilityStatsResult.rows?.[0] || {};

  let prePouInFlightLiabilitySamples = [];
  if (Number(prePouInFlightLiabilityStats.legacy_derived_liability_count || 0) > 0) {
    const prePouInFlightLiabilitySamplesResult = await runQuery(
      `SELECT
          l.id AS liability_id,
          l.liability_key,
          l.status AS liability_status,
          l.employee_code,
          l.employee_name,
          pr.id AS run_id,
          pr.run_no,
          pr.status AS run_status,
          pr.payroll_period,
          pr.ownership_as_of_date
       FROM payroll_run_liabilities l
       JOIN payroll_runs pr
         ON pr.tenant_id = l.tenant_id
        AND pr.legal_entity_id = l.legal_entity_id
        AND pr.id = l.run_id
       WHERE l.tenant_id = ?
         AND l.legal_entity_id = ?
         AND pr.payroll_period BETWEEN ? AND ?
         AND pr.ownership_as_of_date IS NULL
         AND pr.status IN ('DRAFT', 'IMPORTED', 'REVIEWED')
         AND COALESCE(l.status, 'OPEN') <> 'CANCELLED'
       ORDER BY pr.payroll_period DESC, pr.id DESC, l.id ASC
       LIMIT ${PAYROLL_CLOSE_OWNERSHIP_SAMPLE_LIMIT}`,
      [tenantId, legalEntityId, periodStart, periodEnd]
    );
    prePouInFlightLiabilitySamples = (prePouInFlightLiabilitySamplesResult.rows || []).map(
      mapPrePouInFlightLiabilitySampleRow
    );
  }

  const prePouInFlightBatchStatsResult = await runQuery(
    `SELECT
        COUNT(DISTINCT pb.id) AS legacy_active_batch_count,
        COUNT(*) AS legacy_active_batch_line_count,
        COUNT(DISTINCT pr.id) AS affected_run_count,
        COUNT(DISTINCT CASE WHEN pb.status = 'DRAFT' THEN pb.id END) AS draft_batch_count,
        COUNT(DISTINCT CASE WHEN pb.status = 'APPROVED' THEN pb.id END) AS approved_batch_count,
        COUNT(DISTINCT CASE WHEN pb.status = 'EXPORTED' THEN pb.id END) AS exported_batch_count
     FROM payment_batch_lines pbl
     JOIN payment_batches pb
       ON pb.id = pbl.batch_id
      AND pb.tenant_id = pbl.tenant_id
      AND pb.legal_entity_id = pbl.legal_entity_id
     JOIN payroll_run_liabilities l
       ON l.tenant_id = pbl.tenant_id
      AND l.legal_entity_id = pbl.legal_entity_id
      AND l.id = pbl.payable_entity_id
     JOIN payroll_runs pr
       ON pr.tenant_id = l.tenant_id
      AND pr.legal_entity_id = l.legal_entity_id
      AND pr.id = l.run_id
     WHERE pbl.tenant_id = ?
       AND pbl.legal_entity_id = ?
       AND UPPER(COALESCE(pbl.payable_entity_type, '')) = 'PAYROLL_LIABILITY'
       AND pr.payroll_period BETWEEN ? AND ?
       AND pr.ownership_as_of_date IS NULL
       AND pb.status IN ('DRAFT', 'APPROVED', 'EXPORTED')
       AND COALESCE(l.status, 'OPEN') <> 'CANCELLED'
       AND COALESCE(pbl.status, 'PENDING') <> 'CANCELLED'`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const prePouInFlightBatchStats = prePouInFlightBatchStatsResult.rows?.[0] || {};

  let prePouInFlightBatchSamples = [];
  if (Number(prePouInFlightBatchStats.legacy_active_batch_count || 0) > 0) {
    const prePouInFlightBatchSamplesResult = await runQuery(
      `SELECT
          pb.id AS batch_id,
          pb.batch_no,
          pb.status AS batch_status,
          pbl.id AS batch_line_id,
          pbl.line_no AS batch_line_no,
          pbl.status AS batch_line_status,
          l.id AS liability_id,
          l.liability_key,
          pr.id AS run_id,
          pr.run_no,
          pr.status AS run_status,
          pr.payroll_period,
          pr.ownership_as_of_date
       FROM payment_batch_lines pbl
       JOIN payment_batches pb
         ON pb.id = pbl.batch_id
        AND pb.tenant_id = pbl.tenant_id
        AND pb.legal_entity_id = pbl.legal_entity_id
       JOIN payroll_run_liabilities l
         ON l.tenant_id = pbl.tenant_id
        AND l.legal_entity_id = pbl.legal_entity_id
        AND l.id = pbl.payable_entity_id
       JOIN payroll_runs pr
         ON pr.tenant_id = l.tenant_id
        AND pr.legal_entity_id = l.legal_entity_id
        AND pr.id = l.run_id
       WHERE pbl.tenant_id = ?
         AND pbl.legal_entity_id = ?
         AND UPPER(COALESCE(pbl.payable_entity_type, '')) = 'PAYROLL_LIABILITY'
         AND pr.payroll_period BETWEEN ? AND ?
         AND pr.ownership_as_of_date IS NULL
         AND pb.status IN ('DRAFT', 'APPROVED', 'EXPORTED')
         AND COALESCE(l.status, 'OPEN') <> 'CANCELLED'
         AND COALESCE(pbl.status, 'PENDING') <> 'CANCELLED'
       ORDER BY pr.payroll_period DESC, pb.id DESC, pbl.line_no ASC, pbl.id ASC
       LIMIT ${PAYROLL_CLOSE_OWNERSHIP_SAMPLE_LIMIT}`,
      [tenantId, legalEntityId, periodStart, periodEnd]
    );
    prePouInFlightBatchSamples = (prePouInFlightBatchSamplesResult.rows || []).map(
      mapPrePouInFlightBatchSampleRow
    );
  }

  const prePouInFlightBlockingCount =
    Number(prePouInFlightRunStats.legacy_non_finalized_run_count || 0) +
    Number(prePouInFlightLiabilityStats.legacy_derived_liability_count || 0) +
    Number(prePouInFlightBatchStats.legacy_active_batch_count || 0);

  const finalizedOwnershipStatsResult = await runQuery(
    `SELECT
        COUNT(DISTINCT pr.id) AS ownership_aware_finalized_run_count,
        COUNT(DISTINCT CASE WHEN rl.id IS NOT NULL THEN pr.id END) AS affected_run_count,
        COUNT(rl.id) AS blocking_line_count,
        COALESCE(SUM(CASE WHEN rl.ownership_resolution_status = 'UNRESOLVED' THEN 1 ELSE 0 END), 0)
          AS unresolved_line_count,
        COALESCE(SUM(CASE WHEN rl.ownership_resolution_status = 'AMBIGUOUS' THEN 1 ELSE 0 END), 0)
          AS ambiguous_line_count,
        COALESCE(SUM(CASE WHEN rl.ownership_resolution_status = 'MISMATCH' THEN 1 ELSE 0 END), 0)
          AS mismatch_line_count
     FROM payroll_runs pr
     LEFT JOIN payroll_run_lines rl
       ON rl.tenant_id = pr.tenant_id
      AND rl.legal_entity_id = pr.legal_entity_id
      AND rl.run_id = pr.id
      AND rl.ownership_resolution_status IN ('UNRESOLVED', 'AMBIGUOUS', 'MISMATCH')
     WHERE pr.tenant_id = ?
       AND pr.legal_entity_id = ?
       AND pr.status = 'FINALIZED'
       AND pr.payroll_period BETWEEN ? AND ?
       AND pr.ownership_as_of_date IS NOT NULL`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const finalizedOwnershipStats = finalizedOwnershipStatsResult.rows?.[0] || {};

  const grandfatheredFinalizedRunsResult = await runQuery(
    `SELECT COUNT(*) AS grandfathered_finalized_run_count
     FROM payroll_runs
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND status = 'FINALIZED'
       AND payroll_period BETWEEN ? AND ?
       AND ownership_as_of_date IS NULL`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const grandfatheredFinalizedRuns =
    grandfatheredFinalizedRunsResult.rows?.[0] || {};

  let finalizedOwnershipSamples = [];
  if (Number(finalizedOwnershipStats.blocking_line_count || 0) > 0) {
    const finalizedOwnershipSamplesResult = await runQuery(
      `SELECT
          pr.id AS run_id,
          pr.run_no,
          pr.payroll_period,
          pr.ownership_as_of_date,
          rl.id AS line_id,
          rl.line_no,
          rl.employee_code,
          rl.employee_name,
          rl.ownership_resolution_status,
          rl.ownership_resolution_note
       FROM payroll_runs pr
       JOIN payroll_run_lines rl
         ON rl.tenant_id = pr.tenant_id
        AND rl.legal_entity_id = pr.legal_entity_id
        AND rl.run_id = pr.id
       WHERE pr.tenant_id = ?
         AND pr.legal_entity_id = ?
         AND pr.status = 'FINALIZED'
         AND pr.payroll_period BETWEEN ? AND ?
         AND pr.ownership_as_of_date IS NOT NULL
         AND rl.ownership_resolution_status IN ('UNRESOLVED', 'AMBIGUOUS', 'MISMATCH')
       ORDER BY pr.payroll_period DESC, pr.id DESC, rl.line_no ASC, rl.id ASC
       LIMIT ${PAYROLL_CLOSE_OWNERSHIP_SAMPLE_LIMIT}`,
      [tenantId, legalEntityId, periodStart, periodEnd]
    );
    finalizedOwnershipSamples = (finalizedOwnershipSamplesResult.rows || []).map(
      mapPayrollCloseOwnershipSampleRow
    );
  }

  const liabilityOwnershipStatsResult = await runQuery(
    `SELECT
        COUNT(*) AS ownership_aware_liability_count,
        COUNT(DISTINCT CASE WHEN ${invalidLiabilityOwnershipPredicate} THEN pr.id END)
          AS affected_run_count,
        COALESCE(SUM(CASE WHEN ${invalidLiabilityOwnershipPredicate} THEN 1 ELSE 0 END), 0)
          AS invalid_liability_count,
        COALESCE(SUM(
          CASE
            WHEN l.ownership_scope IS NULL OR l.ownership_scope NOT IN ('CENTRAL', 'OPERATING_UNIT')
            THEN 1
            ELSE 0
          END
        ), 0) AS ownership_scope_issue_count,
        COALESCE(SUM(
          CASE
            WHEN l.ownership_scope = 'CENTRAL' AND l.operating_unit_id IS NOT NULL
            THEN 1
            ELSE 0
          END
        ), 0) AS central_with_operating_unit_count,
        COALESCE(SUM(
          CASE
            WHEN l.ownership_scope = 'OPERATING_UNIT' AND l.operating_unit_id IS NULL
            THEN 1
            ELSE 0
          END
        ), 0) AS operating_unit_missing_operating_unit_count
     FROM payroll_run_liabilities l
     JOIN payroll_runs pr
       ON pr.tenant_id = l.tenant_id
      AND pr.legal_entity_id = l.legal_entity_id
      AND pr.id = l.run_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND pr.payroll_period BETWEEN ? AND ?
       AND pr.ownership_as_of_date IS NOT NULL
       AND COALESCE(l.status, 'OPEN') <> 'CANCELLED'`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const liabilityOwnershipStats = liabilityOwnershipStatsResult.rows?.[0] || {};

  const grandfatheredLiabilityStatsResult = await runQuery(
    `SELECT COUNT(*) AS grandfathered_liability_count
     FROM payroll_run_liabilities l
     JOIN payroll_runs pr
       ON pr.tenant_id = l.tenant_id
      AND pr.legal_entity_id = l.legal_entity_id
      AND pr.id = l.run_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND pr.payroll_period BETWEEN ? AND ?
       AND pr.ownership_as_of_date IS NULL
       AND COALESCE(l.status, 'OPEN') <> 'CANCELLED'`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const grandfatheredLiabilityStats =
    grandfatheredLiabilityStatsResult.rows?.[0] || {};

  let invalidLiabilitySamples = [];
  if (Number(liabilityOwnershipStats.invalid_liability_count || 0) > 0) {
    const invalidLiabilitySamplesResult = await runQuery(
      `SELECT
          pr.id AS run_id,
          pr.run_no,
          pr.payroll_period,
          pr.ownership_as_of_date,
          l.id AS liability_id,
          l.liability_type,
          l.liability_group,
          l.employee_code,
          l.employee_name,
          l.ownership_scope,
          l.operating_unit_id,
          ou.code AS operating_unit_code,
          ou.name AS operating_unit_name,
          l.status
       FROM payroll_run_liabilities l
       JOIN payroll_runs pr
         ON pr.tenant_id = l.tenant_id
        AND pr.legal_entity_id = l.legal_entity_id
        AND pr.id = l.run_id
       LEFT JOIN operating_units ou
         ON ou.id = l.operating_unit_id
        AND ou.tenant_id = l.tenant_id
       WHERE l.tenant_id = ?
         AND l.legal_entity_id = ?
         AND pr.payroll_period BETWEEN ? AND ?
         AND pr.ownership_as_of_date IS NOT NULL
         AND COALESCE(l.status, 'OPEN') <> 'CANCELLED'
         AND ${invalidLiabilityOwnershipPredicate}
       ORDER BY pr.payroll_period DESC, pr.id DESC, l.id ASC
       LIMIT ${PAYROLL_CLOSE_OWNERSHIP_SAMPLE_LIMIT}`,
      [tenantId, legalEntityId, periodStart, periodEnd]
    );
    invalidLiabilitySamples = (invalidLiabilitySamplesResult.rows || []).map(
      mapPayrollCloseLiabilitySampleRow
    );
  }

  const postedPayrollBatchSettlementStats =
    await computePostedPayrollBatchSettlementIntegrity({
      tenantId,
      legalEntityId,
      periodStart,
      periodEnd,
      invalidLiabilityOwnershipPredicate: invalidSettlementLiabilityOwnershipPredicate,
      runQuery,
    });

  const overrideStatsResult = await runQuery(
    `SELECT
        COUNT(*) AS pending_override_count
     FROM payroll_liability_override_requests r
     JOIN payroll_runs pr
       ON pr.tenant_id = r.tenant_id
      AND pr.legal_entity_id = r.legal_entity_id
      AND pr.id = r.run_id
     WHERE r.tenant_id = ?
       AND r.legal_entity_id = ?
       AND r.status = 'REQUESTED'
       AND pr.payroll_period BETWEEN ? AND ?`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const overrideStats = overrideStatsResult.rows?.[0] || {};

  const beneficiaryStatsResult = await runQuery(
    `SELECT
        COUNT(*) AS employee_liabilities_in_payment_flow,
        COALESCE(SUM(
          CASE
            WHEN latest_pl.id IS NULL THEN 1
            WHEN latest_pl.beneficiary_snapshot_status = 'NOT_REQUIRED' THEN 0
            WHEN latest_pl.beneficiary_bank_snapshot_id IS NULL THEN 1
            ELSE 0
          END
        ), 0) AS missing_beneficiary_snapshot_count
     FROM payroll_run_liabilities l
     JOIN payroll_runs pr
       ON pr.tenant_id = l.tenant_id
      AND pr.legal_entity_id = l.legal_entity_id
      AND pr.id = l.run_id
     LEFT JOIN payroll_liability_payment_links latest_pl
       ON latest_pl.tenant_id = l.tenant_id
      AND latest_pl.legal_entity_id = l.legal_entity_id
      AND latest_pl.run_id = l.run_id
      AND latest_pl.payroll_liability_id = l.id
      AND latest_pl.id = (
        SELECT pl2.id
        FROM payroll_liability_payment_links pl2
        WHERE pl2.tenant_id = l.tenant_id
          AND pl2.legal_entity_id = l.legal_entity_id
          AND pl2.run_id = l.run_id
          AND pl2.payroll_liability_id = l.id
        ORDER BY pl2.id DESC
        LIMIT 1
      )
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND pr.payroll_period BETWEEN ? AND ?
       AND UPPER(COALESCE(l.beneficiary_type, '')) = 'EMPLOYEE'
       AND UPPER(COALESCE(l.status, '')) IN ('IN_BATCH','PARTIALLY_PAID','PAID')`,
    [tenantId, legalEntityId, periodStart, periodEnd]
  );
  const beneficiaryStats = beneficiaryStatsResult.rows?.[0] || {};

  const checks = [
    {
      check_code: "RUNS_NO_NON_FINALIZED",
      check_name: "No non-finalized payroll runs in period",
      severity: "ERROR",
      status: Number(runStats.non_finalized_runs || 0) === 0 ? "PASS" : "FAIL",
      metric_value: Number(runStats.non_finalized_runs || 0),
      metric_text: `${Number(runStats.non_finalized_runs || 0)} runs in DRAFT/IMPORTED/REVIEWED`,
      details_json: null,
      sort_order: 10,
    },
    {
      check_code: "PRE_POU_IN_FLIGHT_STATE_CLEARED",
      check_name: "Legacy pre-POU in-flight payroll state has been cancelled and recreated",
      severity: "ERROR",
      status: prePouInFlightBlockingCount === 0 ? "PASS" : "FAIL",
      metric_value: prePouInFlightBlockingCount,
      metric_text:
        `${Number(prePouInFlightRunStats.legacy_non_finalized_run_count || 0)} legacy non-finalized runs, ` +
        `${Number(prePouInFlightLiabilityStats.legacy_derived_liability_count || 0)} legacy derived liabilities, ` +
        `${Number(prePouInFlightBatchStats.legacy_active_batch_count || 0)} legacy active payroll batches require cancel/re-create`,
      details_json: {
        non_finalized_run_statuses: [...PAYROLL_NON_FINALIZED_RUN_STATUSES],
        active_payment_batch_statuses: [...PRE_POU_ACTIVE_PAYROLL_BATCH_STATUSES],
        remediation_steps: [...PRE_POU_IN_FLIGHT_REMEDIATION_STEPS],
        grandfathering_boundary: "payroll_runs.ownership_as_of_date IS NULL",
        legacy_non_finalized_run_count: Number(
          prePouInFlightRunStats.legacy_non_finalized_run_count || 0
        ),
        draft_run_count: Number(prePouInFlightRunStats.draft_run_count || 0),
        imported_run_count: Number(prePouInFlightRunStats.imported_run_count || 0),
        reviewed_run_count: Number(prePouInFlightRunStats.reviewed_run_count || 0),
        legacy_derived_liability_count: Number(
          prePouInFlightLiabilityStats.legacy_derived_liability_count || 0
        ),
        liability_affected_run_count: Number(
          prePouInFlightLiabilityStats.affected_run_count || 0
        ),
        open_liability_count: Number(prePouInFlightLiabilityStats.open_liability_count || 0),
        in_batch_liability_count: Number(
          prePouInFlightLiabilityStats.in_batch_liability_count || 0
        ),
        partially_paid_liability_count: Number(
          prePouInFlightLiabilityStats.partially_paid_liability_count || 0
        ),
        paid_liability_count: Number(prePouInFlightLiabilityStats.paid_liability_count || 0),
        legacy_active_batch_count: Number(prePouInFlightBatchStats.legacy_active_batch_count || 0),
        legacy_active_batch_line_count: Number(
          prePouInFlightBatchStats.legacy_active_batch_line_count || 0
        ),
        batch_affected_run_count: Number(prePouInFlightBatchStats.affected_run_count || 0),
        draft_batch_count: Number(prePouInFlightBatchStats.draft_batch_count || 0),
        approved_batch_count: Number(prePouInFlightBatchStats.approved_batch_count || 0),
        exported_batch_count: Number(prePouInFlightBatchStats.exported_batch_count || 0),
        sample_runs: prePouInFlightRunSamples,
        sample_liabilities: prePouInFlightLiabilitySamples,
        sample_batches: prePouInFlightBatchSamples,
      },
      sort_order: 12,
    },
    {
      check_code: "FINALIZED_LINES_OWNERSHIP_RESOLVED",
      check_name: "Finalized payroll lines have resolved ownership",
      severity: "ERROR",
      status: Number(finalizedOwnershipStats.blocking_line_count || 0) === 0 ? "PASS" : "FAIL",
      metric_value: Number(finalizedOwnershipStats.blocking_line_count || 0),
      metric_text: `${Number(finalizedOwnershipStats.blocking_line_count || 0)} finalized payroll lines with blocking ownership status`,
      details_json: {
        blocking_statuses: [...PAYROLL_OWNERSHIP_BLOCKING_STATUSES],
        ownership_aware_finalized_run_count: Number(
          finalizedOwnershipStats.ownership_aware_finalized_run_count || 0
        ),
        affected_run_count: Number(finalizedOwnershipStats.affected_run_count || 0),
        grandfathered_finalized_run_count: Number(
          grandfatheredFinalizedRuns.grandfathered_finalized_run_count || 0
        ),
        unresolved_line_count: Number(finalizedOwnershipStats.unresolved_line_count || 0),
        ambiguous_line_count: Number(finalizedOwnershipStats.ambiguous_line_count || 0),
        mismatch_line_count: Number(finalizedOwnershipStats.mismatch_line_count || 0),
        grandfathering_boundary: "payroll_runs.ownership_as_of_date IS NULL",
        sample_lines: finalizedOwnershipSamples,
      },
      sort_order: 15,
    },
    {
      check_code: "LIABILITIES_OWNER_CONTEXT_VALID",
      check_name: "Payroll liabilities have valid owner context",
      severity: "ERROR",
      status: Number(liabilityOwnershipStats.invalid_liability_count || 0) === 0 ? "PASS" : "FAIL",
      metric_value: Number(liabilityOwnershipStats.invalid_liability_count || 0),
      metric_text: `${Number(liabilityOwnershipStats.invalid_liability_count || 0)} payroll liabilities with invalid owner context`,
      details_json: {
        validity_rules: [...PAYROLL_LIABILITY_OWNERSHIP_VALIDITY_RULES],
        ownership_aware_liability_count: Number(
          liabilityOwnershipStats.ownership_aware_liability_count || 0
        ),
        affected_run_count: Number(liabilityOwnershipStats.affected_run_count || 0),
        grandfathered_liability_count: Number(
          grandfatheredLiabilityStats.grandfathered_liability_count || 0
        ),
        ownership_scope_issue_count: Number(
          liabilityOwnershipStats.ownership_scope_issue_count || 0
        ),
        central_with_operating_unit_count: Number(
          liabilityOwnershipStats.central_with_operating_unit_count || 0
        ),
        operating_unit_missing_operating_unit_count: Number(
          liabilityOwnershipStats.operating_unit_missing_operating_unit_count || 0
        ),
        grandfathering_boundary: "payroll_runs.ownership_as_of_date IS NULL",
        sample_liabilities: invalidLiabilitySamples,
      },
      sort_order: 18,
    },
    {
      check_code: "POSTED_PAYROLL_BATCHES_SELF_BALANCED",
      check_name: "Posted payroll batches preserve required cross-context journal structure",
      severity: "ERROR",
      status:
        Number(postedPayrollBatchSettlementStats.blockingLineCount || 0) === 0 ? "PASS" : "FAIL",
      metric_value: Number(postedPayrollBatchSettlementStats.blockingLineCount || 0),
      metric_text: `${Number(postedPayrollBatchSettlementStats.blockingLineCount || 0)} posted payroll payment lines missing required settlement journal structure`,
      details_json: {
        requirements: [...PAYROLL_POSTED_BATCH_SETTLEMENT_REQUIREMENTS],
        issue_codes: [...PAYROLL_POSTED_BATCH_SETTLEMENT_ISSUE_CODES],
        eligible_posted_batch_count: Number(
          postedPayrollBatchSettlementStats.eligiblePostedBatchCount || 0
        ),
        eligible_posted_line_count: Number(
          postedPayrollBatchSettlementStats.eligiblePostedLineCount || 0
        ),
        cross_context_line_count: Number(
          postedPayrollBatchSettlementStats.crossContextLineCount || 0
        ),
        affected_batch_count: Number(
          postedPayrollBatchSettlementStats.affectedBatchCount || 0
        ),
        grandfathered_posted_batch_count: Number(
          postedPayrollBatchSettlementStats.grandfatheredPostedBatchCount || 0
        ),
        grandfathered_posted_line_count: Number(
          postedPayrollBatchSettlementStats.grandfatheredPostedLineCount || 0
        ),
        posted_journal_missing_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.posted_journal_missing || 0
        ),
        payer_context_journal_line_missing_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.payer_context_journal_line_missing || 0
        ),
        payer_context_journal_line_ambiguous_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.payer_context_journal_line_ambiguous || 0
        ),
        settlement_journal_ref_missing_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.settlement_journal_ref_missing || 0
        ),
        settlement_journal_ref_invalid_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.settlement_journal_ref_invalid || 0
        ),
        main_settlement_line_missing_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.main_settlement_line_missing || 0
        ),
        main_settlement_line_invalid_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.main_settlement_line_invalid || 0
        ),
        self_balancing_owner_credit_missing_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.self_balancing_owner_credit_missing || 0
        ),
        self_balancing_payer_debit_missing_count: Number(
          postedPayrollBatchSettlementStats.issueCounts?.self_balancing_payer_debit_missing || 0
        ),
        grandfathering_boundary: "payroll_runs.ownership_as_of_date IS NULL",
        sample_lines: postedPayrollBatchSettlementStats.sampleLines,
      },
      sort_order: 19,
    },
    {
      check_code: "RUNS_ACCRUAL_POSTED",
      check_name: "Finalized payroll runs have accrual journal posted",
      severity: "ERROR",
      status: Number(runStats.finalized_missing_accrual_journal || 0) === 0 ? "PASS" : "FAIL",
      metric_value: Number(runStats.finalized_missing_accrual_journal || 0),
      metric_text: `${Number(runStats.finalized_missing_accrual_journal || 0)} finalized runs missing accrual journal`,
      details_json: null,
      sort_order: 20,
    },
    {
      check_code: "RETRO_DRAFTS_NONE",
      check_name: "No open RETRO correction shells in period",
      severity: "ERROR",
      status: Number(corrStats.retro_draft_count || 0) === 0 ? "PASS" : "FAIL",
      metric_value: Number(corrStats.retro_draft_count || 0),
      metric_text: `${Number(corrStats.retro_draft_count || 0)} RETRO draft shells`,
      details_json: null,
      sort_order: 30,
    },
    {
      check_code: "OFF_CYCLE_DRAFTS_WARN",
      check_name: "Open OFF_CYCLE draft shells (warning)",
      severity: "WARN",
      status: Number(corrStats.off_cycle_draft_count || 0) === 0 ? "PASS" : "WARN",
      metric_value: Number(corrStats.off_cycle_draft_count || 0),
      metric_text: `${Number(corrStats.off_cycle_draft_count || 0)} OFF_CYCLE draft shells`,
      details_json: null,
      sort_order: 35,
    },
    {
      check_code: "MANUAL_OVERRIDE_REQUESTS_NONE",
      check_name: "No pending manual settlement override requests",
      severity: "ERROR",
      status: Number(overrideStats.pending_override_count || 0) === 0 ? "PASS" : "FAIL",
      metric_value: Number(overrideStats.pending_override_count || 0),
      metric_text: `${Number(overrideStats.pending_override_count || 0)} pending override requests`,
      details_json: null,
      sort_order: 40,
    },
    {
      check_code: "BENEFICIARY_SNAPSHOTS_READY",
      check_name: "Employee liabilities in payment flow have beneficiary snapshots",
      severity: "ERROR",
      status: Number(beneficiaryStats.missing_beneficiary_snapshot_count || 0) === 0 ? "PASS" : "FAIL",
      metric_value: Number(beneficiaryStats.missing_beneficiary_snapshot_count || 0),
      metric_text: `${Number(beneficiaryStats.missing_beneficiary_snapshot_count || 0)} missing snapshots`,
      details_json: {
        employee_liabilities_in_payment_flow: Number(
          beneficiaryStats.employee_liabilities_in_payment_flow || 0
        ),
      },
      sort_order: 50,
    },
    {
      check_code: "RUN_COUNT_INFO",
      check_name: "Payroll runs in period",
      severity: "INFO",
      status: "PASS",
      metric_value: Number(runStats.run_count || 0),
      metric_text: `${Number(runStats.run_count || 0)} runs`,
      details_json: null,
      sort_order: 100,
    },
  ];

  return checks;
}

async function upsertChecklistRows({
  tenantId,
  legalEntityId,
  closeId,
  checks,
  runQuery = query,
}) {
  for (const check of checks || []) {
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
      `INSERT INTO payroll_period_close_checks (
          tenant_id, legal_entity_id, payroll_period_close_id,
          check_code, check_name, severity, status,
          metric_value, metric_text, details_json, sort_order
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         check_name = VALUES(check_name),
         severity = VALUES(severity),
         status = VALUES(status),
         metric_value = VALUES(metric_value),
         metric_text = VALUES(metric_text),
         details_json = VALUES(details_json),
         sort_order = VALUES(sort_order),
         updated_at = CURRENT_TIMESTAMP`,
      [
        tenantId,
        legalEntityId,
        closeId,
        check.check_code,
        check.check_name,
        normalizeUpperText(check.severity),
        normalizeUpperText(check.status),
        check.metric_value == null ? null : toAmount(check.metric_value),
        check.metric_text || null,
        safeJson(check.details_json ?? null),
        Number(check.sort_order || 100),
      ]
    );
  }
}

async function listPeriodCloseChecks({ tenantId, closeId, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM payroll_period_close_checks
     WHERE tenant_id = ? AND payroll_period_close_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [tenantId, closeId]
  );
  return (result.rows || []).map(mapCheckRow);
}

async function listPeriodCloseAudit({ tenantId, closeId, runQuery = query }) {
  const result = await runQuery(
    `SELECT *
     FROM payroll_period_close_audit
     WHERE tenant_id = ? AND payroll_period_close_id = ?
     ORDER BY id DESC`,
    [tenantId, closeId]
  );
  return (result.rows || []).map(mapAuditRow);
}

function assertNoErrorCheckFailures(checks = []) {
  const failing = (checks || []).filter(
    (check) =>
      normalizeUpperText(check?.severity) === "ERROR" &&
      normalizeUpperText(check?.status) === "FAIL"
  );
  if (failing.length > 0) {
    throw makeConflict("Payroll period close request blocked: checklist has failing ERROR checks");
  }
}

export async function resolvePayrollPeriodCloseScope(closeId, tenantId) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedCloseId = parsePositiveInt(closeId);
  if (!parsedTenantId || !parsedCloseId) return null;
  const row = await getPeriodCloseScopeRow({ tenantId: parsedTenantId, closeId: parsedCloseId });
  if (!row) return null;
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export async function listPayrollPeriodCloseRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["pc.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "pc.legal_entity_id", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("pc.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.status && CLOSE_STATUS_VALUES.has(filters.status)) {
    conditions.push("pc.status = ?");
    params.push(filters.status);
  }
  if (filters.periodStart) {
    conditions.push("pc.period_end >= ?");
    params.push(filters.periodStart);
  }
  if (filters.periodEnd) {
    conditions.push("pc.period_start <= ?");
    params.push(filters.periodEnd);
  }

  const whereSql = conditions.join(" AND ");
  const countResult = await query(
    `SELECT COUNT(*) AS total FROM payroll_period_closes pc WHERE ${whereSql}`,
    params
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const safeLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset = Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
  const listResult = await query(
    `SELECT
        pc.*,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name
     FROM payroll_period_closes pc
     JOIN legal_entities le
       ON le.id = pc.legal_entity_id
      AND le.tenant_id = pc.tenant_id
     WHERE ${whereSql}
     ORDER BY pc.period_start DESC, pc.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (listResult.rows || []).map((row) => mapCloseRow(row)),
    total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

export async function getPayrollPeriodCloseDetail({
  req,
  tenantId,
  closeId,
  assertScopeAccess,
}) {
  const close = await getPeriodCloseById({ tenantId, closeId });
  if (!close) throw makeNotFound("Payroll period close not found");
  assertScopeAccess(req, "legal_entity", parsePositiveInt(close.legal_entity_id), "closeId");
  const [checks, audit] = await Promise.all([
    listPeriodCloseChecks({ tenantId, closeId }),
    listPeriodCloseAudit({ tenantId, closeId }),
  ]);
  return {
    close: mapCloseRow(close),
    checks,
    audit,
  };
}

export async function preparePayrollPeriodClose({
  req,
  tenantId,
  userId,
  input,
  assertScopeAccess,
}) {
  assertScopeAccess(req, "legal_entity", input.legalEntityId, "legalEntityId");

  let closeId = null;
  await withTransaction(async (tx) => {
    let close = await getOrCreatePeriodCloseForUpdate({
      tenantId,
      legalEntityId: input.legalEntityId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      runQuery: tx.query,
    });
    if (!close) throw new Error("Failed to load/create payroll period close");

    const currentStatus = normalizeUpperText(close.status);
    if (currentStatus === "CLOSED") {
      throw makeConflict("Payroll period is CLOSED. Reopen before preparing checklist again.");
    }

    const checks = await computeChecklist({
      tenantId,
      legalEntityId: input.legalEntityId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      runQuery: tx.query,
    });
    await upsertChecklistRows({
      tenantId,
      legalEntityId: input.legalEntityId,
      closeId: parsePositiveInt(close.id),
      checks,
      runQuery: tx.query,
    });

    const summary = summarizeChecks(checks);
    const nextStatus = summary.failedChecks === 0 ? "READY" : "DRAFT";

    await tx.query(
      `UPDATE payroll_period_closes
       SET status = ?,
           checklist_version = checklist_version + 1,
           total_checks = ?,
           passed_checks = ?,
           failed_checks = ?,
           warning_checks = ?,
           lock_run_changes = ?,
           lock_manual_settlements = ?,
           lock_payment_prep = ?,
           prepare_note = ?,
           prepared_by_user_id = ?,
           prepared_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?`,
      [
        nextStatus,
        summary.totalChecks,
        summary.passedChecks,
        summary.failedChecks,
        summary.warningChecks,
        input.lockRunChanges ? 1 : 0,
        input.lockManualSettlements ? 1 : 0,
        input.lockPaymentPrep ? 1 : 0,
        input.note || null,
        userId,
        tenantId,
        input.legalEntityId,
        parsePositiveInt(close.id),
      ]
    );

    closeId = parsePositiveInt(close.id);
    await writeCloseAudit({
      tenantId,
      legalEntityId: input.legalEntityId,
      closeId,
      action: "PREPARED",
      note: input.note || null,
      payload: {
        period_start: input.periodStart,
        period_end: input.periodEnd,
        status: nextStatus,
        summary,
        lock_flags: {
          lock_run_changes: Boolean(input.lockRunChanges),
          lock_manual_settlements: Boolean(input.lockManualSettlements),
          lock_payment_prep: Boolean(input.lockPaymentPrep),
        },
      },
      userId,
      runQuery: tx.query,
    });
  });

  return getPayrollPeriodCloseDetail({ req, tenantId, closeId, assertScopeAccess });
}

export async function requestPayrollPeriodClose({
  req,
  tenantId,
  userId,
  closeId,
  note = null,
  requestIdempotencyKey = null,
  assertScopeAccess,
}) {
  await withTransaction(async (tx) => {
    const close = await getPeriodCloseById({ tenantId, closeId, runQuery: tx.query, forUpdate: true });
    if (!close) throw makeNotFound("Payroll period close not found");
    const legalEntityId = parsePositiveInt(close.legal_entity_id);
    assertScopeAccess(req, "legal_entity", legalEntityId, "closeId");

    const currentStatus = normalizeUpperText(close.status);
    if (
      requestIdempotencyKey &&
      close.request_idempotency_key &&
      String(close.request_idempotency_key) === String(requestIdempotencyKey) &&
      ["REQUESTED", "CLOSED"].includes(currentStatus)
    ) {
      return;
    }

    if (!["READY", "REQUESTED"].includes(currentStatus)) {
      throw makeConflict(`Payroll period close must be READY before request-close (current: ${currentStatus})`);
    }

    const checks = await listPeriodCloseChecks({ tenantId, closeId, runQuery: tx.query });
    assertNoErrorCheckFailures(checks);

    await tx.query(
      `UPDATE payroll_period_closes
       SET status = 'REQUESTED',
           request_note = ?,
           request_idempotency_key = COALESCE(?, request_idempotency_key),
           requested_by_user_id = ?,
           requested_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?`,
      [note || null, requestIdempotencyKey || null, userId, tenantId, legalEntityId, closeId]
    );

    await writeCloseAudit({
      tenantId,
      legalEntityId,
      closeId,
      action: "REQUESTED",
      note: note || null,
      payload: {
        request_idempotency_key: requestIdempotencyKey || null,
      },
      userId,
      runQuery: tx.query,
    });
  });

  return getPayrollPeriodCloseDetail({ req, tenantId, closeId, assertScopeAccess });
}

export async function approveAndClosePayrollPeriod({
  req,
  tenantId,
  userId,
  closeId,
  note = null,
  closeIdempotencyKey = null,
  assertScopeAccess,
  skipUnifiedApprovalGate = false,
  approvalRequestId = null,
}) {
  if (!skipUnifiedApprovalGate) {
    const previewClose = await getPeriodCloseById({ tenantId, closeId });
    if (!previewClose) throw makeNotFound("Payroll period close not found");
    const legalEntityId = parsePositiveInt(previewClose.legal_entity_id);
    assertScopeAccess(req, "legal_entity", legalEntityId, "closeId");

    const currentStatus = normalizeUpperText(previewClose.status);
    if (currentStatus === "REQUESTED") {
      const gov = await evaluateApprovalNeed({
        moduleCode: "PAYROLL",
        tenantId,
        targetType: "PAYROLL_PERIOD_CLOSE",
        actionType: "APPROVE_CLOSE",
        legalEntityId,
      });
      if (gov?.approval_required || gov?.approvalRequired) {
        const submitRes = await submitApprovalRequest({
          tenantId,
          userId,
          requestInput: {
            moduleCode: "PAYROLL",
            requestKey: `PRP08:APPROVE_CLOSE:${tenantId}:${closeId}`,
            targetType: "PAYROLL_PERIOD_CLOSE",
            targetId: closeId,
            actionType: "APPROVE_CLOSE",
            legalEntityId,
            actionPayload: {
              closeId,
              note: note || null,
              closeIdempotencyKey: closeIdempotencyKey || null,
            },
            targetSnapshot: {
              module_code: "PAYROLL",
              target_type: "PAYROLL_PERIOD_CLOSE",
              target_id: closeId,
              legal_entity_id: legalEntityId,
              period_start: toDateOnly(previewClose.period_start),
              period_end: toDateOnly(previewClose.period_end),
              status: currentStatus,
            },
          },
        });
        return {
          close: mapCloseRow(previewClose),
          approval_required: true,
          approval_request: submitRes?.item || null,
          idempotent: Boolean(submitRes?.idempotent),
        };
      }
    }
  }

  await withTransaction(async (tx) => {
    const close = await getPeriodCloseById({ tenantId, closeId, runQuery: tx.query, forUpdate: true });
    if (!close) throw makeNotFound("Payroll period close not found");
    const legalEntityId = parsePositiveInt(close.legal_entity_id);
    assertScopeAccess(req, "legal_entity", legalEntityId, "closeId");

    const currentStatus = normalizeUpperText(close.status);
    if (
      closeIdempotencyKey &&
      close.close_idempotency_key &&
      String(close.close_idempotency_key) === String(closeIdempotencyKey) &&
      currentStatus === "CLOSED"
    ) {
      return;
    }

    if (currentStatus !== "REQUESTED") {
      throw makeConflict(`Payroll period close must be REQUESTED before approve-close (current: ${currentStatus})`);
    }

    const requesterId = parsePositiveInt(close.requested_by_user_id);
    if (requesterId && requesterId === parsePositiveInt(userId)) {
      const err = new Error("Maker-checker violation: requester cannot approve-close the same payroll period");
      err.status = 403;
      throw err;
    }

    const checks = await listPeriodCloseChecks({ tenantId, closeId, runQuery: tx.query });
    assertNoErrorCheckFailures(checks);
    const summary = summarizeChecks(checks);

    await tx.query(
      `UPDATE payroll_period_closes
       SET status = 'CLOSED',
           close_note = ?,
           close_idempotency_key = COALESCE(?, close_idempotency_key),
           approved_by_user_id = ?,
           approved_at = CURRENT_TIMESTAMP,
           closed_by_user_id = ?,
           closed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           total_checks = ?,
           passed_checks = ?,
           failed_checks = ?,
           warning_checks = ?
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?`,
      [
        note || null,
        closeIdempotencyKey || null,
        userId,
        userId,
        summary.totalChecks,
        summary.passedChecks,
        summary.failedChecks,
        summary.warningChecks,
        tenantId,
        legalEntityId,
        closeId,
      ]
    );

    await writeCloseAudit({
      tenantId,
      legalEntityId,
      closeId,
      action: "CLOSED",
      note: note || null,
      payload: {
        close_idempotency_key: closeIdempotencyKey || null,
        approval_request_id: parsePositiveInt(approvalRequestId) || null,
        lock_flags: {
          lock_run_changes: Boolean(Number(close.lock_run_changes || 0)),
          lock_manual_settlements: Boolean(Number(close.lock_manual_settlements || 0)),
          lock_payment_prep: Boolean(Number(close.lock_payment_prep || 0)),
        },
      },
      userId,
      runQuery: tx.query,
    });
  });

  return getPayrollPeriodCloseDetail({ req, tenantId, closeId, assertScopeAccess });
}

export async function reopenPayrollPeriodClose({
  req,
  tenantId,
  userId,
  closeId,
  reason,
  assertScopeAccess,
  skipUnifiedApprovalGate = false,
  approvalRequestId = null,
}) {
  if (!skipUnifiedApprovalGate) {
    const previewClose = await getPeriodCloseById({ tenantId, closeId });
    if (!previewClose) throw makeNotFound("Payroll period close not found");
    const legalEntityId = parsePositiveInt(previewClose.legal_entity_id);
    assertScopeAccess(req, "legal_entity", legalEntityId, "closeId");
    const currentStatus = normalizeUpperText(previewClose.status);
    if (currentStatus === "CLOSED") {
      const gov = await evaluateApprovalNeed({
        moduleCode: "PAYROLL",
        tenantId,
        targetType: "PAYROLL_PERIOD_CLOSE",
        actionType: "REOPEN",
        legalEntityId,
      });
      if (gov?.approval_required || gov?.approvalRequired) {
        const submitRes = await submitApprovalRequest({
          tenantId,
          userId,
          requestInput: {
            moduleCode: "PAYROLL",
            requestKey: `PRP08:REOPEN:${tenantId}:${closeId}`,
            targetType: "PAYROLL_PERIOD_CLOSE",
            targetId: closeId,
            actionType: "REOPEN",
            legalEntityId,
            actionPayload: {
              closeId,
              reason,
            },
            targetSnapshot: {
              module_code: "PAYROLL",
              target_type: "PAYROLL_PERIOD_CLOSE",
              target_id: closeId,
              legal_entity_id: legalEntityId,
              period_start: toDateOnly(previewClose.period_start),
              period_end: toDateOnly(previewClose.period_end),
              status: currentStatus,
            },
          },
        });
        return {
          close: mapCloseRow(previewClose),
          approval_required: true,
          approval_request: submitRes?.item || null,
          idempotent: Boolean(submitRes?.idempotent),
        };
      }
    }
  }

  await withTransaction(async (tx) => {
    const close = await getPeriodCloseById({ tenantId, closeId, runQuery: tx.query, forUpdate: true });
    if (!close) throw makeNotFound("Payroll period close not found");
    const legalEntityId = parsePositiveInt(close.legal_entity_id);
    assertScopeAccess(req, "legal_entity", legalEntityId, "closeId");

    const currentStatus = normalizeUpperText(close.status);
    if (currentStatus !== "CLOSED") {
      throw makeConflict(`Only CLOSED payroll periods can be reopened (current: ${currentStatus})`);
    }

    await tx.query(
      `UPDATE payroll_period_closes
       SET status = 'REOPENED',
           reopen_reason = ?,
           reopened_by_user_id = ?,
           reopened_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?`,
      [reason, userId, tenantId, legalEntityId, closeId]
    );

    await writeCloseAudit({
      tenantId,
      legalEntityId,
      closeId,
      action: "REOPENED",
      note: reason,
      payload: { reason, approval_request_id: parsePositiveInt(approvalRequestId) || null },
      userId,
      runQuery: tx.query,
    });
  });

  return getPayrollPeriodCloseDetail({ req, tenantId, closeId, assertScopeAccess });
}

export async function assertPayrollPeriodActionAllowed({
  tenantId,
  legalEntityId,
  payrollPeriod,
  actionType,
  runQuery = query,
}) {
  const parsedTenantId = parsePositiveInt(tenantId);
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const date = toDateOnly(payrollPeriod);
  if (!parsedTenantId || !parsedLegalEntityId || !date) {
    return { allowed: true, close: null };
  }

  const result = await runQuery(
    `SELECT *
     FROM payroll_period_closes
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND status = 'CLOSED'
       AND ? BETWEEN period_start AND period_end
     ORDER BY period_start DESC, id DESC
     LIMIT 1`,
    [parsedTenantId, parsedLegalEntityId, date]
  );
  const close = result.rows?.[0] || null;
  if (!close) {
    return { allowed: true, close: null };
  }

  const action = normalizeUpperText(actionType);
  const blocked =
    (action.startsWith("RUN_") && Number(close.lock_run_changes || 0) === 1) ||
    (action.startsWith("MANUAL_SETTLEMENT_") && Number(close.lock_manual_settlements || 0) === 1) ||
    (action.startsWith("PAYMENT_PREP_") && Number(close.lock_payment_prep || 0) === 1);

  if (blocked) {
    const err = makeConflict(`Payroll period is CLOSED and locked for action ${action}`);
    err.code = "PAYROLL_PERIOD_LOCKED";
    err.details = {
      payroll_period_close_id: parsePositiveInt(close.id),
      tenant_id: parsedTenantId,
      legal_entity_id: parsedLegalEntityId,
      period_start: toDateOnly(close.period_start),
      period_end: toDateOnly(close.period_end),
      action_type: action,
      lock_flags: {
        lock_run_changes: Boolean(Number(close.lock_run_changes || 0)),
        lock_manual_settlements: Boolean(Number(close.lock_manual_settlements || 0)),
        lock_payment_prep: Boolean(Number(close.lock_payment_prep || 0)),
      },
    };
    throw err;
  }

  return { allowed: true, close: mapCloseRow(close) };
}

export async function executeApprovedPayrollPeriodClose({
  tenantId,
  approvalRequestId,
  approvedByUserId,
  payload = {},
}) {
  const closeId = parsePositiveInt(payload?.closeId ?? payload?.close_id);
  if (!closeId) {
    throw badRequest("Approved payroll period close payload is missing closeId");
  }
  return approveAndClosePayrollPeriod({
    req: null,
    tenantId,
    userId: parsePositiveInt(approvedByUserId) || null,
    closeId,
    note: String(payload?.note || "").trim() || null,
    closeIdempotencyKey:
      String((payload?.closeIdempotencyKey ?? payload?.close_idempotency_key) || "").trim() || null,
    assertScopeAccess: noopScopeAccess,
    skipUnifiedApprovalGate: true,
    approvalRequestId,
  });
}

export async function executeApprovedPayrollPeriodReopen({
  tenantId,
  approvalRequestId,
  approvedByUserId,
  payload = {},
}) {
  const closeId = parsePositiveInt(payload?.closeId ?? payload?.close_id);
  if (!closeId) {
    throw badRequest("Approved payroll period reopen payload is missing closeId");
  }
  const reason = String(payload?.reason || "").trim();
  if (!reason) {
    throw badRequest("Approved payroll period reopen payload is missing reason");
  }
  return reopenPayrollPeriodClose({
    req: null,
    tenantId,
    userId: parsePositiveInt(approvedByUserId) || null,
    closeId,
    reason,
    assertScopeAccess: noopScopeAccess,
    skipUnifiedApprovalGate: true,
    approvalRequestId,
  });
}

export default {
  resolvePayrollPeriodCloseScope,
  listPayrollPeriodCloseRows,
  getPayrollPeriodCloseDetail,
  preparePayrollPeriodClose,
  requestPayrollPeriodClose,
  approveAndClosePayrollPeriod,
  reopenPayrollPeriodClose,
  executeApprovedPayrollPeriodClose,
  executeApprovedPayrollPeriodReopen,
  assertPayrollPeriodActionAllowed,
};
