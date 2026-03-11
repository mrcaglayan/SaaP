import { closePool, query } from "../src/db.js";
import {
  approveWorkflowInstance,
  evaluateWorkflowApprovalGate,
} from "../src/services/workflows.service.js";
import {
  buildTaxJournalLines,
  computeTaxBreakdown,
  resolveTaxAccounts,
  resolveTaxCodeAndRule,
} from "../src/services/tax.engine.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseTenantIds(argv) {
  const parsed = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) {
      continue;
    }
    if (token.startsWith("--tenantIds=")) {
      for (const part of token.split("=")[1].split(",")) {
        const id = parsePositiveInt(part.trim());
        if (id) {
          parsed.push(id);
        }
      }
      continue;
    }
    if (token === "--tenantIds") {
      for (const part of String(argv[i + 1] || "").split(",")) {
        const id = parsePositiveInt(part.trim());
        if (id) {
          parsed.push(id);
        }
      }
      i += 1;
    }
  }
  const unique = Array.from(new Set(parsed));
  if (unique.length > 0) {
    return unique.sort((a, b) => a - b);
  }
  return [];
}

async function listOperationalSmokeCandidateTenantIds() {
  const result = await query(
    `SELECT DISTINCT t.id
     FROM tenants t
     JOIN users u
       ON u.tenant_id = t.id
      AND u.status = 'ACTIVE'
     ORDER BY t.id ASC`
  );
  const discovered = (result.rows || [])
    .map((row) => parsePositiveInt(row.id))
    .filter(Boolean);
  const priority = [1, 2];
  const discoveredSet = new Set(discovered);
  const prioritized = [
    ...priority.filter((tenantId) => discoveredSet.has(tenantId)),
    ...discovered.filter((tenantId) => !priority.includes(tenantId)),
  ];
  return Array.from(new Set(prioritized));
}

async function resolveAnyWorkflowPermissionCodeForUser(tenantId, userId) {
  const result = await query(
    `SELECT
       p.code,
       SUM(CASE WHEN urs.effect = 'ALLOW' THEN 1 ELSE 0 END) AS allow_count,
       SUM(CASE WHEN urs.effect = 'DENY' AND urs.scope_type = 'TENANT' THEN 1 ELSE 0 END) AS tenant_deny_count
     FROM user_role_scopes urs
     JOIN roles r ON r.id = urs.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE urs.tenant_id = ?
       AND urs.user_id = ?
     GROUP BY p.code
     HAVING allow_count > 0
        AND tenant_deny_count = 0
     ORDER BY p.code ASC`,
    [tenantId, userId]
  );
  const code = String(result.rows?.[0]?.code || "").trim();
  assert(code, `No usable permission code found for tenant ${tenantId} approver user ${userId}`);
  return code;
}

async function ensureTenantCoreContext(tenantId) {
  const bookRes = await query(
    `SELECT
       b.id AS book_id,
       b.calendar_id,
       b.base_currency_code,
       le.id AS legal_entity_id,
       le.group_company_id,
       le.country_id
     FROM books b
     JOIN legal_entities le ON le.id = b.legal_entity_id
     WHERE b.tenant_id = ?
     ORDER BY b.id ASC
     LIMIT 1`,
    [tenantId]
  );
  const existingBook = bookRes.rows?.[0] || null;
  if (
    parsePositiveInt(existingBook?.book_id) &&
    parsePositiveInt(existingBook?.calendar_id) &&
    parsePositiveInt(existingBook?.legal_entity_id)
  ) {
    return {
      bookId: parsePositiveInt(existingBook.book_id),
      calendarId: parsePositiveInt(existingBook.calendar_id),
      legalEntityId: parsePositiveInt(existingBook.legal_entity_id),
      groupCompanyId: parsePositiveInt(existingBook.group_company_id),
      countryId: parsePositiveInt(existingBook.country_id),
      currencyCode: String(existingBook.base_currency_code || "USD").trim().toUpperCase(),
    };
  }

  const legalEntityRes = await query(
    `SELECT id, group_company_id, country_id, functional_currency_code
     FROM legal_entities
     WHERE tenant_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );
  let legalEntity = legalEntityRes.rows?.[0] || null;

  if (!legalEntity) {
    const countryRes = await query(
      `SELECT id, default_currency_code
       FROM countries
       ORDER BY id ASC
       LIMIT 1`
    );
    const country = countryRes.rows?.[0] || null;
    const countryId = parsePositiveInt(country?.id);
    const currencyCode = String(country?.default_currency_code || "USD")
      .trim()
      .toUpperCase();
    assert(countryId, "Unable to bootstrap tenant core context: countries table is empty");

    let groupCompanyId = null;
    const groupRes = await query(
      `SELECT id
       FROM group_companies
       WHERE tenant_id = ?
       ORDER BY id ASC
       LIMIT 1`,
      [tenantId]
    );
    groupCompanyId = parsePositiveInt(groupRes.rows?.[0]?.id);
    if (!groupCompanyId) {
      const groupCode = `PRF13GC${tenantId}`;
      await query(
        `INSERT INTO group_companies (tenant_id, code, name)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [tenantId, groupCode, `PRF13 Smoke Group ${tenantId}`]
      );
      const newGroupRes = await query(
        `SELECT id
         FROM group_companies
         WHERE tenant_id = ?
           AND code = ?
         LIMIT 1`,
        [tenantId, groupCode]
      );
      groupCompanyId = parsePositiveInt(newGroupRes.rows?.[0]?.id);
    }
    assert(groupCompanyId, `Unable to resolve group company for tenant ${tenantId}`);

    const entityCode = `PRF13LE${tenantId}`;
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
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE
         group_company_id = VALUES(group_company_id),
         country_id = VALUES(country_id),
         functional_currency_code = VALUES(functional_currency_code),
         status = 'ACTIVE'`,
      [
        tenantId,
        groupCompanyId,
        entityCode,
        `PRF13 Smoke Legal Entity ${tenantId}`,
        countryId,
        currencyCode,
      ]
    );
    const newEntityRes = await query(
      `SELECT id, group_company_id, country_id, functional_currency_code
       FROM legal_entities
       WHERE tenant_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, entityCode]
    );
    legalEntity = newEntityRes.rows?.[0] || null;
  }

  const legalEntityId = parsePositiveInt(legalEntity?.id);
  const groupCompanyId = parsePositiveInt(legalEntity?.group_company_id);
  const countryId = parsePositiveInt(legalEntity?.country_id);
  const currencyCode = String(legalEntity?.functional_currency_code || "USD")
    .trim()
    .toUpperCase();
  assert(legalEntityId && groupCompanyId && countryId, `Unable to resolve legal entity context for tenant ${tenantId}`);

  let calendarId = null;
  const calendarRes = await query(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );
  calendarId = parsePositiveInt(calendarRes.rows?.[0]?.id);
  if (!calendarId) {
    const calendarCode = `PRF13CAL${tenantId}`;
    await query(
      `INSERT INTO fiscal_calendars (
         tenant_id,
         code,
         name,
         year_start_month,
         year_start_day
       )
       VALUES (?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [tenantId, calendarCode, `PRF13 Smoke Calendar ${tenantId}`]
    );
    const newCalendarRes = await query(
      `SELECT id
       FROM fiscal_calendars
       WHERE tenant_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, calendarCode]
    );
    calendarId = parsePositiveInt(newCalendarRes.rows?.[0]?.id);
  }
  assert(calendarId, `Unable to resolve fiscal calendar for tenant ${tenantId}`);

  const periodRes = await query(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
     ORDER BY fiscal_year DESC, period_no DESC, id DESC
     LIMIT 1`,
    [calendarId]
  );
  if (!parsePositiveInt(periodRes.rows?.[0]?.id)) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const periodNo = now.getUTCMonth() + 1;
    const startDate = `${year}-${String(periodNo).padStart(2, "0")}-01`;
    const nextMonth = periodNo === 12 ? 1 : periodNo + 1;
    const nextMonthYear = periodNo === 12 ? year + 1 : year;
    const endDateObj = new Date(Date.UTC(nextMonthYear, nextMonth - 1, 0));
    const endDate = endDateObj.toISOString().slice(0, 10);
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
       VALUES (?, ?, ?, ?, ?, ?, FALSE)
       ON DUPLICATE KEY UPDATE
         period_name = VALUES(period_name),
         start_date = VALUES(start_date),
         end_date = VALUES(end_date)`,
      [calendarId, year, periodNo, `M${periodNo}`, startDate, endDate]
    );
  }

  let bookId = null;
  const bookByEntityRes = await query(
    `SELECT id
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  bookId = parsePositiveInt(bookByEntityRes.rows?.[0]?.id);
  if (!bookId) {
    const bookCode = `PRF13BOOK${tenantId}`;
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
       VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)
       ON DUPLICATE KEY UPDATE
         calendar_id = VALUES(calendar_id),
         base_currency_code = VALUES(base_currency_code),
         name = VALUES(name)`,
      [
        tenantId,
        legalEntityId,
        calendarId,
        bookCode,
        `PRF13 Smoke Book ${tenantId}`,
        currencyCode,
      ]
    );
    const newBookRes = await query(
      `SELECT id
       FROM books
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, legalEntityId, bookCode]
    );
    bookId = parsePositiveInt(newBookRes.rows?.[0]?.id);
  }
  assert(bookId, `Unable to resolve book for tenant ${tenantId}`);

  return {
    bookId,
    calendarId,
    legalEntityId,
    groupCompanyId,
    countryId,
    currencyCode,
  };
}

async function ensureConsolidationGroupForTenant({
  tenantId,
  requesterUserId,
  groupCompanyId,
  calendarId,
  currencyCode,
}) {
  const existingRes = await query(
    `SELECT id
     FROM consolidation_groups
     WHERE tenant_id = ?
       AND group_company_id IS NOT NULL
       AND calendar_id IS NOT NULL
       AND presentation_currency_code IS NOT NULL
       AND presentation_currency_code <> ''
       AND status = 'ACTIVE'
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );
  const existingId = parsePositiveInt(existingRes.rows?.[0]?.id);
  if (existingId) {
    return existingId;
  }

  const code = `PRF13CG${tenantId}`;
  await query(
    `INSERT INTO consolidation_groups (
       tenant_id,
       group_company_id,
       calendar_id,
       code,
       name,
       presentation_currency_code,
       status
     )
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       group_company_id = VALUES(group_company_id),
       calendar_id = VALUES(calendar_id),
       presentation_currency_code = VALUES(presentation_currency_code),
       status = 'ACTIVE'`,
    [
      tenantId,
      groupCompanyId,
      calendarId,
      code,
      `PRF13 Smoke Consolidation Group ${tenantId}`,
      currencyCode,
    ]
  );
  const groupRes = await query(
    `SELECT id
     FROM consolidation_groups
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const groupId = parsePositiveInt(groupRes.rows?.[0]?.id);
  assert(groupId, `Unable to create consolidation group for tenant ${tenantId}`);
  return groupId;
}

async function ensureWorkflowGateSetup({
  tenantId,
  requesterUserId,
  legalEntityId,
  groupCompanyId,
  requiredPermissionCode,
}) {
  await query(
    `INSERT INTO tenant_features (
       tenant_id,
       feature_code,
       is_enabled,
       updated_by_user_id
     )
     VALUES (?, 'FEATURE_WORKFLOW_CLOSE_CONSOLIDATION_V1', 1, ?)
     ON DUPLICATE KEY UPDATE
       is_enabled = 1,
       updated_by_user_id = VALUES(updated_by_user_id)`,
    [tenantId, requesterUserId]
  );

  const processes = [
    {
      processType: "PERIOD_CLOSE",
      scopeColumn: "legal_entity_id",
      scopeValue: legalEntityId,
      code: `PRF13_OP_PERIOD_CLOSE_T${tenantId}`,
    },
    {
      processType: "CONSOLIDATION_RUN",
      scopeColumn: "group_company_id",
      scopeValue: groupCompanyId,
      code: `PRF13_OP_CONSOLIDATION_T${tenantId}`,
    },
  ];

  for (const process of processes) {
    // eslint-disable-next-line no-await-in-loop
    const definitionRes = await query(
      `SELECT id
       FROM workflow_definitions
       WHERE tenant_id = ?
         AND code = ?
         AND version_no = 1
       LIMIT 1`,
      [tenantId, process.code]
    );
    let definitionId = parsePositiveInt(definitionRes.rows?.[0]?.id);
    if (!definitionId) {
      // eslint-disable-next-line no-await-in-loop
      const insertDefRes = await query(
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
        [
          tenantId,
          process.code,
          `${process.processType} PRF13 Operational Smoke`,
          process.processType,
          requesterUserId,
        ]
      );
      definitionId = parsePositiveInt(insertDefRes.rows?.insertId);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `UPDATE workflow_definitions
         SET is_active = TRUE
         WHERE tenant_id = ?
           AND id = ?`,
        [tenantId, definitionId]
      );
    }
    assert(definitionId, `Unable to resolve workflow definition for ${process.processType} tenant ${tenantId}`);

    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE FROM workflow_definition_steps
       WHERE workflow_definition_id = ?`,
      [definitionId]
    );
    // eslint-disable-next-line no-await-in-loop
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
       VALUES (?, 1, 'GROUP', ?, 1, FALSE, NULL)`,
      [definitionId, requiredPermissionCode]
    );

    // eslint-disable-next-line no-await-in-loop
    const existingAssignmentRes = await query(
      `SELECT id
       FROM workflow_assignments
       WHERE tenant_id = ?
         AND process_type = ?
         AND workflow_definition_id = ?
         AND ${process.scopeColumn} = ?
       ORDER BY id DESC
       LIMIT 1`,
      [tenantId, process.processType, definitionId, process.scopeValue]
    );
    const assignmentId = parsePositiveInt(existingAssignmentRes.rows?.[0]?.id);
    if (assignmentId) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `UPDATE workflow_assignments
         SET status = 'ACTIVE',
             effective_from = '2000-01-01',
             effective_to = NULL
         WHERE tenant_id = ?
           AND id = ?`,
        [tenantId, assignmentId]
      );
    } else {
      // eslint-disable-next-line no-await-in-loop
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
         VALUES (?, ?, ?, ?, ?, NULL, '2000-01-01', NULL, 'ACTIVE', ?)`,
        [
          tenantId,
          process.processType,
          definitionId,
          process.processType === "CONSOLIDATION_RUN" ? process.scopeValue : null,
          process.processType === "PERIOD_CLOSE" ? process.scopeValue : null,
          requesterUserId,
        ]
      );
    }
  }
}

async function ensurePostingAccountForTaxMapping({ tenantId, legalEntityId }) {
  const existingRes = await query(
    `SELECT
       a.id AS account_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.scope = 'LEGAL_ENTITY'
       AND c.legal_entity_id = ?
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE
     ORDER BY a.id ASC
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const existingId = parsePositiveInt(existingRes.rows?.[0]?.account_id);
  if (existingId) {
    return existingId;
  }

  let coaId = null;
  const coaRes = await query(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND scope = 'LEGAL_ENTITY'
       AND legal_entity_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  coaId = parsePositiveInt(coaRes.rows?.[0]?.id);
  if (!coaId) {
    const coaCode = `PRF13COA${tenantId}`;
    await query(
      `INSERT INTO charts_of_accounts (
         tenant_id,
         legal_entity_id,
         scope,
         code,
         name
       )
       VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)
       ON DUPLICATE KEY UPDATE
         legal_entity_id = VALUES(legal_entity_id),
         name = VALUES(name)`,
      [tenantId, legalEntityId, coaCode, `PRF13 Smoke CoA ${tenantId}`]
    );
    const newCoaRes = await query(
      `SELECT id
       FROM charts_of_accounts
       WHERE tenant_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, coaCode]
    );
    coaId = parsePositiveInt(newCoaRes.rows?.[0]?.id);
  }
  assert(coaId, `Unable to resolve CoA for tax mapping tenant ${tenantId}`);

  const accountCode = `VATMAP${tenantId}`;
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
     VALUES (?, ?, ?, 'LIABILITY', 'CREDIT', TRUE, NULL, TRUE)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       allow_posting = TRUE,
       is_active = TRUE`,
    [coaId, accountCode, `PRF13 VAT Mapping ${tenantId}`]
  );
  const accountRes = await query(
    `SELECT id
     FROM accounts
     WHERE coa_id = ?
       AND code = ?
     LIMIT 1`,
    [coaId, accountCode]
  );
  const accountId = parsePositiveInt(accountRes.rows?.[0]?.id);
  assert(accountId, `Unable to create tax mapping account for tenant ${tenantId}`);
  return accountId;
}

async function ensureTaxPipelineFixture({
  tenantId,
  requesterUserId,
  legalEntityId,
  countryId,
  currencyCode,
}) {
  const accountId = await ensurePostingAccountForTaxMapping({
    tenantId,
    legalEntityId,
  });

  let regimeId = null;
  const regimeRes = await query(
    `SELECT id
     FROM tax_regimes
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = 'PRF13_OP_VAT8'
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  regimeId = parsePositiveInt(regimeRes.rows?.[0]?.id);
  if (!regimeId) {
    const insertRes = await query(
      `INSERT INTO tax_regimes (
         tenant_id,
         country_id,
         legal_entity_id,
         code,
         name,
         currency_code,
         effective_from,
         effective_to,
         status,
         created_by_user_id
       )
       VALUES (?, ?, ?, 'PRF13_OP_VAT8', 'PRF13 Operational VAT 8', ?, '2000-01-01', NULL, 'ACTIVE', ?)`,
      [tenantId, countryId, legalEntityId, currencyCode, requesterUserId]
    );
    regimeId = parsePositiveInt(insertRes.rows?.insertId);
  } else {
    await query(
      `UPDATE tax_regimes
       SET status = 'ACTIVE',
           effective_from = '2000-01-01',
           effective_to = NULL
       WHERE tenant_id = ?
         AND id = ?`,
      [tenantId, regimeId]
    );
  }
  assert(regimeId, `Unable to resolve tax regime fixture for tenant ${tenantId}`);

  let taxCodeId = null;
  const codeRes = await query(
    `SELECT id
     FROM tax_codes
     WHERE tenant_id = ?
       AND tax_regime_id = ?
       AND code = 'VAT8'
     ORDER BY id DESC
     LIMIT 1`,
    [tenantId, regimeId]
  );
  taxCodeId = parsePositiveInt(codeRes.rows?.[0]?.id);
  if (!taxCodeId) {
    const insertRes = await query(
      `INSERT INTO tax_codes (
         tenant_id,
         tax_regime_id,
         code,
         name,
         tax_kind,
         rate_pct,
         calculation_mode,
         recoverability,
         is_reverse_charge,
         status
       )
       VALUES (?, ?, 'VAT8', 'VAT 8%', 'VAT', 8, 'EXCLUSIVE', 'FULL', FALSE, 'ACTIVE')`,
      [tenantId, regimeId]
    );
    taxCodeId = parsePositiveInt(insertRes.rows?.insertId);
  } else {
    await query(
      `UPDATE tax_codes
       SET status = 'ACTIVE',
           tax_kind = 'VAT',
           rate_pct = 8,
           calculation_mode = 'EXCLUSIVE',
           recoverability = 'FULL',
           is_reverse_charge = FALSE
       WHERE tenant_id = ?
         AND id = ?`,
      [tenantId, taxCodeId]
    );
  }
  assert(taxCodeId, `Unable to resolve VAT8 tax code fixture for tenant ${tenantId}`);

  const ruleRes = await query(
    `SELECT id
     FROM tax_rule_sets
     WHERE tenant_id = ?
       AND tax_regime_id = ?
       AND tax_code_id = ?
       AND module_code = 'CARI'
       AND document_type = 'INVOICE'
       AND counterparty_type = 'CUSTOMER'
     ORDER BY apply_priority ASC, id ASC
     LIMIT 1`,
    [tenantId, regimeId, taxCodeId]
  );
  const ruleId = parsePositiveInt(ruleRes.rows?.[0]?.id);
  if (!ruleId) {
    await query(
      `INSERT INTO tax_rule_sets (
         tenant_id,
         tax_regime_id,
         tax_code_id,
         module_code,
         document_type,
         counterparty_type,
         apply_priority,
         threshold_amount,
         formula_json,
         status,
         effective_from,
         effective_to
       )
       VALUES (?, ?, ?, 'CARI', 'INVOICE', 'CUSTOMER', 1, NULL, JSON_OBJECT('type', 'RATE'), 'ACTIVE', '2000-01-01', NULL)`,
      [tenantId, regimeId, taxCodeId]
    );
  } else {
    await query(
      `UPDATE tax_rule_sets
       SET status = 'ACTIVE',
           effective_from = '2000-01-01',
           effective_to = NULL,
           threshold_amount = NULL,
           formula_json = JSON_OBJECT('type', 'RATE')
       WHERE tenant_id = ?
         AND id = ?`,
      [tenantId, ruleId]
    );
  }

  await query(
    `INSERT INTO tax_account_mappings (
       tenant_id,
       tax_regime_id,
       legal_entity_id,
       tax_code_id,
       tax_purpose_code,
       account_id,
       status
     )
     VALUES (?, ?, ?, ?, 'VAT_OUTPUT', ?, 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       account_id = VALUES(account_id),
       status = 'ACTIVE'`,
    [tenantId, regimeId, legalEntityId, taxCodeId, accountId]
  );
}

async function ensureApproverUserForTenant(tenantId) {
  const requesterRes = await query(
    `SELECT id, email, password_hash
     FROM users
     WHERE tenant_id = ?
       AND status = 'ACTIVE'
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId]
  );
  const requester = requesterRes.rows?.[0] || null;
  const requesterUserId = parsePositiveInt(requester?.id);
  assert(requesterUserId, `No ACTIVE requester user found for tenant ${tenantId}`);

  const approverEmail = `prf13.smoke.approver+${tenantId}@local.test`;
  const existingApproverRes = await query(
    `SELECT id
     FROM users
     WHERE tenant_id = ?
       AND email = ?
     LIMIT 1`,
    [tenantId, approverEmail]
  );
  let approverUserId = parsePositiveInt(existingApproverRes.rows?.[0]?.id);

  if (!approverUserId) {
    const fallbackHash =
      String(requester?.password_hash || "").trim() ||
      "$2b$10$O/zv0FuGBFOdXQMJHKb44eTTG44nhAqVNowUyM9dn49GfmGtapaj2";
    await query(
      `INSERT INTO users (tenant_id, email, password_hash, name, status)
       VALUES (?, ?, ?, ?, 'ACTIVE')`,
      [tenantId, approverEmail, fallbackHash, `PR-F13 Smoke Approver T${tenantId}`]
    );
    const createdApproverRes = await query(
      `SELECT id
       FROM users
       WHERE tenant_id = ?
         AND email = ?
       LIMIT 1`,
      [tenantId, approverEmail]
    );
    approverUserId = parsePositiveInt(createdApproverRes.rows?.[0]?.id);
  }

  assert(approverUserId, `Failed to create/resolve approver user for tenant ${tenantId}`);
  assert(
    approverUserId !== requesterUserId,
    `Approver user must differ from requester user for maker-checker (tenant ${tenantId})`
  );

  const roleRes = await query(
    `SELECT id
     FROM roles
     WHERE tenant_id = ?
       AND code = 'TenantAdmin'
     LIMIT 1`,
    [tenantId]
  );
  const roleId = parsePositiveInt(roleRes.rows?.[0]?.id);
  assert(roleId, `Missing TenantAdmin role for tenant ${tenantId}`);

  await query(
    `INSERT INTO user_role_scopes (
       tenant_id,
       user_id,
       role_id,
       scope_type,
       scope_id,
       effect
     )
     VALUES (?, ?, ?, 'TENANT', ?, 'ALLOW')
     ON DUPLICATE KEY UPDATE
       effect = VALUES(effect)`,
    [tenantId, approverUserId, roleId, tenantId]
  );

  return {
    requesterUserId,
    approverUserId,
    approverEmail,
  };
}

async function createTempPeriodCloseRun(tenantId, requesterUserId) {
  const bookRes = await query(
    `SELECT
       b.id AS book_id,
       b.calendar_id,
       le.id AS legal_entity_id,
       le.group_company_id
     FROM books b
     JOIN legal_entities le ON le.id = b.legal_entity_id
     WHERE b.tenant_id = ?
       AND b.calendar_id IS NOT NULL
       AND le.group_company_id IS NOT NULL
     ORDER BY b.id ASC
     LIMIT 1`,
    [tenantId]
  );
  const book = bookRes.rows?.[0] || null;
  const bookId = parsePositiveInt(book?.book_id);
  const calendarId = parsePositiveInt(book?.calendar_id);
  const legalEntityId = parsePositiveInt(book?.legal_entity_id);
  const groupCompanyId = parsePositiveInt(book?.group_company_id);
  assert(bookId && calendarId && legalEntityId, `Missing book/calendar/legalEntity for tenant ${tenantId}`);

  const periodRes = await query(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
     ORDER BY fiscal_year DESC, period_no DESC, id DESC
     LIMIT 1`,
    [calendarId]
  );
  const fiscalPeriodId = parsePositiveInt(periodRes.rows?.[0]?.id);
  assert(fiscalPeriodId, `Missing fiscal period for calendar ${calendarId}`);

  const insertRes = await query(
    `INSERT INTO period_close_runs (
       tenant_id,
       book_id,
       fiscal_period_id,
       run_hash,
       close_status,
       status,
       year_end_closed,
       source_journal_count,
       source_debit_total,
       source_credit_total,
       started_by_user_id,
       note
     )
     VALUES (
       ?,
       ?,
       ?,
       SHA2(CONCAT('PRF13_OP_SMOKE_', UUID()), 256),
       'SOFT_CLOSED',
       'IN_PROGRESS',
       FALSE,
       0,
       0,
       0,
       ?,
       'PRF13_OP_SMOKE_TMP'
     )`,
    [tenantId, bookId, fiscalPeriodId, requesterUserId]
  );

  const runId = parsePositiveInt(insertRes.rows?.insertId);
  assert(runId, `Failed to create period_close_run for tenant ${tenantId}`);
  return {
    runId,
    legalEntityId,
    groupCompanyId,
  };
}

async function createTempConsolidationRun(tenantId, requesterUserId) {
  const groupRes = await query(
    `SELECT
       cg.id AS consolidation_group_id,
       cg.group_company_id,
       cg.calendar_id,
       cg.presentation_currency_code
     FROM consolidation_groups cg
     WHERE cg.tenant_id = ?
       AND cg.group_company_id IS NOT NULL
       AND cg.calendar_id IS NOT NULL
       AND cg.presentation_currency_code IS NOT NULL
       AND cg.presentation_currency_code <> ''
       AND cg.status = 'ACTIVE'
     ORDER BY cg.id ASC
     LIMIT 1`,
    [tenantId]
  );
  const group = groupRes.rows?.[0] || null;
  const consolidationGroupId = parsePositiveInt(group?.consolidation_group_id);
  const groupCompanyId = parsePositiveInt(group?.group_company_id);
  const calendarId = parsePositiveInt(group?.calendar_id);
  const presentationCurrencyCode = String(group?.presentation_currency_code || "").trim();
  assert(consolidationGroupId && groupCompanyId && calendarId, `Missing active consolidation group for tenant ${tenantId}`);
  assert(presentationCurrencyCode, `Missing presentation currency for consolidation group ${consolidationGroupId}`);

  const periodRes = await query(
    `SELECT id
     FROM fiscal_periods
     WHERE calendar_id = ?
     ORDER BY fiscal_year DESC, period_no DESC, id DESC
     LIMIT 1`,
    [calendarId]
  );
  const fiscalPeriodId = parsePositiveInt(periodRes.rows?.[0]?.id);
  assert(fiscalPeriodId, `Missing fiscal period for consolidation calendar ${calendarId}`);

  const runName = `PRF13_OP_SMOKE_T${tenantId}_${Date.now()}`;
  const insertRes = await query(
    `INSERT INTO consolidation_runs (
       consolidation_group_id,
       fiscal_period_id,
       run_name,
       status,
       presentation_currency_code,
       started_by_user_id,
       notes
     )
     VALUES (?, ?, ?, 'DRAFT', ?, ?, 'PRF13_OP_SMOKE_TMP')`,
    [consolidationGroupId, fiscalPeriodId, runName, presentationCurrencyCode, requesterUserId]
  );
  const runId = parsePositiveInt(insertRes.rows?.insertId);
  assert(runId, `Failed to create consolidation_run for tenant ${tenantId}`);
  return {
    runId,
    groupCompanyId,
  };
}

async function approveGateToCompletion({
  tenantId,
  processType,
  targetType,
  targetId,
  scope,
  requesterUserId,
  approverUserId,
}) {
  const initialGate = await evaluateWorkflowApprovalGate({
    tenantId,
    processType,
    targetType,
    targetId,
    requestedByUserId: requesterUserId,
    scope,
  });
  assert(initialGate.enabled, `Workflow gate not enabled for tenant ${tenantId} ${processType}`);
  assert(initialGate.required, `Workflow gate not required for tenant ${tenantId} ${processType}`);
  const instanceId = parsePositiveInt(initialGate?.instance?.id);
  assert(instanceId, `Missing workflow instance for tenant ${tenantId} ${processType}`);

  let approved = false;
  let stepCount = 0;
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const decision = await approveWorkflowInstance({
      req: { user: { tenantId, userId: approverUserId } },
      input: {
        tenantId,
        instanceId,
        userId: approverUserId,
        decisionNote: `PR-F13 operational smoke approve step ${i + 1}`,
      },
      assertScopeAccess: () => {},
    });
    stepCount = decision?.decisions?.length || stepCount;
    if (String(decision?.row?.status || "").toUpperCase() === "APPROVED") {
      approved = true;
      break;
    }
  }
  assert(approved, `Failed to approve workflow instance ${instanceId} for tenant ${tenantId}`);

  const finalGate = await evaluateWorkflowApprovalGate({
    tenantId,
    processType,
    targetType,
    targetId,
    requestedByUserId: requesterUserId,
    scope,
  });
  assert(finalGate.approved, `Final workflow gate check not approved for tenant ${tenantId} ${processType}`);

  return {
    instanceId,
    stepCount,
  };
}

async function runTaxPipelineSmoke({ tenantId, legalEntityId }) {
  const postingDate = new Date().toISOString().slice(0, 10);
  const resolved = await resolveTaxCodeAndRule({
    tenantId,
    legalEntityId,
    postingDate,
    moduleCode: "CARI",
    taxCode: "VAT8",
    documentType: "INVOICE",
    counterpartyType: "CUSTOMER",
  });
  const breakdown = computeTaxBreakdown({
    baseAmount: 1000,
    mode: resolved.computation.calculationMode,
    ratePct: resolved.computation.ratePct,
    recoverability: resolved.computation.recoverability,
    recoverablePct: resolved.computation.recoverablePct,
  });
  const accounts = await resolveTaxAccounts({
    tenantId,
    legalEntityId,
    taxCodeId: parsePositiveInt(resolved.taxCodeRow?.id),
    taxRegimeId: parsePositiveInt(resolved.regimeRow?.id),
    direction: "SALE",
  });
  const lines = buildTaxJournalLines({
    breakdown,
    taxCode: resolved.taxCodeRow?.code,
    taxPurposeCode: accounts.taxPurposeCode,
    mappingRow: accounts.mappingRow,
    direction: "SALE",
    currencyCode: "USD",
  });
  assert(Array.isArray(lines) && lines.length === 1, `Expected one tax journal line for tenant ${tenantId}`);
  assert(
    Number(lines[0]?.creditBase || 0) > 0,
    `Expected SALE tax journal line creditBase > 0 for tenant ${tenantId}`
  );
  return {
    postingDate,
    taxCode: resolved.taxCodeRow?.code,
    taxPurposeCode: accounts.taxPurposeCode,
    taxAmount: breakdown.taxAmount,
  };
}

async function cleanupSmokeArtifacts(tenantId, periodCloseRunIds, consolidationRunIds, workflowInstanceIds) {
  for (const instanceId of workflowInstanceIds) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE wid
       FROM workflow_instance_decisions wid
       JOIN workflow_instances wi ON wi.id = wid.workflow_instance_id
       WHERE wi.tenant_id = ?
         AND wi.id = ?`,
      [tenantId, instanceId]
    );
    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE FROM workflow_instances
       WHERE tenant_id = ?
         AND id = ?`,
      [tenantId, instanceId]
    );
  }

  for (const runId of periodCloseRunIds) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE FROM period_close_runs
       WHERE tenant_id = ?
         AND id = ?`,
      [tenantId, runId]
    );
  }

  for (const runId of consolidationRunIds) {
    // eslint-disable-next-line no-await-in-loop
    await query(
      `DELETE cr
       FROM consolidation_runs cr
       JOIN consolidation_groups cg ON cg.id = cr.consolidation_group_id
       WHERE cg.tenant_id = ?
         AND cr.id = ?`,
      [tenantId, runId]
    );
  }
}

async function runTenantSmoke(tenantId) {
  const periodCloseRunIds = [];
  const consolidationRunIds = [];
  const workflowInstanceIds = [];

  try {
    const users = await ensureApproverUserForTenant(tenantId);
    const core = await ensureTenantCoreContext(tenantId);
    const requiredPermissionCode = await resolveAnyWorkflowPermissionCodeForUser(
      tenantId,
      users.approverUserId
    );
    await ensureWorkflowGateSetup({
      tenantId,
      requesterUserId: users.requesterUserId,
      legalEntityId: core.legalEntityId,
      groupCompanyId: core.groupCompanyId,
      requiredPermissionCode,
    });
    await ensureConsolidationGroupForTenant({
      tenantId,
      requesterUserId: users.requesterUserId,
      groupCompanyId: core.groupCompanyId,
      calendarId: core.calendarId,
      currencyCode: core.currencyCode,
    });
    await ensureTaxPipelineFixture({
      tenantId,
      requesterUserId: users.requesterUserId,
      legalEntityId: core.legalEntityId,
      countryId: core.countryId,
      currencyCode: core.currencyCode,
    });

    const periodClose = await createTempPeriodCloseRun(tenantId, users.requesterUserId);
    periodCloseRunIds.push(periodClose.runId);
    const periodGate = await approveGateToCompletion({
      tenantId,
      processType: "PERIOD_CLOSE",
      targetType: "PERIOD_CLOSE_RUN",
      targetId: periodClose.runId,
      scope: {
        legalEntityId: periodClose.legalEntityId,
        groupCompanyId: periodClose.groupCompanyId,
      },
      requesterUserId: users.requesterUserId,
      approverUserId: users.approverUserId,
    });
    workflowInstanceIds.push(periodGate.instanceId);

    const consolidation = await createTempConsolidationRun(tenantId, users.requesterUserId);
    consolidationRunIds.push(consolidation.runId);
    const consolidationGate = await approveGateToCompletion({
      tenantId,
      processType: "CONSOLIDATION_RUN",
      targetType: "CONSOLIDATION_RUN",
      targetId: consolidation.runId,
      scope: {
        groupCompanyId: consolidation.groupCompanyId,
      },
      requesterUserId: users.requesterUserId,
      approverUserId: users.approverUserId,
    });
    workflowInstanceIds.push(consolidationGate.instanceId);

    const tax = await runTaxPipelineSmoke({
      tenantId,
      legalEntityId: core.legalEntityId,
    });

    return {
      tenantId,
      requesterUserId: users.requesterUserId,
      approverUserId: users.approverUserId,
      periodClose: {
        runId: periodClose.runId,
        workflowInstanceId: periodGate.instanceId,
        approvedStepCount: periodGate.stepCount,
      },
      consolidation: {
        runId: consolidation.runId,
        workflowInstanceId: consolidationGate.instanceId,
        approvedStepCount: consolidationGate.stepCount,
      },
      tax,
    };
  } finally {
    await cleanupSmokeArtifacts(
      tenantId,
      periodCloseRunIds,
      consolidationRunIds,
      workflowInstanceIds
    );
  }
}

async function main() {
  const explicitTenantIds = parseTenantIds(process.argv.slice(2));
  const isExplicitRun = explicitTenantIds.length > 0;
  const candidateTenantIds = isExplicitRun
    ? explicitTenantIds
    : await listOperationalSmokeCandidateTenantIds();
  const targetSuccessCount = isExplicitRun
    ? explicitTenantIds.length
    : Math.min(2, candidateTenantIds.length);
  assert(
    candidateTenantIds.length > 0,
    "No candidate tenants available for PR-F13 operational smoke"
  );
  const results = [];
  const failures = [];

  for (const tenantId of candidateTenantIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await runTenantSmoke(tenantId);
      results.push(result);
      if (!isExplicitRun && results.length >= targetSuccessCount) {
        break;
      }
    } catch (error) {
      if (isExplicitRun) {
        throw error;
      }
      failures.push({
        tenantId,
        message: String(error?.message || "Unknown smoke failure"),
      });
      console.warn(
        `[PR-F13 operational smoke] skipping tenant ${tenantId}: ${String(
          error?.message || "Unknown smoke failure"
        )}`
      );
    }
  }

  assert(
    results.length >= targetSuccessCount,
    `Operational smoke succeeded for ${results.length}/${targetSuccessCount} tenant(s). Last failures: ${JSON.stringify(
      failures.slice(-3)
    )}`
  );
  const successfulTenantIds = results.map((row) => row.tenantId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        candidateTenantIds,
        successfulTenantIds,
        skippedTenantFailures: failures,
        smoke: results,
      },
      null,
      2
    )
  );
  console.log(
    `PR-F13 operational smoke passed (workflow-gated period close + consolidation and tax pipeline) for tenants: ${successfulTenantIds.join(
      ", "
    )}.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
