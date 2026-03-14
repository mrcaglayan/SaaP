import { query } from "../db.js";

export async function findGroupCompanyByCode({ tenantId, code }) {
  const result = await query(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );

  return result.rows[0] || null;
}

export async function upsertGroupCompanyRow({ tenantId, code, name }) {
  const result = await query(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
     name = VALUES(name)`,
    [tenantId, code, name]
  );

  return result.rows?.insertId || null;
}

export async function upsertLegalEntityRowTx(
  tx,
  {
    tenantId,
    groupCompanyId,
    code,
    name,
    taxId,
    countryId,
    functionalCurrencyCode,
    isIntercompanyEnabled,
    intercompanyPartnerRequired,
  }
) {
  const result = await tx.query(
    `INSERT INTO legal_entities (
        tenant_id,
        group_company_id,
        code,
        name,
        tax_id,
        country_id,
        functional_currency_code,
        is_intercompany_enabled,
        intercompany_partner_required
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       tax_id = VALUES(tax_id),
       country_id = VALUES(country_id),
       functional_currency_code = VALUES(functional_currency_code),
       group_company_id = VALUES(group_company_id),
       is_intercompany_enabled = VALUES(is_intercompany_enabled),
       intercompany_partner_required = VALUES(intercompany_partner_required)`,
    [
      tenantId,
      groupCompanyId,
      code,
      name,
      taxId,
      countryId,
      functionalCurrencyCode,
      isIntercompanyEnabled,
      intercompanyPartnerRequired,
    ]
  );

  return result.rows?.insertId || null;
}

export async function upsertOperatingUnitRow({
  tenantId,
  legalEntityId,
  code,
  name,
  unitType,
  hasSubledger,
  centralDueFromAccountId,
  centralDueToAccountId,
  ouDueFromCentralAccountId,
  ouDueToCentralAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `INSERT INTO operating_units (
        tenant_id,
        legal_entity_id,
        code,
        name,
        unit_type,
        has_subledger,
        central_due_from_account_id,
        central_due_to_account_id,
        ou_due_from_central_account_id,
        ou_due_to_central_account_id
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       name = VALUES(name),
       unit_type = VALUES(unit_type),
       has_subledger = VALUES(has_subledger),
       central_due_from_account_id = VALUES(central_due_from_account_id),
       central_due_to_account_id = VALUES(central_due_to_account_id),
       ou_due_from_central_account_id = VALUES(ou_due_from_central_account_id),
       ou_due_to_central_account_id = VALUES(ou_due_to_central_account_id)`,
    [
      tenantId,
      legalEntityId,
      code,
      name,
      unitType,
      hasSubledger,
      centralDueFromAccountId || null,
      centralDueToAccountId || null,
      ouDueFromCentralAccountId || null,
      ouDueToCentralAccountId || null,
    ]
  );

  return result.rows?.insertId || null;
}

export async function upsertOperatingUnitCurrentAccountConfigRow({
  tenantId,
  legalEntityId,
  dueFromParentAccountId,
  dueToParentAccountId,
  autoProvisionOnOperatingUnitCreate = true,
  runQuery = query,
}) {
  const result = await runQuery(
    `INSERT INTO operating_unit_current_account_configs (
        tenant_id,
        legal_entity_id,
        due_from_parent_account_id,
        due_to_parent_account_id,
        auto_provision_on_operating_unit_create
      )
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       due_from_parent_account_id = VALUES(due_from_parent_account_id),
       due_to_parent_account_id = VALUES(due_to_parent_account_id),
       auto_provision_on_operating_unit_create = VALUES(auto_provision_on_operating_unit_create),
       updated_at = CURRENT_TIMESTAMP`,
    [
      tenantId,
      legalEntityId,
      dueFromParentAccountId,
      dueToParentAccountId,
      autoProvisionOnOperatingUnitCreate,
    ]
  );

  return result.rows?.insertId || null;
}

export async function updateOperatingUnitInternalCurrentAccountsRow({
  tenantId,
  operatingUnitId,
  centralDueFromAccountId,
  centralDueToAccountId,
  ouDueFromCentralAccountId,
  ouDueToCentralAccountId,
  runQuery = query,
}) {
  await runQuery(
    `UPDATE operating_units
     SET central_due_from_account_id = ?,
         central_due_to_account_id = ?,
         ou_due_from_central_account_id = ?,
         ou_due_to_central_account_id = ?
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [
      centralDueFromAccountId || null,
      centralDueToAccountId || null,
      ouDueFromCentralAccountId || null,
      ouDueToCentralAccountId || null,
      tenantId,
      operatingUnitId,
    ]
  );

  return operatingUnitId;
}

export async function findOperatingUnitCurrentAccountConfigRowTx(
  tx,
  {
    tenantId,
    legalEntityId,
  }
) {
  const result = await tx.query(
    `SELECT
       le.id AS legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       cfg.id AS operating_unit_current_account_config_id,
       cfg.due_from_parent_account_id,
       dfa.code AS due_from_parent_account_code,
       dfa.name AS due_from_parent_account_name,
       cfg.due_to_parent_account_id,
       dta.code AS due_to_parent_account_code,
       dta.name AS due_to_parent_account_name,
       cfg.auto_provision_on_operating_unit_create,
       cfg.last_applied_at,
       cfg.created_at,
       cfg.updated_at
     FROM legal_entities le
     LEFT JOIN operating_unit_current_account_configs cfg
       ON cfg.tenant_id = le.tenant_id
      AND cfg.legal_entity_id = le.id
     LEFT JOIN accounts dfa ON dfa.id = cfg.due_from_parent_account_id
     LEFT JOIN accounts dta ON dta.id = cfg.due_to_parent_account_id
     WHERE le.tenant_id = ?
       AND le.id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );

  const row = result.rows?.[0] || null;
  return row?.operating_unit_current_account_config_id ? row : null;
}

export async function markOperatingUnitCurrentAccountConfigAppliedRow({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  await runQuery(
    `UPDATE operating_unit_current_account_configs
     SET last_applied_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
}

export async function upsertOperatingUnitPartnerCurrentAccountRow({
  tenantId,
  legalEntityId,
  operatingUnitId,
  partnerOperatingUnitId,
  dueFromAccountId,
  dueToAccountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `INSERT INTO operating_unit_partner_current_accounts (
        tenant_id,
        legal_entity_id,
        operating_unit_id,
        partner_operating_unit_id,
        due_from_account_id,
        due_to_account_id
      )
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       legal_entity_id = VALUES(legal_entity_id),
       due_from_account_id = VALUES(due_from_account_id),
       due_to_account_id = VALUES(due_to_account_id)`,
    [
      tenantId,
      legalEntityId,
      operatingUnitId,
      partnerOperatingUnitId,
      dueFromAccountId,
      dueToAccountId,
    ]
  );

  return result.rows?.insertId || null;
}

export async function upsertFiscalCalendarRow({
  tenantId,
  code,
  name,
  yearStartMonth,
  yearStartDay,
}) {
  const result = await query(
    `INSERT INTO fiscal_calendars (
        tenant_id, code, name, year_start_month, year_start_day
      )
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       year_start_month = VALUES(year_start_month),
       year_start_day = VALUES(year_start_day)`,
    [tenantId, code, name, yearStartMonth, yearStartDay]
  );

  return result.rows?.insertId || null;
}

export async function upsertFiscalPeriodRow({
  calendarId,
  fiscalYear,
  periodNo,
  periodName,
  startDate,
  endDate,
}) {
  await query(
    `INSERT INTO fiscal_periods (
        calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
     )
     VALUES (?, ?, ?, ?, ?, ?, FALSE)
     ON DUPLICATE KEY UPDATE
       period_name = VALUES(period_name),
       start_date = VALUES(start_date),
       end_date = VALUES(end_date)`,
    [calendarId, fiscalYear, periodNo, periodName, startDate, endDate]
  );
}

export async function upsertJournalPurposeAccountTx(
  tx,
  {
    tenantId,
    legalEntityId,
    purposeCode,
    accountId,
  }
) {
  await tx.query(
    `INSERT INTO journal_purpose_accounts (
        tenant_id,
        legal_entity_id,
        purpose_code,
        account_id
     )
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       account_id = VALUES(account_id),
       updated_at = CURRENT_TIMESTAMP`,
    [tenantId, legalEntityId, purposeCode, accountId]
  );
}

export async function findShareholderJournalConfigRowTx(
  tx,
  {
    tenantId,
    legalEntityId,
    capitalPurposeCode,
    commitmentPurposeCode,
  }
) {
  const configResult = await tx.query(
    `SELECT
       le.id AS legal_entity_id,
       le.code AS legal_entity_code,
       le.name AS legal_entity_name,
       cap.account_id AS capital_credit_parent_account_id,
       capa.code AS capital_credit_parent_account_code,
       capa.name AS capital_credit_parent_account_name,
       deb.account_id AS commitment_debit_parent_account_id,
       deba.code AS commitment_debit_parent_account_code,
       deba.name AS commitment_debit_parent_account_name
     FROM legal_entities le
     LEFT JOIN journal_purpose_accounts cap
       ON cap.tenant_id = le.tenant_id
      AND cap.legal_entity_id = le.id
      AND cap.purpose_code = ?
     LEFT JOIN accounts capa ON capa.id = cap.account_id
     LEFT JOIN journal_purpose_accounts deb
       ON deb.tenant_id = le.tenant_id
      AND deb.legal_entity_id = le.id
      AND deb.purpose_code = ?
     LEFT JOIN accounts deba ON deba.id = deb.account_id
     WHERE le.tenant_id = ?
       AND le.id = ?
     LIMIT 1`,
    [capitalPurposeCode, commitmentPurposeCode, tenantId, legalEntityId]
  );

  return configResult.rows[0] || null;
}
