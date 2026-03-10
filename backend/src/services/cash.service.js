import crypto from "node:crypto";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  ensurePeriodOpen,
  loadCentralEquityJournalValidationContext,
  toAmount,
  toIsoDate,
  validateJournalLineScope,
} from "../routes/gl.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";

const BALANCE_EPSILON = 0.0001;
const CASH_TXN_SUBLEDGER_PREFIX = "CASH_TXN:";
const CARI_SETTLEMENT_INTENT_SOURCE_ENTITY_TYPE = "CARI_SETTLEMENT_APPLY";

function asUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeOptionalShortText(value, fieldLabel, maxLength = 100) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw badRequest(`${fieldLabel} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function ensureBalanced(lines) {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    totalDebit += toAmount(line.debitBase);
    totalCredit += toAmount(line.creditBase);
  }
  if (Math.abs(totalDebit - totalCredit) > BALANCE_EPSILON) {
    throw badRequest("Cash posting journal is not balanced");
  }
  return {
    totalDebit: Number(totalDebit.toFixed(6)),
    totalCredit: Number(totalCredit.toFixed(6)),
  };
}

function resolveCashJournalNoPrefix(cashTxn) {
  const sourceEntityType = asUpper(cashTxn?.source_entity_type);
  if (sourceEntityType === CARI_SETTLEMENT_INTENT_SOURCE_ENTITY_TYPE) {
    return "SETL";
  }
  return "CASH";
}

function buildCashJournalNo(cashTxn) {
  const journalNoPrefix = resolveCashJournalNoPrefix(cashTxn);
  const txnNo = String(cashTxn.txn_no || "").trim().toUpperCase();
  if (txnNo) {
    const candidate = `${journalNoPrefix}-${txnNo}`.slice(0, 40);
    if (candidate.length <= 40) {
      return candidate;
    }
  }

  const hash = crypto
    .createHash("sha1")
    .update(`${cashTxn.tenant_id}:${cashTxn.id}:${cashTxn.txn_no || ""}`)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return `${journalNoPrefix}-${cashTxn.id}-${hash}`.slice(0, 40);
}

function requireAccountId(value, label) {
  const id = parsePositiveInt(value);
  if (!id) {
    throw badRequest(`${label} is required`);
  }
  return id;
}

function resolveTransferPostingMode(cashTxn) {
  const sourceOu = parsePositiveInt(cashTxn.operating_unit_id);
  const counterOu = parsePositiveInt(cashTxn.counter_cash_register_operating_unit_id);
  const sourceLegalEntityId = parsePositiveInt(cashTxn.legal_entity_id);
  const counterLegalEntityId = parsePositiveInt(cashTxn.counter_cash_register_legal_entity_id);
  const sourceCurrency = asUpper(cashTxn.currency_code);
  const counterCurrency = asUpper(cashTxn.counter_cash_register_currency_code);

  if (!counterLegalEntityId || counterLegalEntityId !== sourceLegalEntityId) {
    throw badRequest("Direct transfer is only supported within the same legal entity in v1");
  }

  if (counterCurrency && sourceCurrency && counterCurrency !== sourceCurrency) {
    throw badRequest("Transfer register currencies must match");
  }

  if (sourceOu === counterOu) {
    return "DIRECT";
  }

  const sourceEntityType = asUpper(cashTxn.source_entity_type);
  const hasTransitLink = sourceEntityType === "CASH_TRANSIT_TRANSFER";
  if (!hasTransitLink) {
    throw badRequest(
      "Transfers between different operating-unit contexts must use CASH_IN_TRANSIT workflow"
    );
  }

  requireAccountId(cashTxn.counter_account_id, "counterAccountId (CASH_IN_TRANSIT)");
  return "TRANSIT";
}

function buildBaseLine({
  accountId,
  operatingUnitId,
  debitBase,
  creditBase,
  description,
  subledgerReferenceNo,
}) {
  const resolvedOperatingUnitId = parsePositiveInt(operatingUnitId);
  // GL line validation requires operatingUnitId when subledger_reference_no is present.
  const resolvedSubledgerReferenceNo = resolvedOperatingUnitId
    ? normalizeOptionalShortText(subledgerReferenceNo, "line.subledgerReferenceNo", 100)
    : null;

  return {
    accountId: requireAccountId(accountId, "line.accountId"),
    operatingUnitId: resolvedOperatingUnitId,
    counterpartyLegalEntityId: null,
    description: normalizeOptionalShortText(description, "line.description", 255),
    subledgerReferenceNo: resolvedSubledgerReferenceNo,
    debitBase: Number(toAmount(debitBase).toFixed(6)),
    creditBase: Number(toAmount(creditBase).toFixed(6)),
  };
}

function normalizeOptionalId(value) {
  return parsePositiveInt(value) || null;
}

function resolveTransitClearingOperatingUnitId(cashTxn) {
  return (
    parsePositiveInt(cashTxn.operating_unit_id) ||
    parsePositiveInt(cashTxn.counter_cash_register_operating_unit_id) ||
    null
  );
}

function parseDbBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function describeOperatingUnit(row, fallbackId) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code) {
    return code;
  }
  if (name) {
    return name;
  }
  return `#${fallbackId}`;
}

function buildOperatingUnitSelfBalancingError(row, operatingUnitId, detail) {
  const label = describeOperatingUnit(row, operatingUnitId);
  return badRequest(
    `Operating unit ${label} self-balancing setup is invalid for cross-context cash transfers: ${detail}. Complete "Central Due From OU" and "OU Due To Central" from Kasa Islemleri during Transfer Out or in Organization Management before posting.`
  );
}

function describeOperatingUnitPair(row, operatingUnitId, partnerOperatingUnitId) {
  const operatingUnitLabel = describeOperatingUnit(
    {
      code: row?.operating_unit_code,
      name: row?.operating_unit_name,
    },
    operatingUnitId
  );
  const partnerOperatingUnitLabel = describeOperatingUnit(
    {
      code: row?.partner_operating_unit_code,
      name: row?.partner_operating_unit_name,
    },
    partnerOperatingUnitId
  );
  return `${operatingUnitLabel} -> ${partnerOperatingUnitLabel}`;
}

function buildOperatingUnitPartnerCurrentError(
  row,
  operatingUnitId,
  partnerOperatingUnitId,
  detail
) {
  const label = describeOperatingUnitPair(row, operatingUnitId, partnerOperatingUnitId);
  return badRequest(
    `Operating unit pair ${label} direct inter-branch current-account setup is invalid for cross-context cash transfers: ${detail}. Complete "Due From Partner OU" and "Due To Partner OU" from Kasa Islemleri during Transfer Out or in Organization Management before posting.`
  );
}

async function loadOperatingUnitSelfBalancingConfigTx(
  tx,
  { tenantId, legalEntityId, operatingUnitId, cache }
) {
  const resolvedOperatingUnitId = parsePositiveInt(operatingUnitId);
  if (!resolvedOperatingUnitId) {
    return null;
  }

  if (cache?.has(resolvedOperatingUnitId)) {
    return cache.get(resolvedOperatingUnitId);
  }

  const result = await tx.query(
    `SELECT
       ou.id,
       ou.legal_entity_id,
       ou.code,
       ou.name,
       ou.status,
       ou.central_due_from_account_id,
       cdfa.code AS central_due_from_account_code,
       cdfa.name AS central_due_from_account_name,
       cdfa.account_type AS central_due_from_account_type,
       cdfa.normal_side AS central_due_from_account_normal_side,
       cdfa.allow_posting AS central_due_from_account_allow_posting,
       cdfa.is_active AS central_due_from_account_is_active,
       cdfc.legal_entity_id AS central_due_from_account_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = cdfa.id
           AND child.is_active = TRUE
       ) AS central_due_from_account_has_children,
       ou.ou_due_to_central_account_id,
       odtq.code AS ou_due_to_central_account_code,
       odtq.name AS ou_due_to_central_account_name,
       odtq.account_type AS ou_due_to_central_account_type,
       odtq.normal_side AS ou_due_to_central_account_normal_side,
       odtq.allow_posting AS ou_due_to_central_account_allow_posting,
       odtq.is_active AS ou_due_to_central_account_is_active,
       odtqc.legal_entity_id AS ou_due_to_central_account_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = odtq.id
           AND child.is_active = TRUE
       ) AS ou_due_to_central_account_has_children
     FROM operating_units ou
     LEFT JOIN accounts cdfa
       ON cdfa.id = ou.central_due_from_account_id
     LEFT JOIN charts_of_accounts cdfc
       ON cdfc.id = cdfa.coa_id
     LEFT JOIN accounts odtq
       ON odtq.id = ou.ou_due_to_central_account_id
     LEFT JOIN charts_of_accounts odtqc
       ON odtqc.id = odtq.coa_id
     WHERE ou.id = ?
       AND ou.tenant_id = ?
     LIMIT 1`,
    [resolvedOperatingUnitId, tenantId]
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest("Operating unit mapping context not found for tenant");
  }

  if (parsePositiveInt(row.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "operating unit does not belong to the transfer legal entity"
    );
  }
  if (asUpper(row.status) !== "ACTIVE") {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "operating unit must be ACTIVE"
    );
  }

  const centralDueFromAccountId = parsePositiveInt(row.central_due_from_account_id);
  const ouDueToCentralAccountId = parsePositiveInt(row.ou_due_to_central_account_id);
  if (!centralDueFromAccountId || !ouDueToCentralAccountId) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "required internal current-account mappings are missing"
    );
  }
  if (
    parsePositiveInt(row.central_due_from_account_legal_entity_id) !==
    parsePositiveInt(legalEntityId)
  ) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "Central Due From OU account must belong to the same legal entity"
    );
  }
  if (
    parsePositiveInt(row.ou_due_to_central_account_legal_entity_id) !==
    parsePositiveInt(legalEntityId)
  ) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "OU Due To Central account must belong to the same legal entity"
    );
  }
  if (asUpper(row.central_due_from_account_type) !== "ASSET") {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "Central Due From OU account must be an ASSET account"
    );
  }
  if (asUpper(row.central_due_from_account_normal_side) !== "DEBIT") {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "Central Due From OU account must have DEBIT normal side"
    );
  }
  if (!parseDbBoolean(row.central_due_from_account_is_active)) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "Central Due From OU account must be active"
    );
  }
  if (!parseDbBoolean(row.central_due_from_account_allow_posting)) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "Central Due From OU account must be postable"
    );
  }
  if (parseDbBoolean(row.central_due_from_account_has_children)) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "Central Due From OU account must be a leaf account"
    );
  }
  if (asUpper(row.ou_due_to_central_account_type) !== "LIABILITY") {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "OU Due To Central account must be a LIABILITY account"
    );
  }
  if (asUpper(row.ou_due_to_central_account_normal_side) !== "CREDIT") {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "OU Due To Central account must have CREDIT normal side"
    );
  }
  if (!parseDbBoolean(row.ou_due_to_central_account_is_active)) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "OU Due To Central account must be active"
    );
  }
  if (!parseDbBoolean(row.ou_due_to_central_account_allow_posting)) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "OU Due To Central account must be postable"
    );
  }
  if (parseDbBoolean(row.ou_due_to_central_account_has_children)) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      "OU Due To Central account must be a leaf account"
    );
  }

  const duplicateCentralDueFromResult = await tx.query(
    `SELECT id, code, name
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND central_due_from_account_id = ?
       AND id <> ?
     LIMIT 1`,
    [tenantId, legalEntityId, centralDueFromAccountId, resolvedOperatingUnitId]
  );
  const duplicateCentralDueFrom = duplicateCentralDueFromResult.rows?.[0] || null;
  if (duplicateCentralDueFrom) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      `Central Due From OU account is also assigned to operating unit ${describeOperatingUnit(
        duplicateCentralDueFrom,
        parsePositiveInt(duplicateCentralDueFrom.id)
      )}; branch-specific internal current mappings must be unique within the legal entity`
    );
  }

  const duplicateOuDueToResult = await tx.query(
    `SELECT id, code, name
     FROM operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND ou_due_to_central_account_id = ?
       AND id <> ?
     LIMIT 1`,
    [tenantId, legalEntityId, ouDueToCentralAccountId, resolvedOperatingUnitId]
  );
  const duplicateOuDueTo = duplicateOuDueToResult.rows?.[0] || null;
  if (duplicateOuDueTo) {
    throw buildOperatingUnitSelfBalancingError(
      row,
      resolvedOperatingUnitId,
      `OU Due To Central account is also assigned to operating unit ${describeOperatingUnit(
        duplicateOuDueTo,
        parsePositiveInt(duplicateOuDueTo.id)
      )}; branch-specific internal current mappings must be unique within the legal entity`
    );
  }

  const resolved = {
    id: resolvedOperatingUnitId,
    code: String(row.code || ""),
    name: String(row.name || ""),
    centralDueFromAccountId,
    centralDueFromAccountCode: String(row.central_due_from_account_code || ""),
    centralDueFromAccountName: String(row.central_due_from_account_name || ""),
    ouDueToCentralAccountId,
    ouDueToCentralAccountCode: String(row.ou_due_to_central_account_code || ""),
    ouDueToCentralAccountName: String(row.ou_due_to_central_account_name || ""),
  };

  cache?.set(resolvedOperatingUnitId, resolved);
  return resolved;
}

async function loadOperatingUnitPartnerCurrentConfigTx(
  tx,
  {
    tenantId,
    legalEntityId,
    operatingUnitId,
    partnerOperatingUnitId,
    cache,
  }
) {
  const resolvedOperatingUnitId = parsePositiveInt(operatingUnitId);
  const resolvedPartnerOperatingUnitId = parsePositiveInt(partnerOperatingUnitId);
  if (!resolvedOperatingUnitId || !resolvedPartnerOperatingUnitId) {
    return null;
  }
  if (resolvedOperatingUnitId === resolvedPartnerOperatingUnitId) {
    throw buildOperatingUnitPartnerCurrentError(
      null,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "source and partner operating units must be different"
    );
  }

  const cacheKey = `${resolvedOperatingUnitId}:${resolvedPartnerOperatingUnitId}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const result = await tx.query(
    `SELECT
       map.id,
       map.tenant_id,
       map.legal_entity_id,
       map.operating_unit_id,
       map.partner_operating_unit_id,
       ou.code AS operating_unit_code,
       ou.name AS operating_unit_name,
       ou.status AS operating_unit_status,
       ou.legal_entity_id AS operating_unit_legal_entity_id,
       partner.code AS partner_operating_unit_code,
       partner.name AS partner_operating_unit_name,
       partner.status AS partner_operating_unit_status,
       partner.legal_entity_id AS partner_operating_unit_legal_entity_id,
       map.due_from_account_id,
       dfa.code AS due_from_account_code,
       dfa.name AS due_from_account_name,
       dfa.account_type AS due_from_account_type,
       dfa.normal_side AS due_from_account_normal_side,
       dfa.allow_posting AS due_from_account_allow_posting,
       dfa.is_active AS due_from_account_is_active,
       dfac.legal_entity_id AS due_from_account_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = dfa.id
           AND child.is_active = TRUE
       ) AS due_from_account_has_children,
       map.due_to_account_id,
       dta.code AS due_to_account_code,
       dta.name AS due_to_account_name,
       dta.account_type AS due_to_account_type,
       dta.normal_side AS due_to_account_normal_side,
       dta.allow_posting AS due_to_account_allow_posting,
       dta.is_active AS due_to_account_is_active,
       dtac.legal_entity_id AS due_to_account_legal_entity_id,
       EXISTS(
         SELECT 1
         FROM accounts child
         WHERE child.parent_account_id = dta.id
           AND child.is_active = TRUE
       ) AS due_to_account_has_children
     FROM operating_unit_partner_current_accounts map
     JOIN operating_units ou
       ON ou.id = map.operating_unit_id
     JOIN operating_units partner
       ON partner.id = map.partner_operating_unit_id
     LEFT JOIN accounts dfa
       ON dfa.id = map.due_from_account_id
     LEFT JOIN charts_of_accounts dfac
       ON dfac.id = dfa.coa_id
     LEFT JOIN accounts dta
       ON dta.id = map.due_to_account_id
     LEFT JOIN charts_of_accounts dtac
       ON dtac.id = dta.coa_id
     WHERE map.tenant_id = ?
       AND map.operating_unit_id = ?
       AND map.partner_operating_unit_id = ?
     LIMIT 1`,
    [tenantId, resolvedOperatingUnitId, resolvedPartnerOperatingUnitId]
  );

  const row = result.rows?.[0] || null;
  if (!row) {
    throw buildOperatingUnitPartnerCurrentError(
      null,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "required partner-specific current-account mappings are missing"
    );
  }
  if (parsePositiveInt(row.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "mapping does not belong to the transfer legal entity"
    );
  }
  if (
    parsePositiveInt(row.operating_unit_legal_entity_id) !== parsePositiveInt(legalEntityId) ||
    parsePositiveInt(row.partner_operating_unit_legal_entity_id) !== parsePositiveInt(legalEntityId)
  ) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "operating unit pair must belong to the transfer legal entity"
    );
  }
  if (asUpper(row.operating_unit_status) !== "ACTIVE") {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "source operating unit must be ACTIVE"
    );
  }
  if (asUpper(row.partner_operating_unit_status) !== "ACTIVE") {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "partner operating unit must be ACTIVE"
    );
  }

  const dueFromAccountId = parsePositiveInt(row.due_from_account_id);
  const dueToAccountId = parsePositiveInt(row.due_to_account_id);
  if (!dueFromAccountId || !dueToAccountId) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "required partner-specific current-account mappings are missing"
    );
  }
  if (
    parsePositiveInt(row.due_from_account_legal_entity_id) !== parsePositiveInt(legalEntityId)
  ) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due From Partner OU account must belong to the same legal entity"
    );
  }
  if (parsePositiveInt(row.due_to_account_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due To Partner OU account must belong to the same legal entity"
    );
  }
  if (asUpper(row.due_from_account_type) !== "ASSET") {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due From Partner OU account must be an ASSET account"
    );
  }
  if (asUpper(row.due_from_account_normal_side) !== "DEBIT") {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due From Partner OU account must have DEBIT normal side"
    );
  }
  if (!parseDbBoolean(row.due_from_account_is_active)) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due From Partner OU account must be active"
    );
  }
  if (!parseDbBoolean(row.due_from_account_allow_posting)) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due From Partner OU account must be postable"
    );
  }
  if (parseDbBoolean(row.due_from_account_has_children)) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due From Partner OU account must be a leaf account"
    );
  }
  if (asUpper(row.due_to_account_type) !== "LIABILITY") {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due To Partner OU account must be a LIABILITY account"
    );
  }
  if (asUpper(row.due_to_account_normal_side) !== "CREDIT") {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due To Partner OU account must have CREDIT normal side"
    );
  }
  if (!parseDbBoolean(row.due_to_account_is_active)) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due To Partner OU account must be active"
    );
  }
  if (!parseDbBoolean(row.due_to_account_allow_posting)) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due To Partner OU account must be postable"
    );
  }
  if (parseDbBoolean(row.due_to_account_has_children)) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      "Due To Partner OU account must be a leaf account"
    );
  }

  const duplicateDueFromResult = await tx.query(
    `SELECT
       map.operating_unit_id,
       map.partner_operating_unit_id,
       ou.code AS operating_unit_code,
       partner.code AS partner_operating_unit_code
     FROM operating_unit_partner_current_accounts map
     JOIN operating_units ou ON ou.id = map.operating_unit_id
     JOIN operating_units partner ON partner.id = map.partner_operating_unit_id
     WHERE map.tenant_id = ?
       AND map.legal_entity_id = ?
       AND map.due_from_account_id = ?
       AND NOT (
         map.operating_unit_id = ?
         AND map.partner_operating_unit_id = ?
       )
     LIMIT 1`,
    [
      tenantId,
      legalEntityId,
      dueFromAccountId,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
    ]
  );
  const duplicateDueFrom = duplicateDueFromResult.rows?.[0] || null;
  if (duplicateDueFrom) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      `Due From Partner OU account is also assigned to operating unit pair ${describeOperatingUnitPair(
        duplicateDueFrom,
        parsePositiveInt(duplicateDueFrom.operating_unit_id),
        parsePositiveInt(duplicateDueFrom.partner_operating_unit_id)
      )}; partner-specific current-account mappings must be unique within the legal entity`
    );
  }

  const duplicateDueToResult = await tx.query(
    `SELECT
       map.operating_unit_id,
       map.partner_operating_unit_id,
       ou.code AS operating_unit_code,
       partner.code AS partner_operating_unit_code
     FROM operating_unit_partner_current_accounts map
     JOIN operating_units ou ON ou.id = map.operating_unit_id
     JOIN operating_units partner ON partner.id = map.partner_operating_unit_id
     WHERE map.tenant_id = ?
       AND map.legal_entity_id = ?
       AND map.due_to_account_id = ?
       AND NOT (
         map.operating_unit_id = ?
         AND map.partner_operating_unit_id = ?
       )
     LIMIT 1`,
    [
      tenantId,
      legalEntityId,
      dueToAccountId,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
    ]
  );
  const duplicateDueTo = duplicateDueToResult.rows?.[0] || null;
  if (duplicateDueTo) {
    throw buildOperatingUnitPartnerCurrentError(
      row,
      resolvedOperatingUnitId,
      resolvedPartnerOperatingUnitId,
      `Due To Partner OU account is also assigned to operating unit pair ${describeOperatingUnitPair(
        duplicateDueTo,
        parsePositiveInt(duplicateDueTo.operating_unit_id),
        parsePositiveInt(duplicateDueTo.partner_operating_unit_id)
      )}; partner-specific current-account mappings must be unique within the legal entity`
    );
  }

  const resolved = {
    operatingUnitId: resolvedOperatingUnitId,
    partnerOperatingUnitId: resolvedPartnerOperatingUnitId,
    operatingUnitCode: String(row.operating_unit_code || ""),
    operatingUnitName: String(row.operating_unit_name || ""),
    partnerOperatingUnitCode: String(row.partner_operating_unit_code || ""),
    partnerOperatingUnitName: String(row.partner_operating_unit_name || ""),
    dueFromAccountId,
    dueFromAccountCode: String(row.due_from_account_code || ""),
    dueFromAccountName: String(row.due_from_account_name || ""),
    dueToAccountId,
    dueToAccountCode: String(row.due_to_account_code || ""),
    dueToAccountName: String(row.due_to_account_name || ""),
  };

  cache?.set(cacheKey, resolved);
  return resolved;
}

function resolveTransferParticipants(cashTxn) {
  const txnType = asUpper(cashTxn?.txn_type);
  const registerParty = {
    registerAccountId: parsePositiveInt(cashTxn?.register_account_id),
    operatingUnitId: parsePositiveInt(cashTxn?.operating_unit_id),
    registerId: parsePositiveInt(cashTxn?.cash_register_id),
    registerCode: String(cashTxn?.cash_register_code || ""),
  };
  const counterParty = {
    registerAccountId: parsePositiveInt(cashTxn?.counter_cash_register_account_id),
    operatingUnitId: parsePositiveInt(cashTxn?.counter_cash_register_operating_unit_id),
    registerId: parsePositiveInt(cashTxn?.counter_cash_register_id_resolved),
    registerCode: String(cashTxn?.counter_cash_register_code || ""),
  };

  if (txnType === "TRANSFER_OUT") {
    return {
      source: registerParty,
      target: counterParty,
    };
  }
  if (txnType === "TRANSFER_IN") {
    return {
      source: counterParty,
      target: registerParty,
    };
  }
  throw badRequest(`Unsupported transfer transaction type for posting: ${txnType}`);
}

function resolveCrossContextTransferRoute(participants) {
  const sourceOuId = parsePositiveInt(participants?.source?.operatingUnitId);
  const targetOuId = parsePositiveInt(participants?.target?.operatingUnitId);
  if (sourceOuId && targetOuId) {
    return "OU_TO_OU";
  }
  if (sourceOuId) {
    return "OU_TO_CENTRAL";
  }
  if (targetOuId) {
    return "CENTRAL_TO_OU";
  }
  return "SAME_CONTEXT";
}

function normalizeCashJournalOverrideLine(line, { currencyCode, postingReference }) {
  const operatingUnitId = normalizeOptionalId(line?.operatingUnitId);
  const subledgerReferenceNo = operatingUnitId
    ? normalizeOptionalShortText(
        line?.subledgerReferenceNo || postingReference,
        "line.subledgerReferenceNo",
        100
      )
    : null;

  return {
    accountId: requireAccountId(line?.accountId, "line.accountId"),
    operatingUnitId,
    counterpartyLegalEntityId: normalizeOptionalId(line?.counterpartyLegalEntityId),
    description: normalizeOptionalShortText(line?.description, "line.description", 255),
    subledgerReferenceNo,
    currencyCode: asUpper(line?.currencyCode) || currencyCode,
    amountTxn: Number(toAmount(line?.amountTxn).toFixed(6)),
    debitBase: Number(toAmount(line?.debitBase).toFixed(6)),
    creditBase: Number(toAmount(line?.creditBase).toFixed(6)),
    taxCode: normalizeOptionalShortText(line?.taxCode, "line.taxCode", 40),
  };
}

function invertLines(lines) {
  return lines.map((line) => ({
    ...line,
    debitBase: Number(toAmount(line.creditBase).toFixed(6)),
    creditBase: Number(toAmount(line.debitBase).toFixed(6)),
  }));
}

async function buildCashPostingLinesTx(tx, { tenantId, legalEntityId, cashTxn }) {
  const txnType = asUpper(cashTxn.txn_type);
  const amountTxn = Number(toAmount(cashTxn.amount).toFixed(6));
  const amountBase = Number(
    toAmount(cashTxn.amount_base ?? cashTxn.amount).toFixed(6)
  );
  if (!(amountTxn > 0)) {
    throw badRequest("Cash transaction amount must be > 0 for posting");
  }
  if (!(amountBase > 0)) {
    throw badRequest("Cash transaction amount_base must be > 0 for posting");
  }

  const registerAccountId = requireAccountId(cashTxn.register_account_id, "register account");
  const counterAccountId = parsePositiveInt(cashTxn.counter_account_id);
  const counterRegisterAccountId = parsePositiveInt(
    cashTxn.counter_cash_register_account_id
  );
  const registerVarianceGainAccountId = parsePositiveInt(
    cashTxn.register_variance_gain_account_id
  );
  const registerVarianceLossAccountId = parsePositiveInt(
    cashTxn.register_variance_loss_account_id
  );

  const baseDescription = normalizeOptionalShortText(
    cashTxn.description,
    "cashTransaction.description",
    255
  );
  const lineDescription = baseDescription || `Cash ${txnType}`;
  const subledgerReferenceNo = `${CASH_TXN_SUBLEDGER_PREFIX}${cashTxn.id}`;

  let lines;
  const operatingUnitCache = new Map();
  const partnerCurrentCache = new Map();

  if (txnType === "RECEIPT" || txnType === "WITHDRAWAL_FROM_BANK" || txnType === "OPENING_FLOAT") {
    lines = [
      buildBaseLine({
        accountId: registerAccountId,
        operatingUnitId: cashTxn.operating_unit_id,
        debitBase: amountBase,
        creditBase: 0,
        description: lineDescription,
        subledgerReferenceNo,
      }),
      buildBaseLine({
        accountId: requireAccountId(counterAccountId, "counterAccountId"),
        operatingUnitId: cashTxn.operating_unit_id,
        debitBase: 0,
        creditBase: amountBase,
        description: lineDescription,
        subledgerReferenceNo,
      }),
    ];
  } else if (
    txnType === "PAYOUT" ||
    txnType === "DEPOSIT_TO_BANK" ||
    txnType === "CLOSING_ADJUSTMENT"
  ) {
    lines = [
      buildBaseLine({
        accountId: requireAccountId(counterAccountId, "counterAccountId"),
        operatingUnitId: cashTxn.operating_unit_id,
        debitBase: amountBase,
        creditBase: 0,
        description: lineDescription,
        subledgerReferenceNo,
      }),
      buildBaseLine({
        accountId: registerAccountId,
        operatingUnitId: cashTxn.operating_unit_id,
        debitBase: 0,
        creditBase: amountBase,
        description: lineDescription,
        subledgerReferenceNo,
      }),
    ];
  } else if (txnType === "VARIANCE") {
    const resolvedCounterAccountId = requireAccountId(counterAccountId, "counterAccountId");
    let isOverVariance = false;
    if (registerVarianceGainAccountId && resolvedCounterAccountId === registerVarianceGainAccountId) {
      isOverVariance = true;
    } else if (
      registerVarianceLossAccountId &&
      resolvedCounterAccountId === registerVarianceLossAccountId
    ) {
      isOverVariance = false;
    } else if (registerVarianceGainAccountId || registerVarianceLossAccountId) {
      throw badRequest(
        "Variance counterAccountId must match register variance gain/loss account configuration"
      );
    }

    if (isOverVariance) {
      // Counted > expected: increase cash (debit register), credit variance gain account.
      lines = [
        buildBaseLine({
          accountId: registerAccountId,
          operatingUnitId: cashTxn.operating_unit_id,
          debitBase: amountBase,
          creditBase: 0,
          description: lineDescription,
          subledgerReferenceNo,
        }),
        buildBaseLine({
          accountId: resolvedCounterAccountId,
          operatingUnitId: cashTxn.operating_unit_id,
          debitBase: 0,
          creditBase: amountBase,
          description: lineDescription,
          subledgerReferenceNo,
        }),
      ];
    } else {
      // Counted < expected: credit cash register, debit variance loss account.
      lines = [
        buildBaseLine({
          accountId: resolvedCounterAccountId,
          operatingUnitId: cashTxn.operating_unit_id,
          debitBase: amountBase,
          creditBase: 0,
          description: lineDescription,
          subledgerReferenceNo,
        }),
        buildBaseLine({
          accountId: registerAccountId,
          operatingUnitId: cashTxn.operating_unit_id,
          debitBase: 0,
          creditBase: amountBase,
          description: lineDescription,
          subledgerReferenceNo,
        }),
      ];
    }
  } else if (txnType === "TRANSFER_OUT") {
    const transferPostingMode = resolveTransferPostingMode(cashTxn);
    if (transferPostingMode === "DIRECT") {
      lines = [
        buildBaseLine({
          accountId: requireAccountId(
            counterRegisterAccountId,
            "counterCashRegisterId account"
          ),
          operatingUnitId: cashTxn.counter_cash_register_operating_unit_id,
          debitBase: amountBase,
          creditBase: 0,
          description: lineDescription,
          subledgerReferenceNo,
        }),
        buildBaseLine({
          accountId: registerAccountId,
          operatingUnitId: cashTxn.operating_unit_id,
          debitBase: 0,
          creditBase: amountBase,
          description: lineDescription,
          subledgerReferenceNo,
        }),
      ];
    } else {
      requireAccountId(counterAccountId, "counterAccountId (CASH_IN_TRANSIT)");
      const participants = resolveTransferParticipants(cashTxn);
      const routeType = resolveCrossContextTransferRoute(participants);
      const sourceUnit =
        routeType === "OU_TO_CENTRAL"
          ? await loadOperatingUnitSelfBalancingConfigTx(tx, {
              tenantId,
              legalEntityId,
              operatingUnitId: participants.source.operatingUnitId,
              cache: operatingUnitCache,
            })
          : null;
      const targetUnit =
        routeType === "CENTRAL_TO_OU"
          ? await loadOperatingUnitSelfBalancingConfigTx(tx, {
              tenantId,
              legalEntityId,
              operatingUnitId: participants.target.operatingUnitId,
              cache: operatingUnitCache,
            })
          : null;

      if (routeType === "CENTRAL_TO_OU") {
        lines = [
          buildBaseLine({
            accountId: requireAccountId(
              targetUnit?.centralDueFromAccountId,
              "target operating unit Central Due From OU account"
            ),
            operatingUnitId: null,
            debitBase: amountBase,
            creditBase: 0,
            description: lineDescription,
            subledgerReferenceNo,
          }),
          buildBaseLine({
            accountId: sourceUnit
              ? sourceUnit.centralDueFromAccountId
              : registerAccountId,
            operatingUnitId: cashTxn.operating_unit_id,
            debitBase: 0,
            creditBase: amountBase,
            description: lineDescription,
            subledgerReferenceNo,
          }),
        ];
      } else if (routeType === "OU_TO_CENTRAL") {
        lines = [
          buildBaseLine({
            accountId: requireAccountId(
              sourceUnit?.ouDueToCentralAccountId,
              "source operating unit OU Due To Central account"
            ),
            operatingUnitId: participants.source.operatingUnitId,
            debitBase: amountBase,
            creditBase: 0,
            description: lineDescription,
            subledgerReferenceNo,
          }),
          buildBaseLine({
            accountId: requireAccountId(
              participants.source.registerAccountId,
              "source register account"
            ),
            operatingUnitId: participants.source.operatingUnitId,
            debitBase: 0,
            creditBase: amountBase,
            description: lineDescription,
            subledgerReferenceNo,
          }),
        ];
      } else if (routeType === "OU_TO_OU") {
        const sourcePartnerConfig = await loadOperatingUnitPartnerCurrentConfigTx(tx, {
          tenantId,
          legalEntityId,
          operatingUnitId: participants.source.operatingUnitId,
          partnerOperatingUnitId: participants.target.operatingUnitId,
          cache: partnerCurrentCache,
        });
        await loadOperatingUnitPartnerCurrentConfigTx(tx, {
          tenantId,
          legalEntityId,
          operatingUnitId: participants.target.operatingUnitId,
          partnerOperatingUnitId: participants.source.operatingUnitId,
          cache: partnerCurrentCache,
        });
        lines = [
          buildBaseLine({
            accountId: requireAccountId(
              sourcePartnerConfig?.dueFromAccountId,
              "source operating unit Due From Partner OU account"
            ),
            operatingUnitId: participants.source.operatingUnitId,
            debitBase: amountBase,
            creditBase: 0,
            description: lineDescription,
            subledgerReferenceNo,
          }),
          buildBaseLine({
            accountId: requireAccountId(
              participants.source.registerAccountId,
              "source register account"
            ),
            operatingUnitId: participants.source.operatingUnitId,
            debitBase: 0,
            creditBase: amountBase,
            description: lineDescription,
            subledgerReferenceNo,
          }),
        ];
      } else {
        throw badRequest(
          "Cross-context transfer accounting requires different operating-unit contexts"
        );
      }
    }
  } else if (txnType === "TRANSFER_IN") {
    const transferPostingMode = resolveTransferPostingMode(cashTxn);
    if (transferPostingMode === "DIRECT") {
      lines = [
        buildBaseLine({
          accountId: registerAccountId,
          operatingUnitId: cashTxn.operating_unit_id,
          debitBase: amountBase,
          creditBase: 0,
          description: lineDescription,
          subledgerReferenceNo,
        }),
        buildBaseLine({
          accountId: requireAccountId(
            counterRegisterAccountId,
            "counterCashRegisterId account"
          ),
          operatingUnitId: cashTxn.counter_cash_register_operating_unit_id,
          debitBase: 0,
          creditBase: amountBase,
          description: lineDescription,
          subledgerReferenceNo,
        }),
      ];
    } else {
      requireAccountId(counterAccountId, "counterAccountId (CASH_IN_TRANSIT)");
      const participants = resolveTransferParticipants(cashTxn);
      const routeType = resolveCrossContextTransferRoute(participants);
      const sourceUnit =
        routeType === "OU_TO_CENTRAL"
          ? await loadOperatingUnitSelfBalancingConfigTx(tx, {
              tenantId,
              legalEntityId,
              operatingUnitId: participants.source.operatingUnitId,
              cache: operatingUnitCache,
            })
          : null;
      const targetUnit =
        routeType === "CENTRAL_TO_OU"
          ? await loadOperatingUnitSelfBalancingConfigTx(tx, {
              tenantId,
              legalEntityId,
              operatingUnitId: participants.target.operatingUnitId,
              cache: operatingUnitCache,
            })
          : null;

      if (routeType === "CENTRAL_TO_OU") {
        lines = [
          buildBaseLine({
            accountId: requireAccountId(
              participants.target.registerAccountId,
              "target register account"
            ),
            operatingUnitId: participants.target.operatingUnitId,
            debitBase: amountBase,
            creditBase: 0,
            description: lineDescription,
            subledgerReferenceNo,
          }),
          buildBaseLine({
            accountId: requireAccountId(
              targetUnit?.ouDueToCentralAccountId,
              "target operating unit OU Due To Central account"
            ),
            operatingUnitId: participants.target.operatingUnitId,
            debitBase: 0,
            creditBase: amountBase,
            description: lineDescription,
            subledgerReferenceNo,
          }),
        ];
      } else if (routeType === "OU_TO_CENTRAL") {
        lines = [
          buildBaseLine({
            accountId: registerAccountId,
            operatingUnitId: cashTxn.operating_unit_id,
            debitBase: amountBase,
            creditBase: 0,
            description: lineDescription,
            subledgerReferenceNo,
          }),
          buildBaseLine({
            accountId: requireAccountId(
              sourceUnit?.centralDueFromAccountId,
              "source operating unit Central Due From OU account"
            ),
            operatingUnitId: null,
            debitBase: 0,
            creditBase: amountBase,
            description: lineDescription,
            subledgerReferenceNo,
          }),
        ];
      } else if (routeType === "OU_TO_OU") {
        const targetPartnerConfig = await loadOperatingUnitPartnerCurrentConfigTx(tx, {
          tenantId,
          legalEntityId,
          operatingUnitId: participants.target.operatingUnitId,
          partnerOperatingUnitId: participants.source.operatingUnitId,
          cache: partnerCurrentCache,
        });
        lines = [
          buildBaseLine({
            accountId: requireAccountId(
              participants.target.registerAccountId,
              "target register account"
            ),
            operatingUnitId: participants.target.operatingUnitId,
            debitBase: amountBase,
            creditBase: 0,
            description: lineDescription,
            subledgerReferenceNo,
          }),
          buildBaseLine({
            accountId: requireAccountId(
              targetPartnerConfig?.dueToAccountId,
              "target operating unit Due To Partner OU account"
            ),
            operatingUnitId: participants.target.operatingUnitId,
            debitBase: 0,
            creditBase: amountBase,
            description: lineDescription,
            subledgerReferenceNo,
          }),
        ];
      } else {
        throw badRequest(
          "Cross-context transfer accounting requires different operating-unit contexts"
        );
      }
    }
  } else {
    throw badRequest(`Unsupported cash transaction type for posting: ${txnType}`);
  }

  if (parsePositiveInt(cashTxn.reversal_of_transaction_id)) {
    lines = invertLines(lines);
  }

  ensureBalanced(lines);
  return lines;
}

async function resolveBookAndPeriodForCashPostingTx(tx, payload) {
  const bookResult = await tx.query(
    `SELECT id, calendar_id, code, name, base_currency_code, book_type
     FROM books
     WHERE tenant_id = ?
       AND legal_entity_id = ?
     ORDER BY
       CASE WHEN book_type = 'LOCAL' THEN 0 ELSE 1 END,
       id ASC
     LIMIT 1`,
    [payload.tenantId, payload.legalEntityId]
  );
  const book = bookResult.rows?.[0] || null;
  if (!book) {
    throw badRequest("No book found for cash transaction legal entity");
  }

  const bookId = parsePositiveInt(book.id);
  const calendarId = parsePositiveInt(book.calendar_id);
  if (!bookId || !calendarId) {
    throw badRequest("Book configuration is invalid for cash transaction posting");
  }

  const periodResult = await tx.query(
    `SELECT id, fiscal_year, period_no, period_name
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND ? BETWEEN start_date AND end_date
     ORDER BY is_adjustment ASC, id ASC
     LIMIT 1`,
    [calendarId, payload.bookDate]
  );
  const period = periodResult.rows?.[0] || null;
  if (!period) {
    throw badRequest("No fiscal period found for cash transaction book_date");
  }

  const fiscalPeriodId = parsePositiveInt(period.id);
  if (!fiscalPeriodId) {
    throw badRequest("Fiscal period configuration is invalid for cash transaction posting");
  }

  await ensurePeriodOpen(
    bookId,
    fiscalPeriodId,
    "post cash transaction",
    tx.query.bind(tx)
  );

  return {
    bookId,
    fiscalPeriodId,
    calendarId,
    book,
    period,
  };
}

export async function createAndPostCashJournalTx(tx, payload) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const userId = parsePositiveInt(payload?.userId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  const cashTxn = payload?.cashTxn || null;
  const req = payload?.req;
  const journalLinesOverride = Array.isArray(payload?.journalLinesOverride)
    ? payload.journalLinesOverride
    : null;

  if (!tenantId || !userId || !legalEntityId || !cashTxn || !req) {
    throw badRequest("Missing required payload for cash journal posting");
  }

  const txnId = parsePositiveInt(cashTxn.id);
  if (!txnId) {
    throw badRequest("cashTxn.id is required for posting");
  }

  const bookDate = toIsoDate(cashTxn.book_date, "cashTransaction.book_date");
  const entryDate = bookDate;
  const documentDate = bookDate;
  const currencyCode = asUpper(cashTxn.currency_code);
  if (!currencyCode || currencyCode.length !== 3) {
    throw badRequest("cashTransaction.currency_code is invalid");
  }
  const postingReference = `${CASH_TXN_SUBLEDGER_PREFIX}${txnId}`;

  const journalContext = await resolveBookAndPeriodForCashPostingTx(tx, {
    tenantId,
    legalEntityId,
    bookDate,
  });

  const lines = journalLinesOverride
    ? journalLinesOverride.map((line) =>
        normalizeCashJournalOverrideLine(line, {
          currencyCode,
          postingReference,
        })
      )
    : await buildCashPostingLinesTx(tx, {
        tenantId,
        legalEntityId,
        cashTxn,
      });
  const centralEquityPolicy = await loadCentralEquityJournalValidationContext({
    tenantId,
    legalEntityId,
    runQuery: tx.query.bind(tx),
  });
  for (let i = 0; i < lines.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await validateJournalLineScope(req, tenantId, legalEntityId, lines[i], i, {
      centralEquityPolicy,
    });
  }

  const totals = ensureBalanced(lines);
  const referenceNoOverride = normalizeOptionalShortText(
    payload?.referenceNoOverride,
    "referenceNoOverride",
    100
  );
  const descriptionOverride = normalizeOptionalShortText(
    payload?.descriptionOverride,
    "descriptionOverride",
    255
  );
  const journalNoOverride = normalizeOptionalShortText(
    payload?.journalNoOverride,
    "journalNoOverride",
    40
  );
  const referenceNo = normalizeOptionalShortText(cashTxn.reference_no, "cashTransaction.reference_no", 100);
  const entryDescription = normalizeOptionalShortText(cashTxn.description, "cashTransaction.description", 255);
  const effectiveReferenceNo = referenceNo || postingReference;
  const effectiveDescription = entryDescription || `Cash ${asUpper(cashTxn.txn_type)} ${cashTxn.txn_no}`;
  const txnAmountMagnitude = Number(toAmount(cashTxn.amount).toFixed(6));
  if (!journalLinesOverride && !(txnAmountMagnitude > 0)) {
    throw badRequest("Cash transaction amount must be > 0 for journal_lines.amount_txn");
  }

  const journalResult = await tx.query(
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
        created_by_user_id,
        posted_by_user_id,
        posted_at
     )
     VALUES (?, ?, ?, ?, ?, 'CASH', 'POSTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      tenantId,
      legalEntityId,
      journalContext.bookId,
      journalContext.fiscalPeriodId,
      journalNoOverride || buildCashJournalNo(cashTxn),
      entryDate,
      documentDate,
      currencyCode,
      descriptionOverride || effectiveDescription,
      referenceNoOverride || effectiveReferenceNo,
      totals.totalDebit,
      totals.totalCredit,
      userId,
      userId,
    ]
  );

  const journalEntryId = parsePositiveInt(journalResult.rows?.insertId);
  if (!journalEntryId) {
    throw badRequest("Failed to create posted cash journal");
  }
  await upsertJournalSourceLinkTx(tx, {
    tenantId,
    legalEntityId,
    journalEntryId,
    sourceRefType: "CASH_TRANSACTION",
    sourceRefId: txnId,
  });

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const debitBase = Number(toAmount(line.debitBase).toFixed(6));
    const creditBase = Number(toAmount(line.creditBase).toFixed(6));
    const isDebitLine = debitBase > 0 && creditBase === 0;
    const isCreditLine = creditBase > 0 && debitBase === 0;
    if (!isDebitLine && !isCreditLine) {
      throw badRequest("Cash posting line must have exactly one non-zero base side");
    }
    const amountTxn = journalLinesOverride
      ? Number(toAmount(line.amountTxn).toFixed(6))
      : Number((isDebitLine ? txnAmountMagnitude : -txnAmountMagnitude).toFixed(6));

    // eslint-disable-next-line no-await-in-loop
    await tx.query(
      `INSERT INTO journal_lines (
          journal_entry_id,
          line_no,
          account_id,
          operating_unit_id,
          counterparty_legal_entity_id,
          description,
          subledger_reference_no,
          currency_code,
          amount_txn,
          debit_base,
          credit_base,
          tax_code
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        journalEntryId,
        i + 1,
        parsePositiveInt(line.accountId),
        normalizeOptionalId(line.operatingUnitId),
        normalizeOptionalId(line.counterpartyLegalEntityId),
        line.description || null,
        line.subledgerReferenceNo || null,
        line.currencyCode || currencyCode,
        amountTxn,
        debitBase,
        creditBase,
        line.taxCode || null,
      ]
    );
  }

  return {
    journalEntryId,
    bookId: journalContext.bookId,
    fiscalPeriodId: journalContext.fiscalPeriodId,
    sourceType: "CASH",
    lineCount: lines.length,
    totalDebit: totals.totalDebit,
    totalCredit: totals.totalCredit,
    subledgerReferenceNo: postingReference,
  };
}
