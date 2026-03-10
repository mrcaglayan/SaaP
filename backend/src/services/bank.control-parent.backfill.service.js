import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { upsertJournalPurposeAccountTx } from "./org.write.queries.js";

const FEATURE_SUBACCOUNTS_V1 = "FEATURE_SUBACCOUNTS_V1";
const BANK_CONTROL_PARENT_PURPOSE_CODE = "BANK_CONTROL_PARENT";
const LEGACY_BANK_PARENT_CODE = "102";

function toDbBoolean(value) {
  return value === true || Number(value) === 1;
}

function normalizeTenantId(value) {
  const tenantId = parsePositiveInt(value);
  if (!tenantId) {
    throw badRequest("tenantId is required");
  }
  return tenantId;
}

function normalizeOptionalLegalEntityId(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const legalEntityId = parsePositiveInt(value);
  if (!legalEntityId) {
    throw badRequest("legalEntityId must be a positive integer");
  }
  return legalEntityId;
}

async function isStrictBankModeEnabled({ tenantId, runQuery = query }) {
  const result = await runQuery(
    `SELECT is_enabled
     FROM tenant_features
     WHERE tenant_id = ?
       AND feature_code = ?
     LIMIT 1`,
    [tenantId, FEATURE_SUBACCOUNTS_V1]
  );
  return toDbBoolean(result.rows?.[0]?.is_enabled);
}

async function loadLegalEntities({
  tenantId,
  legalEntityId = null,
  runQuery = query,
}) {
  const params = [tenantId];
  let legalEntityFilterSql = "";
  if (legalEntityId) {
    legalEntityFilterSql = " AND le.id = ?";
    params.push(legalEntityId);
  }

  const result = await runQuery(
    `SELECT le.id, le.code, le.name
     FROM legal_entities le
     WHERE le.tenant_id = ?${legalEntityFilterSql}
     ORDER BY le.id`,
    params
  );

  return result.rows || [];
}

async function loadExistingBankControlParentMapping({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       jpa.account_id,
       a.code AS account_code,
       a.name AS account_name
     FROM journal_purpose_accounts jpa
     LEFT JOIN accounts a ON a.id = jpa.account_id
     WHERE jpa.tenant_id = ?
       AND jpa.legal_entity_id = ?
       AND jpa.purpose_code = ?
     LIMIT 1`,
    [tenantId, legalEntityId, BANK_CONTROL_PARENT_PURPOSE_CODE]
  );
  return result.rows?.[0] || null;
}

async function loadLegacyBankParentCandidates({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
       a.id,
       a.code,
       a.name,
       a.account_type,
       a.allow_posting,
       a.is_active
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE c.tenant_id = ?
       AND c.scope = 'LEGAL_ENTITY'
       AND c.legal_entity_id = ?
       AND a.code = ?
     ORDER BY a.id`,
    [tenantId, legalEntityId, LEGACY_BANK_PARENT_CODE]
  );

  return result.rows || [];
}

function buildScanSummary(rows) {
  return {
    scannedCount: rows.length,
    eligibleCount: rows.filter((row) => row.status === "eligible").length,
    appliedCount: rows.filter((row) => row.status === "applied").length,
    alreadyMappedCount: rows.filter((row) => row.status === "already_mapped").length,
    remediationCount: rows.filter((row) => row.status === "remediation_required").length,
    skippedCount: rows.filter((row) => row.status === "strict_mode_disabled").length,
  };
}

function mapExistingMappingRow(legalEntity, mappingRow) {
  return {
    legalEntityId: parsePositiveInt(legalEntity.id),
    legalEntityCode: String(legalEntity.code || ""),
    legalEntityName: String(legalEntity.name || ""),
    status: "already_mapped",
    purposeCode: BANK_CONTROL_PARENT_PURPOSE_CODE,
    accountId: parsePositiveInt(mappingRow?.account_id),
    accountCode: String(mappingRow?.account_code || ""),
    accountName: String(mappingRow?.account_name || ""),
  };
}

function mapRemediationRow(legalEntity, reason, extra = {}) {
  return {
    legalEntityId: parsePositiveInt(legalEntity.id),
    legalEntityCode: String(legalEntity.code || ""),
    legalEntityName: String(legalEntity.name || ""),
    status: "remediation_required",
    purposeCode: BANK_CONTROL_PARENT_PURPOSE_CODE,
    reason,
    ...extra,
  };
}

function mapEligibleRow(legalEntity, candidate) {
  return {
    legalEntityId: parsePositiveInt(legalEntity.id),
    legalEntityCode: String(legalEntity.code || ""),
    legalEntityName: String(legalEntity.name || ""),
    status: "eligible",
    purposeCode: BANK_CONTROL_PARENT_PURPOSE_CODE,
    accountId: parsePositiveInt(candidate?.id),
    accountCode: String(candidate?.code || ""),
    accountName: String(candidate?.name || ""),
    allowPosting: toDbBoolean(candidate?.allow_posting),
  };
}

export async function scanBankControlParentBackfill({
  tenantId,
  legalEntityId = null,
  runQuery = query,
}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedLegalEntityId = normalizeOptionalLegalEntityId(legalEntityId);
  const legalEntities = await loadLegalEntities({
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    runQuery,
  });

  const strictModeEnabled = await isStrictBankModeEnabled({
    tenantId: normalizedTenantId,
    runQuery,
  });

  if (!strictModeEnabled) {
    const rows = legalEntities.map((legalEntity) => ({
      legalEntityId: parsePositiveInt(legalEntity.id),
      legalEntityCode: String(legalEntity.code || ""),
      legalEntityName: String(legalEntity.name || ""),
      status: "strict_mode_disabled",
      purposeCode: BANK_CONTROL_PARENT_PURPOSE_CODE,
      reason: "strict_bank_mode_disabled",
    }));
    return {
      tenantId: normalizedTenantId,
      legalEntityId: normalizedLegalEntityId,
      strictModeEnabled: false,
      rows,
      summary: buildScanSummary(rows),
    };
  }

  const rows = [];
  for (const legalEntity of legalEntities) {
    const mappingRow = await loadExistingBankControlParentMapping({
      tenantId: normalizedTenantId,
      legalEntityId: legalEntity.id,
      runQuery,
    });
    if (mappingRow) {
      rows.push(mapExistingMappingRow(legalEntity, mappingRow));
      continue;
    }

    const candidates = await loadLegacyBankParentCandidates({
      tenantId: normalizedTenantId,
      legalEntityId: legalEntity.id,
      runQuery,
    });
    if (candidates.length === 0) {
      rows.push(mapRemediationRow(legalEntity, "missing_legacy_102_parent"));
      continue;
    }
    if (candidates.length > 1) {
      rows.push(
        mapRemediationRow(legalEntity, "ambiguous_legacy_102_parent", {
          candidateAccountIds: candidates
            .map((row) => parsePositiveInt(row.id))
            .filter(Boolean),
        })
      );
      continue;
    }

    const candidate = candidates[0];
    if (!toDbBoolean(candidate?.is_active)) {
      rows.push(
        mapRemediationRow(legalEntity, "inactive_legacy_102_parent", {
          accountId: parsePositiveInt(candidate?.id),
        })
      );
      continue;
    }
    if (String(candidate?.account_type || "").trim().toUpperCase() !== "ASSET") {
      rows.push(
        mapRemediationRow(legalEntity, "legacy_102_parent_must_be_asset", {
          accountId: parsePositiveInt(candidate?.id),
          accountType: String(candidate?.account_type || "").trim().toUpperCase(),
        })
      );
      continue;
    }

    rows.push(mapEligibleRow(legalEntity, candidate));
  }

  return {
    tenantId: normalizedTenantId,
    legalEntityId: normalizedLegalEntityId,
    strictModeEnabled: true,
    rows,
    summary: buildScanSummary(rows),
  };
}

export async function backfillBankControlParentMappings({
  tenantId,
  legalEntityId = null,
  dryRun = true,
}) {
  const scan = await scanBankControlParentBackfill({
    tenantId,
    legalEntityId,
  });

  if (dryRun || !scan.strictModeEnabled) {
    return {
      ...scan,
      dryRun: true,
    };
  }

  const eligibleRows = scan.rows.filter((row) => row.status === "eligible");
  if (eligibleRows.length > 0) {
    await withTransaction(async (tx) => {
      for (const row of eligibleRows) {
        await upsertJournalPurposeAccountTx(tx, {
          tenantId: scan.tenantId,
          legalEntityId: row.legalEntityId,
          purposeCode: BANK_CONTROL_PARENT_PURPOSE_CODE,
          accountId: row.accountId,
        });
      }
    });
  }

  const rows = scan.rows.map((row) =>
    row.status === "eligible"
      ? {
          ...row,
          status: "applied",
        }
      : row
  );

  return {
    tenantId: scan.tenantId,
    legalEntityId: scan.legalEntityId,
    strictModeEnabled: scan.strictModeEnabled,
    dryRun: false,
    rows,
    summary: buildScanSummary(rows),
  };
}
