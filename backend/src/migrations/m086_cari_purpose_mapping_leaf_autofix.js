function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

async function findPreferredCandidateByCode({
  connection,
  tenantId,
  legalEntityId,
  accountType,
  normalSide,
  preferredCode,
}) {
  const [rows] = await connection.execute(
    `SELECT
       a.id,
       a.code
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
      accountType,
      normalSide,
      preferredCode,
      preferredCode,
      preferredCode,
      preferredCode,
    ]
  );
  return rows?.[0] || null;
}

async function findFallbackCandidate({
  connection,
  tenantId,
  legalEntityId,
  accountType,
  normalSide,
}) {
  const [rows] = await connection.execute(
    `SELECT
       a.id,
       a.code
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
    [tenantId, legalEntityId, accountType, normalSide]
  );
  return rows?.[0] || null;
}

function isMappingValidForRule({ row, rule }) {
  const mappedAccountId = toPositiveInt(row?.mapped_account_id);
  const accountId = toPositiveInt(row?.account_id);
  if (!mappedAccountId || !accountId) {
    return false;
  }
  if (!toDbBoolean(row?.is_active) || !toDbBoolean(row?.allow_posting)) {
    return false;
  }
  if (toUpper(row?.coa_scope) !== "LEGAL_ENTITY") {
    return false;
  }
  if (toPositiveInt(row?.coa_legal_entity_id) !== toPositiveInt(row?.legal_entity_id)) {
    return false;
  }
  if (toPositiveInt(row?.account_tenant_id) !== toPositiveInt(row?.tenant_id)) {
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

async function resolveReplacementAccount({
  connection,
  tenantId,
  legalEntityId,
  rule,
}) {
  for (const preferredCode of rule.preferredCodes || []) {
    // eslint-disable-next-line no-await-in-loop
    const preferred = await findPreferredCandidateByCode({
      connection,
      tenantId,
      legalEntityId,
      accountType: rule.accountType,
      normalSide: rule.normalSide,
      preferredCode,
    });
    if (toPositiveInt(preferred?.id)) {
      return preferred;
    }
  }

  return findFallbackCandidate({
    connection,
    tenantId,
    legalEntityId,
    accountType: rule.accountType,
    normalSide: rule.normalSide,
  });
}

const migration086CariPurposeMappingLeafAutofix = {
  key: "m086_cari_purpose_mapping_leaf_autofix",
  description:
    "Auto-remap invalid CARI purpose mappings (inactive/non-postable/wrong type) to valid postable leaf accounts",
  async up(connection) {
    const purposeCodes = Object.keys(CARI_PURPOSE_RULES);
    if (purposeCodes.length === 0) {
      return;
    }
    const placeholders = purposeCodes.map(() => "?").join(", ");
    const [rows] = await connection.execute(
      `SELECT
         jpa.tenant_id,
         jpa.legal_entity_id,
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
       WHERE jpa.purpose_code IN (${placeholders})`,
      purposeCodes
    );

    for (const row of rows || []) {
      const purposeCode = toUpper(row?.purpose_code);
      const rule = CARI_PURPOSE_RULES[purposeCode];
      if (!rule) {
        continue;
      }
      if (isMappingValidForRule({ row, rule })) {
        continue;
      }

      const tenantId = toPositiveInt(row?.tenant_id);
      const legalEntityId = toPositiveInt(row?.legal_entity_id);
      if (!tenantId || !legalEntityId) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const replacement = await resolveReplacementAccount({
        connection,
        tenantId,
        legalEntityId,
        rule,
      });
      const replacementId = toPositiveInt(replacement?.id);
      if (!replacementId) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await connection.execute(
        `UPDATE journal_purpose_accounts
         SET account_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND legal_entity_id = ?
           AND purpose_code = ?`,
        [replacementId, tenantId, legalEntityId, purposeCode]
      );
    }
  },

  async down() {
    // Non-destructive data-hardening migration: no down-op.
  },
};

export default migration086CariPurposeMappingLeafAutofix;
