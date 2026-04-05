import bcrypt from "bcrypt";
import { closePool, query } from "../src/db.js";
import {
  apiRequest,
  assert,
  assignScopedTestFullAccessRoleToUser,
  createTenant,
  login,
  seedAndCreateBootstrapAdmin,
  startServerProcess,
  toNumber,
  waitForServer,
} from "./ex05-test-helpers.js";

const PORT = Number(process.env.LEGAL_ENTITY_ACTIVATION_TEST_PORT || 3146);
const BASE_URL =
  process.env.LEGAL_ENTITY_ACTIVATION_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const TEST_PASSWORD = "Activation#12345";
const TEST_FISCAL_YEAR = 2026;

function findEntityRow(payload, legalEntityId) {
  return (
    (Array.isArray(payload?.byLegalEntity) ? payload.byLegalEntity : []).find(
      (row) => Number(row?.legalEntityId) === Number(legalEntityId),
    ) || null
  );
}

function findCheck(entityRow, key) {
  return (
    (Array.isArray(entityRow?.checks) ? entityRow.checks : []).find(
      (row) => String(row?.key || "").trim() === key,
    ) || null
  );
}

async function getCountryIdByIso2(iso2) {
  const result = await query(
    `SELECT id
     FROM countries
     WHERE iso2 = ?
     LIMIT 1`,
    [String(iso2 || "").trim().toUpperCase()],
  );
  const countryId = toNumber(result.rows?.[0]?.id);
  assert(countryId > 0, `Country not found: ${iso2}`);
  return countryId;
}

async function createScopedUser({
  tenantId,
  email,
  password,
  name,
  scopeType,
  scopeId,
}) {
  const passwordHash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO users (tenant_id, email, password_hash, name, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
    [tenantId, email, passwordHash, name],
  );
  const userResult = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, email],
  );
  const userId = toNumber(userResult.rows?.[0]?.id);
  assert(userId > 0, `Scoped user not created: ${email}`);
  await assignScopedTestFullAccessRoleToUser({
    tenantId,
    userId,
    scopeType,
    scopeId,
  });
  return { userId, email };
}

async function createGroupCompany({ tenantId, code, name }) {
  await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)`,
    [tenantId, code, name],
  );
  const result = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code],
  );
  const groupCompanyId = toNumber(result.rows?.[0]?.id);
  assert(groupCompanyId > 0, `Group company not created: ${code}`);
  return groupCompanyId;
}

async function createFiscalCalendar({ tenantId, code, name }) {
  await query(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
     )
     VALUES (?, ?, ?, 1, 1)`,
    [tenantId, code, name],
  );
  const result = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code],
  );
  const calendarId = toNumber(result.rows?.[0]?.id);
  assert(calendarId > 0, `Fiscal calendar not created: ${code}`);
  return calendarId;
}

async function createRegularPeriods(calendarId, fiscalYear) {
  for (let periodNo = 1; periodNo <= 12; periodNo += 1) {
    const month = String(periodNo).padStart(2, "0");
    const nextMonth = String((periodNo % 12) + 1).padStart(2, "0");
    const nextYear = periodNo === 12 ? fiscalYear + 1 : fiscalYear;
    // eslint-disable-next-line no-await-in-loop
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
       VALUES (?, ?, ?, ?, ?, DATE_SUB(?, INTERVAL 1 DAY), FALSE)`,
      [
        calendarId,
        fiscalYear,
        periodNo,
        `P${String(periodNo).padStart(2, "0")}`,
        `${fiscalYear}-${month}-01`,
        `${nextYear}-${nextMonth}-01`,
      ],
    );
  }
}

async function createLegalEntity({
  tenantId,
  groupCompanyId,
  countryId,
  code,
  name,
  functionalCurrencyCode = "USD",
}) {
  await query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        country_id,
        functional_currency_code
     )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenantId, groupCompanyId, code, name, countryId, functionalCurrencyCode],
  );
  const result = await query(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code],
  );
  const legalEntityId = toNumber(result.rows?.[0]?.id);
  assert(legalEntityId > 0, `Legal entity not created: ${code}`);
  return legalEntityId;
}

async function createBook({
  tenantId,
  legalEntityId,
  calendarId,
  code,
  name,
  baseCurrencyCode = "USD",
}) {
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
    [tenantId, legalEntityId, calendarId, code, name, baseCurrencyCode],
  );
}

async function createCoa({
  tenantId,
  legalEntityId,
  code,
  name,
}) {
  await query(
    `INSERT INTO charts_of_accounts (
        tenant_id,
        legal_entity_id,
        scope,
        code,
        name
     )
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)`,
    [tenantId, legalEntityId, code, name],
  );
  const result = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code],
  );
  const coaId = toNumber(result.rows?.[0]?.id);
  assert(coaId > 0, `CoA not created: ${code}`);
  return coaId;
}

async function createAccount({
  coaId,
  code,
  name,
  accountType,
  normalSide,
  allowPosting,
}) {
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
     VALUES (?, ?, ?, ?, ?, ?, NULL, TRUE)`,
    [coaId, code, name, accountType, normalSide, Boolean(allowPosting)],
  );
  const result = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, code],
  );
  const accountId = toNumber(result.rows?.[0]?.id);
  assert(accountId > 0, `Account not created: ${code}`);
  return accountId;
}

async function insertShareholder({
  tenantId,
  legalEntityId,
  code,
  name,
  committedCapital = 1000,
  currencyCode = "USD",
}) {
  await query(
    `INSERT INTO shareholders (
        tenant_id,
        legal_entity_id,
        code,
        name,
        shareholder_type,
        committed_capital,
        paid_capital,
        currency_code,
        status
     )
     VALUES (?, ?, ?, ?, 'CORPORATE', ?, 0, ?, 'ACTIVE')`,
    [tenantId, legalEntityId, code, name, committedCapital, currencyCode],
  );
}

async function upsertShareholderMappings({
  tenantId,
  legalEntityId,
  capitalAccountId,
  commitmentAccountId,
}) {
  await query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     )
     VALUES
       (?, ?, 'SHAREHOLDER_CAPITAL_CREDIT_PARENT', ?),
       (?, ?, 'SHAREHOLDER_COMMITMENT_DEBIT_PARENT', ?)
     ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)`,
    [
      tenantId,
      legalEntityId,
      capitalAccountId,
      tenantId,
      legalEntityId,
      commitmentAccountId,
    ],
  );
}

async function createWorkflowDefinition({
  tenantId,
  processType,
  code,
  name,
  createdByUserId,
}) {
  await query(
    `INSERT INTO workflow_definitions (
        tenant_id,
        code,
        name,
        process_type,
        is_active,
        version_no,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, TRUE, 1, ?)`,
    [tenantId, code, name, processType, createdByUserId],
  );
  const result = await query(
    `SELECT id
     FROM workflow_definitions
     WHERE tenant_id = ?
       AND code = ?
       AND version_no = 1
     LIMIT 1`,
    [tenantId, code],
  );
  const workflowDefinitionId = toNumber(result.rows?.[0]?.id);
  assert(workflowDefinitionId > 0, `Workflow definition not created: ${code}`);

  await query(
    `INSERT INTO workflow_definition_steps (
        workflow_definition_id,
        step_no,
        stage_scope_type,
        required_permission_code,
        min_approver_count,
        allow_self_approve,
        escalation_after_hours
     )
     VALUES (?, 1, 'LEGAL_ENTITY', 'org.tree.read', 1, FALSE, NULL)`,
    [workflowDefinitionId],
  );

  return workflowDefinitionId;
}

async function assignWorkflowDefinition({
  tenantId,
  processType,
  workflowDefinitionId,
  createdByUserId,
}) {
  const effectiveFrom = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO workflow_assignments (
        tenant_id,
        process_type,
        workflow_definition_id,
        group_company_id,
        legal_entity_id,
        operating_unit_id,
        effective_from,
        effective_to,
        status,
        created_by_user_id
     )
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL, 'ACTIVE', ?)`,
    [tenantId, processType, workflowDefinitionId, effectiveFrom, createdByUserId],
  );
}

async function createActivationFixture({
  tenantId,
  groupCompanyId,
  countryId,
  calendarId,
  code,
  name,
  withShareholder = false,
  withMappings = false,
}) {
  const legalEntityId = await createLegalEntity({
    tenantId,
    groupCompanyId,
    countryId,
    code,
    name,
  });
  await createBook({
    tenantId,
    legalEntityId,
    calendarId,
    code: `BOOK_${code}`,
    name: `${name} Book`,
  });
  const coaId = await createCoa({
    tenantId,
    legalEntityId,
    code: `COA_${code}`,
    name: `${name} CoA`,
  });
  await createAccount({
    coaId,
    code: `100_${code}`.slice(0, 50),
    name: `${name} Asset`,
    accountType: "ASSET",
    normalSide: "DEBIT",
    allowPosting: true,
  });

  let capitalAccountId = null;
  let commitmentAccountId = null;
  if (withShareholder || withMappings) {
    capitalAccountId = await createAccount({
      coaId,
      code: `500_${code}`.slice(0, 50),
      name: `${name} Capital Parent`,
      accountType: "EQUITY",
      normalSide: "CREDIT",
      allowPosting: false,
    });
    commitmentAccountId = await createAccount({
      coaId,
      code: `501_${code}`.slice(0, 50),
      name: `${name} Commitment Parent`,
      accountType: "EQUITY",
      normalSide: "DEBIT",
      allowPosting: false,
    });
  }

  if (withShareholder) {
    await insertShareholder({
      tenantId,
      legalEntityId,
      code: `SH_${code}`,
      name: `${name} Shareholder`,
    });
  }
  if (withMappings) {
    await upsertShareholderMappings({
      tenantId,
      legalEntityId,
      capitalAccountId,
      commitmentAccountId,
    });
  }

  return {
    legalEntityId,
  };
}

async function main() {
  const stamp = Date.now();
  const adminEmail = `activation_admin_${stamp}@example.com`;

  const identity = await seedAndCreateBootstrapAdmin({
    tenantCode: `LE_ACT_${stamp}`,
    tenantName: `Activation ${stamp}`,
    adminEmail,
    adminPassword: TEST_PASSWORD,
  });

  const trCountryId = await getCountryIdByIso2("TR");
  const aeCountryId = await getCountryIdByIso2("AE");
  const scopedEmail = `activation_tr_${stamp}@example.com`;
  const scopedUser = await createScopedUser({
    tenantId: identity.tenantId,
    email: scopedEmail,
    password: TEST_PASSWORD,
    name: "TR Activation Scope",
    scopeType: "COUNTRY",
    scopeId: trCountryId,
  });

  const groupCompanyId = await createGroupCompany({
    tenantId: identity.tenantId,
    code: `ACT_GRP_${stamp}`,
    name: `Activation Group ${stamp}`,
  });
  const calendarId = await createFiscalCalendar({
    tenantId: identity.tenantId,
    code: `ACT_CAL_${stamp}`,
    name: `Activation Calendar ${stamp}`,
  });
  await createRegularPeriods(calendarId, TEST_FISCAL_YEAR);

  const noShareholder = await createActivationFixture({
    tenantId: identity.tenantId,
    groupCompanyId,
    countryId: trCountryId,
    calendarId,
    code: `TR_NO_SH_${stamp}`,
    name: "TR No Shareholder",
    withShareholder: false,
    withMappings: false,
  });
  const missingMappings = await createActivationFixture({
    tenantId: identity.tenantId,
    groupCompanyId,
    countryId: trCountryId,
    calendarId,
    code: `TR_NO_MAP_${stamp}`,
    name: "TR Missing Mappings",
    withShareholder: true,
    withMappings: false,
  });
  const readyEntity = await createActivationFixture({
    tenantId: identity.tenantId,
    groupCompanyId,
    countryId: aeCountryId,
    calendarId,
    code: `AE_READY_${stamp}`,
    name: "AE Ready",
    withShareholder: true,
    withMappings: true,
  });

  const workflowPeriodCloseId = await createWorkflowDefinition({
    tenantId: identity.tenantId,
    processType: "PERIOD_CLOSE",
    code: `WF_PC_${stamp}`,
    name: "Period Close Ready",
    createdByUserId: identity.userId,
  });
  const workflowConsolidationId = await createWorkflowDefinition({
    tenantId: identity.tenantId,
    processType: "CONSOLIDATION_RUN",
    code: `WF_CR_${stamp}`,
    name: "Consolidation Ready",
    createdByUserId: identity.userId,
  });
  await assignWorkflowDefinition({
    tenantId: identity.tenantId,
    processType: "PERIOD_CLOSE",
    workflowDefinitionId: workflowPeriodCloseId,
    createdByUserId: identity.userId,
  });
  await assignWorkflowDefinition({
    tenantId: identity.tenantId,
    processType: "CONSOLIDATION_RUN",
    workflowDefinitionId: workflowConsolidationId,
    createdByUserId: identity.userId,
  });

  const server = startServerProcess({ port: PORT });
  try {
    await waitForServer({ baseUrl: BASE_URL });

    const adminToken = await login({
      baseUrl: BASE_URL,
      email: adminEmail,
      password: TEST_PASSWORD,
    });
    const scopedToken = await login({
      baseUrl: BASE_URL,
      email: scopedUser.email,
      password: TEST_PASSWORD,
    });

    const adminAll = await apiRequest({
      baseUrl: BASE_URL,
      token: adminToken,
      method: "GET",
      requestPath: "/api/v1/onboarding/legal-entity-activation",
      expectedStatus: 200,
    });
    assert(
      adminAll.json?.stage === "LEGAL_ENTITY_ACTIVATION",
      "Activation readiness response must expose LEGAL_ENTITY_ACTIVATION stage",
    );
    assert(
      Array.isArray(adminAll.json?.byLegalEntity) &&
        adminAll.json.byLegalEntity.length === 3,
      "Admin should receive all three activation rows",
    );

    const noShareholderRow = findEntityRow(adminAll.json, noShareholder.legalEntityId);
    const missingMappingsRow = findEntityRow(adminAll.json, missingMappings.legalEntityId);
    const readyRow = findEntityRow(adminAll.json, readyEntity.legalEntityId);
    assert(noShareholderRow, "No-shareholder activation row is missing");
    assert(missingMappingsRow, "Missing-mappings activation row is missing");
    assert(readyRow, "Ready activation row is missing");

    const noShareholderBaseCheck = findCheck(noShareholderRow, "baseAccountingStructure");
    const noShareholderShareholderCheck = findCheck(noShareholderRow, "shareholderActivation");
    assert(
      noShareholderBaseCheck?.ready === true,
      "Base accounting structure should be ready when books, CoA, and periods exist",
    );
    assert(
      noShareholderShareholderCheck?.ready === false &&
        noShareholderShareholderCheck?.blockerCode === "MISSING_SHAREHOLDER_MASTER",
      "Entity without shareholder master rows must block shareholder activation",
    );

    const missingMappingsShareholderCheck = findCheck(
      missingMappingsRow,
      "shareholderActivation",
    );
    assert(
      missingMappingsShareholderCheck?.details?.shareholderMasterPresent === true,
      "Shareholder master presence must be detected",
    );
    assert(
      missingMappingsShareholderCheck?.ready === false &&
        missingMappingsShareholderCheck?.blockerCode ===
          "SHAREHOLDER_PARENT_MAPPING_INCOMPLETE",
      "Entity with shareholder master but missing parent mappings must stay blocked",
    );

    const readyShareholderCheck = findCheck(readyRow, "shareholderActivation");
    assert(
      readyShareholderCheck?.ready === true,
      "Entity with shareholder master and parent mappings must be ready",
    );
    assert(
      readyRow.ready === true && readyRow.status === "READY",
      "Entity with all activation checks satisfied should be READY",
    );

    const scopedVisible = await apiRequest({
      baseUrl: BASE_URL,
      token: scopedToken,
      method: "GET",
      requestPath: "/api/v1/onboarding/legal-entity-activation",
      expectedStatus: 200,
    });
    const scopedIds = (scopedVisible.json?.byLegalEntity || []).map((row) =>
      Number(row.legalEntityId),
    );
    assert(
      scopedIds.length === 2 &&
        scopedIds.includes(noShareholder.legalEntityId) &&
        scopedIds.includes(missingMappings.legalEntityId) &&
        !scopedIds.includes(readyEntity.legalEntityId),
      "Country-scoped user must only receive visible legal entities on the no-param Option B route",
    );

    await apiRequest({
      baseUrl: BASE_URL,
      token: scopedToken,
      method: "GET",
      requestPath: `/api/v1/onboarding/legal-entity-activation?legalEntityId=${readyEntity.legalEntityId}`,
      expectedStatus: 403,
    });

    const explicitVisible = await apiRequest({
      baseUrl: BASE_URL,
      token: scopedToken,
      method: "GET",
      requestPath: `/api/v1/onboarding/legal-entity-activation?legalEntityId=${noShareholder.legalEntityId}`,
      expectedStatus: 200,
    });
    assert(
      Array.isArray(explicitVisible.json?.byLegalEntity) &&
        explicitVisible.json.byLegalEntity.length === 1 &&
        Number(explicitVisible.json.byLegalEntity[0]?.legalEntityId) ===
          noShareholder.legalEntityId,
      "Explicit in-scope legalEntityId should return one filtered activation row",
    );

    console.log("legal-entity activation readiness regression passed.");
  } finally {
    server.kill("SIGTERM");
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
