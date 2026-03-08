import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

export const CASH_PURPOSE_CODES = Object.freeze({
  EXCHANGE_CLEARING: "CASH_EXCHANGE_CLEARING",
  TRANSIT_CLEARING: "CASH_TRANSIT_CLEARING",
});

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export async function loadCashPurposeAccountIds({
  tenantId,
  legalEntityId,
  purposeCodes,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedPurposeCodes = Array.from(
    new Set(
      (Array.isArray(purposeCodes) ? purposeCodes : [purposeCodes]).map(asUpper).filter(Boolean)
    )
  );

  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }
  if (!normalizedLegalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  if (normalizedPurposeCodes.length === 0) {
    return new Map();
  }

  const placeholders = normalizedPurposeCodes.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT purpose_code, account_id
     FROM journal_purpose_accounts
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND purpose_code IN (${placeholders})`,
    [normalizedTenantId, normalizedLegalEntityId, ...normalizedPurposeCodes]
  );

  const byPurposeCode = new Map();
  for (const row of result.rows || []) {
    const purposeCode = asUpper(row?.purpose_code);
    const accountId = parsePositiveInt(row?.account_id);
    if (!purposeCode || !accountId) {
      continue;
    }
    byPurposeCode.set(purposeCode, accountId);
  }
  return byPurposeCode;
}

export async function resolveCashPurposeAccountId({
  tenantId,
  legalEntityId,
  purposeCode,
  providedAccountId,
  fieldLabel,
  runQuery = query,
}) {
  const normalizedProvidedAccountId = parsePositiveInt(providedAccountId);
  if (normalizedProvidedAccountId) {
    return normalizedProvidedAccountId;
  }

  const normalizedPurposeCode = asUpper(purposeCode);
  const resolvedByPurpose = await loadCashPurposeAccountIds({
    tenantId,
    legalEntityId,
    purposeCodes: [normalizedPurposeCode],
    runQuery,
  });
  const resolvedAccountId = parsePositiveInt(resolvedByPurpose.get(normalizedPurposeCode));
  if (resolvedAccountId) {
    return resolvedAccountId;
  }

  throw badRequest(
    `Setup required: configure journal_purpose_accounts for ${normalizedPurposeCode} or provide ${fieldLabel}`
  );
}
