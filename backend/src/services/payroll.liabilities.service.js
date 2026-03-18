import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  decodeCursorToken,
  encodeCursorToken,
  requireCursorId,
} from "../utils/cursorPagination.js";
import { createPaymentBatch } from "./payments.service.js";
import { findApplicablePayrollComponentMapping } from "./payroll.mappings.service.js";
import { assertPayrollPeriodActionAllowed } from "./payroll.close.service.js";
import {
  assertPayrollBeneficiarySetupForLiabilities,
  attachPayrollBeneficiarySnapshotToLinkTx,
  markPayrollBeneficiarySnapshotNotRequiredTx,
} from "./payroll.beneficiaries.service.js";

const LIABILITY_GROUP_NET = "EMPLOYEE_NET";
const LIABILITY_GROUP_STATUTORY = "STATUTORY";
const VALID_SCOPES = new Set(["NET_PAY", "STATUTORY", "ALL"]);
const OWNERSHIP_SCOPE_VALUES = new Set(["CENTRAL", "OPERATING_UNIT"]);

const LIABILITY_DEFS = Object.freeze({
  NET_PAY: {
    liabilityType: "NET_PAY",
    liabilityGroup: LIABILITY_GROUP_NET,
    source: "LINE",
    lineSourceField: "net_pay",
    payableComponentCode: "PAYROLL_NET_PAYABLE",
    beneficiaryType: "EMPLOYEE",
    beneficiaryName: null,
    expectedEntrySide: "CREDIT",
  },
  EMPLOYEE_TAX: {
    liabilityType: "EMPLOYEE_TAX",
    liabilityGroup: LIABILITY_GROUP_STATUTORY,
    source: "LINE",
    lineSourceField: "employee_tax",
    payableComponentCode: "EMPLOYEE_TAX_PAYABLE",
    beneficiaryType: "TAX_AUTHORITY",
    beneficiaryName: "Payroll Tax Authority",
    expectedEntrySide: "CREDIT",
  },
  EMPLOYEE_SOCIAL_SECURITY: {
    liabilityType: "EMPLOYEE_SOCIAL_SECURITY",
    liabilityGroup: LIABILITY_GROUP_STATUTORY,
    source: "LINE",
    lineSourceField: "employee_social_security",
    payableComponentCode: "EMPLOYEE_SOCIAL_SECURITY_PAYABLE",
    beneficiaryType: "SOCIAL_SECURITY_AUTHORITY",
    beneficiaryName: "Payroll Social Security Authority",
    expectedEntrySide: "CREDIT",
  },
  EMPLOYER_TAX: {
    liabilityType: "EMPLOYER_TAX",
    liabilityGroup: LIABILITY_GROUP_STATUTORY,
    source: "LINE",
    lineSourceField: "employer_tax",
    payableComponentCode: "EMPLOYER_TAX_PAYABLE",
    beneficiaryType: "TAX_AUTHORITY",
    beneficiaryName: "Payroll Employer Tax Authority",
    expectedEntrySide: "CREDIT",
  },
  EMPLOYER_SOCIAL_SECURITY: {
    liabilityType: "EMPLOYER_SOCIAL_SECURITY",
    liabilityGroup: LIABILITY_GROUP_STATUTORY,
    source: "LINE",
    lineSourceField: "employer_social_security",
    payableComponentCode: "EMPLOYER_SOCIAL_SECURITY_PAYABLE",
    beneficiaryType: "SOCIAL_SECURITY_AUTHORITY",
    beneficiaryName: "Payroll Employer Social Security Authority",
    expectedEntrySide: "CREDIT",
  },
  OTHER_DEDUCTIONS: {
    liabilityType: "OTHER_DEDUCTIONS",
    liabilityGroup: LIABILITY_GROUP_STATUTORY,
    source: "LINE",
    lineSourceField: "other_deductions",
    payableComponentCode: "OTHER_DEDUCTIONS_PAYABLE",
    beneficiaryType: "OTHER",
    beneficiaryName: "Payroll Other Deductions",
    expectedEntrySide: "CREDIT",
  },
});

const STATUTORY_TYPES = [
  "EMPLOYEE_TAX",
  "EMPLOYEE_SOCIAL_SECURITY",
  "EMPLOYER_TAX",
  "EMPLOYER_SOCIAL_SECURITY",
  "OTHER_DEDUCTIONS",
];

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function toAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(6));
}

function amountString(value) {
  return toAmount(value).toFixed(6);
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseOptionalJson(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function conflictError(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

function normalizeScope(scope) {
  const normalized = normalizeUpperText(scope || "NET_PAY");
  if (!VALID_SCOPES.has(normalized)) {
    throw badRequest("scope must be NET_PAY, STATUTORY, or ALL");
  }
  return normalized;
}

function matchesScope(liabilityGroup, scope) {
  const normalized = normalizeScope(scope);
  if (normalized === "ALL") return true;
  if (normalized === "NET_PAY") return normalizeUpperText(liabilityGroup) === LIABILITY_GROUP_NET;
  return normalizeUpperText(liabilityGroup) === LIABILITY_GROUP_STATUTORY;
}

function normalizeOwnershipScope(scope) {
  const normalized = normalizeUpperText(scope);
  return OWNERSHIP_SCOPE_VALUES.has(normalized) ? normalized : null;
}

function normalizeOwnershipContextRow(row) {
  return {
    ownership_scope: normalizeOwnershipScope(row?.ownership_scope),
    operating_unit_id: parsePositiveInt(row?.operating_unit_id) || null,
    operating_unit_code: String(row?.operating_unit_code || "").trim() || null,
    operating_unit_name: String(row?.operating_unit_name || "").trim() || null,
  };
}

function validateOwnershipContext(row) {
  const ownershipScope = normalizeOwnershipScope(row?.ownership_scope);
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

function buildOwnershipContextToken(row) {
  const ownershipScope = normalizeOwnershipScope(row?.ownership_scope) || "UNRESOLVED";
  const operatingUnitId = parsePositiveInt(row?.operating_unit_id) || 0;
  if (ownershipScope === "CENTRAL") {
    return "CENTRAL";
  }
  if (ownershipScope === "OPERATING_UNIT") {
    return `OPERATING_UNIT:${operatingUnitId}`;
  }
  return `UNRESOLVED:${operatingUnitId}`;
}

function formatOwnerContextLabel(row) {
  const ownershipScope = normalizeOwnershipScope(row?.ownership_scope);
  if (ownershipScope === "CENTRAL") {
    return "CENTRAL";
  }
  if (ownershipScope === "OPERATING_UNIT") {
    return (
      String(row?.operating_unit_code || "").trim() ||
      String(row?.operating_unit_name || "").trim() ||
      `OU#${parsePositiveInt(row?.operating_unit_id) || "?"}`
    );
  }
  return "UNRESOLVED";
}

function buildPayerContextScope(operatingUnitId) {
  return parsePositiveInt(operatingUnitId) ? "OPERATING_UNIT" : "CENTRAL";
}

function formatPayerContextLabel(row) {
  const operatingUnitId = parsePositiveInt(row?.operating_unit_id) || null;
  if (!operatingUnitId) {
    return "CENTRAL";
  }
  return (
    String(row?.operating_unit_code || "").trim() ||
    String(row?.operating_unit_name || "").trim() ||
    `OU#${operatingUnitId}`
  );
}

function buildSelectedBankAccountPreviewRow(bankAccount) {
  if (!bankAccount) {
    return null;
  }
  const operatingUnitId = parsePositiveInt(bankAccount?.operating_unit_id) || null;
  return {
    id: parsePositiveInt(bankAccount.id),
    legal_entity_id: parsePositiveInt(bankAccount.legal_entity_id),
    code: bankAccount.code || null,
    name: bankAccount.name || null,
    currency_code: normalizeUpperText(bankAccount.currency_code),
    is_active: parseDbBoolean(bankAccount.is_active),
    operating_unit_id: operatingUnitId,
    operating_unit_code: bankAccount.operating_unit_code || null,
    operating_unit_name: bankAccount.operating_unit_name || null,
    payer_context_scope: buildPayerContextScope(operatingUnitId),
    payer_context_label: formatPayerContextLabel(bankAccount),
  };
}

function buildPaymentPrepValidationError(code, message) {
  return { code, message };
}

function evaluatePayerContextAgainstOwnerContext(selectedBankAccount, row) {
  const payer = buildSelectedBankAccountPreviewRow(selectedBankAccount);
  const ownerScope = normalizeOwnershipScope(row?.ownership_scope);
  const ownerOperatingUnitId = parsePositiveInt(row?.operating_unit_id) || null;
  if (!payer || !ownerScope) {
    return {
      allowed: false,
      settlement_mode: "OUT_OF_SCOPE",
      requires_self_balancing: false,
    };
  }
  if (payer.payer_context_scope === "CENTRAL") {
    if (ownerScope === "CENTRAL") {
      return {
        allowed: true,
        settlement_mode: "SAME_CONTEXT",
        requires_self_balancing: false,
      };
    }
    if (ownerScope === "OPERATING_UNIT" && ownerOperatingUnitId) {
      return {
        allowed: true,
        settlement_mode: "CROSS_CONTEXT_SELF_BALANCING",
        requires_self_balancing: true,
      };
    }
  }
  if (payer.payer_context_scope === "OPERATING_UNIT") {
    if (ownerScope === "CENTRAL") {
      return {
        allowed: true,
        settlement_mode: "CROSS_CONTEXT_SELF_BALANCING",
        requires_self_balancing: true,
      };
    }
    if (ownerScope === "OPERATING_UNIT" && ownerOperatingUnitId === payer.operating_unit_id) {
      return {
        allowed: true,
        settlement_mode: "SAME_CONTEXT",
        requires_self_balancing: false,
      };
    }
  }
  return {
    allowed: false,
    settlement_mode: "OUT_OF_SCOPE",
    requires_self_balancing: false,
  };
}

function summarizeLiabilityOwnerContexts(liabilities, selectedBankAccount = null) {
  const grouped = new Map();
  for (const liability of liabilities || []) {
    const token = buildOwnershipContextToken(liability);
    if (!grouped.has(token)) {
      grouped.set(token, {
        ownership_scope: normalizeOwnershipScope(liability?.ownership_scope),
        operating_unit_id: parsePositiveInt(liability?.operating_unit_id) || null,
        operating_unit_code: liability?.operating_unit_code || null,
        operating_unit_name: liability?.operating_unit_name || null,
        owner_context_label: formatOwnerContextLabel(liability),
        liability_count: 0,
        total_amount: 0,
      });
    }
    const current = grouped.get(token);
    current.liability_count += 1;
    current.total_amount = toAmount(current.total_amount + toAmount(liability?.amount));
    if (!current.operating_unit_code) {
      current.operating_unit_code = liability?.operating_unit_code || null;
    }
    if (!current.operating_unit_name) {
      current.operating_unit_name = liability?.operating_unit_name || null;
    }
  }

  return Array.from(grouped.values())
    .sort((left, right) => {
      const leftScope = normalizeOwnershipScope(left?.ownership_scope);
      const rightScope = normalizeOwnershipScope(right?.ownership_scope);
      if (leftScope !== rightScope) {
        if (leftScope === "CENTRAL") return -1;
        if (rightScope === "CENTRAL") return 1;
      }
      const leftCode = String(left?.operating_unit_code || left?.operating_unit_name || "").trim();
      const rightCode = String(right?.operating_unit_code || right?.operating_unit_name || "").trim();
      return leftCode.localeCompare(rightCode);
    })
    .map((row) => {
      const settlement = selectedBankAccount
        ? evaluatePayerContextAgainstOwnerContext(selectedBankAccount, row)
        : null;
      return {
        ...row,
        selected_bank_settlement_mode: settlement?.settlement_mode || null,
        selected_bank_allowed: settlement?.allowed ?? null,
        selected_bank_requires_self_balancing: settlement?.requires_self_balancing ?? null,
      };
    });
}

function liabilityKeyForEmployeeNet(run, line) {
  return `PRL|T:${run.tenant_id}|LE:${run.legal_entity_id}|RUN:${run.id}|NET|RL:${line.id}`;
}

function liabilityKeyForAggregate(run, liabilityType, ownerContext) {
  return [
    `PRL|T:${run.tenant_id}|LE:${run.legal_entity_id}|RUN:${run.id}|STAT|${liabilityType}`,
    `OWN:${buildOwnershipContextToken(ownerContext)}`,
  ].join("|");
}

async function writeLiabilityAudit({
  tenantId,
  legalEntityId,
  runId,
  liabilityId = null,
  action,
  payload = null,
  userId = null,
  runQuery = query,
}) {
  await runQuery(
    `INSERT INTO payroll_liability_audit (
        tenant_id, legal_entity_id, run_id, payroll_liability_id, action, payload_json, acted_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, legalEntityId, runId, liabilityId, action, safeJson(payload), userId]
  );
}

async function getRun(tenantId, runId, runQuery = query) {
  const result = await runQuery(
    `SELECT
        r.id, r.tenant_id, r.legal_entity_id, r.run_no, r.provider_code, r.entity_code,
        r.payroll_period, r.pay_date, r.currency_code, r.status,
        r.total_employee_tax, r.total_employee_social_security, r.total_other_deductions,
        r.total_net_pay, r.total_employer_tax, r.total_employer_social_security,
        r.accrual_journal_entry_id, r.liabilities_built_by_user_id, r.liabilities_built_at,
        le.code AS legal_entity_code, le.name AS legal_entity_name
     FROM payroll_runs r
     JOIN legal_entities le ON le.id = r.legal_entity_id AND le.tenant_id = r.tenant_id
     WHERE r.tenant_id = ? AND r.id = ?
     LIMIT 1`,
    [tenantId, runId]
  );
  const row = result.rows?.[0] || null;
  if (!row) return null;
  return {
    ...row,
    payroll_period: toDateOnly(row.payroll_period),
    pay_date: toDateOnly(row.pay_date),
    liabilities_built_at: row.liabilities_built_at ? String(row.liabilities_built_at) : null,
  };
}

async function getRunForUpdate(tenantId, runId, runQuery) {
  const result = await runQuery(
    `SELECT * FROM payroll_runs WHERE tenant_id = ? AND id = ? LIMIT 1 FOR UPDATE`,
    [tenantId, runId]
  );
  return result.rows?.[0] || null;
}

async function getRunLines(tenantId, runId, runQuery = query) {
  const result = await runQuery(
    `SELECT
        l.id, l.tenant_id, l.legal_entity_id, l.run_id, l.line_no, l.employee_code, l.employee_name, l.cost_center_code,
        l.ownership_scope, l.operating_unit_id,
        l.net_pay, l.employee_tax, l.employee_social_security, l.employer_tax, l.employer_social_security, l.other_deductions,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
     FROM payroll_run_lines l
     LEFT JOIN operating_units ou
       ON ou.id = l.operating_unit_id
      AND ou.tenant_id = l.tenant_id
     WHERE l.tenant_id = ? AND l.run_id = ?
     ORDER BY l.line_no ASC, l.id ASC`,
    [tenantId, runId]
  );
  return result.rows || [];
}

async function countRunLiabilities(tenantId, runId, runQuery = query) {
  const result = await runQuery(
    `SELECT COUNT(*) AS total FROM payroll_run_liabilities WHERE tenant_id = ? AND run_id = ?`,
    [tenantId, runId]
  );
  return Number(result.rows?.[0]?.total || 0);
}

async function listRunLiabilities(tenantId, runId, runQuery = query) {
  const result = await runQuery(
    `SELECT
        l.id, l.tenant_id, l.legal_entity_id, l.run_id, l.liability_key, l.liability_type, l.liability_group,
        l.source_run_line_id, l.employee_code, l.employee_name, l.cost_center_code,
        l.ownership_scope, l.operating_unit_id, ou.code AS operating_unit_code, ou.name AS operating_unit_name,
        l.beneficiary_type, l.beneficiary_id, l.beneficiary_name, l.beneficiary_bank_ref,
        l.payable_component_code, l.payable_gl_account_id, a.code AS payable_gl_account_code, a.name AS payable_gl_account_name,
        l.payable_ref, l.amount, l.settled_amount, l.outstanding_amount,
        l.currency_code, l.status, l.reserved_payment_batch_id, l.paid_at,
        pl.id AS payment_link_id,
        pl.beneficiary_bank_snapshot_id,
        pl.beneficiary_snapshot_status,
        l.created_at, l.updated_at
     FROM payroll_run_liabilities l
     LEFT JOIN accounts a ON a.id = l.payable_gl_account_id
     LEFT JOIN operating_units ou
       ON ou.id = l.operating_unit_id
      AND ou.tenant_id = l.tenant_id
     LEFT JOIN payroll_liability_payment_links pl
       ON pl.tenant_id = l.tenant_id
      AND pl.legal_entity_id = l.legal_entity_id
      AND pl.run_id = l.run_id
      AND pl.payroll_liability_id = l.id
      AND pl.id = (
        SELECT pl2.id
        FROM payroll_liability_payment_links pl2
        WHERE pl2.tenant_id = l.tenant_id
          AND pl2.legal_entity_id = l.legal_entity_id
          AND pl2.run_id = l.run_id
          AND pl2.payroll_liability_id = l.id
        ORDER BY pl2.id DESC
        LIMIT 1
      )
     WHERE l.tenant_id = ? AND l.run_id = ?
     ORDER BY CASE WHEN l.liability_group = 'EMPLOYEE_NET' THEN 0 ELSE 1 END, l.id ASC`,
    [tenantId, runId]
  );
  return (result.rows || []).map((row) => ({
    ...row,
    owner_context_label: formatOwnerContextLabel(row),
    beneficiary_snapshot_status: row.beneficiary_snapshot_status || null,
    beneficiary_ready_for_payment: Boolean(
      parsePositiveInt(row.beneficiary_bank_snapshot_id) ||
        normalizeUpperText(row.beneficiary_snapshot_status) === "NOT_REQUIRED"
    ),
  }));
}

async function getRunLiabilitySummary(tenantId, runId, runQuery = query) {
  const result = await runQuery(
    `SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(amount), 0) AS total_amount,
        COALESCE(SUM(CASE WHEN status = 'OPEN' THEN amount ELSE 0 END), 0) AS total_open,
        COALESCE(SUM(CASE WHEN status = 'IN_BATCH' THEN amount ELSE 0 END), 0) AS total_in_batch,
        COALESCE(SUM(CASE WHEN status = 'PARTIALLY_PAID' THEN amount ELSE 0 END), 0) AS total_partially_paid,
        COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN amount ELSE 0 END), 0) AS total_cancelled,
        COALESCE(SUM(CASE WHEN status = 'PARTIALLY_PAID' THEN outstanding_amount ELSE 0 END), 0)
          AS total_partially_paid_outstanding,
        COALESCE(SUM(CASE WHEN status IN ('OPEN','IN_BATCH','PARTIALLY_PAID') THEN outstanding_amount ELSE 0 END), 0)
          AS total_outstanding,
        COALESCE(SUM(CASE WHEN liability_group = 'EMPLOYEE_NET' THEN amount ELSE 0 END), 0) AS total_employee_net,
        COALESCE(SUM(CASE WHEN liability_group = 'STATUTORY' THEN amount ELSE 0 END), 0) AS total_statutory
     FROM payroll_run_liabilities
     WHERE tenant_id = ? AND run_id = ?`,
    [tenantId, runId]
  );
  const row = result.rows?.[0] || {};
  return {
    total_count: Number(row.total_count || 0),
    total_amount: toAmount(row.total_amount || 0),
    total_open: toAmount(row.total_open || 0),
    total_in_batch: toAmount(row.total_in_batch || 0),
    total_partially_paid: toAmount(row.total_partially_paid || 0),
    total_paid: toAmount(row.total_paid || 0),
    total_cancelled: toAmount(row.total_cancelled || 0),
    total_partially_paid_outstanding: toAmount(row.total_partially_paid_outstanding || 0),
    total_outstanding: toAmount(row.total_outstanding || 0),
    total_employee_net: toAmount(row.total_employee_net || 0),
    total_statutory: toAmount(row.total_statutory || 0),
  };
}

async function listRunLiabilityAudit(tenantId, runId, runQuery = query) {
  const result = await runQuery(
    `SELECT
        id, tenant_id, legal_entity_id, run_id, payroll_liability_id,
        action, payload_json, acted_by_user_id, acted_at
     FROM payroll_liability_audit
     WHERE tenant_id = ? AND run_id = ?
     ORDER BY id DESC`,
    [tenantId, runId]
  );
  return (result.rows || []).map((row) => ({
    ...row,
    payload_json: parseOptionalJson(row.payload_json),
  }));
}

async function getRunLiabilityDetailOrThrow(tenantId, runId, runQuery = query) {
  const run = await getRun(tenantId, runId, runQuery);
  if (!run) {
    throw badRequest("Payroll run not found");
  }
  const [items, summary, audit] = await Promise.all([
    listRunLiabilities(tenantId, runId, runQuery),
    getRunLiabilitySummary(tenantId, runId, runQuery),
    listRunLiabilityAudit(tenantId, runId, runQuery),
  ]);
  return { run, items, summary, audit };
}

function validateMappingForLiability(mapping, run, expectedEntrySide = "CREDIT") {
  const issues = [];
  if (!mapping) return ["missing_mapping"];
  if (normalizeUpperText(mapping.entry_side) !== normalizeUpperText(expectedEntrySide)) {
    issues.push(`mapping_entry_side_mismatch_expected_${normalizeUpperText(expectedEntrySide)}`);
  }
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

function buildLiabilityOwnerContextFromLine(line) {
  return normalizeOwnershipContextRow(line);
}

async function resolvePayableMappingsForRun(run, runQuery = query) {
  const componentCodes = Array.from(
    new Set(Object.values(LIABILITY_DEFS).map((def) => def.payableComponentCode))
  );
  const map = new Map();
  for (const componentCode of componentCodes) {
    // eslint-disable-next-line no-await-in-loop
    const mapping = await findApplicablePayrollComponentMapping({
      tenantId: parsePositiveInt(run.tenant_id),
      legalEntityId: parsePositiveInt(run.legal_entity_id),
      providerCode: run.provider_code,
      currencyCode: normalizeUpperText(run.currency_code),
      componentCode,
      asOfDate: toDateOnly(run.pay_date),
      runQuery,
    });
    map.set(componentCode, mapping || null);
  }
  return map;
}

function buildLiabilityRowsForRun(run, runLines, mappingsByComponent) {
  const rows = [];

  const netDef = LIABILITY_DEFS.NET_PAY;
  const netMapping = mappingsByComponent.get(netDef.payableComponentCode) || null;
  for (const line of runLines || []) {
    const amount = toAmount(line?.[netDef.lineSourceField] || 0);
    if (!(amount > 0)) continue;
    const ownerContext = buildLiabilityOwnerContextFromLine(line);
    rows.push({
      liability_key: liabilityKeyForEmployeeNet(run, line),
      liability_type: netDef.liabilityType,
      liability_group: netDef.liabilityGroup,
      source_run_line_id: parsePositiveInt(line.id),
      employee_code: line.employee_code || null,
      employee_name: line.employee_name || null,
      cost_center_code: line.cost_center_code || null,
      ownership_scope: ownerContext.ownership_scope,
      operating_unit_id: ownerContext.operating_unit_id,
      operating_unit_code: ownerContext.operating_unit_code,
      operating_unit_name: ownerContext.operating_unit_name,
      beneficiary_type: netDef.beneficiaryType,
      beneficiary_id: null,
      beneficiary_name: line.employee_name || line.employee_code || "Employee",
      beneficiary_bank_ref: null,
      payable_component_code: netDef.payableComponentCode,
      payable_mapping: netMapping,
      payable_gl_account_id: parsePositiveInt(netMapping?.gl_account_id) || null,
      payable_ref: `${run.run_no}-EMP-${String(line.employee_code || line.id)}`.slice(0, 120),
      amount,
      currency_code: normalizeUpperText(run.currency_code),
      expected_entry_side: netDef.expectedEntrySide,
    });
  }

  for (const type of STATUTORY_TYPES) {
    const def = LIABILITY_DEFS[type];
    const mapping = mappingsByComponent.get(def.payableComponentCode) || null;
    const groupedRows = new Map();

    for (const line of runLines || []) {
      const amount = toAmount(line?.[def.lineSourceField] || 0);
      if (!(amount > 0)) continue;
      const ownerContext = buildLiabilityOwnerContextFromLine(line);
      const groupingKey = [
        def.liabilityType,
        buildOwnershipContextToken(ownerContext),
      ].join("|");

      if (!groupedRows.has(groupingKey)) {
        groupedRows.set(groupingKey, {
          liability_key: liabilityKeyForAggregate(run, def.liabilityType, ownerContext),
          liability_type: def.liabilityType,
          liability_group: def.liabilityGroup,
          source_run_line_id: null,
          employee_code: null,
          employee_name: null,
          cost_center_code: null,
          ownership_scope: ownerContext.ownership_scope,
          operating_unit_id: ownerContext.operating_unit_id,
          operating_unit_code: ownerContext.operating_unit_code,
          operating_unit_name: ownerContext.operating_unit_name,
          beneficiary_type: def.beneficiaryType,
          beneficiary_id: null,
          beneficiary_name: def.beneficiaryName,
          beneficiary_bank_ref: null,
          payable_component_code: def.payableComponentCode,
          payable_mapping: mapping,
          payable_gl_account_id: parsePositiveInt(mapping?.gl_account_id) || null,
          payable_ref: `${run.run_no}-${def.liabilityType}-${buildOwnershipContextToken(ownerContext)}`.slice(
            0,
            120
          ),
          amount: 0,
          currency_code: normalizeUpperText(run.currency_code),
          expected_entry_side: def.expectedEntrySide,
        });
      }

      const current = groupedRows.get(groupingKey);
      current.amount = toAmount(current.amount + amount);
      if (!current.operating_unit_code) {
        current.operating_unit_code = ownerContext.operating_unit_code;
      }
      if (!current.operating_unit_name) {
        current.operating_unit_name = ownerContext.operating_unit_name;
      }
    }

    rows.push(...Array.from(groupedRows.values()).filter((row) => row.amount > 0));
  }

  return rows;
}

function collectLiabilityBuildValidationIssues(rows, run) {
  const issues = [];
  for (const row of rows) {
    const ownerContextIssues = validateOwnershipContext(row);
    const mappingIssues = validateMappingForLiability(
      row.payable_mapping,
      run,
      row.expected_entry_side
    );
    const rowIssues = [...ownerContextIssues, ...mappingIssues];
    if (rowIssues.length > 0) {
      issues.push({
        liability_type: row.liability_type,
        payable_component_code: row.payable_component_code,
        source_run_line_id: row.source_run_line_id || null,
        employee_code: row.employee_code || null,
        ownership_scope: row.ownership_scope || null,
        operating_unit_id: parsePositiveInt(row.operating_unit_id),
        amount: row.amount,
        issues: rowIssues,
      });
    }
  }
  return issues;
}

function toPaymentBatchLineFromLiability(liability) {
  return {
    beneficiaryType: normalizeUpperText(liability.beneficiary_type),
    beneficiaryId: parsePositiveInt(liability.beneficiary_id),
    beneficiaryName: liability.beneficiary_name,
    beneficiaryBankRef: liability.beneficiary_bank_ref || null,
    payableEntityType: "PAYROLL_LIABILITY",
    payableEntityId: parsePositiveInt(liability.id),
    payableGlAccountId: parsePositiveInt(liability.payable_gl_account_id),
    payableRef: liability.payable_ref || liability.liability_key || null,
    amount: amountString(liability.amount),
    notes:
      normalizeUpperText(liability.liability_group) === LIABILITY_GROUP_NET
        ? "Payroll net salary liability"
        : `Payroll ${liability.liability_type} liability`,
  };
}

async function buildPaymentBatchPreviewInternal(
  tenantId,
  runId,
  scope,
  optionsOrRunQuery = query,
  maybeRunQuery = query
) {
  const options =
    typeof optionsOrRunQuery === "function" ? {} : optionsOrRunQuery || {};
  const runQuery =
    typeof optionsOrRunQuery === "function" ? optionsOrRunQuery : maybeRunQuery;
  const run = await getRun(tenantId, runId, runQuery);
  if (!run) throw badRequest("Payroll run not found");
  const normalizedScope = normalizeScope(scope);
  const allLiabilities = await listRunLiabilities(tenantId, runId, runQuery);
  const eligible = allLiabilities.filter(
    (liability) =>
      normalizeUpperText(liability.status) === "OPEN" &&
      matchesScope(liability.liability_group, normalizedScope)
  );
  const totalAmount = toAmount(eligible.reduce((sum, item) => sum + toAmount(item.amount), 0));
  const lines = eligible.map(toPaymentBatchLineFromLiability);
  const selectedBankAccount = options.bankAccountId
    ? await findPayrollPaymentBankAccount(tenantId, options.bankAccountId, runQuery)
    : null;
  const bankEvaluation = evaluateSelectedBankForPaymentPreview({
    run,
    eligibleLiabilities: eligible,
    selectedBankAccount,
  });

  return {
    run: {
      id: parsePositiveInt(run.id),
      run_no: run.run_no,
      legal_entity_id: parsePositiveInt(run.legal_entity_id),
      legal_entity_code: run.legal_entity_code || run.entity_code || null,
      legal_entity_name: run.legal_entity_name || null,
      currency_code: normalizeUpperText(run.currency_code),
      status: normalizeUpperText(run.status),
      pay_date: run.pay_date,
      liabilities_built_at: run.liabilities_built_at || null,
    },
    scope: normalizedScope,
    eligible_liability_count: eligible.length,
    total_amount: totalAmount,
    can_prepare_payment_batch: eligible.length > 0,
    can_prepare_with_selected_bank: bankEvaluation.can_prepare_with_selected_bank,
    default_idempotency_key: `payroll-run-${runId}-${normalizedScope.toLowerCase()}`,
    selected_bank_account: bankEvaluation.selected_bank_account,
    owner_context_summary: bankEvaluation.owner_context_summary,
    selected_bank_evaluation: bankEvaluation.selected_bank_evaluation,
    eligible_liabilities: bankEvaluation.eligible_liabilities.map((liability) => ({
      id: parsePositiveInt(liability.id),
      liability_type: liability.liability_type,
      liability_group: liability.liability_group,
      ownership_scope: liability.ownership_scope || null,
      operating_unit_id: parsePositiveInt(liability.operating_unit_id),
      operating_unit_code: liability.operating_unit_code || null,
      operating_unit_name: liability.operating_unit_name || null,
      owner_context_label: formatOwnerContextLabel(liability),
      employee_code: liability.employee_code || null,
      employee_name: liability.employee_name || null,
      beneficiary_name: liability.beneficiary_name,
      beneficiary_type: liability.beneficiary_type,
      payable_gl_account_id: parsePositiveInt(liability.payable_gl_account_id),
      amount: toAmount(liability.amount),
      status: liability.status,
      selected_bank_settlement_mode: liability.selected_bank_settlement_mode || null,
      selected_bank_allowed: liability.selected_bank_allowed ?? null,
      selected_bank_requires_self_balancing:
        liability.selected_bank_requires_self_balancing ?? null,
    })),
    batch_payload_template: {
      sourceType: "PAYROLL",
      sourceId: parsePositiveInt(run.id),
      currencyCode: normalizeUpperText(run.currency_code),
      lineCount: lines.length,
      totalAmount,
      lines,
    },
  };
}

function assertSelectedBankEvaluationCanPrepare(preview) {
  const errors = Array.isArray(preview?.selected_bank_evaluation?.validation_errors)
    ? preview.selected_bank_evaluation.validation_errors
    : [];
  if (errors.length === 0) {
    return;
  }
  throw badRequest(
    `Selected bank account cannot prepare payroll payment batch: ${errors
      .map((item) => String(item?.message || "").trim())
      .filter(Boolean)
      .join("; ")}`
  );
}

function inClause(values) {
  const list = (values || []).map((v) => parsePositiveInt(v)).filter(Boolean);
  if (list.length === 0) return null;
  return { list, placeholders: list.map(() => "?").join(", ") };
}

async function getBatchLinesForBatch(tenantId, legalEntityId, batchId, runQuery = query) {
  const result = await runQuery(
    `SELECT
        id, tenant_id, legal_entity_id, batch_id, line_no,
        payable_entity_type, payable_entity_id, amount, status
     FROM payment_batch_lines
     WHERE tenant_id = ? AND legal_entity_id = ? AND batch_id = ?`,
    [tenantId, legalEntityId, batchId]
  );
  return result.rows || [];
}

async function getPayrollLiabilityPaymentLinkByBatch(
  tenantId,
  legalEntityId,
  runId,
  liabilityId,
  batchId,
  runQuery = query
) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        run_id,
        payroll_liability_id,
        payment_batch_id,
        payment_batch_line_id,
        beneficiary_bank_snapshot_id,
        beneficiary_snapshot_status
     FROM payroll_liability_payment_links
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND run_id = ?
       AND payroll_liability_id = ?
       AND payment_batch_id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, runId, liabilityId, batchId]
  );
  return result.rows?.[0] || null;
}

async function findPayrollPaymentBankAccount(tenantId, bankAccountId, runQuery = query) {
  const result = await runQuery(
    `SELECT
        ba.id,
        ba.tenant_id,
        ba.legal_entity_id,
        ba.operating_unit_id,
        ba.code,
        ba.name,
        ba.currency_code,
        ba.is_active,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
     FROM bank_accounts ba
     LEFT JOIN operating_units ou
       ON ou.id = ba.operating_unit_id
      AND ou.tenant_id = ba.tenant_id
     WHERE ba.tenant_id = ?
       AND ba.id = ?
     LIMIT 1`,
    [tenantId, bankAccountId]
  );
  return result.rows?.[0] || null;
}

function evaluateSelectedBankForPaymentPreview({
  run,
  eligibleLiabilities,
  selectedBankAccount,
}) {
  if (!selectedBankAccount) {
    return {
      owner_context_summary: summarizeLiabilityOwnerContexts(eligibleLiabilities),
      selected_bank_account: null,
      selected_bank_evaluation: null,
      can_prepare_with_selected_bank: null,
      eligible_liabilities: (eligibleLiabilities || []).map((liability) => ({
        ...liability,
        selected_bank_settlement_mode: null,
        selected_bank_allowed: null,
        selected_bank_requires_self_balancing: null,
      })),
    };
  }

  const bankPreview = buildSelectedBankAccountPreviewRow(selectedBankAccount);
  if (!bankPreview?.id) {
    throw badRequest("bankAccountId not found");
  }
  if (bankPreview.legal_entity_id !== parsePositiveInt(run?.legal_entity_id)) {
    throw badRequest("bankAccountId does not belong to the payroll run legal entity");
  }

  const ownerContextSummary = summarizeLiabilityOwnerContexts(eligibleLiabilities, bankPreview);
  const liabilitySettlements = (eligibleLiabilities || []).map((liability) => {
    const settlement = evaluatePayerContextAgainstOwnerContext(bankPreview, liability);
    return {
      ...liability,
      selected_bank_settlement_mode: settlement.settlement_mode,
      selected_bank_allowed: settlement.allowed,
      selected_bank_requires_self_balancing: settlement.requires_self_balancing,
    };
  });

  const validationErrors = [];
  if (!bankPreview.is_active) {
    validationErrors.push(
      buildPaymentPrepValidationError(
        "BANK_ACCOUNT_INACTIVE",
        "Selected bank account is inactive"
      )
    );
  }
  if (
    normalizeUpperText(bankPreview.currency_code) !== normalizeUpperText(run?.currency_code)
  ) {
    validationErrors.push(
      buildPaymentPrepValidationError(
        "BANK_ACCOUNT_CURRENCY_MISMATCH",
        `Selected bank currency ${bankPreview.currency_code || "-"} does not match payroll run currency ${normalizeUpperText(run?.currency_code) || "-"}`
      )
    );
  }

  const outOfScopeLiabilityCount = liabilitySettlements.filter(
    (liability) => liability.selected_bank_allowed === false
  ).length;
  const crossContextLiabilityCount = liabilitySettlements.filter(
    (liability) => liability.selected_bank_settlement_mode === "CROSS_CONTEXT_SELF_BALANCING"
  ).length;
  const sameContextLiabilityCount = liabilitySettlements.filter(
    (liability) => liability.selected_bank_settlement_mode === "SAME_CONTEXT"
  ).length;
  const mixedOwnerContext = ownerContextSummary.length > 1;

  if (bankPreview.payer_context_scope === "OPERATING_UNIT" && mixedOwnerContext) {
    validationErrors.push(
      buildPaymentPrepValidationError(
        "OU_BANK_MIXED_OWNER_CONTEXT_NOT_ALLOWED",
        "OU bank payment is not allowed when selected payroll liabilities span multiple owner contexts"
      )
    );
  }
  if (bankPreview.payer_context_scope === "OPERATING_UNIT" && outOfScopeLiabilityCount > 0) {
    validationErrors.push(
      buildPaymentPrepValidationError(
        "OU_BANK_OTHER_OU_NOT_ALLOWED",
        "OU bank payment is only allowed for central-owned liabilities or liabilities owned by the same OU"
      )
    );
  }

  let settlementMode = "NONE";
  if ((eligibleLiabilities || []).length > 0) {
    if (validationErrors.length > 0) {
      settlementMode = "NOT_ALLOWED";
    } else if (crossContextLiabilityCount > 0) {
      settlementMode = "CROSS_CONTEXT_SELF_BALANCING";
    } else {
      settlementMode = "SAME_CONTEXT";
    }
  }

  return {
    owner_context_summary: ownerContextSummary,
    selected_bank_account: bankPreview,
    selected_bank_evaluation: {
      bank_account_id: bankPreview.id,
      payer_context_scope: bankPreview.payer_context_scope,
      payer_context_label: bankPreview.payer_context_label,
      settlement_mode: settlementMode,
      mixed_owner_context: mixedOwnerContext,
      same_context_liability_count: sameContextLiabilityCount,
      cross_context_liability_count: crossContextLiabilityCount,
      out_of_scope_liability_count: outOfScopeLiabilityCount,
      requires_self_balancing:
        settlementMode === "CROSS_CONTEXT_SELF_BALANCING" && validationErrors.length === 0,
      can_prepare_payment_batch:
        (eligibleLiabilities || []).length > 0 && validationErrors.length === 0,
      validation_errors: validationErrors,
    },
    can_prepare_with_selected_bank:
      (eligibleLiabilities || []).length > 0 && validationErrors.length === 0,
    eligible_liabilities: liabilitySettlements,
  };
}

async function linkBatchToLiabilitiesTx(tx, {
  tenantId,
  legalEntityId,
  runId,
  userId,
  run,
  batch,
  preview,
}) {
  const liabilityIds = (preview.eligible_liabilities || []).map((item) => item.id).filter(Boolean);
  const clause = inClause(liabilityIds);
  if (!clause) {
    return { linkedCount: 0, statusUpdatedCount: 0 };
  }

  const lockedResult = await tx.query(
    `SELECT
        id, status, reserved_payment_batch_id, amount, liability_type, liability_group,
        beneficiary_type, employee_code, employee_name, currency_code
     FROM payroll_run_liabilities
     WHERE tenant_id = ? AND legal_entity_id = ? AND run_id = ? AND id IN (${clause.placeholders})
     FOR UPDATE`,
    [tenantId, legalEntityId, runId, ...clause.list]
  );
  const liabilityById = new Map((lockedResult.rows || []).map((row) => [parsePositiveInt(row.id), row]));

  const batchLines = await getBatchLinesForBatch(
    tenantId,
    legalEntityId,
    parsePositiveInt(batch.id),
    tx.query
  );
  const batchLineByLiabilityId = new Map();
  for (const line of batchLines) {
    if (normalizeUpperText(line.payable_entity_type) !== "PAYROLL_LIABILITY") continue;
    const liabilityId = parsePositiveInt(line.payable_entity_id);
    if (!liabilityId) continue;
    batchLineByLiabilityId.set(liabilityId, line);
  }

  let linkedCount = 0;
  let statusUpdatedCount = 0;

  for (const liabilityPreview of preview.eligible_liabilities || []) {
    const liabilityId = parsePositiveInt(liabilityPreview.id);
    const current = liabilityById.get(liabilityId);
    if (!current) throw badRequest(`Payroll liability ${liabilityId} not found`);
    const batchLine = batchLineByLiabilityId.get(liabilityId);
    if (!batchLine) throw badRequest(`Payment batch line missing for payroll liability ${liabilityId}`);

    if (toAmount(current.amount) !== toAmount(batchLine.amount)) {
      throw badRequest(`Amount mismatch for payroll liability ${liabilityId}`);
    }

    const status = normalizeUpperText(current.status);
    const reservedBatchId = parsePositiveInt(current.reserved_payment_batch_id);
    const batchId = parsePositiveInt(batch.id);
    if (["PAID", "CANCELLED"].includes(status)) {
      throw conflictError(`Payroll liability ${liabilityId} cannot be linked from status ${status}`);
    }
    if (status === "IN_BATCH" && reservedBatchId && reservedBatchId !== batchId) {
      throw conflictError(
        `Payroll liability ${liabilityId} already reserved in batch ${reservedBatchId}`
      );
    }

    const ins = await tx.query(
      `INSERT IGNORE INTO payroll_liability_payment_links (
          tenant_id, legal_entity_id, run_id, payroll_liability_id, payment_batch_id,
          payment_batch_line_id, allocated_amount, status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'LINKED')`,
      [
        tenantId,
        legalEntityId,
        runId,
        liabilityId,
        batchId,
        parsePositiveInt(batchLine.id),
        amountString(current.amount),
      ]
    );
    const inserted = Number(ins.rows?.affectedRows || 0) > 0;
    if (inserted) linkedCount += 1;

    let paymentLinkId = parsePositiveInt(ins.rows?.insertId);
    if (!paymentLinkId) {
      const existingLink = await getPayrollLiabilityPaymentLinkByBatch(
        tenantId,
        legalEntityId,
        runId,
        liabilityId,
        batchId,
        tx.query
      );
      paymentLinkId = parsePositiveInt(existingLink?.id);
    }
    if (!paymentLinkId) {
      throw new Error(`Failed to resolve payroll liability payment link for liability ${liabilityId}`);
    }

    const upd = await tx.query(
      `UPDATE payroll_run_liabilities
       SET status = 'IN_BATCH',
           reserved_payment_batch_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND legal_entity_id = ? AND id = ?
         AND (status = 'OPEN' OR (status = 'IN_BATCH' AND reserved_payment_batch_id = ?))`,
      [batchId, tenantId, legalEntityId, liabilityId, batchId]
    );
    if (Number(upd.rows?.affectedRows || 0) > 0) statusUpdatedCount += 1;

    const beneficiaryType = normalizeUpperText(current.beneficiary_type);
    if (beneficiaryType === "EMPLOYEE") {
      try {
        await attachPayrollBeneficiarySnapshotToLinkTx({
          tenantId,
          legalEntityId,
          paymentLinkId,
          paymentBatchLineId: parsePositiveInt(batchLine.id),
          payrollLiabilityId: liabilityId,
          beneficiaryType,
          employeeCode: current.employee_code || null,
          employeeName: current.employee_name || null,
          currencyCode: current.currency_code || preview?.run?.currency_code || run?.currency_code || null,
          asOfDate: run?.pay_date || preview?.run?.pay_date || null,
          userId,
          runQuery: tx.query,
        });
      } catch (err) {
        if (err?.code === "PAYROLL_BENEFICIARY_MISSING") {
          err.details = {
            ...(err.details || {}),
            payroll_liability_id: liabilityId,
            employee_code: current.employee_code || null,
            payment_batch_id: batchId,
          };
        }
        throw err;
      }
    } else {
      await markPayrollBeneficiarySnapshotNotRequiredTx({
        tenantId,
        legalEntityId,
        paymentLinkId,
        runQuery: tx.query,
      });
    }

    if (inserted) {
      await writeLiabilityAudit({
        tenantId,
        legalEntityId,
        runId,
        liabilityId,
        action: "LINKED_BATCH",
        payload: {
          paymentBatchId: batchId,
          paymentBatchLineId: parsePositiveInt(batchLine.id),
          allocatedAmount: toAmount(current.amount),
          beneficiarySnapshotStatus:
            beneficiaryType === "EMPLOYEE" ? "CAPTURED" : "NOT_REQUIRED",
        },
        userId,
        runQuery: tx.query,
      });
    }
  }

  return { linkedCount, statusUpdatedCount };
}

export async function listPayrollLiabilityRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["l.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "l.legal_entity_id", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("l.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.runId) {
    conditions.push("l.run_id = ?");
    params.push(filters.runId);
  }
  if (filters.status) {
    conditions.push("l.status = ?");
    params.push(filters.status);
  }
  if (filters.liabilityType) {
    conditions.push("l.liability_type = ?");
    params.push(filters.liabilityType);
  }
  if (filters.ownershipScope) {
    conditions.push("l.ownership_scope = ?");
    params.push(filters.ownershipScope);
  }
  if (filters.operatingUnitId) {
    conditions.push("l.operating_unit_id = ?");
    params.push(filters.operatingUnitId);
  }
  if (filters.scope === "NET_PAY") {
    conditions.push("l.liability_group = 'EMPLOYEE_NET'");
  } else if (filters.scope === "STATUTORY") {
    conditions.push("l.liability_group = 'STATUTORY'");
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(
      "(l.employee_code LIKE ? OR l.employee_name LIKE ? OR l.beneficiary_name LIKE ? OR l.liability_type LIKE ?)"
    );
    params.push(like, like, like, like);
  }

  const baseConditions = [...conditions];
  const baseParams = [...params];
  const cursorToken = filters.cursor || null;
  const cursor = decodeCursorToken(cursorToken);
  const pageConditions = [...baseConditions];
  const pageParams = [...baseParams];
  if (cursorToken) {
    const cursorId = requireCursorId(cursor, "id");
    pageConditions.push("l.id < ?");
    pageParams.push(cursorId);
  }
  const whereSql = pageConditions.join(" AND ");
  const countWhereSql = baseConditions.join(" AND ");
  const countResult = await query(
    `SELECT COUNT(*) AS total FROM payroll_run_liabilities l WHERE ${countWhereSql}`,
    baseParams
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const safeLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 200;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
  const effectiveOffset = cursorToken ? 0 : safeOffset;

  const listResult = await query(
    `SELECT
        l.id, l.tenant_id, l.legal_entity_id, l.run_id, l.liability_type, l.liability_group,
        l.ownership_scope, l.operating_unit_id, ou.code AS operating_unit_code, ou.name AS operating_unit_name,
        l.employee_code, l.employee_name, l.beneficiary_type, l.beneficiary_name,
        l.amount, l.settled_amount, l.outstanding_amount,
        l.currency_code, l.status, l.reserved_payment_batch_id,
        l.payable_component_code, l.payable_gl_account_id, a.code AS payable_gl_account_code,
        pl.id AS payment_link_id,
        pl.beneficiary_bank_snapshot_id,
        pl.beneficiary_snapshot_status
     FROM payroll_run_liabilities l
     LEFT JOIN accounts a ON a.id = l.payable_gl_account_id
     LEFT JOIN operating_units ou
       ON ou.id = l.operating_unit_id
      AND ou.tenant_id = l.tenant_id
     LEFT JOIN payroll_liability_payment_links pl
       ON pl.tenant_id = l.tenant_id
      AND pl.legal_entity_id = l.legal_entity_id
      AND pl.run_id = l.run_id
      AND pl.payroll_liability_id = l.id
      AND pl.id = (
        SELECT pl2.id
        FROM payroll_liability_payment_links pl2
        WHERE pl2.tenant_id = l.tenant_id
          AND pl2.legal_entity_id = l.legal_entity_id
          AND pl2.run_id = l.run_id
          AND pl2.payroll_liability_id = l.id
        ORDER BY pl2.id DESC
        LIMIT 1
      )
     WHERE ${whereSql}
     ORDER BY l.id DESC
     LIMIT ${safeLimit} OFFSET ${effectiveOffset}`,
    pageParams
  );

  const rawRows = listResult.rows || [];
  const lastRow = rawRows.length > 0 ? rawRows[rawRows.length - 1] : null;
  const nextCursor =
    cursorToken || safeOffset === 0
      ? rawRows.length === safeLimit && lastRow
        ? encodeCursorToken({ id: parsePositiveInt(lastRow.id) })
        : null
      : null;

  return {
    rows: rawRows.map((row) => ({
      ...row,
      owner_context_label: formatOwnerContextLabel(row),
      beneficiary_snapshot_status: row.beneficiary_snapshot_status || null,
      beneficiary_ready_for_payment: Boolean(
        parsePositiveInt(row.beneficiary_bank_snapshot_id) ||
          normalizeUpperText(row.beneficiary_snapshot_status) === "NOT_REQUIRED"
      ),
    })),
    total,
    limit: filters.limit,
    offset: cursorToken ? 0 : filters.offset,
    pageMode: cursorToken ? "CURSOR" : "OFFSET",
    nextCursor,
  };
}

export async function getPayrollRunLiabilitiesDetail({
  req,
  tenantId,
  runId,
  assertScopeAccess,
}) {
  const detail = await getRunLiabilityDetailOrThrow(tenantId, runId);
  assertScopeAccess(req, "legal_entity", parsePositiveInt(detail.run.legal_entity_id), "runId");
  return detail;
}

export async function buildPayrollRunLiabilities({
  req,
  tenantId,
  runId,
  userId,
  note,
  assertScopeAccess,
}) {
  let alreadyBuilt = false;

  await withTransaction(async (tx) => {
    const run = await getRunForUpdate(tenantId, runId, tx.query);
    if (!run) throw badRequest("Payroll run not found");
    assertScopeAccess(req, "legal_entity", parsePositiveInt(run.legal_entity_id), "runId");

    if (normalizeUpperText(run.status) !== "FINALIZED" || !parsePositiveInt(run.accrual_journal_entry_id)) {
      throw badRequest("Payroll run must be FINALIZED with accrual journal before building liabilities");
    }

    const existing = await countRunLiabilities(tenantId, runId, tx.query);
    if (existing > 0) {
      alreadyBuilt = true;
      return;
    }

    const runLines = await getRunLines(tenantId, runId, tx.query);
    const mappings = await resolvePayableMappingsForRun(run, tx.query);
    const liabilityRows = buildLiabilityRowsForRun(run, runLines, mappings);
    const issues = collectLiabilityBuildValidationIssues(liabilityRows, run);
    if (issues.length > 0) {
      await writeLiabilityAudit({
        tenantId,
        legalEntityId: parsePositiveInt(run.legal_entity_id),
        runId,
        action: "VALIDATION",
        payload: {
          type: "LIABILITY_BUILD_BLOCKED",
          reason: "INVALID_PAYABLE_MAPPING_OR_OWNER_CONTEXT",
          issues,
        },
        userId,
        runQuery: tx.query,
      });
      throw badRequest(
        "Payroll liability build blocked due to missing/invalid payable mappings or owner context"
      );
    }

    let builtCount = 0;
    let builtTotal = 0;
    for (const row of liabilityRows) {
      const ins = await tx.query(
        `INSERT INTO payroll_run_liabilities (
            tenant_id, legal_entity_id, run_id, liability_key, liability_type, liability_group,
            source_run_line_id, employee_code, employee_name, cost_center_code, ownership_scope, operating_unit_id,
            beneficiary_type, beneficiary_id, beneficiary_name, beneficiary_bank_ref,
            payable_component_code, payable_gl_account_id, payable_ref,
            amount, settled_amount, outstanding_amount, currency_code, status
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
        [
          tenantId,
          parsePositiveInt(run.legal_entity_id),
          runId,
          row.liability_key,
          row.liability_type,
          row.liability_group,
          row.source_run_line_id,
          row.employee_code,
          row.employee_name,
          row.cost_center_code,
          row.ownership_scope,
          row.operating_unit_id,
          row.beneficiary_type,
          row.beneficiary_id,
          row.beneficiary_name,
          row.beneficiary_bank_ref,
          row.payable_component_code,
          row.payable_gl_account_id,
          row.payable_ref,
          amountString(row.amount),
          amountString(0),
          amountString(row.amount),
          normalizeUpperText(run.currency_code),
        ]
      );
      const liabilityId = parsePositiveInt(ins.rows?.insertId);
      if (!liabilityId) throw new Error("Failed to create payroll liability");
      builtCount += 1;
      builtTotal = toAmount(builtTotal + toAmount(row.amount));

      await writeLiabilityAudit({
        tenantId,
        legalEntityId: parsePositiveInt(run.legal_entity_id),
        runId,
        liabilityId,
        action: "BUILT",
        payload: {
          liabilityType: row.liability_type,
          liabilityGroup: row.liability_group,
          sourceRunLineId: row.source_run_line_id || null,
          employeeCode: row.employee_code || null,
          ownershipScope: row.ownership_scope || null,
          operatingUnitId: parsePositiveInt(row.operating_unit_id),
          payableComponentCode: row.payable_component_code,
          payableGlAccountId: row.payable_gl_account_id,
          amount: toAmount(row.amount),
        },
        userId,
        runQuery: tx.query,
      });
    }

    await tx.query(
      `UPDATE payroll_runs
       SET liabilities_built_by_user_id = ?, liabilities_built_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND id = ?`,
      [userId, tenantId, runId]
    );

    await writeLiabilityAudit({
      tenantId,
      legalEntityId: parsePositiveInt(run.legal_entity_id),
      runId,
      action: "BUILT",
      payload: { note: note || null, liabilityCount: builtCount, totalAmount: builtTotal },
      userId,
      runQuery: tx.query,
    });
  });

  const detail = await getPayrollRunLiabilitiesDetail({ req, tenantId, runId, assertScopeAccess });
  return { ...detail, alreadyBuilt };
}

export async function getPayrollRunLiabilityPaymentBatchPreview({
  req,
  tenantId,
  runId,
  scope,
  bankAccountId = null,
  assertScopeAccess,
}) {
  const run = await getRun(tenantId, runId);
  if (!run) throw badRequest("Payroll run not found");
  assertScopeAccess(req, "legal_entity", parsePositiveInt(run.legal_entity_id), "runId");

  if (normalizeUpperText(run.status) !== "FINALIZED") {
    throw badRequest("Payroll run must be FINALIZED before payment batch preparation preview");
  }

  const preview = await buildPaymentBatchPreviewInternal(tenantId, runId, scope, {
    bankAccountId,
  });
  const summary = await getRunLiabilitySummary(tenantId, runId);
  return { ...preview, summary };
}

export async function createPayrollRunPaymentBatchFromLiabilities({
  req,
  tenantId,
  runId,
  userId,
  input,
  assertScopeAccess,
}) {
  const run = await getRun(tenantId, runId);
  if (!run) throw badRequest("Payroll run not found");
  assertScopeAccess(req, "legal_entity", parsePositiveInt(run.legal_entity_id), "runId");

  if (normalizeUpperText(run.status) !== "FINALIZED") {
    throw badRequest("Payroll run must be FINALIZED before preparing payment batch");
  }

  await assertPayrollPeriodActionAllowed({
    tenantId,
    legalEntityId: parsePositiveInt(run.legal_entity_id),
    payrollPeriod: run.payroll_period,
    actionType: "PAYMENT_PREP_CREATE_BATCH",
  });

  const previewBefore = await buildPaymentBatchPreviewInternal(tenantId, runId, input.scope, {
    bankAccountId: input.bankAccountId,
  });
  if (!previewBefore.can_prepare_payment_batch) {
    throw badRequest("No eligible payroll liabilities to prepare into payment batch");
  }
  assertSelectedBankEvaluationCanPrepare(previewBefore);

  await assertPayrollBeneficiarySetupForLiabilities({
    tenantId,
    legalEntityId: parsePositiveInt(run.legal_entity_id),
    liabilities: previewBefore.eligible_liabilities || [],
    runCurrencyCode: run.currency_code,
    asOfDate: run.pay_date || null,
  });

  const idempotencyKey =
    input.idempotencyKey || previewBefore.default_idempotency_key || `payroll-run-${runId}`;

  const batch = await createPaymentBatch({
    req,
    payload: {
      tenantId,
      userId,
      sourceType: "PAYROLL",
      sourceId: runId,
      bankAccountId: input.bankAccountId,
      currencyCode: normalizeUpperText(run.currency_code),
      idempotencyKey,
      notes: input.notes || `Payroll ${previewBefore.scope} payment batch for ${run.run_no}`,
      lines: (previewBefore.batch_payload_template?.lines || []).map((line) => ({
        ...line,
        amount: amountString(line.amount),
      })),
    },
    assertScopeAccess,
  });

  if (!batch?.id) throw new Error("Failed to create payroll payment batch");
  if (normalizeUpperText(batch.source_type) !== "PAYROLL" || parsePositiveInt(batch.source_id) !== runId) {
    throw conflictError("Idempotency key resolved to another payment batch source");
  }

  const linkSummary = await withTransaction(async (tx) => {
    const currentRun = await getRunForUpdate(tenantId, runId, tx.query);
    if (!currentRun) throw badRequest("Payroll run not found");
    return linkBatchToLiabilitiesTx(tx, {
      tenantId,
      legalEntityId: parsePositiveInt(currentRun.legal_entity_id),
      runId,
      userId,
      run: currentRun,
      batch,
      preview: previewBefore,
    });
  });

  await writeLiabilityAudit({
    tenantId,
    legalEntityId: parsePositiveInt(run.legal_entity_id),
    runId,
    action: "LINKED_BATCH",
    payload: {
      scope: previewBefore.scope,
      paymentBatchId: parsePositiveInt(batch.id),
      paymentBatchNo: batch.batch_no || null,
      linkedCount: linkSummary.linkedCount,
      statusUpdatedCount: linkSummary.statusUpdatedCount,
      idempotencyKey,
    },
    userId,
  });

  const detail = await getPayrollRunLiabilitiesDetail({ req, tenantId, runId, assertScopeAccess });
  const previewAfter = await buildPaymentBatchPreviewInternal(tenantId, runId, input.scope, {
    bankAccountId: input.bankAccountId,
  });

  return {
    run: detail.run,
    liabilities: {
      items: detail.items,
      summary: detail.summary,
      audit: detail.audit,
    },
    batch,
    preview_before_prepare: previewBefore,
    preview_after_prepare: previewAfter,
    linkSummary: {
      ...linkSummary,
      paymentBatchId: parsePositiveInt(batch.id),
      paymentBatchNo: batch.batch_no || null,
      scope: previewBefore.scope,
      idempotencyKey,
    },
  };
}
