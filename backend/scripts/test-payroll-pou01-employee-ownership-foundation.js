import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import { seedCore } from "../src/seedCore.js";
import {
  createPayrollOwnershipAssignment,
  deactivatePayrollOwnershipAssignment,
  getPayrollOwnershipAssignmentByIdForTenant,
  listPayrollOwnershipAssignmentRows,
  resolvePayrollEmployeeOwnershipContext,
  updatePayrollOwnershipAssignment,
} from "../src/services/payroll.ownership.service.js";

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

function allowAllScopeFilter() {
  return "1 = 1";
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

async function createFixtureTenant(stamp) {
  const tenantCode = `PPOU01_T_${stamp}`;
  await query(
    `INSERT INTO tenants (code, name)
     VALUES (?, ?)`,
    [tenantCode, `PPOU01 Tenant ${stamp}`]
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
  const functionalCurrencyCode = String(countryRows.rows?.[0]?.default_currency_code || "TRY");
  assert(countryId > 0, "Missing country seed row");

  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, `PPOU01_G_${stamp}`, `PPOU01 Group ${stamp}`]
  );
  const groupRows = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, `PPOU01_G_${stamp}`]
  );
  const groupCompanyId = toNumber(groupRows.rows?.[0]?.id);
  assert(groupCompanyId > 0, "Failed to create group company fixture");

  for (const suffix of ["A", "B"]) {
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
        `PPOU01_LE_${suffix}_${stamp}`,
        `PPOU01 Legal Entity ${suffix} ${stamp}`,
        countryId,
        functionalCurrencyCode,
      ]
    );
  }

  const legalEntityRows = await query(
    `SELECT id, code
     FROM legal_entities
     WHERE tenant_id = ?
       AND code IN (?, ?)
     ORDER BY code ASC`,
    [tenantId, `PPOU01_LE_A_${stamp}`, `PPOU01_LE_B_${stamp}`]
  );
  const legalEntityAId = toNumber(legalEntityRows.rows?.[0]?.id);
  const legalEntityBId = toNumber(legalEntityRows.rows?.[1]?.id);
  assert(legalEntityAId > 0 && legalEntityBId > 0, "Failed to create legal entities");

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
      VALUES
      (?, ?, ?, ?, 'BRANCH', TRUE, 'ACTIVE'),
      (?, ?, ?, ?, 'BRANCH', TRUE, 'ACTIVE')`,
    [
      tenantId,
      legalEntityAId,
      `PPOU01_OU_A_${stamp}`,
      `PPOU01 OU A ${stamp}`,
      tenantId,
      legalEntityBId,
      `PPOU01_OU_B_${stamp}`,
      `PPOU01 OU B ${stamp}`,
    ]
  );
  const operatingUnitRows = await query(
    `SELECT id, legal_entity_id, code
     FROM operating_units
     WHERE tenant_id = ?
       AND code IN (?, ?)
     ORDER BY code ASC`,
    [tenantId, `PPOU01_OU_A_${stamp}`, `PPOU01_OU_B_${stamp}`]
  );
  const operatingUnitAId = toNumber(operatingUnitRows.rows?.[0]?.id);
  const operatingUnitBId = toNumber(operatingUnitRows.rows?.[1]?.id);
  assert(operatingUnitAId > 0 && operatingUnitBId > 0, "Failed to create operating units");

  const passwordHash = await bcrypt.hash("PPOU01#Smoke123", 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, `ppou01_user_${stamp}@example.com`, passwordHash, "PPOU01 User"]
  );
  const userRows = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, `ppou01_user_${stamp}@example.com`]
  );
  const userId = toNumber(userRows.rows?.[0]?.id);
  assert(userId > 0, "Failed to create user fixture");

  return {
    tenantId,
    userId,
    legalEntityAId,
    legalEntityBId,
    operatingUnitAId,
    operatingUnitBId,
  };
}

async function main() {
  await seedCore({ ensureDefaultTenantIfMissing: true });

  const stamp = Date.now();
  const fixture = await createFixtureTenant(stamp);

  const createdCentral = await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityAId,
      employeeCode: " emp001 ",
      employeeNameSnapshot: "Alpha User",
      ownershipScope: "CENTRAL",
      operatingUnitId: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-03-31",
      status: "ACTIVE",
      expectedCostCenterCode: "cc-central",
      sourceType: "MANUAL",
      notes: "Initial central ownership",
    },
    assertScopeAccess: noScopeGuard,
  });
  const centralAssignmentId = toNumber(createdCentral?.item?.id);
  assert(centralAssignmentId > 0, "Central assignment should be created");
  assert(
    String(createdCentral?.item?.employee_code || "") === "EMP001",
    "employeeCode should be normalized"
  );
  assert(
    String(createdCentral?.item?.ownership_scope || "") === "CENTRAL",
    "Central assignment should expose ownership scope"
  );

  await expectFailure(
    () =>
      createPayrollOwnershipAssignment({
        req: null,
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        input: {
          legalEntityId: fixture.legalEntityAId,
          employeeCode: "EMP001",
          employeeNameSnapshot: "Alpha User",
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: fixture.operatingUnitAId,
          effectiveFrom: "2026-03-15",
          effectiveTo: null,
          status: "ACTIVE",
          expectedCostCenterCode: null,
          sourceType: "MANUAL",
          notes: "Overlapping row should fail",
        },
        assertScopeAccess: noScopeGuard,
      }),
    { status: 409, includes: "overlap" }
  );

  await expectFailure(
    () =>
      createPayrollOwnershipAssignment({
        req: null,
        tenantId: fixture.tenantId,
        userId: fixture.userId,
        input: {
          legalEntityId: fixture.legalEntityAId,
          employeeCode: "EMP999",
          employeeNameSnapshot: "Wrong OU",
          ownershipScope: "OPERATING_UNIT",
          operatingUnitId: fixture.operatingUnitBId,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          status: "ACTIVE",
          expectedCostCenterCode: null,
          sourceType: "MANUAL",
          notes: "Wrong legal entity for OU",
        },
        assertScopeAccess: noScopeGuard,
      }),
    { status: 400, includes: "same legalEntityId" }
  );

  const createdOu = await createPayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    input: {
      legalEntityId: fixture.legalEntityAId,
      employeeCode: "EMP001",
      employeeNameSnapshot: "Alpha User",
      ownershipScope: "OPERATING_UNIT",
      operatingUnitId: fixture.operatingUnitAId,
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
      status: "ACTIVE",
      expectedCostCenterCode: "CC-ALPHA",
      sourceType: "MANUAL",
      notes: "Moved to branch ownership",
    },
    assertScopeAccess: noScopeGuard,
  });
  const ouAssignmentId = toNumber(createdOu?.item?.id);
  assert(ouAssignmentId > 0, "OU assignment should be created");
  assert(
    toNumber(createdOu?.item?.operating_unit_id) === fixture.operatingUnitAId,
    "OU assignment should expose operating unit id"
  );

  const listed = await listPayrollOwnershipAssignmentRows({
    req: null,
    tenantId: fixture.tenantId,
    filters: {
      tenantId: fixture.tenantId,
      legalEntityId: fixture.legalEntityAId,
      employeeCode: "EMP001",
      operatingUnitId: null,
      status: null,
      q: null,
      limit: 100,
      offset: 0,
    },
    buildScopeFilter: allowAllScopeFilter,
    assertScopeAccess: noScopeGuard,
  });
  assert((listed?.rows || []).length === 2, "List should return both assignments");

  const detail = await getPayrollOwnershipAssignmentByIdForTenant({
    req: null,
    tenantId: fixture.tenantId,
    assignmentId: ouAssignmentId,
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(detail?.item?.operating_unit_code || "").includes(`PPOU01_OU_A_${stamp}`),
    "Detail should include operating unit code"
  );

  const resolvedCentral = await resolvePayrollEmployeeOwnershipContext({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityAId,
    employeeCode: "emp001",
    asOfDate: "2026-02-15",
  });
  assert(
    String(resolvedCentral?.resolution_status || "") === "RESOLVED" &&
      String(resolvedCentral?.ownership_scope || "") === "CENTRAL",
    "Resolution should return central owner for February"
  );

  const resolvedOu = await resolvePayrollEmployeeOwnershipContext({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityAId,
    employeeCode: "EMP001",
    asOfDate: "2026-04-15",
  });
  assert(
    String(resolvedOu?.resolution_status || "") === "RESOLVED" &&
      String(resolvedOu?.ownership_scope || "") === "OPERATING_UNIT" &&
      toNumber(resolvedOu?.operating_unit_id) === fixture.operatingUnitAId,
    "Resolution should return OU owner for April"
  );

  const unresolved = await resolvePayrollEmployeeOwnershipContext({
    tenantId: fixture.tenantId,
    legalEntityId: fixture.legalEntityAId,
    employeeCode: "EMP404",
    asOfDate: "2026-04-15",
  });
  assert(
    String(unresolved?.resolution_status || "") === "UNRESOLVED",
    "Unknown employee should resolve as UNRESOLVED"
  );

  const updated = await updatePayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    assignmentId: ouAssignmentId,
    input: {
      employeeNameSnapshot: "Alpha User Updated",
      expectedCostCenterCode: "CC-ALPHA-02",
      notes: "Updated branch assignment",
    },
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(updated?.item?.employee_name_snapshot || "") === "Alpha User Updated",
    "Update should persist employee name snapshot"
  );
  assert(
    String(updated?.item?.expected_cost_center_code || "") === "CC-ALPHA-02",
    "Update should persist expected cost center"
  );

  const deactivated = await deactivatePayrollOwnershipAssignment({
    req: null,
    tenantId: fixture.tenantId,
    userId: fixture.userId,
    assignmentId: centralAssignmentId,
    assertScopeAccess: noScopeGuard,
  });
  assert(
    String(deactivated?.item?.status || "") === "INACTIVE",
    "Deactivate should set assignment status to INACTIVE"
  );

  console.log(
    "PR-POU01 smoke test passed (effective-dated payroll ownership CRUD + overlap prevention + resolver)."
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
