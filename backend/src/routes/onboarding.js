import express from "express";
import { query, withTransaction } from "../db.js";
import { invalidateRbacCache, requirePermission } from "../middleware/rbac.js";
import {
  asyncHandler,
  assertRequiredFields,
  badRequest,
  parsePositiveInt,
  resolveTenantId,
} from "./_utils.js";
import { resolvePolicyPack } from "../services/policy-packs.resolve.service.js";
import { getPolicyPack } from "../services/policy-packs.service.js";
import { applyPolicyPackTx } from "../services/policy-packs.apply.service.js";
import {
  buildDraftOperatingUnitCurrentAccountEligibilityPreview,
  summarizeOperatingUnitCurrentAccountEligibility,
} from "../services/ou.current-account-eligibility.service.js";
import {
  applyOperatingUnitCurrentAccountConfigTx,
  upsertOperatingUnitCurrentAccountConfigTx,
} from "../services/org.write.service.js";
import { upsertJournalPurposeAccountTx } from "../services/org.write.queries.js";
import { assertShareholderParentAccount } from "../services/org.shareholder.helpers.js";
import { getTenantReadinessSnapshot } from "../services/tenant-readiness.service.js";
import { getTenantRoleIdsByCode } from "../services/systemRoles.service.js";
import { createInviteForTenantUser } from "../services/userInvites.service.js";
import { logRbacAuditEvent } from "../audit/rbacAuditLogger.js";

const router = express.Router();
const SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE =
  "SHAREHOLDER_CAPITAL_CREDIT_PARENT";
const SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE =
  "SHAREHOLDER_COMMITMENT_DEBIT_PARENT";
const SHAREHOLDER_PURPOSE_CODES = Object.freeze([
  SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE,
  SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE,
]);
const SHAREHOLDER_PURPOSE_CODE_SET = new Set(SHAREHOLDER_PURPOSE_CODES);
const BOOTSTRAP_HANDOFF_PRESET_CODE_ALIASES = Object.freeze({});
const BOOTSTRAP_HANDOFF_PRESET_DEFINITIONS = Object.freeze({
  EntityAPController: Object.freeze({
    code: "EntityAPController",
    scopeType: "LEGAL_ENTITY",
    roleCodes: Object.freeze([
      "LocalUserAdmin",
      "MasterDataSteward",
      "CounterpartyCardEditor",
      "EntityAPController",
      "APApprover",
      "GLOperator",
      "TreasuryOperator",
      "PayrollOperator",
      "LocalClosePreparer",
      "ShareholderCapitalOperator",
    ]),
    optionalRoleCodes: Object.freeze(["GLPostingAuthority"]),
  }),
});

const DEFAULT_ACCOUNTS = [
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
const ACCOUNT_TYPE_VALUES = new Set([
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
]);
const NORMAL_SIDE_VALUES = new Set(["DEBIT", "CREDIT"]);

const PAYMENT_TERM_STATUS_VALUES = new Set(["ACTIVE", "INACTIVE"]);
const DEFAULT_PAYMENT_TERM_TEMPLATES = [
  {
    code: "DUE_ON_RECEIPT",
    name: "Due on Receipt",
    dueDays: 0,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
  {
    code: "NET_15",
    name: "Net 15",
    dueDays: 15,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
  {
    code: "NET_30",
    name: "Net 30",
    dueDays: 30,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
  {
    code: "NET_45",
    name: "Net 45",
    dueDays: 45,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
  {
    code: "NET_60",
    name: "Net 60",
    dueDays: 60,
    graceDays: 0,
    isEndOfMonth: false,
    status: "ACTIVE",
  },
];

async function scalarCount(sql, params = [], runQuery = query) {
  const result = await runQuery(sql, params);
  const count = Number(result.rows?.[0]?.count || 0);
  return Number.isFinite(count) ? count : 0;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
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

function normalizeEmail(rawValue, fieldName = "email") {
  const normalized = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw badRequest(`${fieldName} is required`);
  }
  if (normalized.length > 255) {
    throw badRequest(`${fieldName} cannot exceed 255 characters`);
  }
  if (!normalized.includes("@") || !normalized.includes(".")) {
    throw badRequest(`${fieldName} is invalid`);
  }
  return normalized;
}

function parseNonNegativeInt(value, fieldName, defaultValue = 0) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw badRequest(`${fieldName} must be a non-negative integer`);
  }
  return parsed;
}

function parseBooleanFlag(value, fallback = false, fieldName = "value") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1") {
    return true;
  }
  if (value === 0 || value === "0") {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw badRequest(`${fieldName} must be a boolean`);
}

function normalizeOptionalCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function normalizeEntityPolicyPackSelection(entity) {
  return {
    policyPackId: normalizeOptionalCode(entity?.policyPackId ?? entity?.policy_pack_id),
    policyPackMode: normalizeOptionalCode(
      entity?.policyPackMode ?? entity?.policy_pack_mode
    ),
  };
}

function normalizeGroupCoaSelection(groupCoa, groupCompany) {
  const normalizedGroupCompanyCode = normalizeCode(
    groupCompany?.code,
    "GLOBAL"
  );
  const normalizedGroupCompanyName = normalizeName(
    groupCompany?.name,
    "Group"
  );
  return {
    code: normalizeCode(
      groupCoa?.code ?? groupCoa?.coaCode ?? `GRP_${normalizedGroupCompanyCode}`,
      `GRP_${normalizedGroupCompanyCode}`
    ),
    name: normalizeName(
      groupCoa?.name ??
        groupCoa?.coaName ??
        `${normalizedGroupCompanyName} Group CoA`,
      "Group CoA"
    ),
    starterPackId: normalizeOptionalCode(
      groupCoa?.starterPackId ??
        groupCoa?.starter_pack_id ??
        groupCoa?.policyPackId ??
        groupCoa?.policy_pack_id
    ),
  };
}

function normalizeCompanyBootstrapCurrentAccountConfig(entity, index) {
  const rawConfig = entity?.currentAccountConfig ?? entity?.current_account_config;
  if (rawConfig === undefined || rawConfig === null || rawConfig === "") {
    return {
      skipForNow: false,
      dueFromParentAccountCode: null,
      dueToParentAccountCode: null,
    };
  }
  if (typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw badRequest(`legalEntities[${index}].currentAccountConfig must be an object`);
  }

  const skipForNow = parseBooleanFlag(
    rawConfig.skipForNow ?? rawConfig.skip_for_now,
    false,
    `legalEntities[${index}].currentAccountConfig.skipForNow`
  );
  const dueFromParentAccountCode = normalizeOptionalCode(
    rawConfig.dueFromParentAccountCode ?? rawConfig.due_from_parent_account_code
  );
  const dueToParentAccountCode = normalizeOptionalCode(
    rawConfig.dueToParentAccountCode ?? rawConfig.due_to_parent_account_code
  );

  if (skipForNow) {
    return {
      skipForNow: true,
      dueFromParentAccountCode,
      dueToParentAccountCode,
    };
  }
  if (!dueFromParentAccountCode && !dueToParentAccountCode) {
    return {
      skipForNow: false,
      dueFromParentAccountCode: null,
      dueToParentAccountCode: null,
    };
  }
  if (!dueFromParentAccountCode || !dueToParentAccountCode) {
    throw badRequest(
      `legalEntities[${index}].currentAccountConfig must include both dueFromParentAccountCode and dueToParentAccountCode`
    );
  }
  if (dueFromParentAccountCode === dueToParentAccountCode) {
    throw badRequest(
      `legalEntities[${index}].currentAccountConfig dueFromParentAccountCode must differ from dueToParentAccountCode`
    );
  }

  return {
    skipForNow: false,
    dueFromParentAccountCode,
    dueToParentAccountCode,
  };
}

function normalizeCompanyBootstrapShareholderParentConfig(entity, index) {
  const rawConfig =
    entity?.shareholderParentConfig ?? entity?.shareholder_parent_config;
  if (rawConfig === undefined || rawConfig === null || rawConfig === "") {
    return {
      manualOverride: false,
      capitalCreditParentAccountCode: null,
      commitmentDebitParentAccountCode: null,
    };
  }
  if (typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw badRequest(
      `legalEntities[${index}].shareholderParentConfig must be an object`
    );
  }

  const manualOverride = parseBooleanFlag(
    rawConfig.manualOverride ?? rawConfig.manual_override,
    false,
    `legalEntities[${index}].shareholderParentConfig.manualOverride`
  );
  const capitalCreditParentAccountCode = normalizeOptionalCode(
    rawConfig.capitalCreditParentAccountCode ??
      rawConfig.capital_credit_parent_account_code
  );
  const commitmentDebitParentAccountCode = normalizeOptionalCode(
    rawConfig.commitmentDebitParentAccountCode ??
      rawConfig.commitment_debit_parent_account_code
  );
  const effectiveManualOverride =
    manualOverride ||
    Boolean(capitalCreditParentAccountCode) ||
    Boolean(commitmentDebitParentAccountCode);

  if (!effectiveManualOverride) {
    return {
      manualOverride: false,
      capitalCreditParentAccountCode: null,
      commitmentDebitParentAccountCode: null,
    };
  }
  if (!capitalCreditParentAccountCode || !commitmentDebitParentAccountCode) {
    throw badRequest(
      `legalEntities[${index}].shareholderParentConfig must include both capitalCreditParentAccountCode and commitmentDebitParentAccountCode`
    );
  }
  if (capitalCreditParentAccountCode === commitmentDebitParentAccountCode) {
    throw badRequest(
      `legalEntities[${index}].shareholderParentConfig capitalCreditParentAccountCode must differ from commitmentDebitParentAccountCode`
    );
  }

  return {
    manualOverride: true,
    capitalCreditParentAccountCode,
    commitmentDebitParentAccountCode,
  };
}

async function resolveBootstrapCurrentAccountParentAccountIdsForCoa({
  coaId,
  legalEntityCode,
  currentAccountConfig,
  runQuery = query,
}) {
  if (
    !currentAccountConfig?.dueFromParentAccountCode ||
    !currentAccountConfig?.dueToParentAccountCode
  ) {
    return null;
  }

  const result = await runQuery(
    `SELECT id, code
     FROM accounts
     WHERE coa_id = ?
       AND code IN (?, ?)`,
    [
      coaId,
      currentAccountConfig.dueFromParentAccountCode,
      currentAccountConfig.dueToParentAccountCode,
    ]
  );
  const accountIdByCode = new Map(
    (result.rows || []).map((row) => [
      normalizeOptionalCode(row?.code),
      parsePositiveInt(row?.id),
    ])
  );

  const dueFromParentAccountId = parsePositiveInt(
    accountIdByCode.get(currentAccountConfig.dueFromParentAccountCode)
  );
  if (!dueFromParentAccountId) {
    throw badRequest(
      `currentAccountConfig.dueFromParentAccountCode could not be resolved in legal entity ${String(
        legalEntityCode || ""
      ).trim()} CoA: ${currentAccountConfig.dueFromParentAccountCode}`
    );
  }

  const dueToParentAccountId = parsePositiveInt(
    accountIdByCode.get(currentAccountConfig.dueToParentAccountCode)
  );
  if (!dueToParentAccountId) {
    throw badRequest(
      `currentAccountConfig.dueToParentAccountCode could not be resolved in legal entity ${String(
        legalEntityCode || ""
      ).trim()} CoA: ${currentAccountConfig.dueToParentAccountCode}`
    );
  }

  return {
    dueFromParentAccountId,
    dueToParentAccountId,
  };
}

async function resolveBootstrapShareholderParentAccountIdsForCoa({
  coaId,
  legalEntityCode,
  shareholderParentConfig,
  runQuery = query,
}) {
  if (
    !shareholderParentConfig?.capitalCreditParentAccountCode ||
    !shareholderParentConfig?.commitmentDebitParentAccountCode
  ) {
    return null;
  }

  const result = await runQuery(
    `SELECT id, code
     FROM accounts
     WHERE coa_id = ?
       AND code IN (?, ?)`,
    [
      coaId,
      shareholderParentConfig.capitalCreditParentAccountCode,
      shareholderParentConfig.commitmentDebitParentAccountCode,
    ]
  );
  const accountIdByCode = new Map(
    (result.rows || []).map((row) => [
      normalizeOptionalCode(row?.code),
      parsePositiveInt(row?.id),
    ])
  );

  const capitalCreditParentAccountId = parsePositiveInt(
    accountIdByCode.get(shareholderParentConfig.capitalCreditParentAccountCode)
  );
  if (!capitalCreditParentAccountId) {
    throw badRequest(
      `shareholderParentConfig.capitalCreditParentAccountCode could not be resolved in legal entity ${String(
        legalEntityCode || ""
      ).trim()} CoA: ${shareholderParentConfig.capitalCreditParentAccountCode}`
    );
  }

  const commitmentDebitParentAccountId = parsePositiveInt(
    accountIdByCode.get(shareholderParentConfig.commitmentDebitParentAccountCode)
  );
  if (!commitmentDebitParentAccountId) {
    throw badRequest(
      `shareholderParentConfig.commitmentDebitParentAccountCode could not be resolved in legal entity ${String(
        legalEntityCode || ""
      ).trim()} CoA: ${shareholderParentConfig.commitmentDebitParentAccountCode}`
    );
  }

  return {
    capitalCreditParentAccountId,
    commitmentDebitParentAccountId,
  };
}

function applyShareholderOverrideToPolicyPackPlan(plan, shareholderParentConfig) {
  // PR-56 keeps shareholder parent mapping inside legal-entity activation.
  // Bootstrap may save explicit overrides when present, but unresolved
  // shareholder parent purposes must not abort baseline company bootstrap.
  return {
    ...plan,
    missingRequiredPurposeCodes: (plan?.missingRequiredPurposeCodes || []).filter(
      (purposeCode) => !SHAREHOLDER_PURPOSE_CODE_SET.has(normalizeOptionalCode(purposeCode))
    ),
  };
}

async function applyBootstrapShareholderParentConfigTx({
  tx,
  tenantId,
  legalEntityId,
  coaId,
  legalEntityCode,
  shareholderParentConfig,
}) {
  if (!shareholderParentConfig?.manualOverride) {
    return {
      configured: false,
      manualOverride: false,
      savedConfig: null,
    };
  }

  const resolvedParentAccountIds =
    await resolveBootstrapShareholderParentAccountIdsForCoa({
      coaId,
      legalEntityCode,
      shareholderParentConfig,
      runQuery: tx.query,
    });

  await assertShareholderParentAccount(
    tx,
    tenantId,
    legalEntityId,
    resolvedParentAccountIds.capitalCreditParentAccountId,
    "capitalCreditParentAccountId",
    "CREDIT"
  );
  await assertShareholderParentAccount(
    tx,
    tenantId,
    legalEntityId,
    resolvedParentAccountIds.commitmentDebitParentAccountId,
    "commitmentDebitParentAccountId",
    "DEBIT"
  );

  await upsertJournalPurposeAccountTx(tx, {
    tenantId,
    legalEntityId,
    purposeCode: SHAREHOLDER_CAPITAL_CREDIT_PARENT_PURPOSE,
    accountId: resolvedParentAccountIds.capitalCreditParentAccountId,
  });
  await upsertJournalPurposeAccountTx(tx, {
    tenantId,
    legalEntityId,
    purposeCode: SHAREHOLDER_COMMITMENT_DEBIT_PARENT_PURPOSE,
    accountId: resolvedParentAccountIds.commitmentDebitParentAccountId,
  });

  return {
    configured: true,
    manualOverride: true,
    savedConfig: {
      capitalCreditParentAccountCode:
        shareholderParentConfig.capitalCreditParentAccountCode,
      commitmentDebitParentAccountCode:
        shareholderParentConfig.commitmentDebitParentAccountCode,
      capitalCreditParentAccountId:
        resolvedParentAccountIds.capitalCreditParentAccountId,
      commitmentDebitParentAccountId:
        resolvedParentAccountIds.commitmentDebitParentAccountId,
    },
  };
}

function summarizeBootstrapCurrentAccountProvisioning(payload) {
  return {
    createdAccountCount: Array.isArray(payload?.createdAccounts)
      ? payload.createdAccounts.length
      : 0,
    reusedAccountCount: Array.isArray(payload?.reusedAccounts)
      ? payload.reusedAccounts.length
      : 0,
    updatedOperatingUnitCount: Array.isArray(payload?.updatedOperatingUnits)
      ? payload.updatedOperatingUnits.length
      : 0,
    updatedPartnerMappingCount: Array.isArray(payload?.updatedPartnerMappings)
      ? payload.updatedPartnerMappings.length
      : 0,
    warningCount: Array.isArray(payload?.warnings) ? payload.warnings.length : 0,
    lastAppliedAt: payload?.lastAppliedAt || null,
  };
}

function buildBootstrapCurrentAccountReadinessWarning({
  legalEntityCode,
  effectiveActiveOperatingUnitCount,
  currentAccountSetupRecommended,
  skippedExplicitly,
}) {
  if (currentAccountSetupRecommended) {
    return {
      code: skippedExplicitly
        ? "CURRENT_ACCOUNT_SETUP_SKIPPED"
        : "CURRENT_ACCOUNT_SETUP_PENDING",
      severity: "warning",
      message: `Current-account setup was ${
        skippedExplicitly ? "skipped" : "not configured"
      } for legal entity ${String(
        legalEntityCode || ""
      ).trim()} during company bootstrap. This legal entity has ${effectiveActiveOperatingUnitCount} active operating units in the submitted draft, so legal-entity activation remains incomplete until saved parents are configured and applied.`,
    };
  }

  return {
    code: "CURRENT_ACCOUNT_SETUP_OPTIONAL",
    severity: "info",
    message: `Current-account setup was not configured for legal entity ${String(
      legalEntityCode || ""
    ).trim()} during company bootstrap. The submitted draft has ${effectiveActiveOperatingUnitCount} active operating unit${
      effectiveActiveOperatingUnitCount === 1 ? "" : "s"
    }, so cross-context readiness is not required yet.`,
  };
}

function buildPolicyPackBootstrapApplyPlan(pack, previewRows) {
  const requiredPurposeCodeSet = new Set(
    (pack?.requiredPurposeMappings || [])
      .filter((row) => row?.required === true)
      .map((row) => normalizeOptionalCode(row?.purposeCode))
      .filter(Boolean)
  );

  const seenPurposeCodes = new Set();
  const applyRows = [];
  const missingRequiredPurposeCodes = [];
  let missingOptionalCount = 0;

  for (const row of Array.isArray(previewRows) ? previewRows : []) {
    const purposeCode = normalizeOptionalCode(row?.purposeCode);
    if (!purposeCode || seenPurposeCodes.has(purposeCode)) {
      continue;
    }

    seenPurposeCodes.add(purposeCode);
    if (row?.missing) {
      if (requiredPurposeCodeSet.has(purposeCode)) {
        missingRequiredPurposeCodes.push(purposeCode);
      } else {
        missingOptionalCount += 1;
      }
      continue;
    }

    const accountId = parsePositiveInt(row?.accountId);
    if (!accountId) {
      continue;
    }

    applyRows.push({
      purposeCode,
      accountId,
    });
  }

  return {
    applyRows,
    missingRequiredPurposeCodes: Array.from(
      new Set(missingRequiredPurposeCodes)
    ).sort((left, right) => left.localeCompare(right)),
    missingOptionalCount,
    requiredPurposeCount: requiredPurposeCodeSet.size,
  };
}

function normalizeDefaultAccountRow(row, index) {
  if (!row || typeof row !== "object") {
    throw badRequest(`defaultAccounts[${index}] must be an object`);
  }

  const code = normalizeOptionalCode(row.code);
  const name = String(row.name || "").trim();
  const accountType = String(row.accountType || row.account_type || "")
    .trim()
    .toUpperCase();
  const normalSide = String(row.normalSide || row.normal_side || "")
    .trim()
    .toUpperCase();
  const parentCode = normalizeOptionalCode(
    row.parentCode ??
      row.parent_code ??
      row.parentAccountCode ??
      row.parent_account_code
  );
  const allowPosting = parseBooleanFlag(
    row.allowPosting ?? row.allow_posting,
    true,
    `defaultAccounts[${index}].allowPosting`
  );

  if (!code) {
    throw badRequest(`defaultAccounts[${index}].code is required`);
  }
  if (!name) {
    throw badRequest(`defaultAccounts[${index}].name is required`);
  }
  if (!ACCOUNT_TYPE_VALUES.has(accountType)) {
    throw badRequest(
      `defaultAccounts[${index}].accountType must be one of: ${Array.from(
        ACCOUNT_TYPE_VALUES
      ).join(", ")}`
    );
  }
  if (!NORMAL_SIDE_VALUES.has(normalSide)) {
    throw badRequest(
      `defaultAccounts[${index}].normalSide must be one of: ${Array.from(
        NORMAL_SIDE_VALUES
      ).join(", ")}`
    );
  }
  if (parentCode && parentCode === code) {
    throw badRequest(`defaultAccounts[${index}].parentCode cannot equal code`);
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

function normalizeOnboardingDefaultAccounts(rawAccounts) {
  if (rawAccounts !== undefined && rawAccounts !== null && !Array.isArray(rawAccounts)) {
    throw badRequest("defaultAccounts must be an array when provided");
  }

  const source =
    Array.isArray(rawAccounts) && rawAccounts.length > 0
      ? rawAccounts
      : DEFAULT_ACCOUNTS;
  const normalizedRows = source.map((row, index) =>
    normalizeDefaultAccountRow(row, index)
  );
  const rowByCode = new Map();
  for (const row of normalizedRows) {
    if (rowByCode.has(row.code)) {
      throw badRequest(`defaultAccounts contains duplicate code: ${row.code}`);
    }
    rowByCode.set(row.code, row);
  }

  const visitStateByCode = new Map();
  const depthByCode = new Map();

  function resolveDepth(code) {
    const state = visitStateByCode.get(code);
    if (state === "visiting") {
      throw badRequest(`defaultAccounts parentCode cycle detected at ${code}`);
    }
    if (state === "visited") {
      return depthByCode.get(code) || 0;
    }

    visitStateByCode.set(code, "visiting");
    const row = rowByCode.get(code);
    if (!row) {
      throw badRequest(`defaultAccounts parentCode references unknown code: ${code}`);
    }

    let depth = 0;
    if (row.parentCode) {
      if (!rowByCode.has(row.parentCode)) {
        throw badRequest(
          `defaultAccounts parentCode ${row.parentCode} does not exist in payload`
        );
      }
      depth = resolveDepth(row.parentCode) + 1;
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

async function upsertOnboardingDefaultAccountsForCoa(coaId, rawAccounts, runQuery = query) {
  const normalizedAccounts = normalizeOnboardingDefaultAccounts(rawAccounts);
  for (const account of normalizedAccounts) {
    // eslint-disable-next-line no-await-in-loop
    await runQuery(
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
  const resolvedAccounts = await runQuery(
    `SELECT id, code
     FROM accounts
     WHERE coa_id = ?
       AND code IN (${placeholders})`,
    [coaId, ...codes]
  );
  const accountIdByCode = new Map(
    resolvedAccounts.rows.map((row) => [String(row.code || "").trim().toUpperCase(), row.id])
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
        `defaultAccounts parentCode ${account.parentCode} could not be resolved in CoA`
      );
    }

    // eslint-disable-next-line no-await-in-loop
    await runQuery(
      `UPDATE accounts
       SET parent_account_id = ?
       WHERE coa_id = ?
         AND code = ?`,
      [parentAccountId, coaId, account.code]
    );
  }

  await runQuery(
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

function normalizePaymentTermTemplate(rawTerm, index) {
  const term = rawTerm || {};
  const code = normalizeCode(term.code, `TERM_${index + 1}`, 50);
  const name = normalizeName(term.name, `Payment Term ${index + 1}`, 255);
  const dueDays = parseNonNegativeInt(
    term.dueDays ?? term.due_days,
    `terms[${index}].dueDays`,
    0
  );
  const graceDays = parseNonNegativeInt(
    term.graceDays ?? term.grace_days,
    `terms[${index}].graceDays`,
    0
  );
  const isEndOfMonth = parseBooleanFlag(
    term.isEndOfMonth ?? term.is_end_of_month,
    false,
    `terms[${index}].isEndOfMonth`
  );
  const status = String(term.status || "ACTIVE")
    .trim()
    .toUpperCase();
  if (!PAYMENT_TERM_STATUS_VALUES.has(status)) {
    throw badRequest(`terms[${index}].status must be ACTIVE or INACTIVE`);
  }

  return {
    code,
    name,
    dueDays,
    graceDays,
    isEndOfMonth,
    status,
  };
}

function normalizePaymentTermTemplates(rawTerms) {
  if (rawTerms !== undefined && !Array.isArray(rawTerms)) {
    throw badRequest("terms must be an array when provided");
  }
  if (Array.isArray(rawTerms) && rawTerms.length === 0) {
    throw badRequest("terms must be a non-empty array when provided");
  }

  const useDefaults = !Array.isArray(rawTerms) || rawTerms.length === 0;
  const sourceTemplates = useDefaults ? DEFAULT_PAYMENT_TERM_TEMPLATES : rawTerms;
  const termTemplates = sourceTemplates.map((term, index) =>
    normalizePaymentTermTemplate(term, index)
  );

  const seenCodes = new Set();
  for (const term of termTemplates) {
    const key = String(term.code || "").toUpperCase();
    if (seenCodes.has(key)) {
      throw badRequest(`Duplicate payment term code: ${term.code}`);
    }
    seenCodes.add(key);
  }

  return {
    termTemplates,
    defaultsUsed: useDefaults,
  };
}

function parseRequestedLegalEntityIds(payload) {
  const body = payload || {};
  const ids = [];

  if (body.legalEntityId !== undefined) {
    const parsedLegalEntityId = parsePositiveInt(body.legalEntityId);
    if (!parsedLegalEntityId) {
      throw badRequest("legalEntityId must be a positive integer");
    }
    ids.push(parsedLegalEntityId);
  }

  if (body.legalEntityIds !== undefined) {
    if (!Array.isArray(body.legalEntityIds)) {
      throw badRequest("legalEntityIds must be an array when provided");
    }
    if (body.legalEntityIds.length === 0) {
      throw badRequest("legalEntityIds must be a non-empty array when provided");
    }

    body.legalEntityIds.forEach((value, index) => {
      const parsedId = parsePositiveInt(value);
      if (!parsedId) {
        throw badRequest(`legalEntityIds[${index}] must be a positive integer`);
      }
      ids.push(parsedId);
    });
  }

  return Array.from(new Set(ids));
}

async function resolveTargetLegalEntityIds(
  tenantId,
  requestedLegalEntityIds,
  runQuery = query
) {
  if (requestedLegalEntityIds.length === 0) {
    const allEntities = await runQuery(
      `SELECT id
       FROM legal_entities
       WHERE tenant_id = ?
       ORDER BY id`,
      [tenantId]
    );
    const allIds = allEntities.rows
      .map((row) => parsePositiveInt(row.id))
      .filter(Boolean);
    if (allIds.length === 0) {
      throw badRequest(
        "No legal entities found for tenant. Run onboarding readiness bootstrap first."
      );
    }
    return allIds;
  }

  const placeholders = requestedLegalEntityIds.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND id IN (${placeholders})`,
    [tenantId, ...requestedLegalEntityIds]
  );
  const allowedIds = new Set(
    result.rows.map((row) => parsePositiveInt(row.id)).filter(Boolean)
  );
  const missingIds = requestedLegalEntityIds.filter((id) => !allowedIds.has(id));
  if (missingIds.length > 0) {
    throw badRequest(
      `Legal entity ids not found for tenant: ${missingIds.join(", ")}`
    );
  }

  return requestedLegalEntityIds.filter((id, index) => {
    return requestedLegalEntityIds.indexOf(id) === index;
  });
}

async function bootstrapPaymentTermsForLegalEntities({
  tenantId,
  legalEntityIds,
  termTemplates,
  runQuery = query,
}) {
  const perLegalEntity = [];
  let createdCount = 0;
  let skippedCount = 0;

  for (const legalEntityId of legalEntityIds) {
    let entityCreatedCount = 0;
    let entitySkippedCount = 0;

    for (const term of termTemplates) {
      // eslint-disable-next-line no-await-in-loop
      const insertResult = await runQuery(
        `INSERT IGNORE INTO payment_terms (
            tenant_id,
            legal_entity_id,
            code,
            name,
            due_days,
            grace_days,
            is_end_of_month,
            status
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          term.code,
          term.name,
          term.dueDays,
          term.graceDays,
          term.isEndOfMonth ? 1 : 0,
          term.status,
        ]
      );
      const affectedRows = Number(insertResult.rows?.affectedRows || 0);
      if (affectedRows > 0) {
        entityCreatedCount += affectedRows;
      } else {
        entitySkippedCount += 1;
      }
    }

    createdCount += entityCreatedCount;
    skippedCount += entitySkippedCount;
    perLegalEntity.push({
      legalEntityId,
      createdCount: entityCreatedCount,
      skippedCount: entitySkippedCount,
    });
  }

  return {
    createdCount,
    skippedCount,
    perLegalEntity,
  };
}

function getBootstrapHandoffPresetDefinition(presetCode) {
  const rawPresetCode = String(presetCode || "").trim();
  const normalizedPresetCode =
    BOOTSTRAP_HANDOFF_PRESET_CODE_ALIASES[rawPresetCode] || rawPresetCode;
  const definition =
    BOOTSTRAP_HANDOFF_PRESET_DEFINITIONS[normalizedPresetCode] || null;
  if (!definition) {
    throw badRequest(`Unknown handoff presetCode: ${rawPresetCode || "<empty>"}`);
  }
  return definition;
}

function buildBootstrapHandoffRoleCodes(definition, includeGlPostingAuthority = false) {
  const roleCodeSet = new Set(definition?.roleCodes || []);
  if (includeGlPostingAuthority) {
    for (const roleCode of definition?.optionalRoleCodes || []) {
      roleCodeSet.add(roleCode);
    }
  }
  return [...roleCodeSet];
}

function normalizeCompanyBootstrapHandoffAssignment(assignment, index) {
  const pathPrefix = `handoffAssignments[${index}]`;
  const safeAssignment =
    assignment && typeof assignment === "object" ? assignment : {};
  const presetCode = String(safeAssignment.presetCode || "").trim();
  if (!presetCode) {
    throw badRequest(`${pathPrefix}.presetCode is required`);
  }

  const presetDefinition = getBootstrapHandoffPresetDefinition(presetCode);
  const scopeType = String(
    safeAssignment.scopeType || presetDefinition.scopeType
  )
    .trim()
    .toUpperCase();
  if (scopeType !== presetDefinition.scopeType) {
    throw badRequest(
      `${pathPrefix}.scopeType must be ${presetDefinition.scopeType} for ${presetCode}`
    );
  }

  const includeGlPostingAuthority = parseBooleanFlag(
    safeAssignment.includeGlPostingAuthority,
    false,
    `${pathPrefix}.includeGlPostingAuthority`
  );
  const userId = parsePositiveInt(safeAssignment.userId);
  const hasUserId = Boolean(userId);
  const rawEmail = String(safeAssignment.email || "").trim();
  const rawName = String(safeAssignment.name || "").trim();
  if (hasUserId && (rawEmail || rawName)) {
    throw badRequest(
      `${pathPrefix} cannot mix userId with invite name/email fields`
    );
  }
  if (!hasUserId && (!rawEmail || !rawName)) {
    throw badRequest(
      `${pathPrefix} requires either userId or invite name/email`
    );
  }

  const normalizedAssignment = {
    presetCode: presetDefinition.code,
    scopeType,
    targetMode: hasUserId ? "EXISTING_USER" : "INVITE",
    userId: hasUserId ? userId : null,
    email: hasUserId ? null : normalizeEmail(rawEmail, `${pathPrefix}.email`),
    name: hasUserId ? null : normalizeName(rawName, rawName),
    includeGlPostingAuthority,
    roleCodes: buildBootstrapHandoffRoleCodes(
      presetDefinition,
      includeGlPostingAuthority
    ),
  };

  if (scopeType === "LEGAL_ENTITY") {
    const legalEntityCode = normalizeCode(
      safeAssignment.legalEntityCode,
      "",
      64
    );
    if (!legalEntityCode) {
      throw badRequest(`${pathPrefix}.legalEntityCode is required`);
    }
    return {
      ...normalizedAssignment,
      legalEntityCode,
      countryIso2: null,
    };
  }

  const countryIso2 = normalizeCode(safeAssignment.countryIso2, "", 2);
  if (!countryIso2) {
    throw badRequest(`${pathPrefix}.countryIso2 is required`);
  }
  return {
    ...normalizedAssignment,
    legalEntityCode: null,
    countryIso2,
  };
}

function normalizeCompanyBootstrapHandoffAssignments(assignments) {
  if (assignments === undefined || assignments === null) {
    return [];
  }
  if (!Array.isArray(assignments)) {
    throw badRequest("handoffAssignments must be an array when provided");
  }
  return assignments.map((assignment, index) =>
    normalizeCompanyBootstrapHandoffAssignment(assignment, index)
  );
}

async function getTenantUserById(tenantId, userId, runQuery = query) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedUserId = parsePositiveInt(userId);
  if (!normalizedTenantId || !normalizedUserId) {
    return null;
  }

  const result = await runQuery(
    `SELECT id, tenant_id, email, name, status
     FROM users
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [normalizedUserId, normalizedTenantId]
  );
  return result.rows?.[0] || null;
}

/**
 * Applies bootstrap handoff presets inside the bootstrap transaction so fresh
 * entity responsibles leave onboarding already scoped to their area.
 */
async function applyCompanyBootstrapHandoffAssignmentsTx({
  tenantId,
  actorUserId,
  handoffAssignments,
  legalEntities,
  entitySummaries,
  runQuery = query,
}) {
  const normalizedAssignments = Array.isArray(handoffAssignments)
    ? handoffAssignments
    : [];
  if (normalizedAssignments.length === 0) {
    return {
      assignmentCount: 0,
      invitedCount: 0,
      existingUserCount: 0,
      assignments: [],
      auditEvents: [],
    };
  }

  const legalEntityIdByCode = new Map(
    (Array.isArray(entitySummaries) ? entitySummaries : [])
      .map((entitySummary) => [
        normalizeCode(entitySummary?.code, "", 64),
        parsePositiveInt(entitySummary?.legalEntityId),
      ])
      .filter((entry) => entry[0] && entry[1])
  );
  const validCountryIso2Set = new Set(
    (Array.isArray(legalEntities) ? legalEntities : [])
      .map((legalEntity) => normalizeCode(legalEntity?.countryIso2, "", 2))
      .filter(Boolean)
  );
  const roleCodes = Array.from(
    new Set(normalizedAssignments.flatMap((assignment) => assignment.roleCodes || []))
  );
  const roleIdsByCode = await getTenantRoleIdsByCode(tenantId, roleCodes, runQuery);
  for (const roleCode of roleCodes) {
    if (!roleIdsByCode.has(roleCode)) {
      throw new Error(
        `Bootstrap handoff role is not configured for tenant ${tenantId}: ${roleCode}`
      );
    }
  }

  const countryScopeIdByIso2 = new Map();
  const assignmentSummaries = [];
  const auditEvents = [];
  let invitedCount = 0;
  let existingUserCount = 0;

  for (const assignment of normalizedAssignments) {
    let scopeId = null;
    let scopeCode = "";
    if (assignment.scopeType === "LEGAL_ENTITY") {
      scopeCode = assignment.legalEntityCode;
      scopeId = legalEntityIdByCode.get(scopeCode);
      if (!scopeId) {
        throw badRequest(
          `handoff assignment references unknown legalEntityCode: ${scopeCode}`
        );
      }
    } else {
      scopeCode = assignment.countryIso2;
      if (!validCountryIso2Set.has(scopeCode)) {
        throw badRequest(
          `handoff assignment references countryIso2 not present in bootstrap payload: ${scopeCode}`
        );
      }
      if (!countryScopeIdByIso2.has(scopeCode)) {
        // Country-scoped handoffs must stay within the countries created by
        // the bootstrap payload, not arbitrary countries elsewhere in the catalog.
        const countryId = await getCountryId(null, scopeCode, runQuery);
        countryScopeIdByIso2.set(scopeCode, countryId);
      }
      scopeId = countryScopeIdByIso2.get(scopeCode);
    }

    let managedUser = null;
    let invite = null;
    if (assignment.targetMode === "EXISTING_USER") {
      managedUser = await getTenantUserById(tenantId, assignment.userId, runQuery);
      if (!managedUser) {
        throw badRequest(`User not found for handoff userId=${assignment.userId}`);
      }
      if (String(managedUser.status || "").toUpperCase() !== "ACTIVE") {
        throw badRequest(
          `Existing handoff user must be ACTIVE: userId=${assignment.userId}`
        );
      }
      existingUserCount += 1;
    } else {
      invite = await createInviteForTenantUser({
        tenantId,
        actorUserId,
        email: assignment.email,
        name: assignment.name,
        runQuery,
      });
      managedUser = await getTenantUserById(tenantId, invite.userId, runQuery);
      invitedCount += 1;
      auditEvents.push({
        tenantId,
        targetUserId: invite.userId,
        action: "user.invite.create",
        resourceType: "user_invite",
        resourceId: invite.id,
        scopeType: "TENANT",
        scopeId: tenantId,
        payload: {
          userId: invite.userId,
          email: invite.email,
          expiresAt: invite.expiresAt,
          source: "company-bootstrap-handoff",
        },
      });
    }

    for (const roleCode of assignment.roleCodes) {
      const roleId = roleIdsByCode.get(roleCode);
      await runQuery(
        `INSERT INTO user_role_scopes (
            tenant_id,
            user_id,
            role_id,
            scope_type,
            scope_id,
            effect,
            effective_from,
            effective_to
         )
         VALUES (?, ?, ?, ?, ?, 'ALLOW', NULL, NULL)
         ON DUPLICATE KEY UPDATE
           effect = VALUES(effect),
           effective_from = VALUES(effective_from),
           effective_to = VALUES(effective_to)`,
        [tenantId, managedUser.id, roleId, assignment.scopeType, scopeId]
      );
    }

    assignmentSummaries.push({
      presetCode: assignment.presetCode,
      scopeType: assignment.scopeType,
      scopeId,
      scopeCode,
      targetMode: assignment.targetMode,
      userId: parsePositiveInt(managedUser?.id),
      email: String(invite?.email || managedUser?.email || "").trim().toLowerCase(),
      name: String(invite?.name || managedUser?.name || "").trim(),
      inviteId: parsePositiveInt(invite?.id) || null,
      includeGlPostingAuthority: assignment.includeGlPostingAuthority,
      roleCodes: assignment.roleCodes,
    });
    auditEvents.push({
      tenantId,
      targetUserId: parsePositiveInt(managedUser?.id),
      action: "onboarding.company_bootstrap.handoff",
      resourceType: "company_bootstrap_handoff",
      scopeType: assignment.scopeType,
      scopeId,
      payload: {
        presetCode: assignment.presetCode,
        scopeCode,
        targetMode: assignment.targetMode,
        includeGlPostingAuthority: assignment.includeGlPostingAuthority,
        roleCodes: assignment.roleCodes,
      },
    });
  }

  return {
    assignmentCount: assignmentSummaries.length,
    invitedCount,
    existingUserCount,
    assignments: assignmentSummaries,
    auditEvents,
  };
}

async function getCountryId(countryId, countryIso2, runQuery = query) {
  const normalizedCountryId = parsePositiveInt(countryId);
  if (normalizedCountryId) {
    return normalizedCountryId;
  }

  if (!countryIso2) {
    throw badRequest("countryId or countryIso2 is required for legal entity");
  }

  const result = await runQuery(
    `SELECT id
     FROM countries
     WHERE iso2 = ?
     LIMIT 1`,
    [String(countryIso2).trim().toUpperCase()]
  );
  const resolved = parsePositiveInt(result.rows[0]?.id);
  if (!resolved) {
    throw badRequest(`Country not found for iso2=${countryIso2}`);
  }
  return resolved;
}

async function getGroupCompanyId(tenantId, code, runQuery = query) {
  const result = await runQuery(
    `SELECT id
     FROM group_companies
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, String(code).trim()]
  );
  return parsePositiveInt(result.rows[0]?.id);
}

async function getFiscalCalendarId(tenantId, code, runQuery = query) {
  const result = await runQuery(
    `SELECT id
     FROM fiscal_calendars
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, String(code).trim()]
  );
  return parsePositiveInt(result.rows[0]?.id);
}

async function getLegalEntityId(tenantId, code, runQuery = query) {
  const result = await runQuery(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, String(code).trim()]
  );
  return parsePositiveInt(result.rows[0]?.id);
}

async function getCoaId(tenantId, code, runQuery = query) {
  const result = await runQuery(
    `SELECT id
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, String(code).trim()]
  );
  return parsePositiveInt(result.rows[0]?.id);
}

async function upsertGroupCoaForCompanyBootstrap(
  tenantId,
  normalizedGroupCoa,
  runQuery = query
) {
  const existingResult = await runQuery(
    `SELECT id, scope
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, normalizedGroupCoa.code]
  );
  const existing = existingResult.rows[0];
  if (existing && String(existing.scope || "").toUpperCase() !== "GROUP") {
    throw badRequest(
      `groupCoa.code ${normalizedGroupCoa.code} already belongs to a non-GROUP chart of accounts`
    );
  }

  await runQuery(
    `INSERT INTO charts_of_accounts (
        tenant_id, legal_entity_id, scope, code, name
     )
     VALUES (?, NULL, 'GROUP', ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       scope = VALUES(scope),
       legal_entity_id = NULL`,
    [tenantId, normalizedGroupCoa.code, normalizedGroupCoa.name]
  );

  const id = await getCoaId(tenantId, normalizedGroupCoa.code, runQuery);
  if (!id) {
    throw new Error(`Unable to resolve GROUP CoA for ${normalizedGroupCoa.code}`);
  }

  let starterAccountCount = 0;
  if (normalizedGroupCoa.starterPackId) {
    const pack = getPolicyPack(normalizedGroupCoa.starterPackId);
    if (!pack) {
      throw badRequest(
        `Unknown groupCoa starter pack: ${normalizedGroupCoa.starterPackId}`
      );
    }
    if (!Array.isArray(pack.starterAccountTree) || pack.starterAccountTree.length === 0) {
      throw badRequest(
        `Starter pack ${pack.packId} does not provide a starterAccountTree`
      );
    }
    starterAccountCount = await upsertOnboardingDefaultAccountsForCoa(
      id,
      pack.starterAccountTree,
      runQuery
    );
  }

  return {
    id,
    code: normalizedGroupCoa.code,
    name: normalizedGroupCoa.name,
    starterPackId: normalizedGroupCoa.starterPackId,
    starterAccountCount,
  };
}

async function getPrimaryCountry(runQuery = query) {
  const preferredResult = await runQuery(
    `SELECT id, default_currency_code
     FROM countries
     WHERE iso2 = 'US'
     LIMIT 1`
  );
  const preferred = preferredResult.rows[0];
  if (preferred) {
    return {
      id: parsePositiveInt(preferred.id),
      defaultCurrencyCode: String(preferred.default_currency_code || "USD").toUpperCase(),
    };
  }

  const fallbackResult = await runQuery(
    `SELECT id, default_currency_code
     FROM countries
     ORDER BY id
     LIMIT 1`
  );
  const fallback = fallbackResult.rows[0];
  const fallbackId = parsePositiveInt(fallback?.id);
  if (!fallbackId) {
    throw new Error("No countries available to build baseline legal entity");
  }

  return {
    id: fallbackId,
    defaultCurrencyCode: String(fallback.default_currency_code || "USD").toUpperCase(),
  };
}

async function ensureDefaultGroupCompany(tenantId, runQuery = query) {
  const existingResult = await runQuery(
    `SELECT id, code, name
     FROM group_companies
     WHERE tenant_id = ?
     ORDER BY id
     LIMIT 1`,
    [tenantId]
  );
  const existing = existingResult.rows[0];
  if (existing) {
    return {
      id: parsePositiveInt(existing.id),
      code: String(existing.code),
      name: String(existing.name),
      created: false,
    };
  }

  const code = "DEFAULT";
  const name = "Default Group";
  await runQuery(
    `INSERT INTO group_companies (tenant_id, code, name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name)`,
    [tenantId, code, name]
  );

  const id = await getGroupCompanyId(tenantId, code, runQuery);
  if (!id) {
    throw new Error("Unable to resolve default group company");
  }

  return { id, code, name, created: true };
}

async function ensureDefaultLegalEntity(tenantId, groupCompanyId, runQuery = query) {
  const existingResult = await runQuery(
    `SELECT id, code, name, functional_currency_code
     FROM legal_entities
     WHERE tenant_id = ?
     ORDER BY id
     LIMIT 1`,
    [tenantId]
  );
  const existing = existingResult.rows[0];
  if (existing) {
    return {
      id: parsePositiveInt(existing.id),
      code: String(existing.code),
      name: String(existing.name),
      functionalCurrencyCode: String(existing.functional_currency_code || "USD").toUpperCase(),
      created: false,
    };
  }

  const country = await getPrimaryCountry(runQuery);
  const code = "DEFAULT_LE";
  const name = "Default Legal Entity";
  await runQuery(
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
     VALUES (?, ?, ?, ?, NULL, ?, ?, TRUE, FALSE)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       group_company_id = VALUES(group_company_id),
       country_id = VALUES(country_id),
       functional_currency_code = VALUES(functional_currency_code),
       is_intercompany_enabled = VALUES(is_intercompany_enabled),
       intercompany_partner_required = VALUES(intercompany_partner_required)`,
    [tenantId, groupCompanyId, code, name, country.id, country.defaultCurrencyCode]
  );

  const id = await getLegalEntityId(tenantId, code, runQuery);
  if (!id) {
    throw new Error("Unable to resolve default legal entity");
  }

  return {
    id,
    code,
    name,
    functionalCurrencyCode: country.defaultCurrencyCode,
    created: true,
  };
}

async function ensureDefaultFiscalCalendar(tenantId, runQuery = query) {
  const existingResult = await runQuery(
    `SELECT id, code, name, year_start_month, year_start_day
     FROM fiscal_calendars
     WHERE tenant_id = ?
     ORDER BY id
     LIMIT 1`,
    [tenantId]
  );
  const existing = existingResult.rows[0];
  if (existing) {
    return {
      id: parsePositiveInt(existing.id),
      code: String(existing.code),
      name: String(existing.name),
      yearStartMonth: Number(existing.year_start_month),
      yearStartDay: Number(existing.year_start_day),
      created: false,
    };
  }

  const code = "MAIN";
  const name = "Main Calendar";
  const yearStartMonth = 1;
  const yearStartDay = 1;
  await runQuery(
    `INSERT INTO fiscal_calendars (
        tenant_id,
        code,
        name,
        year_start_month,
        year_start_day
     )
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       year_start_month = VALUES(year_start_month),
       year_start_day = VALUES(year_start_day)`,
    [tenantId, code, name, yearStartMonth, yearStartDay]
  );

  const id = await getFiscalCalendarId(tenantId, code, runQuery);
  if (!id) {
    throw new Error("Unable to resolve default fiscal calendar");
  }

  return { id, code, name, yearStartMonth, yearStartDay, created: true };
}

async function ensureFiscalPeriods(
  calendarId,
  fiscalYear,
  yearStartMonth,
  yearStartDay,
  runQuery = query
) {
  let created = 0;

  for (let i = 0; i < 12; i += 1) {
    const periodNo = i + 1;
    const existingResult = await runQuery(
      `SELECT id
       FROM fiscal_periods
       WHERE calendar_id = ?
         AND fiscal_year = ?
         AND period_no = ?
         AND is_adjustment = FALSE
       LIMIT 1`,
      [calendarId, fiscalYear, periodNo]
    );
    if (existingResult.rows[0]) {
      continue;
    }

    const monthOffset = yearStartMonth - 1 + i;
    const start = new Date(Date.UTC(fiscalYear, monthOffset, yearStartDay));
    const nextStart = new Date(Date.UTC(fiscalYear, monthOffset + 1, yearStartDay));
    const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
    const periodName = `P${String(periodNo).padStart(2, "0")}`;

    await runQuery(
      `INSERT INTO fiscal_periods (
          calendar_id, fiscal_year, period_no, period_name, start_date, end_date, is_adjustment
       )
       VALUES (?, ?, ?, ?, ?, ?, FALSE)`,
      [calendarId, fiscalYear, periodNo, periodName, toIsoDate(start), toIsoDate(end)]
    );
    created += 1;
  }

  return created;
}

async function getTenantLegalEntities(tenantId, runQuery = query) {
  const result = await runQuery(
    `SELECT id, code, name, functional_currency_code
     FROM legal_entities
     WHERE tenant_id = ?
     ORDER BY id`,
    [tenantId]
  );

  return result.rows.map((row) => ({
    id: parsePositiveInt(row.id),
    code: String(row.code),
    name: String(row.name),
    functionalCurrencyCode: String(row.functional_currency_code || "USD").toUpperCase(),
  }));
}

async function ensureCoaForLegalEntity(tenantId, legalEntity, runQuery = query) {
  const existingResult = await runQuery(
    `SELECT id, code
     FROM charts_of_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND scope = 'LEGAL_ENTITY'
     ORDER BY id
     LIMIT 1`,
    [tenantId, legalEntity.id]
  );
  const existing = existingResult.rows[0];
  if (existing) {
    return {
      id: parsePositiveInt(existing.id),
      code: String(existing.code),
      created: false,
    };
  }

  const code = normalizeCode(`COA-${legalEntity.code}`, `COA-${legalEntity.id}`);
  const name = normalizeName(`${legalEntity.name} CoA`, "Default CoA");
  await runQuery(
    `INSERT INTO charts_of_accounts (
        tenant_id, legal_entity_id, scope, code, name
     )
     VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       legal_entity_id = VALUES(legal_entity_id)`,
    [tenantId, legalEntity.id, code, name]
  );

  const id = await getCoaId(tenantId, code, runQuery);
  if (!id) {
    throw new Error(`Unable to resolve CoA for legal entity ${legalEntity.id}`);
  }

  return { id, code, created: true };
}

async function ensureDefaultAccountsForCoa(coaId, runQuery = query) {
  const existingCount = await scalarCount(
    `SELECT COUNT(*) AS count
     FROM accounts
     WHERE coa_id = ?`,
    [coaId],
    runQuery
  );
  if (existingCount > 0) {
    return 0;
  }

  let created = 0;
  for (const account of DEFAULT_ACCOUNTS) {
    await runQuery(
      `INSERT INTO accounts (
          coa_id,
          code,
          name,
          account_type,
          normal_side,
          allow_posting,
          parent_account_id
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

async function ensureBookForLegalEntity(
  tenantId,
  legalEntity,
  calendarId,
  runQuery = query
) {
  const existingResult = await runQuery(
    `SELECT id, code
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY id
     LIMIT 1`,
    [tenantId, legalEntity.id]
  );
  const existing = existingResult.rows[0];
  if (existing) {
    return {
      id: parsePositiveInt(existing.id),
      code: String(existing.code),
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

  await runQuery(
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
       name = VALUES(name),
       calendar_id = VALUES(calendar_id),
       base_currency_code = VALUES(base_currency_code)`,
    [tenantId, legalEntity.id, calendarId, code, name, baseCurrencyCode]
  );

  const resolved = await runQuery(
    `SELECT id, code
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND code = ?
     LIMIT 1`,
    [tenantId, legalEntity.id, code]
  );
  const id = parsePositiveInt(resolved.rows[0]?.id);
  if (!id) {
    throw new Error(`Unable to resolve book for legal entity ${legalEntity.id}`);
  }

  return { id, code, created: true };
}

router.get(
  "/readiness",
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const readiness = await getTenantReadinessSnapshot(tenantId);
    return res.json(readiness);
  })
);

router.post(
  "/readiness/bootstrap-baseline",
  requirePermission("onboarding.company.setup"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const fiscalYear =
      parsePositiveInt(req.body?.fiscalYear) || new Date().getUTCFullYear();
    if (!fiscalYear) {
      throw badRequest("fiscalYear must be a positive integer");
    }

    const readinessBefore = await getTenantReadinessSnapshot(tenantId);
    const bootstrapResult = await withTransaction(async (tx) => {
      const groupCompany = await ensureDefaultGroupCompany(tenantId, tx.query);
      const legalEntity = await ensureDefaultLegalEntity(
        tenantId,
        groupCompany.id,
        tx.query
      );
      const calendar = await ensureDefaultFiscalCalendar(tenantId, tx.query);
      const fiscalPeriodsCreated = await ensureFiscalPeriods(
        calendar.id,
        fiscalYear,
        calendar.yearStartMonth,
        calendar.yearStartDay,
        tx.query
      );

      const legalEntities = await getTenantLegalEntities(tenantId, tx.query);
      let coasCreated = 0;
      let accountsCreated = 0;
      let booksCreated = 0;

      for (const entity of legalEntities) {
        // eslint-disable-next-line no-await-in-loop
        const coa = await ensureCoaForLegalEntity(tenantId, entity, tx.query);
        if (coa.created) {
          coasCreated += 1;
        }

        // eslint-disable-next-line no-await-in-loop
        accountsCreated += await ensureDefaultAccountsForCoa(coa.id, tx.query);

        // eslint-disable-next-line no-await-in-loop
        const book = await ensureBookForLegalEntity(
          tenantId,
          entity,
          calendar.id,
          tx.query
        );
        if (book.created) {
          booksCreated += 1;
        }
      }

      return {
        groupCompany,
        legalEntity,
        calendar,
        fiscalPeriodsCreated,
        coasCreated,
        accountsCreated,
        booksCreated,
      };
    });
    await invalidateRbacCache(tenantId);

    const readinessAfter = await getTenantReadinessSnapshot(tenantId);

    return res.status(201).json({
      ok: true,
      tenantId,
      fiscalYear,
      created: {
        groupCompanies: bootstrapResult.groupCompany.created ? 1 : 0,
        legalEntities: bootstrapResult.legalEntity.created ? 1 : 0,
        fiscalCalendars: bootstrapResult.calendar.created ? 1 : 0,
        fiscalPeriods: bootstrapResult.fiscalPeriodsCreated,
        chartsOfAccounts: bootstrapResult.coasCreated,
        accounts: bootstrapResult.accountsCreated,
        books: bootstrapResult.booksCreated,
      },
      readinessBefore: {
        ready: readinessBefore.ready,
        missingKeys: readinessBefore.missingKeys,
      },
      readinessAfter: {
        ready: readinessAfter.ready,
        missingKeys: readinessAfter.missingKeys,
      },
    });
  })
);

router.post(
  "/payment-terms/bootstrap",
  requirePermission("onboarding.company.setup"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const requestedLegalEntityIds = parseRequestedLegalEntityIds(req.body);
    const { termTemplates, defaultsUsed } = normalizePaymentTermTemplates(
      req.body?.terms
    );

    const bootstrapResult = await withTransaction(async (tx) => {
      const legalEntityIds = await resolveTargetLegalEntityIds(
        tenantId,
        requestedLegalEntityIds,
        tx.query
      );
      const insertResult = await bootstrapPaymentTermsForLegalEntities({
        tenantId,
        legalEntityIds,
        termTemplates,
        runQuery: tx.query,
      });

      return {
        legalEntityIds,
        ...insertResult,
      };
    });

    return res.status(201).json({
      ok: true,
      tenantId,
      defaultsUsed,
      legalEntityIds: bootstrapResult.legalEntityIds,
      termTemplates,
      createdCount: bootstrapResult.createdCount,
      skippedCount: bootstrapResult.skippedCount,
      perLegalEntity: bootstrapResult.perLegalEntity,
    });
  })
);

router.get(
  "/company-bootstrap/handoff-options",
  requirePermission("onboarding.company.setup"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    const userResult = await query(
      `SELECT id, email, name, status
       FROM users
       WHERE tenant_id = ?
         AND status = 'ACTIVE'
       ORDER BY name, email`,
      [tenantId]
    );

    return res.json({
      ok: true,
      tenantId,
      users: userResult.rows || [],
      presets: Object.values(BOOTSTRAP_HANDOFF_PRESET_DEFINITIONS),
    });
  })
);

router.post(
  "/company-bootstrap/current-account-eligibility-preview",
  requirePermission("onboarding.company.setup"),
  asyncHandler(async (req, res) => {
    const legalEntities = req.body?.legalEntities;
    if (legalEntities !== undefined && !Array.isArray(legalEntities)) {
      throw badRequest("legalEntities must be an array when provided");
    }

    const rows = buildDraftOperatingUnitCurrentAccountEligibilityPreview(legalEntities);
    return res.json({
      ok: true,
      rows,
    });
  })
);

router.post(
  "/company-bootstrap",
  requirePermission("onboarding.company.setup"),
  asyncHandler(async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw badRequest("tenantId is required");
    }

    assertRequiredFields(req.body, [
      "groupCompany",
      "fiscalCalendar",
      "fiscalYear",
      "legalEntities",
    ]);

    const groupCompany = req.body.groupCompany || {};
    const groupCoa = req.body.groupCoa || {};
    const fiscalCalendar = req.body.fiscalCalendar || {};
    const fiscalYear = parsePositiveInt(req.body.fiscalYear);
    const legalEntities = Array.isArray(req.body.legalEntities)
      ? req.body.legalEntities
      : [];
    const handoffAssignments = normalizeCompanyBootstrapHandoffAssignments(
      req.body?.handoffAssignments
    );
    const actorUserId = parsePositiveInt(req.user?.userId);
    const selectedPolicyPackCount = legalEntities.reduce((count, entity) => {
      const { policyPackId } = normalizeEntityPolicyPackSelection(entity);
      return policyPackId ? count + 1 : count;
    }, 0);

    if (!fiscalYear) {
      throw badRequest("fiscalYear must be a positive integer");
    }
    if (legalEntities.length === 0) {
      throw badRequest("legalEntities must be a non-empty array");
    }
    if (selectedPolicyPackCount > 0 && !actorUserId) {
      throw badRequest("Authenticated user is required when policyPackId is provided");
    }
    if (handoffAssignments.length > 0 && !actorUserId) {
      throw badRequest("Authenticated user is required when handoffAssignments are provided");
    }

    assertRequiredFields(groupCompany, ["code", "name"]);
    const normalizedGroupCoa = normalizeGroupCoaSelection(groupCoa, groupCompany);
    assertRequiredFields(fiscalCalendar, [
      "code",
      "name",
      "yearStartMonth",
      "yearStartDay",
    ]);

    const yearStartMonth = parsePositiveInt(fiscalCalendar.yearStartMonth);
    const yearStartDay = parsePositiveInt(fiscalCalendar.yearStartDay);
    if (!yearStartMonth || yearStartMonth > 12) {
      throw badRequest("fiscalCalendar.yearStartMonth must be between 1 and 12");
    }
    if (!yearStartDay || yearStartDay > 31) {
      throw badRequest("fiscalCalendar.yearStartDay must be between 1 and 31");
    }

    const bootstrapResult = await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO group_companies (tenant_id, code, name)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name)`,
        [tenantId, String(groupCompany.code).trim(), String(groupCompany.name).trim()]
      );
      const groupCompanyId = await getGroupCompanyId(
        tenantId,
        groupCompany.code,
        tx.query
      );
      if (!groupCompanyId) {
        throw new Error("Unable to resolve group company id");
      }
      const groupCoaSummary = await upsertGroupCoaForCompanyBootstrap(
        tenantId,
        normalizedGroupCoa,
        tx.query
      );

      await tx.query(
        `INSERT INTO fiscal_calendars (
            tenant_id, code, name, year_start_month, year_start_day
         )
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           year_start_month = VALUES(year_start_month),
           year_start_day = VALUES(year_start_day)`,
        [
          tenantId,
          String(fiscalCalendar.code).trim(),
          String(fiscalCalendar.name).trim(),
          yearStartMonth,
          yearStartDay,
        ]
      );
      const calendarId = await getFiscalCalendarId(
        tenantId,
        fiscalCalendar.code,
        tx.query
      );
      if (!calendarId) {
        throw new Error("Unable to resolve fiscal calendar id");
      }

      for (let i = 0; i < 12; i += 1) {
        const monthOffset = yearStartMonth - 1 + i;
        const start = new Date(Date.UTC(fiscalYear, monthOffset, yearStartDay));
        const nextStart = new Date(Date.UTC(fiscalYear, monthOffset + 1, yearStartDay));
        const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
        const periodNo = i + 1;
        const periodName = `P${String(periodNo).padStart(2, "0")}`;

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
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

      const entitySummaries = [];
      const currentAccountReadinessWarnings = [];

      for (let entityIndex = 0; entityIndex < legalEntities.length; entityIndex += 1) {
        const entity = legalEntities[entityIndex];
        assertRequiredFields(entity, ["code", "name", "functionalCurrencyCode"]);
        const normalizedEntityCode = String(entity.code).trim();
        const normalizedEntityName = String(entity.name).trim();
        // eslint-disable-next-line no-await-in-loop
        const countryId = await getCountryId(entity.countryId, entity.countryIso2, tx.query);

        const intercompanyEnabled =
          entity.isIntercompanyEnabled === undefined
            ? true
            : Boolean(entity.isIntercompanyEnabled);
        const partnerRequired = Boolean(entity.intercompanyPartnerRequired);

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO legal_entities (
              tenant_id, group_company_id, code, name, tax_id, country_id, functional_currency_code,
              is_intercompany_enabled, intercompany_partner_required
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
            normalizedEntityCode,
            normalizedEntityName,
            entity.taxId ? String(entity.taxId).trim() : null,
            countryId,
            String(entity.functionalCurrencyCode).toUpperCase(),
            intercompanyEnabled,
            partnerRequired,
          ]
        );

        // eslint-disable-next-line no-await-in-loop
        const legalEntityId = await getLegalEntityId(tenantId, entity.code, tx.query);
        if (!legalEntityId) {
          throw new Error(`Unable to resolve legal entity id for ${entity.code}`);
        }

        const branches = Array.isArray(entity.branches) ? entity.branches : [];
        const currentAccountEligibility = summarizeOperatingUnitCurrentAccountEligibility(
          branches
        );
        const currentAccountConfig = normalizeCompanyBootstrapCurrentAccountConfig(
          entity,
          entityIndex
        );
        for (const branch of branches) {
          assertRequiredFields(branch, ["code", "name"]);
          // eslint-disable-next-line no-await-in-loop
          await tx.query(
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
              String(branch.code).trim(),
              String(branch.name).trim(),
              String(branch.unitType || "BRANCH").toUpperCase(),
              Boolean(branch.hasSubledger),
            ]
          );
        }

        const coaCode = entity.coaCode
          ? String(entity.coaCode).trim()
          : `COA-${normalizedEntityCode.toUpperCase()}`;
        const coaName = entity.coaName
          ? String(entity.coaName).trim()
          : `${normalizedEntityName} CoA`;

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO charts_of_accounts (
              tenant_id, legal_entity_id, scope, code, name
           )
           VALUES (?, ?, 'LEGAL_ENTITY', ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             legal_entity_id = VALUES(legal_entity_id)`,
          [tenantId, legalEntityId, coaCode, coaName]
        );
        // eslint-disable-next-line no-await-in-loop
        const coaId = await getCoaId(tenantId, coaCode, tx.query);
        if (!coaId) {
          throw new Error(`Unable to resolve CoA for ${coaCode}`);
        }

        // Backward-compatible with legacy flat payloads:
        // - `defaultAccounts` camelCase
        // - `default_accounts` snake_case
        // Also supports new tree rows via `parentCode`.
        // Parent links are resolved deterministically after account upserts.
        // eslint-disable-next-line no-await-in-loop
        await upsertOnboardingDefaultAccountsForCoa(
          coaId,
          entity.defaultAccounts ?? entity.default_accounts,
          tx.query
        );

        const shareholderParentConfig =
          normalizeCompanyBootstrapShareholderParentConfig(entity, entityIndex);
        const { policyPackId, policyPackMode } =
          normalizeEntityPolicyPackSelection(entity);
        let policyPackSummary = null;
        if (policyPackId) {
          const pack = getPolicyPack(policyPackId);
          if (!pack) {
            throw badRequest(
              `Unknown policyPackId for legal entity ${String(entity.code).trim()}: ${policyPackId}`
            );
          }

          // Resolve first to build a preview, then apply only resolved rows inside
          // the same company-bootstrap transaction.
          // eslint-disable-next-line no-await-in-loop
          const preview = await resolvePolicyPack({
            tenantId,
            legalEntityId,
            packId: pack.packId,
            runQuery: tx.query,
          });
          if (!preview) {
            throw badRequest(
              `Policy pack could not be resolved for legal entity ${String(
                entity.code
              ).trim()}: ${pack.packId}`
            );
          }

          const plan = applyShareholderOverrideToPolicyPackPlan(
            buildPolicyPackBootstrapApplyPlan(pack, preview.rows || []),
            shareholderParentConfig
          );
          if (plan.missingRequiredPurposeCodes.length > 0) {
            throw badRequest(
              `Policy pack ${pack.packId} missing required purpose mappings for legal entity ${String(
                entity.code
              ).trim()}: ${plan.missingRequiredPurposeCodes.join(", ")}`
            );
          }
          if (plan.applyRows.length === 0) {
            throw badRequest(
              `Policy pack ${pack.packId} did not resolve any mappable purpose rows for legal entity ${String(
                entity.code
              ).trim()}`
            );
          }

          // eslint-disable-next-line no-await-in-loop
          const applyPayload = await applyPolicyPackTx({
            tx,
            tenantId,
            userId: actorUserId,
            legalEntityId,
            packId: pack.packId,
            mode: policyPackMode || "MERGE",
            rows: plan.applyRows,
          });
          if (!applyPayload) {
            throw badRequest(
              `Policy pack could not be applied for legal entity ${String(
                entity.code
              ).trim()}: ${pack.packId}`
            );
          }

          policyPackSummary = {
            packId: applyPayload.packId,
            mode: applyPayload.mode,
            previewSummary: preview.summary,
            requiredPurposeCount: plan.requiredPurposeCount,
            appliedRowCount: applyPayload.rows.length,
            missingOptionalCount: plan.missingOptionalCount,
            metadata: applyPayload.metadata,
          };
        }

        const bookCode = entity.bookCode
          ? String(entity.bookCode).trim()
          : `BOOK-${normalizedEntityCode.toUpperCase()}`;
        const bookName = entity.bookName
          ? String(entity.bookName).trim()
          : `${normalizedEntityName} Book`;

        // eslint-disable-next-line no-await-in-loop
        await tx.query(
          `INSERT INTO books (
              tenant_id, legal_entity_id, calendar_id, code, name, book_type, base_currency_code
           )
           VALUES (?, ?, ?, ?, ?, 'LOCAL', ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             calendar_id = VALUES(calendar_id),
             base_currency_code = VALUES(base_currency_code)`,
          [
            tenantId,
            legalEntityId,
            calendarId,
            bookCode,
            bookName,
            String(entity.functionalCurrencyCode).toUpperCase(),
          ]
        );

        let currentAccountSetup = {
          configured: false,
          skipped: false,
          eligibility: currentAccountEligibility,
          savedConfig: null,
          provisioningSummary: null,
          warning: null,
        };
        let shareholderParentSetup = {
          configured: false,
          manualOverride: false,
          savedConfig: null,
        };
        if (
          currentAccountConfig.dueFromParentAccountCode &&
          currentAccountConfig.dueToParentAccountCode &&
          !currentAccountConfig.skipForNow
        ) {
          const resolvedCurrentAccountParentIds =
            await resolveBootstrapCurrentAccountParentAccountIdsForCoa({
              coaId,
              legalEntityCode: normalizedEntityCode,
              currentAccountConfig,
              runQuery: tx.query,
            });
          const savedCurrentAccountConfig =
            await upsertOperatingUnitCurrentAccountConfigTx(tx, {
              tenantId,
              legalEntityId,
              dueFromParentAccountId:
                resolvedCurrentAccountParentIds.dueFromParentAccountId,
              dueToParentAccountId:
                resolvedCurrentAccountParentIds.dueToParentAccountId,
              autoProvisionOnOperatingUnitCreate: true,
            });
          const provisioningSummary = await applyOperatingUnitCurrentAccountConfigTx(tx, {
            tenantId,
            legalEntityId,
          });
          currentAccountSetup = {
            configured: true,
            skipped: false,
            eligibility: currentAccountEligibility,
            savedConfig: {
              dueFromParentAccountCode:
                currentAccountConfig.dueFromParentAccountCode,
              dueToParentAccountCode: currentAccountConfig.dueToParentAccountCode,
              autoProvisionOnOperatingUnitCreate: true,
              lastAppliedAt: provisioningSummary?.lastAppliedAt || null,
              updatedAt: savedCurrentAccountConfig?.updated_at || null,
            },
            provisioningSummary: summarizeBootstrapCurrentAccountProvisioning(
              provisioningSummary
            ),
            warning: null,
          };
        } else if (
          currentAccountConfig.skipForNow ||
          currentAccountEligibility.currentAccountSetupRecommended
        ) {
          const warning = buildBootstrapCurrentAccountReadinessWarning({
            legalEntityCode: normalizedEntityCode,
            effectiveActiveOperatingUnitCount:
              currentAccountEligibility.effectiveActiveOperatingUnitCount,
            currentAccountSetupRecommended:
              currentAccountEligibility.currentAccountSetupRecommended,
            skippedExplicitly: currentAccountConfig.skipForNow,
          });
          currentAccountSetup = {
            configured: false,
            skipped: Boolean(currentAccountConfig.skipForNow),
            eligibility: currentAccountEligibility,
            savedConfig: null,
            provisioningSummary: null,
            warning,
          };
          currentAccountReadinessWarnings.push({
            legalEntityCode: normalizedEntityCode,
            legalEntityId,
            ...warning,
          });
        }

        if (shareholderParentConfig.manualOverride) {
          shareholderParentSetup = await applyBootstrapShareholderParentConfigTx({
            tx,
            tenantId,
            legalEntityId,
            coaId,
            legalEntityCode: normalizedEntityCode,
            shareholderParentConfig,
          });
        }

        entitySummaries.push({
          code: normalizedEntityCode,
          legalEntityId,
          coaCode,
          coaId,
          branchCount: branches.length,
          currentAccountSetup,
          shareholderParentSetup,
          ...(policyPackSummary ? { policyPack: policyPackSummary } : {}),
        });
      }

      const legalEntityIds = entitySummaries.map((entity) => entity.legalEntityId);
      const paymentTermBootstrap = await bootstrapPaymentTermsForLegalEntities({
        tenantId,
        legalEntityIds,
        termTemplates: DEFAULT_PAYMENT_TERM_TEMPLATES,
        runQuery: tx.query,
      });
      const handoffSummary = await applyCompanyBootstrapHandoffAssignmentsTx({
        tenantId,
        actorUserId,
        handoffAssignments,
        legalEntities,
        entitySummaries,
        runQuery: tx.query,
      });

      return {
        groupCompanyId,
        groupCoa: groupCoaSummary,
        calendarId,
        entitySummaries,
        paymentTermBootstrap,
        currentAccountReadinessWarnings,
        handoffSummary,
      };
    });
    await invalidateRbacCache(tenantId);
    for (const auditEvent of bootstrapResult.handoffSummary?.auditEvents || []) {
      await logRbacAuditEvent(req, auditEvent);
    }

    return res.status(201).json({
      ok: true,
      tenantId,
      groupCompanyId: bootstrapResult.groupCompanyId,
      groupCoa: bootstrapResult.groupCoa,
      calendarId: bootstrapResult.calendarId,
      fiscalYear,
      periodsGenerated: 12,
      legalEntities: bootstrapResult.entitySummaries,
      currentAccountReadinessWarnings:
        bootstrapResult.currentAccountReadinessWarnings,
      paymentTerms: {
        defaultsUsed: true,
        templateCount: DEFAULT_PAYMENT_TERM_TEMPLATES.length,
        createdCount: bootstrapResult.paymentTermBootstrap.createdCount,
        skippedCount: bootstrapResult.paymentTermBootstrap.skippedCount,
        perLegalEntity: bootstrapResult.paymentTermBootstrap.perLegalEntity,
      },
      handoff: {
        assignmentCount: Number(
          bootstrapResult.handoffSummary?.assignmentCount || 0
        ),
        invitedCount: Number(bootstrapResult.handoffSummary?.invitedCount || 0),
        existingUserCount: Number(
          bootstrapResult.handoffSummary?.existingUserCount || 0
        ),
        assignments: bootstrapResult.handoffSummary?.assignments || [],
      },
    });
  })
);

export const __testOnboardingInternals = {
  normalizeOnboardingDefaultAccounts,
  normalizeEntityPolicyPackSelection,
  normalizeGroupCoaSelection,
  buildPolicyPackBootstrapApplyPlan,
  normalizeCompanyBootstrapCurrentAccountConfig,
  normalizeCompanyBootstrapHandoffAssignments,
  buildDraftOperatingUnitCurrentAccountEligibilityPreview,
};

export default router;
