import express from "express";
import { query, withTransaction } from "../db.js";
import {
  assertScopeAccess,
  buildScopeFilter,
  getScopeContext,
  requirePermission,
} from "../middleware/rbac.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import {
  assertCurrencyExists,
  assertCountryExists,
  assertFiscalCalendarBelongsToTenant,
  assertGroupCompanyBelongsToTenant,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import { recalculateShareholderOwnershipPctTx } from "../services/shareholderOwnership.js";

const router = express.Router();
const SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE =
  "SHAREHOLDER_CAPITAL_CREDIT_PARENT";
const SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE =
  "SHAREHOLDER_COMMITMENT_DEBIT_PARENT";
const DEFAULT_GL_ACCOUNTS = [
  {
    code: "1000",
    name: "Cash and Cash Equivalents",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    code: "1100",
    name: "Accounts Receivable",
    accountType: "ASSET",
    normalSide: "DEBIT",
  },
  {
    code: "2000",
    name: "Accounts Payable",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  },
  {
    code: "3000",
    name: "Retained Earnings",
    accountType: "EQUITY",
    normalSide: "CREDIT",
  },
  {
    code: "4000",
    name: "Revenue",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  },
  {
    code: "5000",
    name: "Operating Expense",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  },
];

function toLocalYyyyMmDd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function toIsoDate(value, fieldLabel = "date") {
  if (value === undefined || value === null || value === "") {
    throw badRequest(`${fieldLabel} is required`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${fieldLabel} must be a valid date`);
    }
    return toLocalYyyyMmDd(value);
  }

  const asString = String(value).trim();
  if (!asString) {
    throw badRequest(`${fieldLabel} must be a valid date`);
  }

  const yyyyMmDdMatch = asString.match(/^(\d{4}-\d{2}-\d{2})/);
  if (yyyyMmDdMatch?.[1]) {
    return yyyyMmDdMatch[1];
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${fieldLabel} must be a valid date`);
  }
  return toLocalYyyyMmDd(parsed);
}

function normalizeCode(rawValue, fallback = "DEFAULT", maxLength = 50) {
  const normalized = String(rawValue || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const safe = normalized || fallback;
  return safe.slice(0, maxLength);
}

function normalizeName(rawValue, fallback = "Default Name", maxLength = 255) {
  const normalized = String(rawValue || "").trim();
  return (normalized || fallback).slice(0, maxLength);
}

function parseBooleanValue(rawValue, defaultValue = false) {
  if (rawValue === undefined || rawValue === null) {
    return defaultValue;
  }
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "number") {
    return rawValue !== 0;
  }
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }
  return Boolean(rawValue);
}

function parseOptionalNonNegativeNumber(rawValue, label, defaultValue = null) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw badRequest(`${label} must be a non-negative number`);
  }
  return parsed;
}

function generateAutoJournalNo(prefix = "TAA") {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 1_679_616)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0");
  return `${String(prefix).slice(0, 8).toUpperCase()}-${stamp}-${rand}`.slice(0, 40);
}

function normalizeMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

function normalizeAccountNormalSide(value) {
  return String(value || "").trim().toUpperCase();
}

async function resolveShareholderParentMappings(tx, tenantId, legalEntityId) {
  const result = await tx.query(
    `SELECT purpose_code, account_id
     FROM journal_purpose_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND purpose_code IN (?, ?)`,
    [
      tenantId,
      legalEntityId,
      SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE,
      SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE,
    ]
  );

  const byPurpose = new Map(
    (result.rows || []).map((row) => [String(row.purpose_code || ""), parsePositiveInt(row.account_id)])
  );
  const capitalCreditParentAccountId = parsePositiveInt(
    byPurpose.get(SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE)
  );
  const commitmentDebitParentAccountId = parsePositiveInt(
    byPurpose.get(SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE)
  );

  return {
    capitalCreditParentAccountId,
    commitmentDebitParentAccountId,
  };
}

async function assertShareholderParentAccount(
  tx,
  tenantId,
  legalEntityId,
  accountId,
  fieldLabel,
  expectedNormalSide
) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    throw badRequest(`${fieldLabel} must be a positive integer`);
  }

  const result = await tx.query(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.coa_id,
       a.account_type,
       a.normal_side,
       a.is_active,
       a.allow_posting,
       c.legal_entity_id
      FROM accounts a
      JOIN charts_of_accounts c ON c.id = a.coa_id
      WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [normalizedAccountId, tenantId]
  );
  const account = result.rows[0];
  if (!account) {
    throw badRequest(`${fieldLabel} not found for tenant`);
  }
  if (parsePositiveInt(account.legal_entity_id) !== legalEntityId) {
    throw badRequest(`${fieldLabel} must belong to selected legalEntityId`);
  }
  if (!Boolean(account.is_active)) {
    throw badRequest(`${fieldLabel} must reference an active account`);
  }
  if (String(account.account_type || "").toUpperCase() !== "EQUITY") {
    throw badRequest(`${fieldLabel} must reference an EQUITY account`);
  }
  if (
    expectedNormalSide &&
    normalizeAccountNormalSide(account.normal_side) !== expectedNormalSide
  ) {
    throw badRequest(
      `${fieldLabel} must reference a ${expectedNormalSide} normal-side account`
    );
  }
  if (Boolean(account.allow_posting)) {
    throw badRequest(
      `${fieldLabel} must reference a non-postable/header account (allow_posting=false)`
    );
  }

  return {
    id: normalizedAccountId,
    code: String(account.code || ""),
    name: String(account.name || ""),
    coaId: parsePositiveInt(account.coa_id),
    normalSide: normalizeAccountNormalSide(account.normal_side),
  };
}

function pushValidationIssue(collection, issue) {
  const normalizedCode = String(issue?.code || "").trim().toUpperCase();
  const normalizedMessage = String(issue?.message || "").trim();
  if (!normalizedCode || !normalizedMessage) {
    return;
  }
  const existing = collection.find(
    (row) => row.code === normalizedCode && row.message === normalizedMessage
  );
  if (!existing) {
    collection.push({
      code: normalizedCode,
      message: normalizedMessage,
      details: issue?.details ? [issue.details] : [],
    });
    return;
  }
  if (issue?.details) {
    existing.details = Array.isArray(existing.details) ? existing.details : [];
    existing.details.push(issue.details);
  }
}

function createBatchRowIssue(code, message) {
  return {
    code: String(code || "").trim().toUpperCase(),
    message: String(message || "").trim(),
  };
}

function normalizeCurrencyCode(value, fallback = "USD") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return normalized || fallback;
}

async function loadShareholderCommitmentJournalizedAmountByShareholder(
  tx,
  tenantId,
  legalEntityId,
  shareholderIds
) {
  if (!Array.isArray(shareholderIds) || shareholderIds.length === 0) {
    return new Map();
  }

  const placeholders = shareholderIds.map(() => "?").join(",");
  try {
    const result = await tx.query(
      `SELECT
         shareholder_id,
         SUM(amount) AS total_amount
       FROM shareholder_commitment_journal_entries
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND shareholder_id IN (${placeholders})
       GROUP BY shareholder_id`,
      [tenantId, legalEntityId, ...shareholderIds]
    );

    return new Map(
      (result.rows || []).map((row) => [
        parsePositiveInt(row.shareholder_id),
        normalizeMoney(row.total_amount || 0),
      ])
    );
  } catch (err) {
    if (Number(err?.errno) === 1146) {
      throw badRequest(
        "Setup required: shareholder commitment audit table is missing (run latest migrations)"
      );
    }
    throw err;
  }
}

async function loadLegalEntityAccountHierarchy(tx, tenantId, legalEntityId) {
  const result = await tx.query(
    `SELECT
       a.id,
       a.parent_account_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.legal_entity_id = ?`,
    [tenantId, legalEntityId]
  );

  return new Map(
    (result.rows || []).map((row) => [
      parsePositiveInt(row.id),
      parsePositiveInt(row.parent_account_id),
    ])
  );
}

function isDescendantOfParentAccount(parentById, accountId, parentAccountId) {
  const normalizedAccountId = parsePositiveInt(accountId);
  const normalizedParentAccountId = parsePositiveInt(parentAccountId);
  if (!normalizedAccountId || !normalizedParentAccountId) {
    return false;
  }

  const visited = new Set();
  let currentParentId = parsePositiveInt(parentById.get(normalizedAccountId));
  while (currentParentId) {
    if (currentParentId === normalizedParentAccountId) {
      return true;
    }
    if (visited.has(currentParentId)) {
      break;
    }
    visited.add(currentParentId);
    currentParentId = parsePositiveInt(parentById.get(currentParentId));
  }

  return false;
}

function validateShareholderMappedLeafAccount({
  account,
  tenantId,
  legalEntityId,
  expectedNormalSide,
  expectedParentAccountId,
  parentById,
  fieldLabel,
}) {
  if (!account) {
    return createBatchRowIssue(
      "MISSING_ACCOUNTS",
      `${fieldLabel} is missing for selected shareholder`
    );
  }
  if (
    parsePositiveInt(account.account_tenant_id) !== tenantId ||
    parsePositiveInt(account.account_legal_entity_id) !== legalEntityId
  ) {
    return createBatchRowIssue(
      "INVALID_PARENT_MAPPING",
      `${fieldLabel} must belong to selected legalEntityId`
    );
  }
  if (String(account.account_type || "").toUpperCase() !== "EQUITY") {
    return createBatchRowIssue(
      "INVALID_PARENT_MAPPING",
      `${fieldLabel} must reference an EQUITY account`
    );
  }
  if (normalizeAccountNormalSide(account.normal_side) !== expectedNormalSide) {
    return createBatchRowIssue(
      "INVALID_PARENT_MAPPING",
      `${fieldLabel} must reference a ${expectedNormalSide} normal-side account`
    );
  }
  if (!Boolean(account.is_active)) {
    return createBatchRowIssue(
      "INACTIVE_ACCOUNTS",
      `${fieldLabel} must reference an active account`
    );
  }
  if (!Boolean(account.allow_posting)) {
    return createBatchRowIssue(
      "NON_POSTABLE_MAPPED_CHILD_ACCOUNT",
      `${fieldLabel} must reference a postable account`
    );
  }
  if (Boolean(account.has_active_children)) {
    return createBatchRowIssue(
      "NON_POSTABLE_MAPPED_CHILD_ACCOUNT",
      `${fieldLabel} must reference a leaf/postable account`
    );
  }
  if (
    !isDescendantOfParentAccount(
      parentById,
      parsePositiveInt(account.id),
      expectedParentAccountId
    )
  ) {
    return createBatchRowIssue(
      "INVALID_PARENT_MAPPING",
      `${fieldLabel} must be a child/descendant of configured parent account`
    );
  }
  return null;
}

function parseBatchShareholderIds(rawShareholderIds) {
  const shareholderIds = Array.from(
    new Set(
      (Array.isArray(rawShareholderIds) ? rawShareholderIds : [])
        .map((value) => parsePositiveInt(value))
        .filter(Boolean)
    )
  );
  if (shareholderIds.length === 0) {
    throw badRequest("shareholderIds must include at least one valid id");
  }
  if (shareholderIds.length > 200) {
    throw badRequest("shareholderIds cannot exceed 200 entries");
  }
  return shareholderIds;
}

async function buildShareholderCommitmentBatchPreviewTx(tx, payload) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  const shareholderIds = parseBatchShareholderIds(payload?.shareholderIds);
  const commitmentDate = toIsoDate(payload?.commitmentDate, "commitmentDate");
  const lockShareholders = Boolean(payload?.lockShareholders);

  if (!tenantId || !legalEntityId) {
    throw badRequest("tenantId and legalEntityId are required");
  }

  const blockingErrors = [];
  const warnings = [];
  const lockClause = lockShareholders ? "FOR UPDATE" : "";
  const placeholders = shareholderIds.map(() => "?").join(",");
  const shareholdersResult = await tx.query(
    `SELECT
       s.id,
       s.code,
       s.name,
       s.committed_capital,
       s.currency_code,
       s.capital_sub_account_id,
       s.commitment_debit_sub_account_id
     FROM shareholders s
     WHERE s.tenant_id = ?
       AND s.legal_entity_id = ?
       AND s.id IN (${placeholders})
     ORDER BY s.id
     ${lockClause}`,
    [tenantId, legalEntityId, ...shareholderIds]
  );
  const shareholdersById = new Map(
    (shareholdersResult.rows || []).map((row) => [parsePositiveInt(row.id), row])
  );
  const missingIds = shareholderIds.filter((id) => !shareholdersById.has(id));
  if (missingIds.length > 0) {
    throw badRequest(
      `Some shareholders were not found in legalEntityId=${legalEntityId}: ${missingIds.join(",")}`
    );
  }

  const selectedShareholders = shareholderIds
    .map((id) => shareholdersById.get(id))
    .filter(Boolean);

  const currencyGroups = new Map();
  for (const row of selectedShareholders) {
    const currencyCode = normalizeCurrencyCode(row.currency_code || "");
    if (!currencyGroups.has(currencyCode)) {
      currencyGroups.set(currencyCode, []);
    }
    currencyGroups
      .get(currencyCode)
      .push({
        shareholder_id: parsePositiveInt(row.id),
        code: String(row.code || ""),
        name: String(row.name || ""),
      });
  }
  if (currencyGroups.size > 1) {
    const mixedCurrencyDetails = Array.from(currencyGroups.entries()).map(
      ([currency_code, shareholders]) => ({
        currency_code,
        shareholders,
      })
    );
    pushValidationIssue(blockingErrors, {
      code: "MIXED_CURRENCY",
      message:
        "Queued shareholders contain mixed currencies. Create separate batches per currency.",
      details: mixedCurrencyDetails,
    });
  }

  const shareholderParentMappings = await resolveShareholderParentMappings(
    tx,
    tenantId,
    legalEntityId
  );
  const capitalCreditParentAccountId = parsePositiveInt(
    shareholderParentMappings.capitalCreditParentAccountId
  );
  const commitmentDebitParentAccountId = parsePositiveInt(
    shareholderParentMappings.commitmentDebitParentAccountId
  );

  let capitalParentAccount = null;
  let commitmentParentAccount = null;
  if (!capitalCreditParentAccountId || !commitmentDebitParentAccountId) {
    pushValidationIssue(blockingErrors, {
      code: "INVALID_PARENT_MAPPING",
      message:
        "Setup required: configure shareholder parent account mapping for selected legalEntityId",
      details: {
        capital_credit_parent_account_id: capitalCreditParentAccountId || null,
        commitment_debit_parent_account_id: commitmentDebitParentAccountId || null,
      },
    });
  } else {
    try {
      capitalParentAccount = await assertShareholderParentAccount(
        tx,
        tenantId,
        legalEntityId,
        capitalCreditParentAccountId,
        "capitalCreditParentAccountId",
        "CREDIT"
      );
    } catch (err) {
      pushValidationIssue(blockingErrors, {
        code: "INVALID_PARENT_MAPPING",
        message: err?.message || "capitalCreditParentAccountId is invalid",
      });
    }
    try {
      commitmentParentAccount = await assertShareholderParentAccount(
        tx,
        tenantId,
        legalEntityId,
        commitmentDebitParentAccountId,
        "commitmentDebitParentAccountId",
        "DEBIT"
      );
    } catch (err) {
      pushValidationIssue(blockingErrors, {
        code: "INVALID_PARENT_MAPPING",
        message: err?.message || "commitmentDebitParentAccountId is invalid",
      });
    }
  }

  const journalContext = await resolveOpenBookPeriodForLegalEntity(
    tx,
    tenantId,
    legalEntityId,
    commitmentDate
  );
  if (!journalContext?.bookId || !journalContext?.fiscalPeriodId) {
    pushValidationIssue(blockingErrors, {
      code: "NO_OPEN_BOOK_PERIOD",
      message: "No OPEN book/fiscal period found for legalEntityId",
    });
  } else if (
    commitmentDate < journalContext.startDate ||
    commitmentDate > journalContext.endDate
  ) {
    pushValidationIssue(blockingErrors, {
      code: "COMMITMENT_DATE_OUTSIDE_OPEN_PERIOD",
      message: "commitmentDate must be within an OPEN fiscal period for legalEntityId",
      details: {
        fiscal_period_id: journalContext.fiscalPeriodId,
        period_start_date: journalContext.startDate,
        period_end_date: journalContext.endDate,
      },
    });
  }

  const accountIds = Array.from(
    new Set(
      selectedShareholders.flatMap((row) => [
        parsePositiveInt(row.capital_sub_account_id),
        parsePositiveInt(row.commitment_debit_sub_account_id),
      ])
    )
  ).filter(Boolean);
  const accountById = new Map();
  if (accountIds.length > 0) {
    const accountPlaceholders = accountIds.map(() => "?").join(",");
    const accountsResult = await tx.query(
      `SELECT
         a.id,
         a.code,
         a.name,
         a.account_type,
         a.normal_side,
         a.allow_posting,
         a.is_active,
         a.parent_account_id,
         EXISTS(
           SELECT 1
           FROM accounts child
           WHERE child.parent_account_id = a.id
             AND child.is_active = TRUE
         ) AS has_active_children,
         c.tenant_id AS account_tenant_id,
         c.legal_entity_id AS account_legal_entity_id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE a.id IN (${accountPlaceholders})`,
      accountIds
    );
    for (const row of accountsResult.rows || []) {
      accountById.set(parsePositiveInt(row.id), row);
    }
  }

  const accountParentById = await loadLegalEntityAccountHierarchy(
    tx,
    tenantId,
    legalEntityId
  );
  const alreadyJournaledByShareholderId =
    await loadShareholderCommitmentJournalizedAmountByShareholder(
      tx,
      tenantId,
      legalEntityId,
      shareholderIds
    );

  const rows = [];
  const includedShareholders = [];
  const skippedShareholders = [];
  let totalDebit = 0;
  let totalCredit = 0;
  let totalsCurrencyCode = normalizeCurrencyCode(selectedShareholders[0]?.currency_code || "");
  let zeroDeltaSkippedCount = 0;

  for (const shareholder of selectedShareholders) {
    const shareholderId = parsePositiveInt(shareholder.id);
    const code = String(shareholder.code || "");
    const name = String(shareholder.name || "");
    const currencyCode = normalizeCurrencyCode(shareholder.currency_code || "");
    const committedCapital = normalizeMoney(shareholder.committed_capital || 0);
    const alreadyJournaledAmount = normalizeMoney(
      alreadyJournaledByShareholderId.get(shareholderId) || 0
    );
    const deltaAmount = normalizeMoney(committedCapital - alreadyJournaledAmount);

    const debitAccountId = parsePositiveInt(
      shareholder.commitment_debit_sub_account_id
    );
    const creditAccountId = parsePositiveInt(shareholder.capital_sub_account_id);
    const debitAccount = accountById.get(debitAccountId) || null;
    const creditAccount = accountById.get(creditAccountId) || null;

    const rowIssues = [];
    if (!creditAccountId) {
      rowIssues.push(
        createBatchRowIssue(
          "MISSING_ACCOUNTS",
          "capital_sub_account_id is missing for selected shareholder"
        )
      );
    }
    if (!debitAccountId) {
      rowIssues.push(
        createBatchRowIssue(
          "MISSING_ACCOUNTS",
          "commitment_debit_sub_account_id is missing for selected shareholder"
        )
      );
    }

    if (creditAccountId) {
      const capitalIssue = validateShareholderMappedLeafAccount({
        account: creditAccount,
        tenantId,
        legalEntityId,
        expectedNormalSide: "CREDIT",
        expectedParentAccountId: capitalParentAccount?.id || capitalCreditParentAccountId,
        parentById: accountParentById,
        fieldLabel: "capital_sub_account_id",
      });
      if (capitalIssue) {
        rowIssues.push(capitalIssue);
      }
    }
    if (debitAccountId) {
      const debitIssue = validateShareholderMappedLeafAccount({
        account: debitAccount,
        tenantId,
        legalEntityId,
        expectedNormalSide: "DEBIT",
        expectedParentAccountId:
          commitmentParentAccount?.id || commitmentDebitParentAccountId,
        parentById: accountParentById,
        fieldLabel: "commitment_debit_sub_account_id",
      });
      if (debitIssue) {
        rowIssues.push(debitIssue);
      }
    }

    for (const issue of rowIssues) {
      pushValidationIssue(blockingErrors, {
        code: issue.code,
        message: issue.message,
        details: {
          shareholder_id: shareholderId,
          code,
          name,
        },
      });
    }

    const rowPreview = {
      shareholder_id: shareholderId,
      code,
      name,
      currency_code: currencyCode,
      committed_capital: committedCapital,
      already_journaled_amount: alreadyJournaledAmount,
      delta_amount: deltaAmount,
      debit_account_id: debitAccountId || null,
      debit_account_code: debitAccount ? String(debitAccount.code || "") : null,
      debit_account_name: debitAccount ? String(debitAccount.name || "") : null,
      credit_account_id: creditAccountId || null,
      credit_account_code: creditAccount ? String(creditAccount.code || "") : null,
      credit_account_name: creditAccount ? String(creditAccount.name || "") : null,
      validation_issues: rowIssues,
    };

    let skippedReason = null;
    if (deltaAmount <= 0) {
      skippedReason =
        committedCapital <= 0
          ? "committed capital is zero"
          : "already fully journaled";
      zeroDeltaSkippedCount += 1;
    } else if (rowIssues.length > 0) {
      skippedReason = rowIssues.map((issue) => issue.message).join("; ");
    }

    if (skippedReason) {
      rowPreview.status = "SKIPPED";
      rowPreview.skipped_reason = skippedReason;
      skippedShareholders.push(rowPreview);
    } else {
      rowPreview.status = "INCLUDED";
      rowPreview.skipped_reason = null;
      includedShareholders.push(rowPreview);
      totalDebit = normalizeMoney(totalDebit + deltaAmount);
      totalCredit = normalizeMoney(totalCredit + deltaAmount);
    }

    rows.push(rowPreview);
  }

  if (zeroDeltaSkippedCount > 0) {
    warnings.push({
      code: "ALREADY_FULLY_JOURNALED",
      message:
        "Some queued shareholders were skipped because they are already fully journaled",
      count: zeroDeltaSkippedCount,
    });
  }

  if (includedShareholders.length === 0) {
    pushValidationIssue(blockingErrors, {
      code: "NO_JOURNALIZABLE_ROWS",
      message: "No shareholder has a positive journalizable commitment delta",
    });
  }

  if (currencyGroups.size === 1) {
    totalsCurrencyCode = Array.from(currencyGroups.keys())[0];
  } else if (includedShareholders[0]?.currency_code) {
    totalsCurrencyCode = includedShareholders[0].currency_code;
  }

  return {
    legal_entity_id: legalEntityId,
    commitment_date: commitmentDate,
    parent_mapping: {
      capital_credit_parent_account_id: capitalCreditParentAccountId || null,
      commitment_debit_parent_account_id: commitmentDebitParentAccountId || null,
      capital_credit_parent_account_code: capitalParentAccount?.code || null,
      capital_credit_parent_account_name: capitalParentAccount?.name || null,
      commitment_debit_parent_account_code: commitmentParentAccount?.code || null,
      commitment_debit_parent_account_name: commitmentParentAccount?.name || null,
    },
    rows,
    included_shareholders: includedShareholders,
    skipped_shareholders: skippedShareholders,
    totals: {
      total_debit: totalDebit,
      total_credit: totalCredit,
      currency_code: totalsCurrencyCode || null,
    },
    journal_context: journalContext
      ? {
          book_id: journalContext.bookId,
          book_code: journalContext.bookCode,
          fiscal_period_id: journalContext.fiscalPeriodId,
          period_start_date: journalContext.startDate,
          period_end_date: journalContext.endDate,
          base_currency_code: journalContext.baseCurrencyCode,
        }
      : null,
    validation: {
      has_blocking_errors: blockingErrors.length > 0,
      blocking_errors: blockingErrors,
      warnings,
      mixed_currency:
        currencyGroups.size > 1
          ? Array.from(currencyGroups.entries()).map(([currency_code, members]) => ({
              currency_code,
              shareholders: members,
            }))
          : [],
    },
  };
}

function normalizeShareholderChildSequenceFromCode(parentCode, childCode) {
  const normalizedParentCode = String(parentCode || "").trim();
  const normalizedChildCode = String(childCode || "").trim();
  if (!normalizedParentCode || !normalizedChildCode) {
    return null;
  }
  const prefix = `${normalizedParentCode}.`;
  if (!normalizedChildCode.startsWith(prefix)) {
    return null;
  }
  const suffix = normalizedChildCode.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  const parsed = Number(suffix);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildShareholderChildCode(parentCode, sequence) {
  const normalizedParentCode = String(parentCode || "").trim();
  if (!normalizedParentCode) {
    throw badRequest("Parent account code is required to generate child account code");
  }
  const prefix = `${normalizedParentCode}.`;
  const maxSuffixLength = 50 - prefix.length;
  if (maxSuffixLength < 1) {
    throw badRequest(
      `Parent account code ${normalizedParentCode} is too long to generate child account code`
    );
  }

  const numericSequence = Number(sequence);
  if (!Number.isInteger(numericSequence) || numericSequence <= 0) {
    throw badRequest("sequence must be a positive integer");
  }

  let suffix = String(numericSequence);
  if (maxSuffixLength >= 2) {
    suffix = suffix.padStart(2, "0");
  }
  if (suffix.length > maxSuffixLength) {
    throw badRequest(
      `No available child account code capacity under parent ${normalizedParentCode}`
    );
  }
  return `${prefix}${suffix}`;
}

function toCommitmentJournalFailureMessage(reason) {
  switch (String(reason || "")) {
    case "CAPITAL_SUB_ACCOUNT_REQUIRED":
      return "capitalSubAccountId is required to create commitment journal";
    case "COMMITMENT_DEBIT_SUB_ACCOUNT_REQUIRED":
      return "commitmentDebitSubAccountId is required to create commitment journal";
    case "AUTH_USER_REQUIRED":
      return "Authenticated user is required to create commitment journal";
    case "NO_OPEN_BOOK_PERIOD":
      return "No OPEN book/fiscal period found for legalEntityId";
    case "COMMITMENT_DATE_OUTSIDE_OPEN_PERIOD":
      return "commitmentDate must be within an OPEN fiscal period for legalEntityId";
    case "COMMITMENT_DEBIT_SUB_ACCOUNT_INVALID":
      return "commitmentDebitSubAccountId must reference an active, postable, leaf EQUITY account in the same legal entity";
    default:
      return "Commitment journal could not be created";
  }
}

function toJournalContextRow(row) {
  if (!row) {
    return null;
  }
  return {
    bookId: parsePositiveInt(row.book_id),
    bookCode: String(row.book_code || ""),
    fiscalPeriodId: parsePositiveInt(row.fiscal_period_id),
    startDate: toIsoDate(row.start_date, "fiscal_period.start_date"),
    endDate: toIsoDate(row.end_date, "fiscal_period.end_date"),
    baseCurrencyCode: String(row.base_currency_code || "USD").toUpperCase(),
  };
}

async function resolveOpenBookPeriodForLegalEntity(
  tx,
  tenantId,
  legalEntityId,
  asOfDate
) {
  const currentResult = await tx.query(
    `SELECT
       b.id AS book_id,
       b.code AS book_code,
       b.base_currency_code,
       fp.id AS fiscal_period_id,
       fp.start_date,
       fp.end_date
     FROM books b
     JOIN fiscal_periods fp
       ON fp.calendar_id = b.calendar_id
      AND fp.is_adjustment = FALSE
     LEFT JOIN period_statuses ps
       ON ps.book_id = b.id
      AND ps.fiscal_period_id = fp.id
     WHERE b.tenant_id = ?
       AND b.legal_entity_id = ?
       AND ? BETWEEN fp.start_date AND fp.end_date
       AND COALESCE(ps.status, 'OPEN') = 'OPEN'
     ORDER BY b.id, fp.start_date DESC
     LIMIT 1`,
    [tenantId, legalEntityId, asOfDate]
  );
  const current = toJournalContextRow(currentResult.rows[0]);
  if (current) {
    return current;
  }

  const pastResult = await tx.query(
    `SELECT
       b.id AS book_id,
       b.code AS book_code,
       b.base_currency_code,
       fp.id AS fiscal_period_id,
       fp.start_date,
       fp.end_date
     FROM books b
     JOIN fiscal_periods fp
       ON fp.calendar_id = b.calendar_id
      AND fp.is_adjustment = FALSE
     LEFT JOIN period_statuses ps
       ON ps.book_id = b.id
      AND ps.fiscal_period_id = fp.id
     WHERE b.tenant_id = ?
       AND b.legal_entity_id = ?
       AND fp.start_date <= ?
       AND COALESCE(ps.status, 'OPEN') = 'OPEN'
     ORDER BY fp.start_date DESC
     LIMIT 1`,
    [tenantId, legalEntityId, asOfDate]
  );
  const past = toJournalContextRow(pastResult.rows[0]);
  if (past) {
    return past;
  }

  const futureResult = await tx.query(
    `SELECT
       b.id AS book_id,
       b.code AS book_code,
       b.base_currency_code,
       fp.id AS fiscal_period_id,
       fp.start_date,
       fp.end_date
     FROM books b
     JOIN fiscal_periods fp
       ON fp.calendar_id = b.calendar_id
      AND fp.is_adjustment = FALSE
     LEFT JOIN period_statuses ps
       ON ps.book_id = b.id
      AND ps.fiscal_period_id = fp.id
     WHERE b.tenant_id = ?
       AND b.legal_entity_id = ?
       AND fp.start_date > ?
       AND COALESCE(ps.status, 'OPEN') = 'OPEN'
     ORDER BY fp.start_date ASC
     LIMIT 1`,
    [tenantId, legalEntityId, asOfDate]
  );
  return toJournalContextRow(futureResult.rows[0]);
}

async function createShareholderCommitmentDraftJournal(tx, payload) {
  const amount = normalizeMoney(payload.amount);
  if (amount <= 0) {
    return {
      attempted: false,
      created: false,
      reason: "NO_COMMITTED_CAPITAL_INCREASE",
      amount: 0,
    };
  }

  if (!payload.capitalSubAccountId) {
    return {
      attempted: true,
      created: false,
      reason: "CAPITAL_SUB_ACCOUNT_REQUIRED",
      amount,
    };
  }

  const commitmentDebitSubAccountId = parsePositiveInt(
    payload.commitmentDebitSubAccountId
  );
  if (!commitmentDebitSubAccountId) {
    return {
      attempted: true,
      created: false,
      reason: "COMMITMENT_DEBIT_SUB_ACCOUNT_REQUIRED",
      amount,
    };
  }

  if (!payload.userId) {
    return {
      attempted: true,
      created: false,
      reason: "AUTH_USER_REQUIRED",
      amount,
    };
  }

  const commitmentDate = payload.commitmentDate
    ? toIsoDate(payload.commitmentDate, "commitmentDate")
    : toIsoDate(new Date(), "commitmentDate");
  const journalContext = await resolveOpenBookPeriodForLegalEntity(
    tx,
    payload.tenantId,
    payload.legalEntityId,
    commitmentDate
  );
  if (!journalContext?.bookId || !journalContext?.fiscalPeriodId) {
    return {
      attempted: true,
      created: false,
      reason: "NO_OPEN_BOOK_PERIOD",
      amount,
    };
  }

  if (
    commitmentDate < journalContext.startDate ||
    commitmentDate > journalContext.endDate
  ) {
    return {
      attempted: true,
      created: false,
      reason: "COMMITMENT_DATE_OUTSIDE_OPEN_PERIOD",
      amount,
      bookId: journalContext.bookId,
      fiscalPeriodId: journalContext.fiscalPeriodId,
    };
  }

  const debitAccountResult = await tx.query(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.account_type,
       a.is_active,
       a.allow_posting,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = a.id
           AND child.is_active = TRUE
       ) AS has_active_children,
       c.tenant_id AS account_tenant_id,
       c.legal_entity_id AS account_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [commitmentDebitSubAccountId, payload.tenantId]
  );
  const debitAccountRow = debitAccountResult.rows[0];
  const debitAccountId = parsePositiveInt(debitAccountRow?.id);
  const debitAccountTenantId = parsePositiveInt(debitAccountRow?.account_tenant_id);
  const debitAccountLegalEntityId = parsePositiveInt(
    debitAccountRow?.account_legal_entity_id
  );
  const debitAccountValid =
    debitAccountId &&
    debitAccountTenantId === payload.tenantId &&
    debitAccountLegalEntityId === payload.legalEntityId &&
    String(debitAccountRow?.account_type || "").toUpperCase() === "EQUITY" &&
    Boolean(debitAccountRow?.is_active) &&
    Boolean(debitAccountRow?.allow_posting) &&
    !Boolean(debitAccountRow?.has_active_children);

  if (!debitAccountValid) {
    return {
      attempted: true,
      created: false,
      reason: "COMMITMENT_DEBIT_SUB_ACCOUNT_INVALID",
      amount,
      bookId: journalContext.bookId,
      fiscalPeriodId: journalContext.fiscalPeriodId,
    };
  }
  const debitAccount = {
    id: debitAccountId,
    code: String(debitAccountRow?.code || ""),
    name: String(debitAccountRow?.name || ""),
  };

  const entryDate = commitmentDate;
  const documentDate = commitmentDate;
  const journalNo = generateAutoJournalNo("TAAHHUT");
  const description = `Shareholder commitment (${payload.shareholderCode})`;
  const referenceNo = `SHAREHOLDER_COMMITMENT:${payload.shareholderId}:${Date.now()}`.slice(
    0,
    100
  );
  const currencyCode = String(
    journalContext.baseCurrencyCode || payload.currencyCode || "USD"
  ).toUpperCase();

  const entryResult = await tx.query(
    `INSERT INTO journal_entries (
        tenant_id,
        legal_entity_id,
        book_id,
        fiscal_period_id,
        journal_no,
        source_type,
        status,
        entry_date,
        document_date,
        currency_code,
        description,
        reference_no,
        total_debit_base,
        total_credit_base,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      journalContext.bookId,
      journalContext.fiscalPeriodId,
      journalNo,
      entryDate,
      documentDate,
      currencyCode,
      description,
      referenceNo,
      amount,
      amount,
      payload.userId,
    ]
  );
  const journalEntryId = parsePositiveInt(entryResult.rows.insertId);
  if (!journalEntryId) {
    throw badRequest("Failed to create shareholder commitment journal");
  }

  await tx.query(
    `INSERT INTO journal_lines (
        journal_entry_id,
        line_no,
        account_id,
        operating_unit_id,
        counterparty_legal_entity_id,
        description,
        currency_code,
        amount_txn,
        debit_base,
        credit_base,
        tax_code
      )
      VALUES (?, 1, ?, NULL, NULL, ?, ?, ?, ?, 0, NULL)`,
    [
      journalEntryId,
      debitAccount.id,
      `Shareholder commitment receivable (${payload.shareholderCode})`,
      currencyCode,
      amount,
      amount,
    ]
  );

  await tx.query(
    `INSERT INTO journal_lines (
        journal_entry_id,
        line_no,
        account_id,
        operating_unit_id,
        counterparty_legal_entity_id,
        description,
        currency_code,
        amount_txn,
        debit_base,
        credit_base,
        tax_code
      )
      VALUES (?, 2, ?, NULL, NULL, ?, ?, ?, 0, ?, NULL)`,
    [
      journalEntryId,
      payload.capitalSubAccountId,
      `Committed capital (${payload.shareholderCode})`,
      currencyCode,
      amount * -1,
      amount,
    ]
  );

  if (parsePositiveInt(payload.shareholderId)) {
    await tx.query(
      `INSERT INTO shareholder_commitment_journal_entries (
          tenant_id,
          shareholder_id,
          legal_entity_id,
          journal_entry_id,
          line_group_key,
          amount,
          currency_code,
          created_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.tenantId,
        payload.shareholderId,
        payload.legalEntityId,
        journalEntryId,
        "SINGLE",
        amount,
        currencyCode,
        payload.userId,
      ]
    );
  }

  return {
    attempted: true,
    created: true,
    reason: null,
    journalEntryId,
    journalNo,
    bookId: journalContext.bookId,
    bookCode: journalContext.bookCode,
    fiscalPeriodId: journalContext.fiscalPeriodId,
    entryDate,
    amount,
    debitAccountId: debitAccount.id,
    debitAccountCode: debitAccount.code,
    creditAccountId: payload.capitalSubAccountId,
  };
}

async function resolveLegalEntityByCode(tx, tenantId, code) {
  const result = await tx.query(
    `SELECT id, code, name, functional_currency_code
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Unable to resolve legal entity after upsert");
  }

  const id = parsePositiveInt(row.id);
  if (!id) {
    throw new Error("Invalid legal entity id");
  }

  return {
    id,
    code: String(row.code || ""),
    name: String(row.name || ""),
    functionalCurrencyCode: String(row.functional_currency_code || "USD").toUpperCase(),
  };
}

async function resolveOrCreateDefaultFiscalCalendar(tx, tenantId) {
  const existing = await tx.query(
    `SELECT id, code, name, year_start_month, year_start_day
     FROM fiscal_calendars
     WHERE tenant_id = ?
     ORDER BY id
     LIMIT 1`,
    [tenantId]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      id: parsePositiveInt(row.id),
      code: String(row.code || ""),
      name: String(row.name || ""),
      yearStartMonth: Number(row.year_start_month || 1),
      yearStartDay: Number(row.year_start_day || 1),
      created: false,
    };
  }

  const code = "MAIN";
  const name = "Main Calendar";
  const yearStartMonth = 1;
  const yearStartDay = 1;
  await tx.query(
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

  const created = await tx.query(
    `SELECT id, code, name, year_start_month, year_start_day
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const row = created.rows[0];
  if (!row) {
    throw new Error("Unable to resolve fiscal calendar");
  }

  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
    name: String(row.name || ""),
    yearStartMonth: Number(row.year_start_month || 1),
    yearStartDay: Number(row.year_start_day || 1),
    created: true,
  };
}

async function ensureFiscalPeriodsForYear(tx, calendar, fiscalYear) {
  let created = 0;
  for (let i = 0; i < 12; i += 1) {
    const periodNo = i + 1;
    const existing = await tx.query(
      `SELECT id
       FROM fiscal_periods
       WHERE calendar_id = ?
         AND fiscal_year = ?
         AND period_no = ?
         AND is_adjustment = FALSE
       LIMIT 1`,
      [calendar.id, fiscalYear, periodNo]
    );
    if (existing.rows[0]) {
      continue;
    }

    const monthOffset = calendar.yearStartMonth - 1 + i;
    const start = new Date(Date.UTC(fiscalYear, monthOffset, calendar.yearStartDay));
    const nextStart = new Date(
      Date.UTC(fiscalYear, monthOffset + 1, calendar.yearStartDay)
    );
    const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
    const periodName = `P${String(periodNo).padStart(2, "0")}`;

    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO fiscal_periods (
          calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
       )
       VALUES (?, ?, ?, ?, ?, ?, FALSE)`,
      [calendar.id, fiscalYear, periodNo, periodName, toIsoDate(start), toIsoDate(end)]
    );
    created += 1;
  }
  return created;
}

async function resolveOrCreateDefaultCoa(tx, tenantId, legalEntity) {
  const existing = await tx.query(
    `SELECT id, code
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND scope = 'LEGAL_ENTITY'
     ORDER BY id
     LIMIT 1`,
    [tenantId, legalEntity.id]
  );
  if (existing.rows[0]) {
    return {
      id: parsePositiveInt(existing.rows[0].id),
      code: String(existing.rows[0].code || ""),
      created: false,
    };
  }

  const code = normalizeCode(`COA-${legalEntity.code}`, `COA-${legalEntity.id}`);
  const name = normalizeName(`${legalEntity.name} CoA`, "Default CoA");
  await tx.query(
    `INSERT INTO charts_of_accounts (
        tenant_id, legal_entity_id, scope, code, name
     )
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       legal_entity_id = VALUES(legal_entity_id),
       scope = VALUES(scope)`,
    [tenantId, legalEntity.id, code, name]
  );

  const resolved = await tx.query(
    `SELECT id, code
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, code]
  );
  const row = resolved.rows[0];
  if (!row) {
    throw new Error("Unable to resolve chart of accounts");
  }

  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
    created: true,
  };
}

async function ensureDefaultAccountsForCoa(tx, coaId) {
  const existing = await tx.query(
    `SELECT COUNT(*) AS count
     FROM accounts
     WHERE coa_id = ?`,
    [coaId]
  );
  const existingCount = Number(existing.rows[0]?.count || 0);
  if (existingCount > 0) {
    return 0;
  }

  let created = 0;
  for (const account of DEFAULT_GL_ACCOUNTS) {
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO accounts (
          coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id
       )
       VALUES (?, ?, ?, ?, ?, TRUE, NULL)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         account_type = VALUES(account_type),
         normal_side = VALUES(normal_side),
         allow_posting = VALUES(allow_posting)`,
      [
        coaId,
        String(account.code).trim(),
        String(account.name).trim(),
        String(account.accountType).toUpperCase(),
        String(account.normalSide).toUpperCase(),
      ]
    );
    created += 1;
  }
  return created;
}

async function resolveOrCreateDefaultBook(tx, tenantId, legalEntity, calendarId) {
  const existing = await tx.query(
    `SELECT id, code
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY id
     LIMIT 1`,
    [tenantId, legalEntity.id]
  );
  if (existing.rows[0]) {
    return {
      id: parsePositiveInt(existing.rows[0].id),
      code: String(existing.rows[0].code || ""),
      created: false,
    };
  }

  const code = normalizeCode(`BOOK-${legalEntity.code}`, `BOOK-${legalEntity.id}`);
  const name = normalizeName(`${legalEntity.name} Book`, "Default Book");
  const baseCurrencyCode = normalizeCode(
    legalEntity.functionalCurrencyCode || "USD",
    "USD",
    3
  );
  await tx.query(
    `INSERT INTO books (
        tenant_id, legal_entity_id, calendar_id, code, name, book_type, base_currency_code
     )
     VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       calendar_id = VALUES(calendar_id),
       base_currency_code = VALUES(base_currency_code)`,
    [tenantId, legalEntity.id, calendarId, code, name, baseCurrencyCode]
  );

  const resolved = await tx.query(
    `SELECT id, code
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntity.id, code]
  );
  const row = resolved.rows[0];
  if (!row) {
    throw new Error("Unable to resolve book");
  }

  return {
    id: parsePositiveInt(row.id),
    code: String(row.code || ""),
    created: true,
  };
}

async function autoProvisionLegalEntityGl(tx, tenantId, legalEntity, fiscalYear) {
  const calendar = await resolveOrCreateDefaultFiscalCalendar(tx, tenantId);
  const fiscalPeriodsCreated = await ensureFiscalPeriodsForYear(tx, calendar, fiscalYear);
  const coa = await resolveOrCreateDefaultCoa(tx, tenantId, legalEntity);
  const accountsCreated = await ensureDefaultAccountsForCoa(tx, coa.id);
  const book = await resolveOrCreateDefaultBook(tx, tenantId, legalEntity, calendar.id);

  return {
    calendarId: calendar.id,
    calendarCode: calendar.code,
    coaId: coa.id,
    coaCode: coa.code,
    bookId: book.id,
    bookCode: book.code,
    created: {
      fiscalCalendars: calendar.created ? 1 : 0,
      fiscalPeriods: fiscalPeriodsCreated,
      chartsOfAccounts: coa.created ? 1 : 0,
      accounts: accountsCreated,
      books: book.created ? 1 : 0,
    },
  };
}

router.get(
  "/tree",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const groupParams = [tenantId];
    const groupFilter = buildScopeFilter(req, "group", "id", groupParams);

    const entityParams = [tenantId];
    const entityFilter = buildScopeFilter(req, "legal_entity", "id", entityParams);

    const unitParams = [tenantId];
    const unitFilter = buildScopeFilter(req, "operating_unit", "id", unitParams);

    const countryParams = [];
    const countryFilter = buildScopeFilter(req, "country", "c.id", countryParams);

    const [groups, countries, entities, units] = await Promise.all([
      query(
        `SELECT id, code, name, created_at
         FROM group_companies
         WHERE tenant_id = ?
           AND ${groupFilter}
         ORDER BY id`,
        groupParams
      ),
      query(
        `SELECT c.id, c.iso2, c.iso3, c.name, c.default_currency_code
         FROM countries c
         WHERE ${countryFilter}
         ORDER BY c.name`,
        countryParams
      ),
      query(
        `SELECT
           id,
           group_company_id,
           code,
           name,
           tax_id,
           country_id,
           functional_currency_code,
           status,
           is_intercompany_enabled,
           intercompany_partner_required
         FROM legal_entities
         WHERE tenant_id = ?
           AND ${entityFilter}
         ORDER BY id`,
        entityParams
      ),
      query(
        `SELECT id, legal_entity_id, code, name, unit_type, has_subledger, status
         FROM operating_units
         WHERE tenant_id = ?
           AND ${unitFilter}
         ORDER BY id`,
        unitParams
      ),
    ]);

    return res.json({
      tenantId,
      groups: groups.rows,
      countries: countries.rows,
      legalEntities: entities.rows,
      operatingUnits: units.rows,
      rbacSource: req.rbac?.source || null,
      tenantWideScope: Boolean(getScopeContext(req)?.tenantWide),
    });
  })
);

router.get(
  "/group-companies",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const params = [tenantId];
    const scopeFilter = buildScopeFilter(req, "group", "id", params);

    const result = await query(
      `SELECT id, tenant_id, code, name, created_at
       FROM group_companies
       WHERE tenant_id = ?
         AND ${scopeFilter}
       ORDER BY id`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/countries",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const params = [];
    const countryFilter = buildScopeFilter(req, "country", "c.id", params);

    const result = await query(
      `SELECT c.id, c.iso2, c.iso3, c.name, c.default_currency_code
       FROM countries c
       WHERE ${countryFilter}
       ORDER BY c.name`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/currencies",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await query(
      `SELECT code, name, minor_units
       FROM currencies
       ORDER BY code`
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/legal-entities",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const countryId = parsePositiveInt(req.query.countryId);
    const groupCompanyId = parsePositiveInt(req.query.groupCompanyId);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;

    const params = [tenantId];
    const conditions = ["tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "legal_entity", "id", params));

    if (countryId) {
      conditions.push("country_id = ?");
      params.push(countryId);
    }
    if (groupCompanyId) {
      conditions.push("group_company_id = ?");
      params.push(groupCompanyId);
    }
    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         id,
         tenant_id,
         group_company_id,
         code,
         name,
         tax_id,
         country_id,
         functional_currency_code,
         status,
         is_intercompany_enabled,
         intercompany_partner_required,
         created_at,
         updated_at
       FROM legal_entities
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/operating-units",
  requirePermission("org.tree.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const params = [tenantId];
    const conditions = ["tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "operating_unit", "id", params));

    if (legalEntityId) {
      conditions.push("legal_entity_id = ?");
      params.push(legalEntityId);
    }

    const result = await query(
      `SELECT
         id,
         tenant_id,
         legal_entity_id,
         code,
         name,
         unit_type,
         has_subledger,
         status,
         created_at
       FROM operating_units
       WHERE ${conditions.join(" AND ")}
       ORDER BY id`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/fiscal-calendars",
  requirePermission("org.fiscal_calendar.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const result = await query(
      `SELECT id, code, name, year_start_month, year_start_day, created_at
       FROM fiscal_calendars
       WHERE tenant_id = ?
       ORDER BY id`,
      [tenantId]
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.get(
  "/fiscal-calendars/:calendarId/periods",
  requirePermission("org.fiscal_period.read"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const calendarId = parsePositiveInt(req.params.calendarId);
    if (!calendarId) {
      throw badRequest("calendarId must be a positive integer");
    }

    const fiscalYear = parsePositiveInt(req.query.fiscalYear);

    const calendarResult = await query(
      `SELECT id, code, name
       FROM fiscal_calendars
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [calendarId, tenantId]
    );
    const calendar = calendarResult.rows[0];
    if (!calendar) {
      throw badRequest("Calendar not found for tenant");
    }

    const conditions = ["calendar_id = ?"];
    const params = [calendarId];

    if (fiscalYear) {
      conditions.push("fiscal_year = ?");
      params.push(fiscalYear);
    }

    const periodsResult = await query(
      `SELECT id, calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
       FROM fiscal_periods
       WHERE ${conditions.join(" AND ")}
       ORDER BY fiscal_year, period_no, is_adjustment`,
      params
    );

    return res.json({
      tenantId,
      calendar,
      fiscalYear: fiscalYear || null,
      rows: periodsResult.rows,
    });
  })
);

router.post(
  "/group-companies",
  requirePermission("org.group_company.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["code", "name"]);
    const { code, name } = req.body;

    const existingResult = await query(
      `SELECT id
       FROM group_companies
       WHERE tenant_id = ?
         AND code = ?
       LIMIT 1`,
      [tenantId, String(code).trim()]
    );
    const existingId = parsePositiveInt(existingResult.rows[0]?.id);
    if (existingId) {
      assertScopeAccess(req, "group", existingId, "groupCompanyId");
    } else if (!getScopeContext(req)?.tenantWide) {
      throw badRequest(
        "Creating a new group company requires tenant-wide data scope"
      );
    }

    const result = await query(
      `INSERT INTO group_companies (tenant_id, code, name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
      [tenantId, String(code).trim(), String(name).trim()]
    );

    return res.status(201).json({
      ok: true,
      id: result.rows.insertId || existingId || null,
      tenantId,
      code,
      name,
    });
  })
);

router.post(
  "/legal-entities",
  requirePermission("org.legal_entity.upsert", {
    resolveScope: (req, tenantId) => {
      const groupCompanyId = parsePositiveInt(req.body?.groupCompanyId);
      if (groupCompanyId) {
        return { scopeType: "GROUP", scopeId: groupCompanyId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, [
      "groupCompanyId",
      "code",
      "name",
      "countryId",
      "functionalCurrencyCode",
    ]);

    const groupCompanyId = parsePositiveInt(req.body.groupCompanyId);
    const countryId = parsePositiveInt(req.body.countryId);

    if (!groupCompanyId || !countryId) {
      throw badRequest("groupCompanyId and countryId must be positive integers");
    }

    await assertGroupCompanyBelongsToTenant(tenantId, groupCompanyId, "groupCompanyId");
    await assertCountryExists(countryId, "countryId");

    assertScopeAccess(req, "group", groupCompanyId, "groupCompanyId");
    assertScopeAccess(req, "country", countryId, "countryId");

    const intercompanyEnabled =
      req.body.isIntercompanyEnabled === undefined
        ? true
        : Boolean(req.body.isIntercompanyEnabled);
    const partnerRequired = Boolean(req.body.intercompanyPartnerRequired);
    const autoProvisionDefaults = parseBooleanValue(
      req.body.autoProvisionDefaults,
      false
    );
    const fiscalYear =
      parsePositiveInt(req.body.fiscalYear) || new Date().getUTCFullYear();

    const { code, name, taxId, functionalCurrencyCode } = req.body;
    const normalizedCode = String(code || "").trim();
    const normalizedName = String(name || "").trim();
    if (!normalizedCode || !normalizedName) {
      throw badRequest("code and name are required");
    }
    const normalizedFunctionalCurrencyCode = String(functionalCurrencyCode || "")
      .trim()
      .toUpperCase();
    await assertCurrencyExists(
      normalizedFunctionalCurrencyCode,
      "functionalCurrencyCode"
    );
    const operationResult = await withTransaction(async (tx) => {
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
          normalizedCode,
          normalizedName,
          taxId ? String(taxId).trim() : null,
          countryId,
          normalizedFunctionalCurrencyCode,
          intercompanyEnabled,
          partnerRequired,
        ]
      );

      const legalEntity = await resolveLegalEntityByCode(
        tx,
        tenantId,
        normalizedCode
      );
      let provisioning = null;
      if (autoProvisionDefaults) {
        provisioning = await autoProvisionLegalEntityGl(
          tx,
          tenantId,
          legalEntity,
          fiscalYear
        );
      }

      return {
        legalEntity,
        provisioning,
        insertId: result.rows.insertId || null,
      };
    });

    return res.status(201).json({
      ok: true,
      id: operationResult.insertId || operationResult.legalEntity.id,
      legalEntityId: operationResult.legalEntity.id,
      autoProvisionDefaults,
      fiscalYear,
      provisioning: operationResult.provisioning,
    });
  })
);

router.get(
  "/shareholder-journal-config",
  requirePermission("org.tree.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    if (legalEntityId) {
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const params = [
      SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE,
      SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE,
      tenantId,
    ];
    const conditions = ["le.tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "legal_entity", "le.id", params));
    if (legalEntityId) {
      conditions.push("le.id = ?");
      params.push(legalEntityId);
    }

    const result = await query(
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
       WHERE ${conditions.join(" AND ")}
       ORDER BY le.code, le.id`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.post(
  "/shareholder-journal-config",
  requirePermission("org.legal_entity.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    const capitalCreditParentAccountId = parsePositiveInt(
      req.body.capitalCreditParentAccountId
    );
    const commitmentDebitParentAccountId = parsePositiveInt(
      req.body.commitmentDebitParentAccountId
    );
    if (
      !legalEntityId ||
      !capitalCreditParentAccountId ||
      !commitmentDebitParentAccountId
    ) {
      throw badRequest(
        "legalEntityId, capitalCreditParentAccountId, and commitmentDebitParentAccountId must be positive integers"
      );
    }
    if (capitalCreditParentAccountId === commitmentDebitParentAccountId) {
      throw badRequest(
        "commitmentDebitParentAccountId must be different from capitalCreditParentAccountId"
      );
    }

    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const row = await withTransaction(async (tx) => {
      await assertShareholderParentAccount(
        tx,
        tenantId,
        legalEntityId,
        capitalCreditParentAccountId,
        "capitalCreditParentAccountId",
        "CREDIT"
      );
      await assertShareholderParentAccount(
        tx,
        tenantId,
        legalEntityId,
        commitmentDebitParentAccountId,
        "commitmentDebitParentAccountId",
        "DEBIT"
      );

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
        [
          tenantId,
          legalEntityId,
          SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE,
          capitalCreditParentAccountId,
        ]
      );

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
        [
          tenantId,
          legalEntityId,
          SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE,
          commitmentDebitParentAccountId,
        ]
      );

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
        [
          SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE,
          SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE,
          tenantId,
          legalEntityId,
        ]
      );
      return configResult.rows[0] || null;
    });

    return res.status(201).json({
      ok: true,
      row,
    });
  })
);

router.get(
  "/shareholders",
  requirePermission("org.tree.read", {
    resolveScope: (req) => {
      const legalEntityId = parsePositiveInt(req.query?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return null;
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.query.legalEntityId);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    if (status && !["ACTIVE", "INACTIVE"].includes(status)) {
      throw badRequest("status must be ACTIVE or INACTIVE");
    }

    if (legalEntityId) {
      await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const params = [tenantId];
    const conditions = ["s.tenant_id = ?"];
    conditions.push(buildScopeFilter(req, "legal_entity", "s.legal_entity_id", params));

    if (legalEntityId) {
      conditions.push("s.legal_entity_id = ?");
      params.push(legalEntityId);
    }
    if (status) {
      conditions.push("s.status = ?");
      params.push(status);
    }

    const result = await query(
      `SELECT
         s.id,
         s.tenant_id,
         s.legal_entity_id,
         s.code,
         s.name,
         s.shareholder_type,
         s.tax_id,
         s.ownership_pct,
         s.committed_capital,
         CASE
           WHEN c.id IS NULL THEN 0
           ELSE COALESCE(pc.paid_capital_calculated, 0)
         END AS paid_capital,
         CASE WHEN c.id IS NULL THEN NULL ELSE s.capital_sub_account_id END AS capital_sub_account_id,
         CASE
           WHEN dc.id IS NULL THEN NULL
           ELSE s.commitment_debit_sub_account_id
         END AS commitment_debit_sub_account_id,
         s.currency_code,
         s.status,
         s.notes,
         s.created_at,
         s.updated_at,
         CASE WHEN c.id IS NULL THEN NULL ELSE a.code END AS capital_sub_account_code,
         CASE WHEN c.id IS NULL THEN NULL ELSE a.name END AS capital_sub_account_name,
         CASE WHEN c.id IS NULL THEN NULL ELSE a.account_type END AS capital_sub_account_type,
         CASE WHEN dc.id IS NULL THEN NULL ELSE da.code END AS commitment_debit_sub_account_code,
         CASE WHEN dc.id IS NULL THEN NULL ELSE da.name END AS commitment_debit_sub_account_name,
         CASE WHEN dc.id IS NULL THEN NULL ELSE da.account_type END AS commitment_debit_sub_account_type
       FROM shareholders s
       LEFT JOIN accounts a ON a.id = s.capital_sub_account_id
       LEFT JOIN charts_of_accounts c
         ON c.id = a.coa_id
        AND c.tenant_id = s.tenant_id
       LEFT JOIN accounts da ON da.id = s.commitment_debit_sub_account_id
       LEFT JOIN charts_of_accounts dc
         ON dc.id = da.coa_id
        AND dc.tenant_id = s.tenant_id
       LEFT JOIN (
         SELECT
           je.tenant_id,
           je.legal_entity_id,
           jl.account_id,
           SUM(jl.credit_base) AS paid_capital_calculated
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         WHERE je.status = 'POSTED'
         GROUP BY je.tenant_id, je.legal_entity_id, jl.account_id
       ) pc
         ON pc.tenant_id = s.tenant_id
        AND pc.legal_entity_id = s.legal_entity_id
        AND pc.account_id = s.capital_sub_account_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY s.legal_entity_id, s.code`,
      params
    );

    return res.json({
      tenantId,
      rows: result.rows,
    });
  })
);

router.post(
  "/shareholders",
  requirePermission("org.legal_entity.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["legalEntityId", "code", "name"]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }

    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      legalEntityId,
      "legalEntityId"
    );
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const code = String(req.body.code || "").trim().toUpperCase();
    const name = String(req.body.name || "").trim();
    if (!code || !name) {
      throw badRequest("code and name are required");
    }

    const shareholderType = String(
      req.body.shareholderType || "INDIVIDUAL"
    ).toUpperCase();
    if (!["INDIVIDUAL", "CORPORATE"].includes(shareholderType)) {
      throw badRequest("shareholderType must be INDIVIDUAL or CORPORATE");
    }

    const status = String(req.body.status || "ACTIVE").toUpperCase();
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      throw badRequest("status must be ACTIVE or INACTIVE");
    }

    const committedCapital = parseOptionalNonNegativeNumber(
      req.body.committedCapital,
      "committedCapital",
      0
    );

    const currencyCode = String(
      req.body.currencyCode || legalEntity.functional_currency_code || "USD"
    )
      .trim()
      .toUpperCase();
    await assertCurrencyExists(currencyCode, "currencyCode");

    const taxId = req.body.taxId ? String(req.body.taxId).trim() : null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const commitmentDate =
      req.body.commitmentDate === undefined ||
      req.body.commitmentDate === null ||
      req.body.commitmentDate === ""
        ? null
        : toIsoDate(req.body.commitmentDate, "commitmentDate");
    const capitalSubAccountId = req.body.capitalSubAccountId
      ? parsePositiveInt(req.body.capitalSubAccountId)
      : null;
    const commitmentDebitSubAccountId = req.body.commitmentDebitSubAccountId
      ? parsePositiveInt(req.body.commitmentDebitSubAccountId)
      : null;
    const autoCommitmentJournal = parseBooleanValue(
      req.body.autoCommitmentJournal,
      true
    );
    const userId = parsePositiveInt(req.user?.userId);
    if (req.body.capitalSubAccountId && !capitalSubAccountId) {
      throw badRequest("capitalSubAccountId must be a positive integer");
    }
    if (
      req.body.commitmentDebitSubAccountId &&
      !commitmentDebitSubAccountId
    ) {
      throw badRequest(
        "commitmentDebitSubAccountId must be a positive integer"
      );
    }
    if (committedCapital > 0 && !capitalSubAccountId) {
      throw badRequest(
        "capitalSubAccountId is required when committedCapital is greater than 0"
      );
    }
    if (committedCapital > 0 && !commitmentDebitSubAccountId) {
      throw badRequest(
        "commitmentDebitSubAccountId is required when committedCapital is greater than 0"
      );
    }
    if (
      capitalSubAccountId &&
      commitmentDebitSubAccountId &&
      capitalSubAccountId === commitmentDebitSubAccountId
    ) {
      throw badRequest(
        "commitmentDebitSubAccountId must be different from capitalSubAccountId"
      );
    }

    const operation = await withTransaction(async (tx) => {
      const existingResult = await tx.query(
        `SELECT
           id,
           committed_capital,
           capital_sub_account_id,
           commitment_debit_sub_account_id
         FROM shareholders
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND code = ?
         LIMIT 1
         FOR UPDATE`,
        [tenantId, legalEntityId, code]
      );
      const existing = existingResult.rows[0] || null;
      const shareholderParentMappings = await resolveShareholderParentMappings(
        tx,
        tenantId,
        legalEntityId
      );
      const capitalCreditParentAccountId = parsePositiveInt(
        shareholderParentMappings.capitalCreditParentAccountId
      );
      const commitmentDebitParentAccountId = parsePositiveInt(
        shareholderParentMappings.commitmentDebitParentAccountId
      );
      const shouldValidateMappedShareholderSubAccounts =
        committedCapital > 0 || capitalSubAccountId || commitmentDebitSubAccountId;
      const shouldValidateMappedLeafHierarchy =
        Boolean(capitalSubAccountId) || Boolean(commitmentDebitSubAccountId);

      if (
        shouldValidateMappedShareholderSubAccounts &&
        (!capitalCreditParentAccountId || !commitmentDebitParentAccountId)
      ) {
        throw badRequest(
          "Setup required: configure shareholder parent account mapping for selected legalEntityId"
        );
      }
      if (capitalCreditParentAccountId) {
        await assertShareholderParentAccount(
          tx,
          tenantId,
          legalEntityId,
          capitalCreditParentAccountId,
          "capitalCreditParentAccountId",
          "CREDIT"
        );
      }
      if (commitmentDebitParentAccountId) {
        await assertShareholderParentAccount(
          tx,
          tenantId,
          legalEntityId,
          commitmentDebitParentAccountId,
          "commitmentDebitParentAccountId",
          "DEBIT"
        );
      }
      const accountParentById = shouldValidateMappedLeafHierarchy
        ? await loadLegalEntityAccountHierarchy(tx, tenantId, legalEntityId)
        : new Map();

      if (capitalSubAccountId) {
        const accountResult = await tx.query(
          `SELECT
             a.id,
             a.code,
             a.account_type,
             a.normal_side,
             a.allow_posting,
             a.is_active,
             a.parent_account_id,
             EXISTS(
               SELECT 1
               FROM accounts child
               WHERE child.parent_account_id = a.id
                 AND child.is_active = TRUE
             ) AS has_active_children,
             c.legal_entity_id
           FROM accounts a
           JOIN charts_of_accounts c ON c.id = a.coa_id
           WHERE a.id = ?
             AND c.tenant_id = ?
           LIMIT 1`,
          [capitalSubAccountId, tenantId]
        );
        const account = accountResult.rows[0];
        if (!account) {
          throw badRequest("capitalSubAccountId not found for tenant");
        }
        if (parsePositiveInt(account.legal_entity_id) !== legalEntityId) {
          throw badRequest(
            "capitalSubAccountId must belong to the selected legalEntityId"
          );
        }
        if (String(account.account_type || "").toUpperCase() !== "EQUITY") {
          throw badRequest("capitalSubAccountId must reference an EQUITY account");
        }
        if (normalizeAccountNormalSide(account.normal_side) !== "CREDIT") {
          throw badRequest(
            "capitalSubAccountId must reference a CREDIT normal-side account"
          );
        }
        if (!Boolean(account.is_active)) {
          throw badRequest("capitalSubAccountId must reference an active account");
        }
        if (!Boolean(account.allow_posting)) {
          throw badRequest("capitalSubAccountId must reference a postable account");
        }
        if (Boolean(account.has_active_children)) {
          throw badRequest("capitalSubAccountId must reference a leaf sub-account");
        }
        if (
          capitalCreditParentAccountId &&
          !isDescendantOfParentAccount(
            accountParentById,
            parsePositiveInt(account.id),
            capitalCreditParentAccountId
          )
        ) {
          throw badRequest(
            "capitalSubAccountId must be a child/descendant of configured capitalCreditParentAccountId"
          );
        }

        const mappingConflict = await tx.query(
          `SELECT id
           FROM shareholders
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND capital_sub_account_id = ?
             AND id <> ?
           LIMIT 1`,
          [tenantId, legalEntityId, capitalSubAccountId, parsePositiveInt(existing?.id) || 0]
        );
        if (mappingConflict.rows[0]) {
          throw badRequest(
            "capitalSubAccountId is already assigned to another shareholder"
          );
        }
      }

      if (commitmentDebitSubAccountId) {
        const accountResult = await tx.query(
          `SELECT
             a.id,
             a.code,
             a.account_type,
             a.normal_side,
             a.allow_posting,
             a.is_active,
             a.parent_account_id,
             EXISTS(
               SELECT 1
               FROM accounts child
               WHERE child.parent_account_id = a.id
                 AND child.is_active = TRUE
             ) AS has_active_children,
             c.legal_entity_id
           FROM accounts a
           JOIN charts_of_accounts c ON c.id = a.coa_id
           WHERE a.id = ?
             AND c.tenant_id = ?
           LIMIT 1`,
          [commitmentDebitSubAccountId, tenantId]
        );
        const account = accountResult.rows[0];
        if (!account) {
          throw badRequest("commitmentDebitSubAccountId not found for tenant");
        }
        if (parsePositiveInt(account.legal_entity_id) !== legalEntityId) {
          throw badRequest(
            "commitmentDebitSubAccountId must belong to the selected legalEntityId"
          );
        }
        if (String(account.account_type || "").toUpperCase() !== "EQUITY") {
          throw badRequest(
            "commitmentDebitSubAccountId must reference an EQUITY account"
          );
        }
        if (normalizeAccountNormalSide(account.normal_side) !== "DEBIT") {
          throw badRequest(
            "commitmentDebitSubAccountId must reference a DEBIT normal-side account"
          );
        }
        if (!Boolean(account.is_active)) {
          throw badRequest(
            "commitmentDebitSubAccountId must reference an active account"
          );
        }
        if (!Boolean(account.allow_posting)) {
          throw badRequest(
            "commitmentDebitSubAccountId must reference a postable account"
          );
        }
        if (Boolean(account.has_active_children)) {
          throw badRequest(
            "commitmentDebitSubAccountId must reference a leaf sub-account"
          );
        }
        if (
          commitmentDebitParentAccountId &&
          !isDescendantOfParentAccount(
            accountParentById,
            parsePositiveInt(account.id),
            commitmentDebitParentAccountId
          )
        ) {
          throw badRequest(
            "commitmentDebitSubAccountId must be a child/descendant of configured commitmentDebitParentAccountId"
          );
        }

        const mappingConflict = await tx.query(
          `SELECT id
           FROM shareholders
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND commitment_debit_sub_account_id = ?
             AND id <> ?
           LIMIT 1`,
          [
            tenantId,
            legalEntityId,
            commitmentDebitSubAccountId,
            parsePositiveInt(existing?.id) || 0,
          ]
        );
        if (mappingConflict.rows[0]) {
          throw badRequest(
            "commitmentDebitSubAccountId is already assigned to another shareholder"
          );
        }
      }

      await tx.query(
        `INSERT INTO shareholders (
            tenant_id,
            legal_entity_id,
            code,
            name,
            shareholder_type,
            tax_id,
            committed_capital,
            capital_sub_account_id,
            commitment_debit_sub_account_id,
            currency_code,
            status,
            notes
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           shareholder_type = VALUES(shareholder_type),
           tax_id = VALUES(tax_id),
           committed_capital = VALUES(committed_capital),
           capital_sub_account_id = VALUES(capital_sub_account_id),
           commitment_debit_sub_account_id = VALUES(commitment_debit_sub_account_id),
           currency_code = VALUES(currency_code),
           status = VALUES(status),
           notes = VALUES(notes)`,
        [
          tenantId,
          legalEntityId,
          code,
          name,
          shareholderType,
          taxId,
          committedCapital,
          capitalSubAccountId,
          commitmentDebitSubAccountId,
          currencyCode,
          status,
          notes,
        ]
      );

      const savedResult = await tx.query(
        `SELECT
           id,
           committed_capital,
           capital_sub_account_id,
           commitment_debit_sub_account_id
         FROM shareholders
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND code = ?
         LIMIT 1`,
        [tenantId, legalEntityId, code]
      );
      const saved = savedResult.rows[0] || null;
      const shareholderId = parsePositiveInt(saved?.id);
      const previousCommittedCapital = normalizeMoney(existing?.committed_capital || 0);
      const currentCommittedCapital = normalizeMoney(saved?.committed_capital || 0);
      const committedCapitalDelta = normalizeMoney(
        currentCommittedCapital - previousCommittedCapital
      );

      let commitmentJournal = {
        attempted: false,
        created: false,
        reason: autoCommitmentJournal ? null : "DISABLED",
        amount: committedCapitalDelta > 0 ? committedCapitalDelta : 0,
      };

      if (autoCommitmentJournal) {
        if (committedCapitalDelta > 0) {
          commitmentJournal = await createShareholderCommitmentDraftJournal(tx, {
            tenantId,
            legalEntityId,
            userId,
            shareholderId,
            shareholderCode: code,
            shareholderName: name,
            amount: committedCapitalDelta,
            currencyCode,
            commitmentDate,
            capitalSubAccountId:
              parsePositiveInt(saved?.capital_sub_account_id) || capitalSubAccountId,
            commitmentDebitSubAccountId:
              parsePositiveInt(saved?.commitment_debit_sub_account_id) ||
              commitmentDebitSubAccountId,
          });
          if (!commitmentJournal.created) {
            throw badRequest(
              toCommitmentJournalFailureMessage(commitmentJournal.reason)
            );
          }
        } else if (committedCapitalDelta < 0) {
          commitmentJournal = {
            attempted: true,
            created: false,
            reason: "COMMITTED_CAPITAL_DECREASE_REQUIRES_MANUAL_REVERSAL",
            amount: Math.abs(committedCapitalDelta),
          };
        } else {
          commitmentJournal = {
            attempted: true,
            created: false,
            reason: "NO_COMMITTED_CAPITAL_INCREASE",
            amount: 0,
          };
        }
      }

      await recalculateShareholderOwnershipPctTx(tx, tenantId, legalEntityId);

      return {
        shareholderId: shareholderId || null,
        committedCapitalDelta,
        commitmentJournal,
      };
    });

    return res.status(201).json({
      ok: true,
      id: operation.shareholderId,
      committedCapitalDelta: operation.committedCapitalDelta,
      commitmentJournal: operation.commitmentJournal,
      autoCommitmentJournal,
    });
  })
);

router.post(
  "/shareholders/commitment-journal-batch/preview",
  requirePermission("org.legal_entity.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const shareholderIds = parseBatchShareholderIds(req.body?.shareholderIds);
    const commitmentDate =
      req.body.commitmentDate === undefined ||
      req.body.commitmentDate === null ||
      req.body.commitmentDate === ""
        ? toIsoDate(new Date(), "commitmentDate")
        : toIsoDate(req.body.commitmentDate, "commitmentDate");

    const preview = await withTransaction(async (tx) =>
      buildShareholderCommitmentBatchPreviewTx(tx, {
        tenantId,
        legalEntityId,
        shareholderIds,
        commitmentDate,
        lockShareholders: false,
      })
    );

    return res.json({
      ok: true,
      ...preview,
    });
  })
);

router.post(
  "/shareholders/commitment-journal-batch",
  requirePermission("org.legal_entity.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const shareholderIds = parseBatchShareholderIds(req.body?.shareholderIds);

    const commitmentDate =
      req.body.commitmentDate === undefined ||
      req.body.commitmentDate === null ||
      req.body.commitmentDate === ""
        ? toIsoDate(new Date(), "commitmentDate")
        : toIsoDate(req.body.commitmentDate, "commitmentDate");
    const userId = parsePositiveInt(req.user?.userId);
    if (!userId) {
      throw badRequest("Authenticated user is required");
    }

    try {
      const operation = await withTransaction(async (tx) => {
        const preview = await buildShareholderCommitmentBatchPreviewTx(tx, {
          tenantId,
          legalEntityId,
          shareholderIds,
          commitmentDate,
          lockShareholders: true,
        });

        if (preview.validation?.has_blocking_errors) {
          const err = badRequest("Batch commitment journal validation failed");
          err.code = "BATCH_VALIDATION_FAILED";
          err.payload = {
            validation: preview.validation,
            skipped_shareholders: preview.skipped_shareholders,
            rows: preview.rows,
          };
          throw err;
        }

        const includedShareholders = Array.isArray(preview.included_shareholders)
          ? preview.included_shareholders
          : [];
        if (includedShareholders.length === 0) {
          const err = badRequest(
            "No shareholder has a positive journalizable commitment delta"
          );
          err.code = "BATCH_VALIDATION_FAILED";
          err.payload = {
            validation: preview.validation,
            skipped_shareholders: preview.skipped_shareholders,
            rows: preview.rows,
          };
          throw err;
        }

        const journalContext = preview.journal_context || null;
        const bookId = parsePositiveInt(journalContext?.book_id);
        const fiscalPeriodId = parsePositiveInt(journalContext?.fiscal_period_id);
        if (!bookId || !fiscalPeriodId) {
          throw badRequest("No OPEN book/fiscal period found for legalEntityId");
        }

        const totalAmount = normalizeMoney(preview.totals?.total_debit || 0);
        if (totalAmount <= 0) {
          throw badRequest("Total commitment amount must be greater than zero");
        }

        const journalNo = generateAutoJournalNo("TAAHHUT");
        const referenceNo = `SHAREHOLDER_COMMITMENT_BATCH:${legalEntityId}:${Date.now()}`.slice(
          0,
          100
        );
        const currencyCode = normalizeCurrencyCode(
          preview.totals?.currency_code || journalContext?.base_currency_code || "USD"
        );
        const entryDate = commitmentDate;
        const documentDate = commitmentDate;
        const description = `Shareholder commitment batch (${includedShareholders.length} shareholders)`;

        const entryResult = await tx.query(
          `INSERT INTO journal_entries (
              tenant_id,
              legal_entity_id,
              book_id,
              fiscal_period_id,
              journal_no,
              source_type,
              status,
              entry_date,
              document_date,
              currency_code,
              description,
              reference_no,
              total_debit_base,
              total_credit_base,
              created_by_user_id
            )
            VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            legalEntityId,
            bookId,
            fiscalPeriodId,
            journalNo,
            entryDate,
            documentDate,
            currencyCode,
            description,
            referenceNo,
            totalAmount,
            totalAmount,
            userId,
          ]
        );
        const journalEntryId = parsePositiveInt(entryResult.rows.insertId);
        if (!journalEntryId) {
          throw badRequest("Failed to create shareholder batch commitment journal");
        }

        let lineNo = 1;
        for (const shareholder of includedShareholders) {
          const amount = normalizeMoney(shareholder.delta_amount || 0);
          const shareholderId = parsePositiveInt(shareholder.shareholder_id);
          const shareholderCode = String(shareholder.code || shareholderId || "");
          const shareholderName = String(shareholder.name || "").trim();
          const debitAccountId = parsePositiveInt(shareholder.debit_account_id);
          const creditAccountId = parsePositiveInt(shareholder.credit_account_id);

          // eslint-disable-next-line no-await-in-loop
          await tx.query(
            `INSERT INTO journal_lines (
                journal_entry_id,
                line_no,
                account_id,
                operating_unit_id,
                counterparty_legal_entity_id,
                description,
                currency_code,
                amount_txn,
                debit_base,
                credit_base,
                tax_code
              )
              VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, 0, NULL)`,
            [
              journalEntryId,
              lineNo,
              debitAccountId,
              `Shareholder commitment receivable (${shareholderCode}${shareholderName ? ` - ${shareholderName}` : ""})`,
              currencyCode,
              amount,
              amount,
            ]
          );
          lineNo += 1;

          // eslint-disable-next-line no-await-in-loop
          await tx.query(
            `INSERT INTO journal_lines (
                journal_entry_id,
                line_no,
                account_id,
                operating_unit_id,
                counterparty_legal_entity_id,
                description,
                currency_code,
                amount_txn,
                debit_base,
                credit_base,
                tax_code
              )
              VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 0, ?, NULL)`,
            [
              journalEntryId,
              lineNo,
              creditAccountId,
              `Committed capital (${shareholderCode}${shareholderName ? ` - ${shareholderName}` : ""})`,
              currencyCode,
              amount * -1,
              amount,
            ]
          );
          lineNo += 1;

          // eslint-disable-next-line no-await-in-loop
          await tx.query(
            `INSERT INTO shareholder_commitment_journal_entries (
                tenant_id,
                shareholder_id,
                legal_entity_id,
                journal_entry_id,
                line_group_key,
                amount,
                currency_code,
                created_by_user_id
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tenantId,
              shareholderId,
              legalEntityId,
              journalEntryId,
              `BATCH:${shareholderId}`,
              amount,
              currencyCode,
              userId,
            ]
          );
        }

        return {
          journalEntryId,
          journalNo,
          shareholderCount: includedShareholders.length,
          skippedCount: Array.isArray(preview.skipped_shareholders)
            ? preview.skipped_shareholders.length
            : 0,
          totalAmount,
          bookId,
          bookCode: journalContext?.book_code || "-",
          fiscalPeriodId,
          entryDate,
          processedShareholderIds: includedShareholders.map((row) =>
            parsePositiveInt(row.shareholder_id)
          ),
          skippedShareholders: preview.skipped_shareholders || [],
          validationWarnings: preview.validation?.warnings || [],
        };
      });

      return res.status(201).json({
        ok: true,
        ...operation,
      });
    } catch (err) {
      if (err?.code === "BATCH_VALIDATION_FAILED") {
        return res.status(400).json({
          message: err.message,
          ...(err.payload || {}),
        });
      }
      throw err;
    }
  })
);

router.post(
  "/shareholders/auto-provision-sub-accounts",
  requirePermission("gl.account.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const shareholderId = parsePositiveInt(req.body?.shareholderId);
    const shareholderCode = String(req.body?.shareholderCode || "")
      .trim()
      .toUpperCase();
    const shareholderName = String(req.body?.shareholderName || "").trim();
    if (!shareholderCode || !shareholderName) {
      throw badRequest("shareholderCode and shareholderName are required");
    }

    const operation = await withTransaction(async (tx) => {
      const parentMappings = await resolveShareholderParentMappings(
        tx,
        tenantId,
        legalEntityId
      );
      const capitalParentAccountId = parsePositiveInt(
        parentMappings.capitalCreditParentAccountId
      );
      const commitmentParentAccountId = parsePositiveInt(
        parentMappings.commitmentDebitParentAccountId
      );
      if (!capitalParentAccountId || !commitmentParentAccountId) {
        throw badRequest(
          "Setup required: configure shareholder parent account mapping for selected legalEntityId"
        );
      }
      const capitalParentAccount = await assertShareholderParentAccount(
        tx,
        tenantId,
        legalEntityId,
        capitalParentAccountId,
        "capitalCreditParentAccountId",
        "CREDIT"
      );
      const commitmentParentAccount = await assertShareholderParentAccount(
        tx,
        tenantId,
        legalEntityId,
        commitmentParentAccountId,
        "commitmentDebitParentAccountId",
        "DEBIT"
      );

      const parentRowsResult = await tx.query(
        `SELECT
           a.id,
           a.code,
           a.name,
           a.coa_id,
           a.normal_side,
           a.account_type,
           a.allow_posting,
           a.is_active,
           c.legal_entity_id
         FROM accounts a
         JOIN charts_of_accounts c ON c.id = a.coa_id
         WHERE c.tenant_id = ?
           AND a.id IN (?, ?)
         FOR UPDATE`,
        [tenantId, capitalParentAccount.id, commitmentParentAccount.id]
      );
      const parentById = new Map(
        (parentRowsResult.rows || []).map((row) => [parsePositiveInt(row.id), row])
      );
      const capitalParentRow = parentById.get(capitalParentAccount.id);
      const commitmentParentRow = parentById.get(commitmentParentAccount.id);
      if (!capitalParentRow || !commitmentParentRow) {
        throw badRequest("Configured parent mapping accounts could not be loaded");
      }

      let shareholderRow = null;
      if (shareholderId) {
        const shareholderResult = await tx.query(
          `SELECT
             id,
             code,
             name,
             capital_sub_account_id,
             commitment_debit_sub_account_id
           FROM shareholders
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?
           LIMIT 1
           FOR UPDATE`,
          [tenantId, legalEntityId, shareholderId]
        );
        shareholderRow = shareholderResult.rows[0] || null;
        if (!shareholderRow) {
          throw badRequest("shareholderId not found for selected legalEntityId");
        }
      }

      const existingAccountIds = Array.from(
        new Set(
          [
            parsePositiveInt(shareholderRow?.capital_sub_account_id),
            parsePositiveInt(shareholderRow?.commitment_debit_sub_account_id),
          ].filter(Boolean)
        )
      );
      const existingAccountById = new Map();
      if (existingAccountIds.length > 0) {
        const placeholders = existingAccountIds.map(() => "?").join(",");
        const existingAccountsResult = await tx.query(
          `SELECT
             a.id,
             a.code,
             a.name,
             a.account_type,
             a.normal_side,
             a.allow_posting,
             a.is_active,
             a.parent_account_id,
             EXISTS(
               SELECT 1
               FROM accounts child
               WHERE child.parent_account_id = a.id
                 AND child.is_active = TRUE
             ) AS has_active_children,
             c.tenant_id AS account_tenant_id,
             c.legal_entity_id AS account_legal_entity_id
           FROM accounts a
           JOIN charts_of_accounts c ON c.id = a.coa_id
           WHERE a.id IN (${placeholders})`,
          existingAccountIds
        );
        for (const row of existingAccountsResult.rows || []) {
          existingAccountById.set(parsePositiveInt(row.id), row);
        }
      }

      const accountParentById = await loadLegalEntityAccountHierarchy(
        tx,
        tenantId,
        legalEntityId
      );

      const resolveExistingMappedAccount = ({
        accountId,
        fieldLabel,
        expectedNormalSide,
        expectedParentAccountId,
      }) => {
        const normalizedAccountId = parsePositiveInt(accountId);
        if (!normalizedAccountId) {
          return null;
        }
        const account = existingAccountById.get(normalizedAccountId) || null;
        const issue = validateShareholderMappedLeafAccount({
          account,
          tenantId,
          legalEntityId,
          expectedNormalSide,
          expectedParentAccountId,
          parentById: accountParentById,
          fieldLabel,
        });
        if (issue) {
          throw badRequest(
            `${fieldLabel} on shareholder is invalid: ${issue.message}`
          );
        }
        return {
          id: normalizedAccountId,
          code: String(account.code || ""),
          name: String(account.name || ""),
          created: false,
        };
      };

      let capitalSubAccount = resolveExistingMappedAccount({
        accountId: shareholderRow?.capital_sub_account_id,
        fieldLabel: "capital_sub_account_id",
        expectedNormalSide: "CREDIT",
        expectedParentAccountId: capitalParentAccount.id,
      });
      let commitmentSubAccount = resolveExistingMappedAccount({
        accountId: shareholderRow?.commitment_debit_sub_account_id,
        fieldLabel: "commitment_debit_sub_account_id",
        expectedNormalSide: "DEBIT",
        expectedParentAccountId: commitmentParentAccount.id,
      });

      const childRowsResult = await tx.query(
        `SELECT id, code, parent_account_id
         FROM accounts
         WHERE parent_account_id IN (?, ?)
         FOR UPDATE`,
        [capitalParentAccount.id, commitmentParentAccount.id]
      );
      const capitalUsedSequences = new Set();
      const debitUsedSequences = new Set();
      for (const row of childRowsResult.rows || []) {
        const parentAccountId = parsePositiveInt(row.parent_account_id);
        const sequence =
          parentAccountId === capitalParentAccount.id
            ? normalizeShareholderChildSequenceFromCode(
                capitalParentRow.code,
                row.code
              )
            : normalizeShareholderChildSequenceFromCode(
                commitmentParentRow.code,
                row.code
              );
        if (!sequence) {
          continue;
        }
        if (parentAccountId === capitalParentAccount.id) {
          capitalUsedSequences.add(sequence);
        }
        if (parentAccountId === commitmentParentAccount.id) {
          debitUsedSequences.add(sequence);
        }
      }

      const needsCapitalCreate = !capitalSubAccount;
      const needsDebitCreate = !commitmentSubAccount;

      if (needsCapitalCreate || needsDebitCreate) {
        const preferredSequenceFromCapital =
          !needsCapitalCreate && capitalSubAccount
            ? normalizeShareholderChildSequenceFromCode(
                capitalParentRow.code,
                capitalSubAccount.code
              )
            : null;
        const preferredSequenceFromDebit =
          !needsDebitCreate && commitmentSubAccount
            ? normalizeShareholderChildSequenceFromCode(
                commitmentParentRow.code,
                commitmentSubAccount.code
              )
            : null;
        const preferredSequence = parsePositiveInt(
          preferredSequenceFromCapital || preferredSequenceFromDebit
        );
        const sequenceFits = (sequence) => {
          if (!sequence) {
            return false;
          }
          if (needsCapitalCreate && capitalUsedSequences.has(sequence)) {
            return false;
          }
          if (needsDebitCreate && debitUsedSequences.has(sequence)) {
            return false;
          }
          return true;
        };

        let selectedSequence = preferredSequence && sequenceFits(preferredSequence)
          ? preferredSequence
          : null;
        if (!selectedSequence) {
          selectedSequence = 1;
          while (!sequenceFits(selectedSequence) && selectedSequence < 999999) {
            selectedSequence += 1;
          }
        }
        if (!sequenceFits(selectedSequence)) {
          throw badRequest(
            "Unable to allocate next available shareholder sub-account codes under configured parents"
          );
        }

        if (needsCapitalCreate) {
          const capitalCode = buildShareholderChildCode(
            capitalParentRow.code,
            selectedSequence
          );
          const capitalInsert = await tx.query(
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
              VALUES (?, ?, ?, 'EQUITY', 'CREDIT', TRUE, ?, TRUE)`,
            [
              parsePositiveInt(capitalParentRow.coa_id),
              capitalCode,
              shareholderName,
              capitalParentAccount.id,
            ]
          );
          capitalSubAccount = {
            id: parsePositiveInt(capitalInsert.rows.insertId),
            code: capitalCode,
            name: shareholderName,
            created: true,
          };
          capitalUsedSequences.add(selectedSequence);
        }

        if (needsDebitCreate) {
          const debitCode = buildShareholderChildCode(
            commitmentParentRow.code,
            selectedSequence
          );
          const debitInsert = await tx.query(
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
              VALUES (?, ?, ?, 'EQUITY', 'DEBIT', TRUE, ?, TRUE)`,
            [
              parsePositiveInt(commitmentParentRow.coa_id),
              debitCode,
              shareholderName,
              commitmentParentAccount.id,
            ]
          );
          commitmentSubAccount = {
            id: parsePositiveInt(debitInsert.rows.insertId),
            code: debitCode,
            name: shareholderName,
            created: true,
          };
          debitUsedSequences.add(selectedSequence);
        }
      }

      if (!capitalSubAccount?.id || !commitmentSubAccount?.id) {
        throw badRequest("Failed to resolve both shareholder sub-accounts");
      }

      if (shareholderRow?.id) {
        await tx.query(
          `UPDATE shareholders
           SET capital_sub_account_id = ?,
               commitment_debit_sub_account_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = ?
             AND legal_entity_id = ?
             AND id = ?`,
          [
            capitalSubAccount.id,
            commitmentSubAccount.id,
            tenantId,
            legalEntityId,
            parsePositiveInt(shareholderRow.id),
          ]
        );
      }

      return {
        legalEntityId,
        shareholderId: parsePositiveInt(shareholderRow?.id) || null,
        shareholderCode,
        shareholderName,
        capitalSubAccount,
        commitmentDebitSubAccount: commitmentSubAccount,
      };
    });

    return res.status(201).json({
      ok: true,
      message: "Shareholder sub-accounts are ready",
      ...operation,
    });
  })
);

router.post(
  "/operating-units",
  requirePermission("org.operating_unit.upsert", {
    resolveScope: (req, tenantId) => {
      const legalEntityId = parsePositiveInt(req.body?.legalEntityId);
      if (legalEntityId) {
        return { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId };
      }
      return { scopeType: "TENANT", scopeId: tenantId };
    },
  }),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["legalEntityId", "code", "name"]);
    const legalEntityId = parsePositiveInt(req.body.legalEntityId);
    if (!legalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }

    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");

    const { code, name, unitType = "BRANCH", hasSubledger = false } = req.body;
    const result = await query(
      `INSERT INTO operating_units (
          tenant_id, legal_entity_id, code, name, unit_type, has_subledger
        )
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         unit_type = VALUES(unit_type),
         has_subledger = VALUES(has_subledger)`,
      [
        tenantId,
        legalEntityId,
        String(code).trim(),
        String(name).trim(),
        String(unitType).toUpperCase(),
        Boolean(hasSubledger),
      ]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/fiscal-calendars",
  requirePermission("org.fiscal_calendar.upsert"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["code", "name", "yearStartMonth", "yearStartDay"]);

    const yearStartMonth = parsePositiveInt(req.body.yearStartMonth);
    const yearStartDay = parsePositiveInt(req.body.yearStartDay);

    if (!yearStartMonth || yearStartMonth > 12) {
      throw badRequest("yearStartMonth must be between 1 and 12");
    }
    if (!yearStartDay || yearStartDay > 31) {
      throw badRequest("yearStartDay must be between 1 and 31");
    }

    const { code, name } = req.body;
    const result = await query(
      `INSERT INTO fiscal_calendars (
          tenant_id, code, name, year_start_month, year_start_day
        )
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         year_start_month = VALUES(year_start_month),
         year_start_day = VALUES(year_start_day)`,
      [tenantId, String(code).trim(), String(name).trim(), yearStartMonth, yearStartDay]
    );

    return res.status(201).json({ ok: true, id: result.rows.insertId || null });
  })
);

router.post(
  "/fiscal-periods/generate",
  requirePermission("org.fiscal_period.generate"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, ["calendarId", "fiscalYear"]);

    const calendarId = parsePositiveInt(req.body.calendarId);
    const fiscalYear = parsePositiveInt(req.body.fiscalYear);
    if (!calendarId || !fiscalYear) {
      throw badRequest("calendarId and fiscalYear must be positive integers");
    }

    const calendar = await assertFiscalCalendarBelongsToTenant(
      tenantId,
      calendarId,
      "calendarId"
    );

    for (let i = 0; i < 12; i += 1) {
      const monthOffset = calendar.year_start_month - 1 + i;
      const start = new Date(Date.UTC(fiscalYear, monthOffset, calendar.year_start_day));
      const nextStart = new Date(
        Date.UTC(fiscalYear, monthOffset + 1, calendar.year_start_day)
      );
      const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
      const periodNo = i + 1;
      const periodName = `P${String(periodNo).padStart(2, "0")}`;

      await query(
        `INSERT INTO fiscal_periods (
            calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
         )
         VALUES (?, ?, ?, ?, ?, ?, FALSE)
         ON DUPLICATE KEY UPDATE
           period_name = VALUES(period_name),
           start_date = VALUES(start_date),
           end_date = VALUES(end_date)`,
        [calendarId, fiscalYear, periodNo, periodName, toIsoDate(start), toIsoDate(end)]
      );
    }

    return res.status(201).json({
      ok: true,
      calendarId,
      fiscalYear,
      periodsGenerated: 12,
    });
  })
);

export default router;
