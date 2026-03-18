import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  finalizePayrollRunAccrual,
  getPayrollRunAccrualPreview,
  markPayrollRunReviewed,
} from "../src/services/payroll.accruals.service.js";
import {
  createPayrollCorrectionShell,
  reversePayrollRunWithCorrection,
} from "../src/services/payroll.corrections.service.js";
import { upsertPayrollComponentMapping } from "../src/services/payroll.mappings.service.js";
import {
  createPayrollOwnershipAssignment,
  resolvePayrollEmployeeOwnershipContext,
  updatePayrollOwnershipAssignment,
} from "../src/services/payroll.ownership.service.js";
import {
  getPayrollRunByIdForTenant,
  importPayrollRunCsv,
  listPayrollRunLineRows,
} from "../src/services/payroll.runs.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function noScopeGuard() {
  return true;
}

function allowAllScopeFilter() {
  return "1 = 1";
}

function buildOriginalCsv() {
  return [
    "employee_code,employee_name,cost_center_code,base_salary,overtime_pay,bonus_pay,allowances_total,gross_pay,employee_tax,employee_social_security,other_deductions,employer_tax,employer_social_security,net_pay",
    " emp001 ,Alpha User,CC-001,1000,0,0,0,1000,100,50,25,120,80,825",
    "emp002,Beta User,CC-002,1100,0,0,0,1100,120,55,25,130,85,900",
    "emp003,Gamma User,CC-003,900,0,0,0,900,90,45,15,100,70,750",
    "emp004,Delta User,CC-004,950,0,0,0,950,95,45,10,105,75,800",
    "emp005,Epsilon User,CC-005,980,0,0,0,980,98,48,14,108,78,820",
  ].join("\n");
}

function buildCorrectionShellCsv() {
  return [
    "employee_code,employee_name,cost_center_code,base_salary,overtime_pay,bonus_pay,allowances_total,gross_pay,employee_tax,employee_social_security,other_deductions,employer_tax,employer_social_security,net_pay",
    "emp006,Zeta User,CC-006,1000,0,0,0,1000,100,50,10,120,80,840",
  ].join("\n");
}

async function createFixtureTenant(stamp) {
  const tenantCode = `PPOU02_T_${stamp}`;
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `PPOU02 Tenant ${stamp}`]
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
  assert(countryId > 0, "Missing country seed row");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `PPOU02_G_${stamp}`, `PPOU02 Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU02_G_${stamp}`]
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
      `PPOU02_LE_${stamp}`,
      `PPOU02 Legal Entity ${stamp}`,
      countryId,
      currencyCode,
    ]
  );
  const legalEntityRows = await query(
    `SELECT id, code
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU02_LE_${stamp}`]
  );
  const legalEntityId = toNumber(legalEntityRows.rows?.[0]?.id);
  const legalEntityCode = String(legalEntityRows.rows?.[0]?.code || "");
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
    [tenantId, legalEntityId, `PPOU02_OU_${stamp}`, `PPOU02 OU ${stamp}`]
  );
  const operatingUnitRows = await query(
    `SELECT id, code
     FROM operating_units
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU02_OU_${stamp}`]
  );
  const operatingUnitId = toNumber(operatingUnitRows.rows?.[0]?.id);
  assert(operatingUnitId > 0, "Failed to create operating unit fixture");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id, code, name, year_start_month, year_start_day
      )
      VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `PPOU02_CAL_${stamp}`, `PPOU02 Calendar ${stamp}`]
  );
  const calendarRows = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU02_CAL_${stamp}`]
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
      `PPOU02_BOOK_${stamp}`,
      `PPOU02 Book ${stamp}`,
      currencyCode,
    ]
  );

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id, legal_entity_id, scope, code, name
      )
      VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, `PPOU02_COA_${stamp}`, `PPOU02 Chart ${stamp}`]
  );
  const coaRows = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU02_COA_${stamp}`]
  );
  const coaId = toNumber(coaRows.rows?.[0]?.id);
  assert(coaId > 0, "Failed to create chart fixture");

  await query(
    `INSERT INTO accounts (
        coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id, is_active
      )
      VALUES (?, ?, ?, 'EXPENSE', 'DEBIT', TRUE, NULL, TRUE)`,
    [coaId, `PPOU02EXP${stamp}`, `PPOU02 Expense ${stamp}`]
  );
  await query(
    `INSERT INTO accounts (
        coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id, is_active
      )
      VALUES (?, ?, ?, 'LIABILITY', 'CREDIT', TRUE, NULL, TRUE)`,
    [coaId, `PPOU02LIA${stamp}`, `PPOU02 Liability ${stamp}`]
  );
  const expenseRows = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND name = ?
     LIMIT 1`,
    [coaId, `PPOU02 Expense ${stamp}`]
  );
  const liabilityRows = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND name = ?
     LIMIT 1`,
    [coaId, `PPOU02 Liability ${stamp}`]
  );
  const expenseGlAccountId = toNumber(expenseRows.rows?.[0]?.id);
  const liabilityGlAccountId = toNumber(liabilityRows.rows?.[0]?.id);
  assert(expenseGlAccountId > 0 && liabilityGlAccountId > 0, "Failed to create GL fixtures");

  const passwordHash = await bcrypt.hash("PPOU02#Smoke123", 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `ppou02_user_${stamp}@example.com`, passwordHash, "PPOU02 User"]
  );
  const userRows = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, `ppou02_user_${stamp}@example.com`]
  );
  const userId = toNumber(userRows.rows?.[0]?.id);
  assert(userId > 0, "Failed to create user fixture");

  return {
    tenantId,
    legalEntityId,
    legalEntityCode,
    operatingUnitId,
    userId,
    currencyCode,
    expenseGlAccountId,
    liabilityGlAccountId,
  };
}

async function seedOwnershipAssignments(fixture) {
  const emp001 = await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP001",
      employeeNameSnapshot: "Alpha User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-001",
      sourceType: "MANUAL",
      notes: "Central owner",
    },
    assertScopeAccess: noScopeGuard,
  });

  const emp002 = await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP002",
      employeeNameSnapshot: "Beta User",
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: fixture.operatingUnitId,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-002",
      sourceType: "MANUAL",
      notes: "OU owner",
    },
    assertScopeAccess: noScopeGuard,
  });

  await query(
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
      VALUES
      (?, ?, 'EMP004', 'Delta User', 'CENTRAL', NULL, '2026-01-01', NULL, 'ACTIVE', NULL, 'MANUAL', 'Direct ambiguous row 1', ?, ?),
      (?, ?, 'EMP004', 'Delta User', 'OPERATING_UNIT', ?, '2026-01-01', NULL, 'ACTIVE', NULL, 'MANUAL', 'Direct ambiguous row 2', ?, ?)`,
    [
      fixture.tenantId,
      fixture.legalEntityId,
      fixture.userId,
      fixture.userId,
      fixture.tenantId,
      fixture.legalEntityId,
      fixture.operatingUnitId,
      fixture.userId,
      fixture.userId,
    ]
  );

  const emp005 = await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP005",
      employeeNameSnapshot: "Epsilon User",
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: fixture.operatingUnitId,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-999",
      sourceType: "MANUAL",
      notes: "Mismatch owner",
    },
    assertScopeAccess: noScopeGuard,
  });

  await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP006",
      employeeNameSnapshot: "Zeta User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-02-28",
      status: "ACTIVE",
      expectedCostCenterCode: "CC-006",
      sourceType: "MANUAL",
      notes: "Pre-March central owner",
    },
    assertScopeAccess: noScopeGuard,
  });
  await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP006",
      employeeNameSnapshot: "Zeta User",
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: fixture.operatingUnitId,
      effectiveFrom: "2026-03-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-006",
      sourceType: "MANUAL",
      notes: "Post-March OU owner",
    },
    assertScopeAccess: noScopeGuard,
  });

  return {
    emp001AssignmentId: toNumber(emp001?.item?.id),
    emp002AssignmentId: toNumber(emp002?.item?.id),
    emp005AssignmentId: toNumber(emp005?.item?.id),
  };
}

async function finalizeRunWithMappings({
  fixture,
  providerCode,
  runId,
}) {
  const preview = await getPayrollRunAccrualPreview({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    assertScopeAccess: noScopeGuard,
  });
  assert((preview?.component_totals || []).length > 0, "Accrual preview should return components");

  const uniquePreviewComponents = Array.from(
    new Set(
      (preview.component_totals || []).map((component) =>
        normalizeUpperText(component?.component_code)
      )
    )
  );
  for (const componentCode of uniquePreviewComponents) {
    const component = (preview.component_totals || []).find(
      (row) => normalizeUpperText(row?.component_code) === componentCode
    );
    const entrySide = normalizeUpperText(component?.entry_side);
    // eslint-disable-next-line no-await-in-loop
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
        notes: "PR-POU02 mapping",
      },
      assertScopeAccess: noScopeGuard,
    });
  }

  await markPayrollRunReviewed({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    note: "review for PR-POU02",
    assertScopeAccess: noScopeGuard,
  });
  const finalized = await finalizePayrollRunAccrual({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    note: "finalize for PR-POU02",
    forceFromImported: false,
    assertScopeAccess: noScopeGuard,
  });
  assert(toNumber(finalized?.accrualJournalEntryId) > 0, "Finalize should create accrual JE");
}

async function resolveOwnershipIssuesBeforeFinalize({
  fixture,
  ownership,
}) {
  await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP003",
      employeeNameSnapshot: "Gamma User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-003",
      sourceType: "MANUAL",
      notes: "Resolved before finalize",
    },
    assertScopeAccess: noScopeGuard,
  });

  await query(
    `UPDATE payroll_employee_owner_context_assignments
     SET status = 'INACTIVE',
         updated_by_user_id = ?,
         deactivated_by_user_id = ?,
         deactivated_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND employee_code = 'EMP004'
       AND ownership_scope = 'OPERATING_UNIT'
       AND status = 'ACTIVE'`,
    [
      fixture.userId,
      fixture.userId,
      fixture.tenantId,
      fixture.legalEntityId,
    ]
  );

  await updatePayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    assignmentId: ownership.emp005AssignmentId,
    input: {
      expectedCostCenterCode: "CC-005",
    },
    assertScopeAccess: noScopeGuard,
  });
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createFixtureTenant(stamp);
  const ownership = await seedOwnershipAssignments(fixture);
  const providerCode = `PPOU02_${stamp}`;

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
      sourceBatchRef: `PPOU02-IMPORT-${stamp}`,
      originalFilename: `ppou02-${stamp}.csv`,
      csvText: buildOriginalCsv(),
    },
    assertScopeAccess: noScopeGuard,
  });
  const runId = toNumber(imported?.id);
  assert(runId > 0, "Import should create payroll run");
  assert(String(imported?.ownership_as_of_date || "") === "2026-02-28", "ownership_as_of_date should lock to payroll period end");

  const runDetail = await getPayrollRunByIdForTenant({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    assertScopeAccess: noScopeGuard,
  });
  assert(String(runDetail?.ownership_as_of_date || "") === "2026-02-28", "Run detail should expose ownership_as_of_date");

  const lineByEmployee = new Map(
    (runDetail?.lines || []).map((line) => [String(line.employee_code || "").trim().toUpperCase(), line])
  );
  assert(lineByEmployee.size === 5, "Imported run should return five lines");
  assert(lineByEmployee.has("EMP001"), "Employee codes should be normalized on import");

  const emp001Line = lineByEmployee.get("EMP001");
  const emp002Line = lineByEmployee.get("EMP002");
  const emp003Line = lineByEmployee.get("EMP003");
  const emp004Line = lineByEmployee.get("EMP004");
  const emp005Line = lineByEmployee.get("EMP005");

  assert(normalizeUpperText(emp001Line?.ownership_resolution_status) === "RESOLVED", "EMP001 should resolve cleanly");
  assert(normalizeUpperText(emp001Line?.ownership_scope) === "CENTRAL", "EMP001 should resolve to CENTRAL");
  assert(toNumber(emp001Line?.ownership_assignment_id) === ownership.emp001AssignmentId, "EMP001 assignment id should snapshot");

  assert(normalizeUpperText(emp002Line?.ownership_resolution_status) === "RESOLVED", "EMP002 should resolve cleanly");
  assert(normalizeUpperText(emp002Line?.ownership_scope) === "OPERATING_UNIT", "EMP002 should resolve to OU");
  assert(toNumber(emp002Line?.operating_unit_id) === fixture.operatingUnitId, "EMP002 should snapshot OU id");
  assert(toNumber(emp002Line?.ownership_assignment_id) === ownership.emp002AssignmentId, "EMP002 assignment id should snapshot");

  assert(normalizeUpperText(emp003Line?.ownership_resolution_status) === "UNRESOLVED", "EMP003 should be UNRESOLVED");
  assert(String(emp003Line?.ownership_resolution_note || "").includes("No active payroll ownership assignment"), "EMP003 unresolved note should be populated");

  assert(normalizeUpperText(emp004Line?.ownership_resolution_status) === "AMBIGUOUS", "EMP004 should be AMBIGUOUS");
  assert(String(emp004Line?.ownership_resolution_note || "").includes("Multiple active payroll ownership assignments"), "EMP004 ambiguous note should be populated");

  assert(normalizeUpperText(emp005Line?.ownership_resolution_status) === "MISMATCH", "EMP005 should be MISMATCH");
  assert(normalizeUpperText(emp005Line?.ownership_scope) === "OPERATING_UNIT", "EMP005 mismatch should still snapshot resolved owner context");
  assert(toNumber(emp005Line?.operating_unit_id) === fixture.operatingUnitId, "EMP005 mismatch should keep OU id");
  assert(toNumber(emp005Line?.ownership_assignment_id) === ownership.emp005AssignmentId, "EMP005 mismatch should keep assignment id");
  assert(String(emp005Line?.ownership_resolution_note || "").includes("Expected cost center CC-999"), "EMP005 mismatch note should include expected cost center");

  assert(toNumber(runDetail?.ownership_summary?.resolved_line_count) === 2, "Summary should count RESOLVED lines");
  assert(toNumber(runDetail?.ownership_summary?.unresolved_line_count) === 1, "Summary should count UNRESOLVED lines");
  assert(toNumber(runDetail?.ownership_summary?.ambiguous_line_count) === 1, "Summary should count AMBIGUOUS lines");
  assert(toNumber(runDetail?.ownership_summary?.mismatch_line_count) === 1, "Summary should count MISMATCH lines");
  assert(toNumber(runDetail?.ownership_summary?.owner_context_count) === 2, "Summary should expose two owner contexts");
  assert(toNumber(runDetail?.ownership_summary?.mixed_ou_count) === 1, "Summary should expose one OU context");
  assert(Array.isArray(runDetail?.ownership_summary?.breakdown) && runDetail.ownership_summary.breakdown.length === 2, "Summary breakdown should expose central + OU buckets");

  const mismatchLines = await listPayrollRunLineRows({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    filters: {
      tenantId: fixture.tenantId,
      runId,
      q: null,
      costCenterCode: null,
      operatingUnitId: null,
      ownershipResolutionStatus: "MISMATCH",
      limit: 50,
      offset: 0,
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    (mismatchLines?.rows || []).length === 1 &&
      normalizeUpperText(mismatchLines?.rows?.[0]?.employee_code) === "EMP005",
    "Line list should filter by ownershipResolutionStatus"
  );

  const ouLines = await listPayrollRunLineRows({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    filters: {
      tenantId: fixture.tenantId,
      runId,
      q: null,
      costCenterCode: null,
      operatingUnitId: fixture.operatingUnitId,
      ownershipResolutionStatus: null,
      limit: 50,
      offset: 0,
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    (ouLines?.rows || []).length === 2 &&
      (ouLines.rows || []).every((row) => toNumber(row.operating_unit_id) === fixture.operatingUnitId),
    "Line list should filter by operatingUnitId"
  );

  const correctionShell = await createPayrollCorrectionShell({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      correctionType: "OFF_CYCLE",
      originalRunId: null,
      entityCode: fixture.legalEntityCode,
      providerCode,
      payrollPeriod: "2026-02-01",
      payDate: "2026-03-15",
      currencyCode: fixture.currencyCode,
      reason: "PR-POU02 ownership date-lock smoke",
      idempotencyKey: `PPOU02-SHELL-${stamp}`,
    },
    assertScopeAccess: noScopeGuard,
  });
  const correctionRunId = toNumber(correctionShell?.correction_run?.id);
  assert(correctionRunId > 0, "Correction shell should be created");
  assert(String(correctionShell?.correction_run?.ownership_as_of_date || "") === "2026-02-28", "Correction shell should lock ownership_as_of_date from payroll period end");

  const correctionImport = await importPayrollRunCsv({
    req: null,
    payload: {
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      legalEntityId: null,
      targetRunId: correctionRunId,
      providerCode,
      payrollPeriod: "2026-02-01",
      payDate: "2026-03-15",
      currencyCode: fixture.currencyCode,
      sourceBatchRef: `PPOU02-CORR-${stamp}`,
      originalFilename: `ppou02-correction-${stamp}.csv`,
      csvText: buildCorrectionShellCsv(),
    },
    assertScopeAccess: noScopeGuard,
  });
  const correctionLine = (correctionImport?.lines || [])[0];
  assert(String(correctionImport?.ownership_as_of_date || "") === "2026-02-28", "Correction import should preserve shell ownership_as_of_date");
  assert(normalizeUpperText(correctionLine?.employee_code) === "EMP006", "Correction import should normalize employee_code");
  assert(normalizeUpperText(correctionLine?.ownership_resolution_status) === "RESOLVED", "Correction shell line should resolve");
  assert(normalizeUpperText(correctionLine?.ownership_scope) === "CENTRAL", "Correction shell import should resolve by locked payroll-period end, not pay_date");

  await resolveOwnershipIssuesBeforeFinalize({
    fixture,
    ownership,
  });
  await finalizeRunWithMappings({
    fixture,
    providerCode,
    runId,
  });
  const finalizedRunDetail = await getPayrollRunByIdForTenant({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    assertScopeAccess: noScopeGuard,
  });
  const finalizedLineByEmployee = new Map(
    (finalizedRunDetail?.lines || []).map((line) => [
      String(line.employee_code || "").trim().toUpperCase(),
      line,
    ])
  );

  await query(
    `UPDATE payroll_employee_owner_context_assignments
     SET status = 'INACTIVE',
         updated_by_user_id = ?,
         deactivated_by_user_id = ?,
         deactivated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND employee_code = 'EMP001'
       AND status = 'ACTIVE'`,
    [fixture.userId, fixture.userId, fixture.tenantId, fixture.legalEntityId]
  );
  const replacementEmp001 = await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP001",
      employeeNameSnapshot: "Alpha User",
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: fixture.operatingUnitId,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-001",
      sourceType: "MANUAL",
      notes: "Changed after finalize",
    },
    assertScopeAccess: noScopeGuard,
  });
  const replacementEmp001AssignmentId = toNumber(replacementEmp001?.item?.id);
  assert(replacementEmp001AssignmentId > 0, "Replacement EMP001 assignment should be created");

  const currentEmp001Resolution = await resolvePayrollEmployeeOwnershipContext({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityId,
    employeeCode: "EMP001",
    asOfDate: "2026-02-28",
  });
  assert(
    normalizeUpperText(currentEmp001Resolution?.ownership_scope) === "OPERATING_UNIT" &&
      toNumber(currentEmp001Resolution?.operating_unit_id) === fixture.operatingUnitId,
    "Current master resolution should now differ from original snapshot"
  );

  const reversed = await reversePayrollRunWithCorrection({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    reason: "PR-POU02 reversal snapshot copy",
    note: "verify copied ownership snapshot",
    idempotencyKey: `PPOU02-REV-${stamp}`,
    assertScopeAccess: noScopeGuard,
  });
  const reversalRunId = toNumber(reversed?.reversal_run?.id);
  assert(reversalRunId > 0, "Reversal should create reversal run");

  const reversalDetail = await getPayrollRunByIdForTenant({
    req: null,
    tenantId: fixture.tenantId,
    runId: reversalRunId,
    assertScopeAccess: noScopeGuard,
  });
  assert(String(reversalDetail?.ownership_as_of_date || "") === "2026-02-28", "Reversal run should copy original ownership_as_of_date");

  const reversalByEmployee = new Map(
    (reversalDetail?.lines || []).map((line) => [String(line.employee_code || "").trim().toUpperCase(), line])
  );
  for (const [employeeCode, originalLine] of finalizedLineByEmployee.entries()) {
    const reversalLine = reversalByEmployee.get(employeeCode);
    assert(reversalLine, `Reversal line missing for ${employeeCode}`);
    assert(
      normalizeUpperText(reversalLine?.ownership_scope) === normalizeUpperText(originalLine?.ownership_scope),
      `Reversal line ownership_scope should match original for ${employeeCode}`
    );
    assert(
      toNumber(reversalLine?.operating_unit_id) === toNumber(originalLine?.operating_unit_id),
      `Reversal line operating_unit_id should match original for ${employeeCode}`
    );
    assert(
      toNumber(reversalLine?.ownership_assignment_id) === toNumber(originalLine?.ownership_assignment_id),
      `Reversal line ownership_assignment_id should match original for ${employeeCode}`
    );
    assert(
      normalizeUpperText(reversalLine?.ownership_resolution_status) ===
        normalizeUpperText(originalLine?.ownership_resolution_status),
      `Reversal line ownership_resolution_status should match original for ${employeeCode}`
    );
    assert(
      String(reversalLine?.ownership_resolution_note || "") ===
        String(originalLine?.ownership_resolution_note || ""),
      `Reversal line ownership_resolution_note should match original for ${employeeCode}`
    );
  }
  assert(
    normalizeUpperText(reversalByEmployee.get("EMP001")?.ownership_scope) === "CENTRAL" &&
      toNumber(reversalByEmployee.get("EMP001")?.ownership_assignment_id) === ownership.emp001AssignmentId &&
      toNumber(reversalByEmployee.get("EMP001")?.ownership_assignment_id) !==
        replacementEmp001AssignmentId,
    "Reversal line for EMP001 should keep original snapshot instead of current master assignment"
  );

  console.log(
    "PR-POU02 smoke test passed (ownership_as_of_date lock + line snapshot statuses + shell preservation + line filters + reversal snapshot copy)."
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
