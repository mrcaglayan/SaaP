import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { getPolicyPack } from "./policy-packs.service.js";

const ACCOUNT_TYPE_VALUES = new Set([
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
]);
const NORMAL_SIDE_VALUES = new Set(["DEBIT", "CREDIT"]);
const APPLY_MODES = new Set(["SKIP_IF_EXISTS", "MERGE", "OVERWRITE"]);
const DEFAULT_GL_ACCOUNTS = Object.freeze([
  Object.freeze({
    code: "1000",
    name: "Cash and Cash Equivalents",
    accountType: "ASSET",
    normalSide: "DEBIT",
  }),
  Object.freeze({
    code: "1100",
    name: "Accounts Receivable",
    accountType: "ASSET",
    normalSide: "DEBIT",
  }),
  Object.freeze({
    code: "2000",
    name: "Accounts Payable",
    accountType: "LIABILITY",
    normalSide: "CREDIT",
  }),
  Object.freeze({
    code: "3000",
    name: "Retained Earnings",
    accountType: "EQUITY",
    normalSide: "CREDIT",
  }),
  Object.freeze({
    code: "4000",
    name: "Revenue",
    accountType: "REVENUE",
    normalSide: "CREDIT",
  }),
  Object.freeze({
    code: "5000",
    name: "Operating Expense",
    accountType: "EXPENSE",
    normalSide: "DEBIT",
  }),
]);

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
  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function normalizeApplyMode(rawValue, defaultMode = "MERGE") {
  const normalizedMode = String(rawValue || defaultMode)
    .trim()
    .toUpperCase();
  if (!APPLY_MODES.has(normalizedMode)) {
    throw badRequest(`mode must be one of: ${Array.from(APPLY_MODES).join(", ")}`);
  }
  return normalizedMode;
}

function normalizeStarterAccountRow(row, index) {
  if (!row || typeof row !== "object") {
    throw badRequest(`starterAccounts[${index}] must be an object`);
  }

  const code = normalizeCode(row.code, `ACCOUNT_${index + 1}`);
  const name = normalizeName(row.name, `Account ${index + 1}`);
  const accountType = String(row.accountType ?? row.account_type ?? "")
    .trim()
    .toUpperCase();
  const normalSide = String(row.normalSide ?? row.normal_side ?? "")
    .trim()
    .toUpperCase();
  const rawParentCode = String(
    row.parentCode ??
      row.parent_code ??
      row.parentAccountCode ??
      row.parent_account_code ??
      ""
  )
    .trim()
    .toUpperCase();
  const parentCode = rawParentCode ? normalizeCode(rawParentCode, rawParentCode) : null;
  const allowPosting = parseBooleanValue(
    row.allowPosting ?? row.allow_posting,
    true
  );

  if (!ACCOUNT_TYPE_VALUES.has(accountType)) {
    throw badRequest(
      `starterAccounts[${index}].accountType must be one of: ${Array.from(
        ACCOUNT_TYPE_VALUES
      ).join(", ")}`
    );
  }
  if (!NORMAL_SIDE_VALUES.has(normalSide)) {
    throw badRequest(
      `starterAccounts[${index}].normalSide must be one of: ${Array.from(
        NORMAL_SIDE_VALUES
      ).join(", ")}`
    );
  }
  if (parentCode && parentCode === code) {
    throw badRequest(`starterAccounts[${index}].parentCode cannot equal code`);
  }

  return {
    code,
    name,
    accountType,
    normalSide,
    allowPosting,
    parentCode,
  };
}

function normalizeStarterAccounts(rawAccounts) {
  if (rawAccounts !== undefined && rawAccounts !== null && !Array.isArray(rawAccounts)) {
    throw badRequest("starterAccounts must be an array when provided");
  }

  const source =
    Array.isArray(rawAccounts) && rawAccounts.length > 0
      ? rawAccounts
      : DEFAULT_GL_ACCOUNTS;
  const normalizedRows = source.map((row, index) =>
    normalizeStarterAccountRow(row, index)
  );
  const rowByCode = new Map();
  for (const row of normalizedRows) {
    if (rowByCode.has(row.code)) {
      throw badRequest(`starterAccounts contains duplicate code: ${row.code}`);
    }
    rowByCode.set(row.code, row);
  }

  const visitStateByCode = new Map();
  const depthByCode = new Map();

  function resolveDepth(code) {
    const state = visitStateByCode.get(code);
    if (state === "visiting") {
      throw badRequest(`starterAccounts parentCode cycle detected at ${code}`);
    }
    if (state === "visited") {
      return depthByCode.get(code) || 0;
    }

    visitStateByCode.set(code, "visiting");
    const currentRow = rowByCode.get(code);
    if (!currentRow) {
      throw badRequest(`starterAccounts parentCode references unknown code: ${code}`);
    }

    let depth = 0;
    if (currentRow.parentCode) {
      if (!rowByCode.has(currentRow.parentCode)) {
        throw badRequest(
          `starterAccounts parentCode ${currentRow.parentCode} does not exist in payload`
        );
      }
      depth = resolveDepth(currentRow.parentCode) + 1;
    }

    depthByCode.set(code, depth);
    visitStateByCode.set(code, "visited");
    return depth;
  }

  for (const row of normalizedRows) {
    resolveDepth(row.code);
  }

  return normalizedRows.sort((left, right) => {
    const depthDelta =
      (depthByCode.get(left.code) || 0) - (depthByCode.get(right.code) || 0);
    if (depthDelta !== 0) {
      return depthDelta;
    }
    return left.code.localeCompare(right.code);
  });
}

/**
 * Resolve the starter-account template rows for one baseline or policy pack.
 */
export function resolveStarterAccountTemplate(policyPackId) {
  const normalizedPackId = String(policyPackId || "").trim().toUpperCase();
  if (!normalizedPackId) {
    return {
      packId: null,
      source: "BASELINE",
      rows: normalizeStarterAccounts(DEFAULT_GL_ACCOUNTS),
    };
  }

  const pack = getPolicyPack(normalizedPackId);
  if (!pack) {
    throw badRequest(`Unknown policyPackId: ${normalizedPackId}`);
  }
  if (!Array.isArray(pack.starterAccountTree) || pack.starterAccountTree.length === 0) {
    throw badRequest(
      `Selected policy pack ${normalizedPackId} does not provide a starterAccountTree`
    );
  }

  return {
    packId: normalizedPackId,
    source: "POLICY_PACK",
    rows: normalizeStarterAccounts(pack.starterAccountTree),
  };
}

async function replaceCoaAccountsIfAllowed(tx, coaId) {
  try {
    // Overwrite stays intentionally strict. Zero balance is not enough when any
    // setup/master row still references the account tree, so we let FK checks
    // block the delete inside the transaction.
    await tx.query(`DELETE FROM accounts WHERE coa_id = ?`, [coaId]);
  } catch (err) {
    if (err?.errno === 1451) {
      throw badRequest(
        "Existing CoA accounts cannot be overwritten because they are already referenced by journals or setup tables. Use a new CoA or manual remap first."
      );
    }
    throw err;
  }
}

async function upsertStarterAccountsToCoa(tx, coaId, starterAccounts) {
  const normalizedAccounts = normalizeStarterAccounts(starterAccounts);
  for (const account of normalizedAccounts) {
    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO accounts (
          coa_id, code, name, account_type, normal_side, allow_posting, parent_account_id
       )
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         account_type = VALUES(account_type),
         normal_side = VALUES(normal_side),
         allow_posting = VALUES(allow_posting),
         parent_account_id = NULL`,
      [
        coaId,
        account.code,
        account.name,
        account.accountType,
        account.normalSide,
        account.allowPosting,
      ]
    );
  }

  if (normalizedAccounts.length === 0) {
    return 0;
  }

  const codes = normalizedAccounts.map((account) => account.code);
  const placeholders = codes.map(() => "?").join(", ");
  const resolvedAccounts = await tx.query(
    `SELECT id, code
     FROM accounts
     WHERE coa_id = ?
       AND code IN (${placeholders})`,
    [coaId, ...codes]
  );
  const accountIdByCode = new Map(
    (resolvedAccounts.rows || []).map((row) => [
      String(row.code || "").trim().toUpperCase(),
      row.id,
    ])
  );

  for (const account of normalizedAccounts) {
    if (!accountIdByCode.has(account.code)) {
      throw new Error(`Unable to resolve account id for code ${account.code}`);
    }
  }

  for (const account of normalizedAccounts) {
    if (!account.parentCode) {
      continue;
    }

    const parentAccountId = parsePositiveInt(accountIdByCode.get(account.parentCode));
    if (!parentAccountId) {
      throw badRequest(
        `starterAccounts parentCode ${account.parentCode} could not be resolved in CoA`
      );
    }

    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `UPDATE accounts
       SET parent_account_id = ?
       WHERE coa_id = ?
         AND code = ?`,
      [parentAccountId, coaId, account.code]
    );
  }

  await tx.query(
    `UPDATE accounts parent
     JOIN accounts child ON child.parent_account_id = parent.id
     SET parent.allow_posting = FALSE
     WHERE parent.coa_id = ?
       AND child.coa_id = ?
       AND parent.allow_posting = TRUE`,
    [coaId, coaId]
  );

  return normalizedAccounts.length;
}

/**
 * Apply a starter-account template to one CoA inside an existing transaction.
 */
export async function applyStarterAccountTemplateToCoaTx(
  tx,
  { coaId, policyPackId = null, mode = "MERGE" }
) {
  if (!tx || typeof tx.query !== "function") {
    throw badRequest("tx.query is required");
  }

  const normalizedCoaId = parsePositiveInt(coaId);
  if (!normalizedCoaId) {
    throw badRequest("coaId must be a positive integer");
  }

  const normalizedMode = normalizeApplyMode(mode);
  const template = resolveStarterAccountTemplate(policyPackId);
  const existing = await tx.query(
    `SELECT COUNT(*) AS count
     FROM accounts
     WHERE coa_id = ?`,
    [normalizedCoaId]
  );
  const existingCount = Number(existing.rows?.[0]?.count || 0);
  if (existingCount > 0 && normalizedMode === "SKIP_IF_EXISTS") {
    return {
      template,
      mode: normalizedMode,
      appliedCount: 0,
      existingCount,
      clearedCount: 0,
      overwriteApplied: false,
      skippedBecauseExistingAccounts: true,
    };
  }

  if (existingCount > 0 && normalizedMode === "OVERWRITE") {
    await replaceCoaAccountsIfAllowed(tx, normalizedCoaId);
  }

  const appliedCount = await upsertStarterAccountsToCoa(
    tx,
    normalizedCoaId,
    template.rows
  );
  return {
    template,
    mode: normalizedMode,
    appliedCount,
    existingCount,
    clearedCount: existingCount > 0 && normalizedMode === "OVERWRITE" ? existingCount : 0,
    overwriteApplied: existingCount > 0 && normalizedMode === "OVERWRITE",
    skippedBecauseExistingAccounts: false,
  };
}

/**
 * Preview a starter-account template against the currently persisted CoA tree.
 */
export async function previewStarterAccountTemplateForCoa({
  coaId,
  policyPackId = null,
  runQuery = query,
}) {
  if (typeof runQuery !== "function") {
    throw badRequest("runQuery must be a function");
  }

  const normalizedCoaId = parsePositiveInt(coaId);
  if (!normalizedCoaId) {
    throw badRequest("coaId must be a positive integer");
  }

  const template = resolveStarterAccountTemplate(policyPackId);
  const existing = await runQuery(
    `SELECT id, code
     FROM accounts
     WHERE coa_id = ?`,
    [normalizedCoaId]
  );
  const existingByCode = new Map(
    (existing.rows || []).map((row) => [String(row.code || "").trim().toUpperCase(), row])
  );
  const rows = template.rows.map((row) => ({
    ...row,
    exists: existingByCode.has(row.code),
  }));
  const existingMatches = rows.filter((row) => row.exists).length;

  return {
    template,
    rows,
    summary: {
      total: rows.length,
      existingMatches,
      newCodes: rows.length - existingMatches,
      existingAccountCount: Number(existing.rows?.length || 0),
    },
  };
}
