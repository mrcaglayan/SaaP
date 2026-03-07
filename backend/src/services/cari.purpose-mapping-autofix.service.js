import { query } from "../db.js";
import { parsePositiveInt } from "../routes/_utils.js";

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toDbBoolean(value) {
  return value === true || Number(value) === 1;
}

const CARI_PURPOSE_RULES = Object.freeze({
  CARI_AR_CONTROL: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["120"]),
  }),
  CARI_AR_OFFSET: Object.freeze({
    accountType: "REVENUE",
    normalSide: "CREDIT",
    preferredCodes: Object.freeze(["600"]),
  }),
  CARI_AP_CONTROL: Object.freeze({
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    preferredCodes: Object.freeze(["320"]),
  }),
  CARI_AP_OFFSET: Object.freeze({
    accountType: "EXPENSE",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["770", "632"]),
  }),
  CARI_SETTLEMENT_FX_GAIN: Object.freeze({
    accountType: "REVENUE",
    normalSide: "CREDIT",
    preferredCodes: Object.freeze(["646"]),
  }),
  CARI_SETTLEMENT_FX_LOSS: Object.freeze({
    accountType: "EXPENSE",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["656"]),
  }),
  CARI_AR_CONTROL_CASH: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["120"]),
  }),
  CARI_AR_OFFSET_CASH: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["102", "100"]),
  }),
  CARI_AP_CONTROL_CASH: Object.freeze({
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    preferredCodes: Object.freeze(["320"]),
  }),
  CARI_AP_OFFSET_CASH: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["102", "100"]),
  }),
  CARI_AR_CONTROL_MANUAL: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["120"]),
  }),
  CARI_AR_OFFSET_MANUAL: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["102", "100"]),
  }),
  CARI_AP_CONTROL_MANUAL: Object.freeze({
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    preferredCodes: Object.freeze(["320"]),
  }),
  CARI_AP_OFFSET_MANUAL: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["102", "100"]),
  }),
  CARI_AR_CONTROL_ON_ACCOUNT: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["120"]),
  }),
  CARI_AR_OFFSET_ON_ACCOUNT: Object.freeze({
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    preferredCodes: Object.freeze(["340", "380"]),
  }),
  CARI_AP_CONTROL_ON_ACCOUNT: Object.freeze({
    accountType: "LIABILITY",
    normalSide: "CREDIT",
    preferredCodes: Object.freeze(["320"]),
  }),
  CARI_AP_OFFSET_ON_ACCOUNT: Object.freeze({
    accountType: "ASSET",
    normalSide: "DEBIT",
    preferredCodes: Object.freeze(["159"]),
  }),
});

const ALL_CARI_PURPOSE_CODES = Object.freeze(Object.keys(CARI_PURPOSE_RULES));
const CARI_PURPOSE_ANALOG_CANDIDATES = Object.freeze({
  CARI_AR_CONTROL_CASH: Object.freeze(["CARI_AR_CONTROL", "CARI_AR_CONTROL_MANUAL"]),
  CARI_AP_CONTROL_CASH: Object.freeze(["CARI_AP_CONTROL", "CARI_AP_CONTROL_MANUAL"]),
  CARI_AR_CONTROL_MANUAL: Object.freeze(["CARI_AR_CONTROL", "CARI_AR_CONTROL_CASH"]),
  CARI_AP_CONTROL_MANUAL: Object.freeze(["CARI_AP_CONTROL", "CARI_AP_CONTROL_CASH"]),
  CARI_AR_CONTROL_ON_ACCOUNT: Object.freeze([
    "CARI_AR_CONTROL",
    "CARI_AR_CONTROL_MANUAL",
    "CARI_AR_CONTROL_CASH",
  ]),
  CARI_AP_CONTROL_ON_ACCOUNT: Object.freeze([
    "CARI_AP_CONTROL",
    "CARI_AP_CONTROL_MANUAL",
    "CARI_AP_CONTROL_CASH",
  ]),
  CARI_AR_OFFSET_CASH: Object.freeze(["CARI_AR_OFFSET_MANUAL"]),
  CARI_AP_OFFSET_CASH: Object.freeze(["CARI_AP_OFFSET_MANUAL"]),
  CARI_AR_OFFSET_MANUAL: Object.freeze(["CARI_AR_OFFSET_CASH"]),
  CARI_AP_OFFSET_MANUAL: Object.freeze(["CARI_AP_OFFSET_CASH"]),
});

function normalizePurposeCodes(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return [...ALL_CARI_PURPOSE_CODES];
  }
  const allowed = new Set(ALL_CARI_PURPOSE_CODES);
  const normalized = [];
  const seen = new Set();
  for (const raw of input) {
    const code = toUpper(raw);
    if (!code || seen.has(code) || !allowed.has(code)) {
      continue;
    }
    seen.add(code);
    normalized.push(code);
  }
  return normalized;
}

function isRowValidForRule({ row, rule, tenantId, legalEntityId }) {
  const mappedAccountId = parsePositiveInt(row?.mapped_account_id);
  const accountId = parsePositiveInt(row?.account_id);
  if (!mappedAccountId || !accountId) {
    return false;
  }
  if (!toDbBoolean(row?.is_active) || !toDbBoolean(row?.allow_posting)) {
    return false;
  }
  if (toUpper(row?.coa_scope) !== "LEGAL_ENTITY") {
    return false;
  }
  if (parsePositiveInt(row?.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    return false;
  }
  if (parsePositiveInt(row?.account_tenant_id) !== parsePositiveInt(tenantId)) {
    return false;
  }
  if (toUpper(row?.account_type) !== toUpper(rule.accountType)) {
    return false;
  }
  if (toUpper(row?.normal_side) !== toUpper(rule.normalSide)) {
    return false;
  }
  return true;
}

async function findFirstPostableChildCandidate({
  runQuery,
  tenantId,
  legalEntityId,
  parentAccountId,
  accountType,
  normalSide,
}) {
  const result = await runQuery(
    `SELECT a.id, a.code
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.scope = 'LEGAL_ENTITY'
       AND c.legal_entity_id = ?
       AND a.parent_account_id = ?
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE
       AND UPPER(a.account_type) = ?
       AND UPPER(a.normal_side) = ?
     ORDER BY a.code ASC, a.id ASC
     LIMIT 1`,
    [tenantId, legalEntityId, parentAccountId, toUpper(accountType), toUpper(normalSide)]
  );
  return result.rows?.[0] || null;
}

async function findPreferredCandidateByCode({
  runQuery,
  tenantId,
  legalEntityId,
  accountType,
  normalSide,
  preferredCode,
}) {
  const result = await runQuery(
    `SELECT a.id, a.code
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.scope = 'LEGAL_ENTITY'
       AND c.legal_entity_id = ?
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE
       AND UPPER(a.account_type) = ?
       AND UPPER(a.normal_side) = ?
       AND (
         UPPER(a.code) = UPPER(?)
         OR UPPER(a.code) LIKE CONCAT(UPPER(?), '.%')
         OR UPPER(a.code) LIKE CONCAT(UPPER(?), '-%')
       )
     ORDER BY
       CASE WHEN UPPER(a.code) = UPPER(?) THEN 0 ELSE 1 END,
       CHAR_LENGTH(a.code) ASC,
       a.code ASC,
       a.id ASC
     LIMIT 1`,
    [
      tenantId,
      legalEntityId,
      toUpper(accountType),
      toUpper(normalSide),
      preferredCode,
      preferredCode,
      preferredCode,
      preferredCode,
    ]
  );
  return result.rows?.[0] || null;
}

async function findFallbackCandidate({
  runQuery,
  tenantId,
  legalEntityId,
  accountType,
  normalSide,
}) {
  const result = await runQuery(
    `SELECT a.id, a.code
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.scope = 'LEGAL_ENTITY'
       AND c.legal_entity_id = ?
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE
       AND UPPER(a.account_type) = ?
       AND UPPER(a.normal_side) = ?
     ORDER BY a.code ASC, a.id ASC
     LIMIT 1`,
    [tenantId, legalEntityId, toUpper(accountType), toUpper(normalSide)]
  );
  return result.rows?.[0] || null;
}

async function resolveReplacementAccount({
  runQuery,
  tenantId,
  legalEntityId,
  currentMappedAccountId,
  rule,
  allowGenericFallback = true,
}) {
  const currentAccountId = parsePositiveInt(currentMappedAccountId);
  if (currentAccountId) {
    const childCandidate = await findFirstPostableChildCandidate({
      runQuery,
      tenantId,
      legalEntityId,
      parentAccountId: currentAccountId,
      accountType: rule.accountType,
      normalSide: rule.normalSide,
    });
    if (parsePositiveInt(childCandidate?.id)) {
      return childCandidate;
    }
  }

  for (const preferredCode of rule.preferredCodes || []) {
    // eslint-disable-next-line no-await-in-loop
    const preferredCandidate = await findPreferredCandidateByCode({
      runQuery,
      tenantId,
      legalEntityId,
      accountType: rule.accountType,
      normalSide: rule.normalSide,
      preferredCode,
    });
    if (parsePositiveInt(preferredCandidate?.id)) {
      return preferredCandidate;
    }
  }

  if (!allowGenericFallback) {
    return null;
  }

  return findFallbackCandidate({
    runQuery,
    tenantId,
    legalEntityId,
    accountType: rule.accountType,
    normalSide: rule.normalSide,
  });
}

function getAnalogPurposeCandidates(purposeCode) {
  return CARI_PURPOSE_ANALOG_CANDIDATES[toUpper(purposeCode)] || [];
}

function resolveReplacementFromAnalogMapping({
  rowByPurposeCode,
  purposeCode,
  rule,
  tenantId,
  legalEntityId,
}) {
  for (const analogPurposeCode of getAnalogPurposeCandidates(purposeCode)) {
    const analogRow = rowByPurposeCode.get(analogPurposeCode) || null;
    if (
      !analogRow ||
      !isRowValidForRule({
        row: analogRow,
        rule,
        tenantId,
        legalEntityId,
      })
    ) {
      continue;
    }
    const accountId =
      parsePositiveInt(analogRow.account_id) || parsePositiveInt(analogRow.mapped_account_id);
    if (!accountId) {
      continue;
    }
    return {
      id: accountId,
      code: String(analogRow.account_code || "").trim() || null,
      sourcePurposeCode: analogPurposeCode,
    };
  }
  return null;
}

export async function autoRemapCariPurposeMappingsForLegalEntity({
  tenantId,
  legalEntityId,
  purposeCodes = [],
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedPurposeCodes = normalizePurposeCodes(purposeCodes);

  if (!normalizedTenantId || !normalizedLegalEntityId || normalizedPurposeCodes.length === 0) {
    return {
      checkedCount: 0,
      updatedCount: 0,
      updatedRows: [],
    };
  }

  const lookupPurposeCodes = Array.from(
    new Set(
      normalizedPurposeCodes.flatMap((purposeCode) => [
        purposeCode,
        ...getAnalogPurposeCandidates(purposeCode),
      ])
    )
  );
  const placeholders = lookupPurposeCodes.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       jpa.purpose_code,
       jpa.account_id AS mapped_account_id,
       a.id AS account_id,
       a.code AS account_code,
       a.account_type,
       a.normal_side,
       a.allow_posting,
       a.is_active,
       c.tenant_id AS account_tenant_id,
       c.scope AS coa_scope,
       c.legal_entity_id AS coa_legal_entity_id
     FROM journal_purpose_accounts jpa
     LEFT JOIN accounts a ON a.id = jpa.account_id
     LEFT JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE jpa.tenant_id = ?
       AND jpa.legal_entity_id = ?
       AND jpa.purpose_code IN (${placeholders})`,
    [normalizedTenantId, normalizedLegalEntityId, ...lookupPurposeCodes]
  );

  const rowByPurposeCode = new Map(
    (result.rows || []).map((row) => [toUpper(row.purpose_code), row])
  );

  const updatedRows = [];
  for (const purposeCode of normalizedPurposeCodes) {
    const row = rowByPurposeCode.get(purposeCode) || null;
    const rule = CARI_PURPOSE_RULES[purposeCode];
    if (!rule || !row) {
      if (!rule) {
        continue;
      }
    } else if (
      isRowValidForRule({
        row,
        rule,
        tenantId: normalizedTenantId,
        legalEntityId: normalizedLegalEntityId,
      })
    ) {
      continue;
    }

    const analogReplacement = resolveReplacementFromAnalogMapping({
      rowByPurposeCode,
      purposeCode,
      rule,
      tenantId: normalizedTenantId,
      legalEntityId: normalizedLegalEntityId,
    });
    // eslint-disable-next-line no-await-in-loop
    const replacement =
      analogReplacement ||
      (await resolveReplacementAccount({
        runQuery,
        tenantId: normalizedTenantId,
        legalEntityId: normalizedLegalEntityId,
        currentMappedAccountId: row?.mapped_account_id,
        rule,
        allowGenericFallback: Boolean(row),
      }));
    const replacementAccountId = parsePositiveInt(replacement?.id);
    const currentMappedAccountId = parsePositiveInt(row?.mapped_account_id);
    if (!replacementAccountId || replacementAccountId === currentMappedAccountId) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await runQuery(
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
      [normalizedTenantId, normalizedLegalEntityId, purposeCode, replacementAccountId]
    );

    updatedRows.push({
      purposeCode,
      previousAccountId: currentMappedAccountId || null,
      previousAccountCode: String(row?.account_code || "").trim() || null,
      newAccountId: replacementAccountId,
      newAccountCode: String(replacement?.code || "").trim() || null,
    });
  }

  return {
    checkedCount: normalizedPurposeCodes.length,
    updatedCount: updatedRows.length,
    updatedRows,
  };
}

export const __testCariPurposeMappingAutofixInternals = {
  CARI_PURPOSE_RULES,
  normalizePurposeCodes,
};
