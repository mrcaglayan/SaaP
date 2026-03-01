import { query, withTransaction } from "../db.js";
import {
  assertAccountBelongsToTenant,
  assertCurrencyExists,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const FEATURE_SUBACCOUNTS_V1 = "FEATURE_SUBACCOUNTS_V1";

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function isDuplicateConstraintError(err) {
  return Number(err?.errno) === 1062;
}

function toNullableString(value, maxLength = 255) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isMissingTableError(err) {
  return Number(err?.errno) === 1146;
}

function normalizeIdentityText(value, { compact = false, upper = false } = {}) {
  if (value === undefined || value === null) {
    return null;
  }
  let normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (compact) {
    normalized = normalized.replace(/\s+/g, "");
  }
  if (upper) {
    normalized = normalized.toUpperCase();
  }
  return normalized;
}

function listBankIdentityFieldChanges({ existing, payload }) {
  const changes = [];

  if (parsePositiveInt(existing.gl_account_id) !== parsePositiveInt(payload.glAccountId)) {
    changes.push("gl_account_id");
  }

  if (
    normalizeIdentityText(existing.currency_code, { upper: true }) !==
    normalizeIdentityText(payload.currencyCode, { upper: true })
  ) {
    changes.push("currency_code");
  }

  if (
    normalizeIdentityText(existing.iban, { compact: true, upper: true }) !==
    normalizeIdentityText(payload.iban, { compact: true, upper: true })
  ) {
    changes.push("iban");
  }

  if (normalizeIdentityText(existing.account_no) !== normalizeIdentityText(payload.accountNo)) {
    changes.push("account_no");
  }

  return changes;
}

async function getBankAccountUsageSummary({
  tenantId,
  legalEntityId,
  bankAccountId,
  runQuery = query,
}) {
  const hasDependentRows = async (sql, params) => {
    try {
      const result = await runQuery(sql, params);
      return Array.isArray(result.rows) && result.rows.length > 0;
    } catch (err) {
      if (isMissingTableError(err)) {
        return false;
      }
      throw err;
    }
  };

  try {
    const [
      hasStatementLines,
      hasPaymentBatches,
      hasPaymentBatchLines,
      hasReconciliationRefs,
      hasPostedPaymentJournals,
      hasPostedReconciliationByLineFlags,
      hasPostedReconciliationAutoPostings,
      hasPostedReconciliationDifferenceAdjustments,
    ] = await Promise.all([
      hasDependentRows(
        `SELECT 1
         FROM bank_statement_lines l
         WHERE l.tenant_id = ?
           AND l.legal_entity_id = ?
           AND l.bank_account_id = ?
         LIMIT 1`,
        [tenantId, legalEntityId, bankAccountId]
      ),
      hasDependentRows(
        `SELECT 1
         FROM payment_batches pb
         WHERE pb.tenant_id = ?
           AND pb.legal_entity_id = ?
           AND pb.bank_account_id = ?
         LIMIT 1`,
        [tenantId, legalEntityId, bankAccountId]
      ),
      hasDependentRows(
        `SELECT 1
         FROM payment_batch_lines pl
         JOIN payment_batches pb
           ON pb.id = pl.batch_id
          AND pb.tenant_id = pl.tenant_id
          AND pb.legal_entity_id = pl.legal_entity_id
         WHERE pb.tenant_id = ?
           AND pb.legal_entity_id = ?
           AND pb.bank_account_id = ?
         LIMIT 1`,
        [tenantId, legalEntityId, bankAccountId]
      ),
      hasDependentRows(
        `SELECT 1
         FROM bank_reconciliation_matches m
         JOIN bank_statement_lines l
           ON l.id = m.statement_line_id
          AND l.tenant_id = m.tenant_id
          AND l.legal_entity_id = m.legal_entity_id
         WHERE m.tenant_id = ?
           AND m.legal_entity_id = ?
           AND l.bank_account_id = ?
           AND m.status = 'ACTIVE'
         LIMIT 1`,
        [tenantId, legalEntityId, bankAccountId]
      ),
      hasDependentRows(
        `SELECT 1
         FROM payment_batches pb
         WHERE pb.tenant_id = ?
           AND pb.legal_entity_id = ?
           AND pb.bank_account_id = ?
           AND pb.posted_journal_entry_id IS NOT NULL
         LIMIT 1`,
        [tenantId, legalEntityId, bankAccountId]
      ),
      hasDependentRows(
        `SELECT 1
         FROM bank_statement_lines l
         WHERE l.tenant_id = ?
           AND l.legal_entity_id = ?
           AND l.bank_account_id = ?
           AND (
             l.auto_post_journal_entry_id IS NOT NULL
             OR l.reconciliation_difference_journal_entry_id IS NOT NULL
           )
         LIMIT 1`,
        [tenantId, legalEntityId, bankAccountId]
      ),
      hasDependentRows(
        `SELECT 1
         FROM bank_reconciliation_auto_postings ap
         JOIN bank_statement_lines l
           ON l.id = ap.statement_line_id
          AND l.tenant_id = ap.tenant_id
          AND l.legal_entity_id = ap.legal_entity_id
         WHERE ap.tenant_id = ?
           AND ap.legal_entity_id = ?
           AND l.bank_account_id = ?
           AND ap.status = 'POSTED'
         LIMIT 1`,
        [tenantId, legalEntityId, bankAccountId]
      ),
      hasDependentRows(
        `SELECT 1
         FROM bank_reconciliation_difference_adjustments da
         JOIN bank_statement_lines l
           ON l.id = da.bank_statement_line_id
          AND l.tenant_id = da.tenant_id
          AND l.legal_entity_id = da.legal_entity_id
         WHERE da.tenant_id = ?
           AND da.legal_entity_id = ?
           AND l.bank_account_id = ?
           AND da.journal_entry_id IS NOT NULL
         LIMIT 1`,
        [tenantId, legalEntityId, bankAccountId]
      ),
    ]);
    const hasPostedReconciliationJournals =
      hasPostedReconciliationByLineFlags ||
      hasPostedReconciliationAutoPostings ||
      hasPostedReconciliationDifferenceAdjustments;
    const hasPaymentFlows = hasPaymentBatches || hasPaymentBatchLines;

    const usages = [];
    if (hasStatementLines) {
      usages.push("statement lines");
    }
    if (hasPaymentFlows) {
      usages.push("payment batches/payment lines");
    }
    if (hasReconciliationRefs) {
      usages.push("reconciliation references");
    }
    if (hasPostedPaymentJournals) {
      usages.push("posted payment journals");
    }
    if (hasPostedReconciliationJournals) {
      usages.push("posted reconciliation journals");
    }

    return {
      hasUsage: usages.length > 0,
      usages,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { hasUsage: false, usages: [] };
    }
    throw err;
  }
}

async function isTenantFeatureEnabled({
  tenantId,
  featureCode,
  runQuery = query,
}) {
  try {
    const result = await runQuery(
      `SELECT is_enabled
       FROM tenant_features
       WHERE tenant_id = ?
         AND feature_code = ?
       LIMIT 1`,
      [tenantId, normalizeUpperText(featureCode)]
    );
    if (!result.rows?.length) {
      return false;
    }
    return parseDbBoolean(result.rows[0]?.is_enabled);
  } catch (err) {
    if (isMissingTableError(err)) {
      return false;
    }
    throw err;
  }
}

async function validateBankAccountOperatingUnit({
  tenantId,
  legalEntityId,
  operatingUnitId,
  label = "operatingUnitId",
}) {
  const parsedOperatingUnitId = parsePositiveInt(operatingUnitId);
  if (!parsedOperatingUnitId) {
    return null;
  }

  const operatingUnit = await assertOperatingUnitBelongsToTenant(
    tenantId,
    parsedOperatingUnitId,
    label
  );

  if (normalizeUpperText(operatingUnit.status) !== "ACTIVE") {
    throw badRequest(`${label} must reference an ACTIVE operating unit`);
  }
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  if (
    parsedLegalEntityId &&
    parsePositiveInt(operatingUnit.legal_entity_id) !== parsedLegalEntityId
  ) {
    throw badRequest(`${label} must belong to legalEntityId`);
  }

  return operatingUnit;
}

async function countChildAccounts({ accountId, runQuery = query }) {
  const result = await runQuery(
    `SELECT COUNT(*) AS total
     FROM accounts
     WHERE parent_account_id = ?`,
    [accountId]
  );
  return Number(result.rows?.[0]?.total || 0);
}

async function findBankAccountScopeById({ tenantId, bankAccountId, runQuery = query }) {
  const result = await runQuery(
    `SELECT id, legal_entity_id
     FROM bank_accounts
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [bankAccountId, tenantId]
  );
  return result.rows?.[0] || null;
}

async function findBankAccountById({ tenantId, bankAccountId, runQuery = query }) {
  const result = await runQuery(
    `SELECT
        ba.id,
        ba.tenant_id,
        ba.legal_entity_id,
        ba.operating_unit_id,
        ba.code,
        ba.name,
        ba.currency_code,
        ba.gl_account_id,
        ba.bank_name,
        ba.branch_name,
        ba.iban,
        ba.account_no,
        ba.is_active,
        ba.created_by_user_id,
        ba.created_at,
        ba.updated_at,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        a.code AS gl_account_code,
        a.name AS gl_account_name,
        a.account_type AS gl_account_type,
        a.allow_posting AS gl_account_allow_posting,
        a.is_active AS gl_account_is_active
     FROM bank_accounts ba
     JOIN legal_entities le
       ON le.id = ba.legal_entity_id
      AND le.tenant_id = ba.tenant_id
     LEFT JOIN operating_units ou
       ON ou.id = ba.operating_unit_id
     JOIN accounts a
       ON a.id = ba.gl_account_id
     WHERE ba.tenant_id = ?
       AND ba.id = ?
     LIMIT 1`,
    [tenantId, bankAccountId]
  );
  return result.rows?.[0] || null;
}

async function findBankAccountByCode({
  tenantId,
  legalEntityId,
  code,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id, tenant_id, legal_entity_id, code, gl_account_id, is_active
     FROM bank_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, code]
  );
  return result.rows?.[0] || null;
}

async function fetchBankLinkableGlAccount({
  tenantId,
  legalEntityId,
  accountId,
  label = "glAccountId",
  runQuery = query,
}) {
  await assertAccountBelongsToTenant(tenantId, accountId, label, { runQuery });

  const result = await runQuery(
    `SELECT
        a.id,
        a.code,
        a.name,
        a.account_type,
        a.normal_side,
        a.allow_posting,
        a.parent_account_id,
        a.is_active,
        c.scope AS coa_scope,
        c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest(`${label} not found for tenant`);
  }

  if (normalizeUpperText(row.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${label} must belong to a LEGAL_ENTITY chart`);
  }
  if (parsePositiveInt(row.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${label} must belong to legalEntityId`);
  }
  if (normalizeUpperText(row.account_type) !== "ASSET") {
    throw badRequest(`${label} must be an ASSET account`);
  }
  if (!parseDbBoolean(row.is_active)) {
    throw badRequest(`${label} must reference an ACTIVE account`);
  }
  if (!parseDbBoolean(row.allow_posting)) {
    throw badRequest(`${label} must reference a postable account`);
  }

  const childCount = await countChildAccounts({
    accountId,
    runQuery,
  });
  if (childCount > 0) {
    throw badRequest(`${label} must reference a leaf account`);
  }

  const strict102Mode = await isTenantFeatureEnabled({
    tenantId,
    featureCode: FEATURE_SUBACCOUNTS_V1,
    runQuery,
  });
  if (!strict102Mode) {
    // Fallback strategy: when strict mode is disabled, keep baseline ASSET+ACTIVE+postable+leaf checks only.
    return row;
  }

  const control102 = await findControl102Account({
    tenantId,
    legalEntityId,
    runQuery,
  });
  if (!control102) {
    throw badRequest(
      "Strict bank policy is enabled (feature_subaccounts_v1), but control account code 102 is missing for legalEntityId. Create account 102 or disable strict mode for this tenant."
    );
  }

  const under102 = await isAccountDescendantOf({
    tenantId,
    accountId,
    ancestorAccountId: control102.id,
    runQuery,
  });
  if (!under102) {
    throw badRequest(
      `${label} must be a descendant/leaf under control account 102 when strict bank policy is enabled (feature_subaccounts_v1)`
    );
  }

  return row;
}

async function findControl102Account({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.allow_posting
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.scope = 'LEGAL_ENTITY'
       AND c.legal_entity_id = ?
       AND a.code = '102'
     ORDER BY a.id
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  return result.rows?.[0] || null;
}

async function isAccountDescendantOf({
  tenantId,
  accountId,
  ancestorAccountId,
  runQuery = query,
}) {
  const targetId = parsePositiveInt(accountId);
  const ancestorId = parsePositiveInt(ancestorAccountId);
  if (!targetId || !ancestorId) {
    return false;
  }
  if (targetId === ancestorId) {
    return true;
  }

  const visited = new Set();
  let currentId = targetId;
  let depth = 0;
  while (currentId && depth < 200) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);
    depth += 1;

    const result = await runQuery(
      `SELECT a.parent_account_id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE a.id = ?
         AND c.tenant_id = ?
       LIMIT 1`,
      [currentId, tenantId]
    );
    const parentId = parsePositiveInt(result.rows?.[0]?.parent_account_id);
    if (!parentId) {
      return false;
    }
    if (parentId === ancestorId) {
      return true;
    }
    currentId = parentId;
  }
  return false;
}

async function insertBankAccount({ payload, runQuery = query }) {
  const result = await runQuery(
    `INSERT INTO bank_accounts (
        tenant_id,
        legal_entity_id,
        operating_unit_id,
        code,
        name,
        currency_code,
        gl_account_id,
        bank_name,
        branch_name,
        iban,
        account_no,
        is_active,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.operatingUnitId,
      payload.code,
      payload.name,
      payload.currencyCode,
      payload.glAccountId,
      toNullableString(payload.bankName, 255),
      toNullableString(payload.branchName, 255),
      toNullableString(payload.iban, 64),
      toNullableString(payload.accountNo, 80),
      payload.isActive ? 1 : 0,
      payload.userId,
    ]
  );
  return parsePositiveInt(result.rows?.insertId);
}

async function updateBankAccountRow({ bankAccountId, payload, runQuery = query }) {
  await runQuery(
    `UPDATE bank_accounts
     SET code = ?,
         name = ?,
         currency_code = ?,
         gl_account_id = ?,
         operating_unit_id = ?,
         bank_name = ?,
         branch_name = ?,
         iban = ?,
         account_no = ?,
         is_active = ?
     WHERE id = ?`,
    [
      payload.code,
      payload.name,
      payload.currencyCode,
      payload.glAccountId,
      payload.operatingUnitId,
      toNullableString(payload.bankName, 255),
      toNullableString(payload.branchName, 255),
      toNullableString(payload.iban, 64),
      toNullableString(payload.accountNo, 80),
      payload.isActive ? 1 : 0,
      bankAccountId,
    ]
  );
}

export async function resolveBankAccountScope(bankAccountId, tenantId) {
  const parsedBankAccountId = parsePositiveInt(bankAccountId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedBankAccountId || !parsedTenantId) {
    return null;
  }

  const row = await findBankAccountScopeById({
    tenantId: parsedTenantId,
    bankAccountId: parsedBankAccountId,
  });
  if (!row) {
    return null;
  }

  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export async function listBankAccountRows({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["ba.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "ba.legal_entity_id", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("ba.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.operatingUnitId) {
    await validateBankAccountOperatingUnit({
      tenantId,
      legalEntityId: filters.legalEntityId || null,
      operatingUnitId: filters.operatingUnitId,
      label: "operatingUnitId",
    });
    conditions.push("ba.operating_unit_id = ?");
    params.push(filters.operatingUnitId);
  }

  if (filters.isActive !== null) {
    conditions.push("ba.is_active = ?");
    params.push(filters.isActive ? 1 : 0);
  }

  if (filters.q) {
    conditions.push(
      "(ba.code LIKE ? OR ba.name LIKE ? OR ba.bank_name LIKE ? OR ba.iban LIKE ? OR ba.account_no LIKE ?)"
    );
    const like = `%${filters.q}%`;
    params.push(like, like, like, like, like);
  }

  const whereSql = conditions.join(" AND ");

  const countResult = await query(
    `SELECT COUNT(*) AS total
     FROM bank_accounts ba
     WHERE ${whereSql}`,
    params
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const safeLimit =
    Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;
  const listResult = await query(
    `SELECT
        ba.id,
        ba.tenant_id,
        ba.legal_entity_id,
        ba.operating_unit_id,
        ba.code,
        ba.name,
        ba.currency_code,
        ba.gl_account_id,
        ba.bank_name,
        ba.branch_name,
        ba.iban,
        ba.account_no,
        ba.is_active,
        ba.created_by_user_id,
        ba.created_at,
        ba.updated_at,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        a.code AS gl_account_code,
        a.name AS gl_account_name
     FROM bank_accounts ba
     JOIN legal_entities le
       ON le.id = ba.legal_entity_id
      AND le.tenant_id = ba.tenant_id
     LEFT JOIN operating_units ou
       ON ou.id = ba.operating_unit_id
     JOIN accounts a
       ON a.id = ba.gl_account_id
     WHERE ${whereSql}
     ORDER BY ba.legal_entity_id, ba.code, ba.id
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: listResult.rows || [],
    total,
    limit: filters.limit,
    offset: filters.offset,
  };
}

export async function getBankAccountByIdForTenant({
  req,
  tenantId,
  bankAccountId,
  assertScopeAccess,
}) {
  const row = await findBankAccountById({ tenantId, bankAccountId });
  if (!row) {
    throw badRequest("Bank account not found");
  }
  assertScopeAccess(req, "legal_entity", row.legal_entity_id, "bankAccountId");
  return row;
}

export async function createBankAccount({
  req,
  payload,
  assertScopeAccess,
}) {
  await assertLegalEntityBelongsToTenant(payload.tenantId, payload.legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");
  await assertCurrencyExists(payload.currencyCode, "currencyCode");
  await validateBankAccountOperatingUnit({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    operatingUnitId: payload.operatingUnitId,
    label: "operatingUnitId",
  });

  await fetchBankLinkableGlAccount({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    accountId: payload.glAccountId,
    label: "glAccountId",
  });

  try {
    const row = await withTransaction(async (tx) => {
      const insertId = await insertBankAccount({
        payload,
        runQuery: tx.query,
      });
      if (!insertId) {
        throw new Error("Failed to create bank account");
      }
      return findBankAccountById({
        tenantId: payload.tenantId,
        bankAccountId: insertId,
        runQuery: tx.query,
      });
    });
    if (!row) {
      throw new Error("Failed to load created bank account");
    }
    return row;
  } catch (err) {
    if (isDuplicateConstraintError(err)) {
      throw badRequest("Bank account code and GL account link must be unique within legalEntityId");
    }
    throw err;
  }
}

export async function updateBankAccountById({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await findBankAccountById({
    tenantId: payload.tenantId,
    bankAccountId: payload.bankAccountId,
  });
  if (!existing) {
    throw badRequest("Bank account not found");
  }

  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "bankAccountId");
  if (parsePositiveInt(existing.legal_entity_id) !== parsePositiveInt(payload.legalEntityId)) {
    throw badRequest("legalEntityId cannot be changed for an existing bank account");
  }

  const identityChanges = listBankIdentityFieldChanges({ existing, payload });
  if (identityChanges.length > 0) {
    const usage = await getBankAccountUsageSummary({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      bankAccountId: payload.bankAccountId,
    });
    if (usage.hasUsage) {
      throw badRequest(
        `Bank account identity is immutable after usage/posting. Blocked fields: ${identityChanges.join(
          ", "
        )}. Detected dependencies: ${usage.usages.join(
          ", "
        )}. Create a new bank account and migrate future transactions instead of mutating this account.`
      );
    }
  }

  await assertLegalEntityBelongsToTenant(payload.tenantId, payload.legalEntityId, "legalEntityId");
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");
  await assertCurrencyExists(payload.currencyCode, "currencyCode");
  await validateBankAccountOperatingUnit({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    operatingUnitId: payload.operatingUnitId,
    label: "operatingUnitId",
  });

  await fetchBankLinkableGlAccount({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    accountId: payload.glAccountId,
    label: "glAccountId",
  });

  try {
    const row = await withTransaction(async (tx) => {
      await updateBankAccountRow({
        bankAccountId: payload.bankAccountId,
        payload,
        runQuery: tx.query,
      });
      return findBankAccountById({
        tenantId: payload.tenantId,
        bankAccountId: payload.bankAccountId,
        runQuery: tx.query,
      });
    });
    if (!row) {
      throw new Error("Failed to load updated bank account");
    }
    return row;
  } catch (err) {
    if (isDuplicateConstraintError(err)) {
      throw badRequest("Bank account code and GL account link must be unique within legalEntityId");
    }
    throw err;
  }
}

export async function setBankAccountActive({
  req,
  tenantId,
  bankAccountId,
  isActive,
  assertScopeAccess,
}) {
  const existing = await findBankAccountById({
    tenantId,
    bankAccountId,
  });
  if (!existing) {
    throw badRequest("Bank account not found");
  }

  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "bankAccountId");
  if (parseDbBoolean(existing.is_active) === Boolean(isActive)) {
    return existing;
  }

  await query(
    `UPDATE bank_accounts
     SET is_active = ?
     WHERE id = ?
       AND tenant_id = ?`,
    [isActive ? 1 : 0, bankAccountId, tenantId]
  );

  const updated = await findBankAccountById({
    tenantId,
    bankAccountId,
  });
  if (!updated) {
    throw new Error("Failed to load updated bank account status");
  }
  return updated;
}
