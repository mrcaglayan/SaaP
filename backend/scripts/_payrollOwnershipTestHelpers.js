import { query } from "../src/db.js";
import { createPayrollOwnershipAssignment } from "../src/services/payroll.ownership.service.js";

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function parseSimpleCsvRows(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }

  const headers = lines[0].split(",").map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return headers.reduce((row, header, index) => {
      row[header] = String(cells[index] || "").trim();
      return row;
    }, {});
  });
}

async function hasOverlappingActiveAssignment({
  tenantId,
  legalEntityId,
  employeeCode,
  effectiveFrom,
  effectiveTo,
}) {
  const rows = await query(
    `SELECT id
     FROM payroll_employee_owner_context_assignments
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND employee_code = ?
       AND status = 'ACTIVE'
       AND effective_from <= ?
       AND COALESCE(effective_to, '9999-12-31') >= ?
     LIMIT 1`,
    [
      tenantId,
      legalEntityId,
      employeeCode,
      effectiveTo || "9999-12-31",
      effectiveFrom,
    ]
  );
  return Boolean(rows.rows?.[0]?.id);
}

export async function seedCentralPayrollOwnershipAssignmentsFromCsv({
  tenantId,
  legalEntityId,
  userId,
  csvText,
  effectiveFrom = "2026-01-01",
  effectiveTo = null,
  assertScopeAccess,
}) {
  const parsedRows = parseSimpleCsvRows(csvText);
  const seenEmployeeCodes = new Set();
  let createdCount = 0;

  for (const row of parsedRows) {
    const employeeCode = normalizeUpperText(row.employee_code);
    if (!employeeCode || seenEmployeeCodes.has(employeeCode)) {
      continue;
    }
    seenEmployeeCodes.add(employeeCode);

    // Keep fixture setup idempotent across multiple runs in the same script.
    // Once an overlapping active assignment exists for the employee, reuse it.
    // The smoke tests only need one valid authoritative owner context.
    // eslint-disable-next-line no-await-in-loop
    const alreadySeeded = await hasOverlappingActiveAssignment({
      tenantId,
      legalEntityId,
      employeeCode,
      effectiveFrom,
      effectiveTo,
    });
    if (alreadySeeded) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await createPayrollOwnershipAssignment({
      req: null,
      tenantId,
      userId,
      input: {
        legalEntityId,
        employeeCode,
        employeeNameSnapshot: String(row.employee_name || "").trim() || null,
        ownershipScope: "CENTRAL",
        operatingUnitId: null,
        effectiveFrom,
        effectiveTo,
        status: "ACTIVE",
        expectedCostCenterCode: normalizeUpperText(row.cost_center_code) || null,
        sourceType: "MANUAL",
        notes: "Smoke test ownership seed",
      },
      assertScopeAccess,
    });
    createdCount += 1;
  }

  return {
    createdCount,
    employeeCount: seenEmployeeCodes.size,
  };
}
