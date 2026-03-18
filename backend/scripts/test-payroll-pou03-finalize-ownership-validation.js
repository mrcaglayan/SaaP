import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  finalizePayrollRunAccrual,
  getPayrollRunAccrualPreview,
  markPayrollRunReviewed,
} from "../src/services/payroll.accruals.service.js";
import { upsertPayrollComponentMapping } from "../src/services/payroll.mappings.service.js";
import {
  createPayrollOwnershipAssignment,
  updatePayrollOwnershipAssignment,
} from "../src/services/payroll.ownership.service.js";
import { getPayrollRunByIdForTenant, importPayrollRunCsv } from "../src/services/payroll.runs.service.js";

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

async function expectFailure(work, { status, code, includes, validateDetails } = {}) {
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
    if (code && String(error?.code || "").toUpperCase() !== String(code).toUpperCase()) {
      throw new Error(
        `Expected error code ${code} but got ${String(error?.code || "")}`
      );
    }
    if (includes && !String(error?.message || "").includes(includes)) {
      throw new Error(
        `Expected error message to include "${includes}" but got "${String(error?.message || "")}"`
      );
    }
    if (typeof validateDetails === "function") {
      validateDetails(error?.details || null);
    }
    return error;
  }
  throw new Error("Expected operation to fail, but it succeeded");
}

function buildCsv() {
  return [
    "employee_code,employee_name,cost_center_code,base_salary,overtime_pay,bonus_pay,allowances_total,gross_pay,employee_tax,employee_social_security,other_deductions,employer_tax,employer_social_security,net_pay",
    "EMP001,Alpha User,CC-001,1000,0,0,0,1000,100,50,10,120,80,840",
    "EMP002,Beta User,CC-002,1100,0,0,0,1100,110,55,15,130,85,920",
    "EMP003,Gamma User,CC-003,900,0,0,0,900,90,45,10,100,70,755",
    "EMP004,Delta User,CC-004,950,0,0,0,950,95,45,10,105,75,800",
    "EMP005,Epsilon User,CC-005,980,0,0,0,980,98,48,12,108,78,822",
  ].join("\n");
}

async function createFixtureTenant(stamp) {
  const tenantCode = `PPOU03_T_${stamp}`;
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `PPOU03 Tenant ${stamp}`]
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
    [tenantId, `PPOU03_G_${stamp}`, `PPOU03 Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU03_G_${stamp}`]
  );
  const groupCompanyId = toNumber(groupRows.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Failed to create group fixture");

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
      `PPOU03_LE_${stamp}`,
      `PPOU03 Legal Entity ${stamp}`,
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
    [tenantId, `PPOU03_LE_${stamp}`]
  );
  const legalEntityId = toNumber(legalEntityRows.rows?.[0]?.id);
  assert(legalEntityId > 0, "Failed to create legal entity fixture");

  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id, code, name, year_start_month, year_start_day
      )
      VALUES (?, ?, ?, 1, 1)`,
    [tenantId, `PPOU03_CAL_${stamp}`, `PPOU03 Calendar ${stamp}`]
  );
  const calendarRows = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU03_CAL_${stamp}`]
  );
  const calendarId = toNumber(calendarRows.rows?.[0]?.id);
  assert(calendarId > 0, "Failed to create calendar fixture");

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
      `PPOU03_BOOK_${stamp}`,
      `PPOU03 Book ${stamp}`,
      currencyCode,
    ]
  );

  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id, legal_entity_id, scope, code, name
      )
      VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, `PPOU03_COA_${stamp}`, `PPOU03 Chart ${stamp}`]
  );
  const coaRows = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU03_COA_${stamp}`]
  );
  const coaId = toNumber(coaRows.rows?.[0]?.id);
  assert(coaId > 0, "Failed to create chart fixture");

  await query(
    `INSERT INTO accounts (
        coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id, is_active
      )
      VALUES (?, ?, ?, 'EXPENSE', 'DEBIT', TRUE, NULL, TRUE)`,
    [coaId, `PPOU03EXP${stamp}`, `PPOU03 Expense ${stamp}`]
  );
  await query(
    `INSERT INTO accounts (
        coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id, is_active
      )
      VALUES (?, ?, ?, 'LIABILITY', 'CREDIT', TRUE, NULL, TRUE)`,
    [coaId, `PPOU03LIA${stamp}`, `PPOU03 Liability ${stamp}`]
  );
  const expenseRows = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND name = ?
     LIMIT 1`,
    [coaId, `PPOU03 Expense ${stamp}`]
  );
  const liabilityRows = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND name = ?
     LIMIT 1`,
    [coaId, `PPOU03 Liability ${stamp}`]
  );
  const expenseGlAccountId = toNumber(expenseRows.rows?.[0]?.id);
  const liabilityGlAccountId = toNumber(liabilityRows.rows?.[0]?.id);
  assert(expenseGlAccountId > 0 && liabilityGlAccountId > 0, "Failed to create account fixtures");

  const passwordHash = await bcrypt.hash("PPOU03#Smoke123", 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `ppou03_user_${stamp}@example.com`, passwordHash, "PPOU03 User"]
  );
  const userRows = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, `ppou03_user_${stamp}@example.com`]
  );
  const userId = toNumber(userRows.rows?.[0]?.id);
  assert(userId > 0, "Failed to create user fixture");

  return {
    tenantId,
    legalEntityId,
    userId,
    currencyCode,
    expenseGlAccountId,
    liabilityGlAccountId,
  };
}

async function seedInitialOwnership(fixture) {
  await createPayrollOwnershipAssignment({
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
      notes: "Resolved owner",
    },
    assertScopeAccess: noScopeGuard,
  });

  const ambiguousOne = await createPayrollOwnershipAssignment({
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
      notes: "Ambiguous assignment 1",
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
      VALUES (?, ?, 'EMP003', 'Gamma User', 'CENTRAL', NULL, '2026-01-01', NULL, 'ACTIVE', 'CC-003', 'MANUAL', 'Ambiguous assignment 2', ?, ?)`,
    [fixture.tenantId, fixture.legalEntityId, fixture.userId, fixture.userId]
  );

  const mismatch = await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP004",
      employeeNameSnapshot: "Delta User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-999",
      sourceType: "MANUAL",
      notes: "Mismatch owner",
    },
    assertScopeAccess: noScopeGuard,
  });

  return {
    ambiguousAssignmentId: toNumber(ambiguousOne?.item?.id),
    mismatchAssignmentId: toNumber(mismatch?.item?.id),
  };
}

async function addMappingsFromPreview({ fixture, providerCode, runId }) {
  const preview = await getPayrollRunAccrualPreview({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    assertScopeAccess: noScopeGuard,
  });

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
        notes: "PR-POU03 mapping",
      },
      assertScopeAccess: noScopeGuard,
    });
  }

  return preview;
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createFixtureTenant(stamp);
  const seeded = await seedInitialOwnership(fixture);
  const providerCode = `PPOU03_${stamp}`;

  const imported = await importPayrollRunCsv({
    req: null,
    payload: {
      tenantId: fixture.tenantId,
      userId: fixture.userId,
      legalEntityId: fixture.legalEntityId,
      providerCode,
      payrollPeriod: "2026-02-01",
      payDate: "2026-03-15",
      currencyCode: fixture.currencyCode,
      sourceBatchRef: `PPOU03-SRC-${stamp}`,
      originalFilename: `ppou03-${stamp}.csv`,
      csvText: buildCsv(),
    },
    assertScopeAccess: noScopeGuard,
  });
  const runId = toNumber(imported?.id);
  assert(runId > 0, "Import should create run");
  assert(String(imported?.ownership_as_of_date || "") === "2026-02-28", "Run should lock ownership_as_of_date to payroll period end");

  const previewBeforeMappings = await addMappingsFromPreview({
    fixture,
    providerCode,
    runId,
  });
  assert(
    toNumber(previewBeforeMappings?.ownership_validation?.blocking_line_count) === 4,
    "Preview should expose four blocking ownership lines before finalize"
  );
  assert(previewBeforeMappings?.can_finalize === false, "Preview should not allow finalize while ownership is unresolved");

  const reviewed = await markPayrollRunReviewed({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    note: "review with ownership issues",
    assertScopeAccess: noScopeGuard,
  });
  assert(reviewed?.idempotentReplay === false, "Review should still succeed");

  await expectFailure(
    () =>
      finalizePayrollRunAccrual({
        req: null,
        tenantId: fixture.tenantId,
        runId,
        userId: fixture.userId,
        note: "should fail on ownership",
        forceFromImported: false,
        assertScopeAccess: noScopeGuard,
      }),
    {
      status: 400,
      code: "PAYROLL_OWNERSHIP_FINALIZE_BLOCKED",
      includes: "EMP002 [UNRESOLVED]",
      validateDetails(details) {
        assert(details?.type === "OWNERSHIP_FINALIZE_BLOCKED", "Finalize block should return ownership block details");
        assert(
          toNumber(details?.ownership_validation?.blocking_line_count) === 4,
          "Finalize block should report four blocking lines"
        );
        const sampleCodes = new Set(
          (details?.ownership_validation?.sample_lines || []).map((line) =>
            normalizeUpperText(line?.employee_code)
          )
        );
        assert(sampleCodes.has("EMP002"), "Finalize error details should include EMP002");
        assert(sampleCodes.has("EMP003"), "Finalize error details should include EMP003");
        assert(sampleCodes.has("EMP004"), "Finalize error details should include EMP004");
        assert(sampleCodes.has("EMP005"), "Finalize error details should include EMP005");
      },
    }
  );

  const validationAuditRows1 = await query(
    `SELECT payload_json
     FROM payroll_run_audit
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND run_id = ?
       AND action = 'VALIDATION'
     ORDER BY id DESC
     LIMIT 1`,
    [fixture.tenantId, fixture.legalEntityId, runId]
  );
  const validationAudit1 = validationAuditRows1.rows?.[0]?.payload_json || null;
  const validationAuditPayload1 =
    typeof validationAudit1 === "string" ? JSON.parse(validationAudit1) : validationAudit1;
  assert(
    validationAuditPayload1?.type === "OWNERSHIP_FINALIZE_BLOCKED",
    "Audit should record OWNERSHIP_FINALIZE_BLOCKED"
  );

  await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP002",
      employeeNameSnapshot: "Beta User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-002",
      sourceType: "MANUAL",
      notes: "Resolved after import",
    },
    assertScopeAccess: noScopeGuard,
  });
  await query(
    `UPDATE payroll_employee_owner_context_assignments
     SET status = 'INACTIVE',
         updated_by_user_id = ?,
         deactivated_by_user_id = ?,
         deactivated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?`,
    [fixture.userId, fixture.userId, fixture.tenantId, fixture.legalEntityId, seeded.ambiguousAssignmentId]
  );
  await updatePayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    assignmentId: seeded.mismatchAssignmentId,
    input: {
      expectedCostCenterCode: "CC-004",
    },
    assertScopeAccess: noScopeGuard,
  });
  await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP005",
      employeeNameSnapshot: "Epsilon User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-03-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-005",
      sourceType: "MANUAL",
      notes: "Starts after locked ownership_as_of_date",
    },
    assertScopeAccess: noScopeGuard,
  });

  await expectFailure(
    () =>
      finalizePayrollRunAccrual({
        req: null,
        tenantId: fixture.tenantId,
        runId,
        userId: fixture.userId,
        note: "should still fail because EMP005 assignment starts after as-of date",
        forceFromImported: false,
        assertScopeAccess: noScopeGuard,
      }),
    {
      status: 400,
      code: "PAYROLL_OWNERSHIP_FINALIZE_BLOCKED",
      includes: "EMP005 [UNRESOLVED]",
      validateDetails(details) {
        assert(
          toNumber(details?.ownership_validation?.blocking_line_count) === 1,
          "Only EMP005 should remain blocking after fixes"
        );
      },
    }
  );

  await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityId,
      employeeCode: "EMP005",
      employeeNameSnapshot: "Epsilon User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-02-01",
      effectiveTo: "2026-02-28",
      status: "ACTIVE",
      expectedCostCenterCode: "CC-005",
      sourceType: "MANUAL",
      notes: "Valid for locked ownership_as_of_date",
    },
    assertScopeAccess: noScopeGuard,
  });

  const finalized = await finalizePayrollRunAccrual({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    userId: fixture.userId,
    note: "finalize after fixing ownership issues",
    forceFromImported: false,
    assertScopeAccess: noScopeGuard,
  });
  assert(toNumber(finalized?.accrualJournalEntryId) > 0, "Finalize should succeed after ownership fixes");

  const finalRun = await getPayrollRunByIdForTenant({
    req: null,
    tenantId: fixture.tenantId,
    runId,
    assertScopeAccess: noScopeGuard,
  });
  assert(normalizeUpperText(finalRun?.status) === "FINALIZED", "Run should be FINALIZED");
  for (const line of finalRun?.lines || []) {
    assert(
      normalizeUpperText(line?.ownership_resolution_status) === "RESOLVED",
      `Line ${line?.line_no} should be RESOLVED after successful finalize`
    );
    assert(
      normalizeUpperText(line?.ownership_scope) === "CENTRAL",
      `Line ${line?.line_no} should keep explicit CENTRAL ownership_scope`
    );
  }

  const validationAuditRows2 = await query(
    `SELECT payload_json
     FROM payroll_run_audit
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND run_id = ?
       AND action = 'VALIDATION'
     ORDER BY id DESC
     LIMIT 1`,
    [fixture.tenantId, fixture.legalEntityId, runId]
  );
  const validationAudit2 = validationAuditRows2.rows?.[0]?.payload_json || null;
  const validationAuditPayload2 =
    typeof validationAudit2 === "string" ? JSON.parse(validationAudit2) : validationAudit2;
  assert(
    validationAuditPayload2?.type === "OWNERSHIP_READY_FOR_FINALIZE",
    "Audit should record OWNERSHIP_READY_FOR_FINALIZE before successful finalize"
  );
  assert(
    toNumber(validationAuditPayload2?.ownership_reresolution?.updatedLineCount) >= 1,
    "Successful finalize should record ownership re-resolution updates"
  );

  console.log(
    "PR-POU03 smoke test passed (import allowed + review informational + finalize blocked with details + locked-date re-resolution + finalize succeeds after fixes)."
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
