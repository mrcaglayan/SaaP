import { query, withTransaction } from "../db.js";
import { assertAccountBelongsToTenant } from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const CONTRACT_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
});

const CONTRACT_TYPE = Object.freeze({
  CUSTOMER: "CUSTOMER",
  VENDOR: "VENDOR",
});

const LINKABLE_CONTRACT_STATUSES = new Set([
  CONTRACT_STATUS.DRAFT,
  CONTRACT_STATUS.ACTIVE,
]);
const LINK_CORRECTION_CONTRACT_STATUSES = new Set([
  CONTRACT_STATUS.DRAFT,
  CONTRACT_STATUS.ACTIVE,
  CONTRACT_STATUS.SUSPENDED,
  CONTRACT_STATUS.CLOSED,
]);

const LINKABLE_DOCUMENT_STATUSES = new Set([
  "POSTED",
  "PARTIALLY_SETTLED",
  "SETTLED",
]);
const AMENDABLE_CONTRACT_STATUSES = new Set([
  CONTRACT_STATUS.ACTIVE,
  CONTRACT_STATUS.SUSPENDED,
]);
const LINE_PATCHABLE_CONTRACT_STATUSES = new Set([
  CONTRACT_STATUS.DRAFT,
  CONTRACT_STATUS.ACTIVE,
  CONTRACT_STATUS.SUSPENDED,
]);
const CONTRACT_AMENDMENT_TYPE = Object.freeze({
  FULL_REPLACE: "FULL_REPLACE",
  LINE_PATCH: "LINE_PATCH",
});

const TRANSITIONS = Object.freeze({
  activate: {
    toStatus: CONTRACT_STATUS.ACTIVE,
    fromStatuses: new Set([CONTRACT_STATUS.DRAFT, CONTRACT_STATUS.SUSPENDED]),
  },
  suspend: {
    toStatus: CONTRACT_STATUS.SUSPENDED,
    fromStatuses: new Set([CONTRACT_STATUS.ACTIVE]),
  },
  close: {
    toStatus: CONTRACT_STATUS.CLOSED,
    fromStatuses: new Set([CONTRACT_STATUS.ACTIVE, CONTRACT_STATUS.SUSPENDED]),
  },
  cancel: {
    toStatus: CONTRACT_STATUS.CANCELLED,
    fromStatuses: new Set([CONTRACT_STATUS.DRAFT]),
  },
});

const EPSILON = 0.000001;
const LINK_EVENT_ACTION = Object.freeze({
  ADJUST: "ADJUST",
  UNLINK: "UNLINK",
});
const AUDIT_ACTIONS = Object.freeze({
  LINK_CREATE: "contract.document_link.create",
  LINK_ADJUST: "contract.document_link.adjust",
  LINK_UNLINK: "contract.document_link.unlink",
});

function toDecimalNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnlyString(value, label = "date") {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw badRequest(`${label} must be a valid date`);
    }
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}(?:\b|T)/.test(raw)) {
    return raw.slice(0, 10);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} must be a valid date`);
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  return Number(value) === 1;
}

function toFixedAmount(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return "0.000000";
  }
  return parsed.toFixed(6);
}

function toFixedFxRate(value, label = "linkFxRate") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be > 0`);
  }
  return parsed.toFixed(10);
}

function toSignedFixedAmount(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  return parsed.toFixed(6);
}

function normalizeNearZero(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.abs(parsed) <= EPSILON ? 0 : parsed;
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

function resolveLinkFxRateSnapshot({
  contractCurrencyCode,
  documentCurrencyCode,
  linkedAmountTxn,
  linkedAmountBase,
  requestedFxRate,
  documentFxRate,
}) {
  const normalizedContractCurrency = asUpper(contractCurrencyCode);
  const normalizedDocumentCurrency = asUpper(documentCurrencyCode);

  const explicitFxRate = toDecimalNumber(requestedFxRate);
  if (explicitFxRate !== null && explicitFxRate <= 0) {
    throw badRequest("linkFxRate must be > 0");
  }

  const documentFx = toDecimalNumber(documentFxRate);
  const txnAmount = Math.abs(Number(linkedAmountTxn || 0));
  const baseAmount = Math.abs(Number(linkedAmountBase || 0));
  const derivedFx =
    txnAmount > EPSILON && baseAmount > EPSILON ? baseAmount / txnAmount : null;

  let resolvedFxRate = explicitFxRate ?? documentFx ?? derivedFx;
  if (!resolvedFxRate && normalizedContractCurrency === normalizedDocumentCurrency) {
    resolvedFxRate = 1;
  }

  if (!Number.isFinite(resolvedFxRate) || Number(resolvedFxRate) <= 0) {
    throw badRequest(
      "Cross-currency link requires linkFxRate or a source document fx_rate"
    );
  }

  return toFixedFxRate(resolvedFxRate, "linkFxRate");
}

function resolveClientIp(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const firstIp = forwardedFor
      .split(",")
      .map((segment) => segment.trim())
      .find(Boolean);
    if (firstIp) {
      return firstIp.slice(0, 64);
    }
  }
  return String(req?.ip || req?.socket?.remoteAddress || "unknown").slice(0, 64);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      serializationError: "payload_json could not be serialized",
    });
  }
}

function inClausePlaceholders(values) {
  const safeValues = Array.isArray(values) ? values.filter(Boolean) : [];
  if (safeValues.length === 0) {
    return null;
  }
  return safeValues.map(() => "?").join(", ");
}

function isDuplicateKeyError(err, constraintName = null) {
  const duplicate =
    Number(err?.errno) === 1062 ||
    String(err?.code || "").toUpperCase() === "ER_DUP_ENTRY";
  if (!duplicate) {
    return false;
  }
  if (!constraintName) {
    return true;
  }
  return String(err?.message || "").includes(constraintName);
}

function mapContractSummaryRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    counterpartyId: parsePositiveInt(row.counterparty_id),
    contractNo: row.contract_no,
    contractType: row.contract_type,
    status: row.status,
    versionNo: Number(row.version_no || 1),
    currencyCode: row.currency_code,
    startDate: toDateOnlyString(row.start_date, "startDate"),
    endDate: toDateOnlyString(row.end_date, "endDate"),
    totalAmountTxn: toDecimalNumber(row.total_amount_txn),
    totalAmountBase: toDecimalNumber(row.total_amount_base),
    notes: row.notes || null,
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lineCount:
      row.line_count === undefined || row.line_count === null
        ? null
        : Number(row.line_count),
  };
}

function parseNullableJson(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function mapContractLineRow(row) {
  return {
    id: parsePositiveInt(row.id),
    lineNo: Number(row.line_no || 0),
    description: row.description || "",
    lineAmountTxn: toDecimalNumber(row.line_amount_txn),
    lineAmountBase: toDecimalNumber(row.line_amount_base),
    recognitionMethod: row.recognition_method,
    recognitionStartDate: toDateOnlyString(
      row.recognition_start_date,
      "recognitionStartDate"
    ),
    recognitionEndDate: toDateOnlyString(
      row.recognition_end_date,
      "recognitionEndDate"
    ),
    deferredAccountId: parsePositiveInt(row.deferred_account_id),
    revenueAccountId: parsePositiveInt(row.revenue_account_id),
    status: row.status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapContractDocumentLinkRow(row) {
  const originalLinkedAmountTxn = toDecimalNumber(row.linked_amount_txn) || 0;
  const originalLinkedAmountBase = toDecimalNumber(row.linked_amount_base) || 0;
  const adjustmentsDeltaTxn = toDecimalNumber(row.delta_amount_txn) || 0;
  const adjustmentsDeltaBase = toDecimalNumber(row.delta_amount_base) || 0;
  const linkedAmountTxn = normalizeNearZero(originalLinkedAmountTxn + adjustmentsDeltaTxn);
  const linkedAmountBase = normalizeNearZero(originalLinkedAmountBase + adjustmentsDeltaBase);

  return {
    linkId: parsePositiveInt(row.id),
    contractId: parsePositiveInt(row.contract_id),
    linkType: row.link_type,
    linkedAmountTxn,
    linkedAmountBase,
    originalLinkedAmountTxn: originalLinkedAmountTxn,
    originalLinkedAmountBase: originalLinkedAmountBase,
    adjustmentsDeltaTxn,
    adjustmentsDeltaBase,
    adjustmentCount: Number(row.adjustment_event_count || 0),
    isUnlinked: Number(row.unlink_event_count || 0) > 0,
    createdAt: row.created_at || null,
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    cariDocumentId: parsePositiveInt(row.cari_document_id),
    contractCurrencyCodeSnapshot: row.contract_currency_code_snapshot || null,
    documentCurrencyCodeSnapshot: row.document_currency_code_snapshot || null,
    linkFxRateSnapshot: toDecimalNumber(row.link_fx_rate_snapshot),
    documentNo: row.document_no || null,
    direction: row.direction || null,
    status: row.status || null,
    documentDate: toDateOnlyString(row.document_date, "documentDate"),
    amountTxn: toDecimalNumber(row.amount_txn),
    amountBase: toDecimalNumber(row.amount_base),
  };
}

function mapContractLinkableDocumentRow(row) {
  return {
    id: parsePositiveInt(row.id),
    documentNo: row.document_no || null,
    direction: row.direction || null,
    status: row.status || null,
    documentDate: toDateOnlyString(row.document_date, "documentDate"),
    currencyCode: row.currency_code || null,
    amountTxn: toDecimalNumber(row.amount_txn),
    amountBase: toDecimalNumber(row.amount_base),
    openAmountTxn: toDecimalNumber(row.open_amount_txn),
    openAmountBase: toDecimalNumber(row.open_amount_base),
    fxRate: toDecimalNumber(row.fx_rate),
  };
}

function mapContractAmendmentRow(row) {
  if (!row) {
    return null;
  }

  return {
    amendmentId: parsePositiveInt(row.id),
    contractId: parsePositiveInt(row.contract_id),
    versionNo: Number(row.version_no || 0),
    amendmentType: row.amendment_type || null,
    reason: row.reason || "",
    payload: parseNullableJson(row.payload_json),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdAt: row.created_at || null,
  };
}

function assertCounterpartyRoleCompatibility(contractType, counterpartyRow) {
  if (!counterpartyRow) {
    throw badRequest("counterpartyId must belong to legalEntityId");
  }
  if (asUpper(contractType) === CONTRACT_TYPE.CUSTOMER && !toBoolean(counterpartyRow.is_customer)) {
    throw badRequest(
      "Counterparty role mismatch: CUSTOMER contracts require counterparty.is_customer=true"
    );
  }
  if (asUpper(contractType) === CONTRACT_TYPE.VENDOR && !toBoolean(counterpartyRow.is_vendor)) {
    throw badRequest(
      "Counterparty role mismatch: VENDOR contracts require counterparty.is_vendor=true"
    );
  }
}

function calculateHeaderTotals(lines) {
  let totalTxn = 0;
  let totalBase = 0;
  for (const line of lines || []) {
    if (asUpper(line.status) !== "ACTIVE") {
      continue;
    }
    totalTxn += Number(line.lineAmountTxn || 0);
    totalBase += Number(line.lineAmountBase || 0);
  }
  return {
    totalAmountTxn: toFixedAmount(totalTxn),
    totalAmountBase: toFixedAmount(totalBase),
  };
}

function assertLineRecognitionDates(line, basePath = "line") {
  const recognitionMethod = asUpper(line?.recognitionMethod);
  const recognitionStartDate = line?.recognitionStartDate || null;
  const recognitionEndDate = line?.recognitionEndDate || null;
  const hasStart = Boolean(recognitionStartDate);
  const hasEnd = Boolean(recognitionEndDate);

  if (recognitionMethod === "STRAIGHT_LINE") {
    if (!hasStart || !hasEnd) {
      throw badRequest(
        `${basePath}.recognitionStartDate and ${basePath}.recognitionEndDate are required for STRAIGHT_LINE`
      );
    }
  } else if (recognitionMethod === "MILESTONE") {
    if (!hasStart || !hasEnd) {
      throw badRequest(
        `${basePath}.recognitionStartDate and ${basePath}.recognitionEndDate are required for MILESTONE`
      );
    }
    if (recognitionStartDate !== recognitionEndDate) {
      throw badRequest(
        `${basePath}.recognitionStartDate and ${basePath}.recognitionEndDate must match for MILESTONE`
      );
    }
  } else if (recognitionMethod === "MANUAL") {
    if (hasStart || hasEnd) {
      throw badRequest(
        `${basePath}.recognitionStartDate and ${basePath}.recognitionEndDate must be omitted for MANUAL`
      );
    }
  }

  if (
    recognitionStartDate &&
    recognitionEndDate &&
    recognitionStartDate > recognitionEndDate
  ) {
    throw badRequest(
      `${basePath}.recognitionStartDate cannot be greater than ${basePath}.recognitionEndDate`
    );
  }
}

function expectedAccountType(contractType, accountRole) {
  const normalizedContractType = asUpper(contractType);
  const normalizedRole = asUpper(accountRole);

  if (normalizedContractType === CONTRACT_TYPE.CUSTOMER) {
    if (normalizedRole === "DEFERRED") {
      return "LIABILITY";
    }
    return "REVENUE";
  }

  if (normalizedRole === "DEFERRED") {
    return "ASSET";
  }
  return "EXPENSE";
}

function assertAccountCompatibility({
  accountRow,
  legalEntityId,
  contractType,
  accountRole,
  label,
}) {
  if (!accountRow) {
    throw badRequest(`${label} not found for tenant`);
  }
  if (asUpper(accountRow.scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${label} must belong to a LEGAL_ENTITY chart`);
  }
  if (parsePositiveInt(accountRow.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${label} must belong to contract legalEntityId`);
  }
  if (!toBoolean(accountRow.is_active)) {
    throw badRequest(`${label} must be active`);
  }
  if (!toBoolean(accountRow.allow_posting)) {
    throw badRequest(`${label} must allow posting`);
  }
  const expected = expectedAccountType(contractType, accountRole);
  if (asUpper(accountRow.account_type) !== expected) {
    throw badRequest(`${label} must have accountType=${expected} for contractType=${contractType}`);
  }
}

async function fetchContractRow({
  tenantId,
  contractId,
  runQuery = query,
  forUpdate = false,
}) {
  const lockSql = forUpdate ? " FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT
        c.id,
        c.tenant_id,
        c.legal_entity_id,
        c.counterparty_id,
        c.contract_no,
        c.contract_type,
        c.status,
        c.version_no,
        c.currency_code,
        c.start_date,
        c.end_date,
        c.total_amount_txn,
        c.total_amount_base,
        c.notes,
        c.created_by_user_id,
        c.created_at,
        c.updated_at,
        (
          SELECT COUNT(*)
          FROM contract_lines cl
          WHERE cl.tenant_id = c.tenant_id
            AND cl.legal_entity_id = c.legal_entity_id
            AND cl.contract_id = c.id
        ) AS line_count
     FROM contracts c
     WHERE c.tenant_id = ?
       AND c.id = ?
     LIMIT 1${lockSql}`,
    [tenantId, contractId]
  );
  return result.rows?.[0] || null;
}

async function fetchCounterpartyRow({
  tenantId,
  legalEntityId,
  counterpartyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        is_customer,
        is_vendor,
        status
     FROM counterparties
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, counterpartyId]
  );
  return result.rows?.[0] || null;
}

async function assertLegalEntityExists({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
     FROM legal_entities
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId]
  );
  if (!result.rows?.[0]) {
    throw badRequest("legalEntityId not found for tenant");
  }
}

async function assertCurrencyExists({
  currencyCode,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT code
     FROM currencies
     WHERE code = ?
     LIMIT 1`,
    [currencyCode]
  );
  if (!result.rows?.[0]) {
    throw badRequest("currencyCode not found");
  }
}

async function fetchAccountRow({
  tenantId,
  accountId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        a.id,
        a.account_type,
        a.is_active,
        a.allow_posting,
        c.scope,
        c.legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId]
  );
  return result.rows?.[0] || null;
}

async function validateContractLineAccountsTx({
  tenantId,
  legalEntityId,
  contractType,
  lines,
  runQuery,
}) {
  for (let index = 0; index < (lines || []).length; index += 1) {
    const line = lines[index];
    const linePath = `lines[${index}]`;

    if (line.deferredAccountId) {
      await assertAccountBelongsToTenant(
        tenantId,
        line.deferredAccountId,
        `${linePath}.deferredAccountId`,
        { runQuery }
      );
      const deferredAccount = await fetchAccountRow({
        tenantId,
        accountId: line.deferredAccountId,
        runQuery,
      });
      assertAccountCompatibility({
        accountRow: deferredAccount,
        legalEntityId,
        contractType,
        accountRole: "DEFERRED",
        label: `${linePath}.deferredAccountId`,
      });
    }

    if (line.revenueAccountId) {
      await assertAccountBelongsToTenant(
        tenantId,
        line.revenueAccountId,
        `${linePath}.revenueAccountId`,
        { runQuery }
      );
      const revenueAccount = await fetchAccountRow({
        tenantId,
        accountId: line.revenueAccountId,
        runQuery,
      });
      assertAccountCompatibility({
        accountRow: revenueAccount,
        legalEntityId,
        contractType,
        accountRole: "REVENUE",
        label: `${linePath}.revenueAccountId`,
      });
    }
  }
}

async function replaceContractLinesTx({
  tenantId,
  legalEntityId,
  contractId,
  lines,
  runQuery,
}) {
  await runQuery(
    `DELETE FROM contract_lines
     WHERE tenant_id = ?
       AND contract_id = ?`,
    [tenantId, contractId]
  );

  for (let index = 0; index < (lines || []).length; index += 1) {
    const line = lines[index];
    await runQuery(
      `INSERT INTO contract_lines (
          tenant_id,
          legal_entity_id,
          contract_id,
          line_no,
          description,
          line_amount_txn,
          line_amount_base,
          recognition_method,
          recognition_start_date,
          recognition_end_date,
          deferred_account_id,
          revenue_account_id,
          status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        contractId,
        index + 1,
        line.description,
        line.lineAmountTxn,
        line.lineAmountBase,
        line.recognitionMethod,
        line.recognitionStartDate,
        line.recognitionEndDate,
        line.deferredAccountId,
        line.revenueAccountId,
        line.status,
      ]
    );
  }
}

async function fetchContractLineRowById({
  tenantId,
  legalEntityId = null,
  contractId,
  lineId,
  runQuery = query,
  forUpdate = false,
}) {
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const legalEntityFilterSql = parsedLegalEntityId ? " AND legal_entity_id = ?" : "";
  const params = parsedLegalEntityId
    ? [tenantId, parsedLegalEntityId, contractId, lineId]
    : [tenantId, contractId, lineId];
  const lockSql = forUpdate ? " FOR UPDATE" : "";
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        contract_id,
        line_no,
        description,
        line_amount_txn,
        line_amount_base,
        recognition_method,
        recognition_start_date,
        recognition_end_date,
        deferred_account_id,
        revenue_account_id,
        status,
        created_at,
        updated_at
     FROM contract_lines
     WHERE tenant_id = ?
       ${legalEntityFilterSql}
       AND contract_id = ?
       AND id = ?
     LIMIT 1${lockSql}`,
    params
  );
  return result.rows?.[0] || null;
}

async function listContractLineRowsByContractId({
  tenantId,
  legalEntityId = null,
  contractId,
  runQuery = query,
}) {
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const legalEntityFilterSql = parsedLegalEntityId ? " AND legal_entity_id = ?" : "";
  const params = parsedLegalEntityId
    ? [tenantId, parsedLegalEntityId, contractId]
    : [tenantId, contractId];
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        contract_id,
        line_no,
        description,
        line_amount_txn,
        line_amount_base,
        recognition_method,
        recognition_start_date,
        recognition_end_date,
        deferred_account_id,
        revenue_account_id,
        status,
        created_at,
        updated_at
     FROM contract_lines
     WHERE tenant_id = ?
       ${legalEntityFilterSql}
       AND contract_id = ?
     ORDER BY line_no ASC, id ASC`,
    params
  );
  return result.rows || [];
}

function mapLineRowsForHeaderTotals(lineRows) {
  return (lineRows || []).map((row) => ({
    lineAmountTxn: row.line_amount_txn,
    lineAmountBase: row.line_amount_base,
    status: row.status,
  }));
}

async function insertContractAmendmentTx({
  tenantId,
  legalEntityId,
  contractId,
  versionNo,
  amendmentType,
  reason,
  payload,
  userId,
  runQuery,
}) {
  await runQuery(
    `INSERT INTO contract_amendments (
        tenant_id,
        legal_entity_id,
        contract_id,
        version_no,
        amendment_type,
        reason,
        payload_json,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      legalEntityId,
      contractId,
      versionNo,
      amendmentType,
      reason,
      safeStringify(payload || null),
      userId,
    ]
  );
}

async function insertContractAuditLog({
  req,
  runQuery = query,
  tenantId,
  userId,
  action,
  legalEntityId,
  linkId,
  payload,
}) {
  await runQuery(
    `INSERT INTO audit_logs (
        tenant_id,
        user_id,
        action,
        resource_type,
        resource_id,
        scope_type,
        scope_id,
        request_id,
        ip_address,
        user_agent,
        payload_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      userId || null,
      action,
      "contract_document_link",
      linkId ? String(linkId) : null,
      legalEntityId ? "LEGAL_ENTITY" : null,
      legalEntityId || null,
      toNullableString(req?.requestId || req?.headers?.["x-request-id"], 80),
      resolveClientIp(req),
      toNullableString(req?.headers?.["user-agent"], 255),
      safeStringify(payload || null),
    ]
  );
}

function buildLinkEventStateByLinkId(baseLinks, eventRows) {
  const byLinkId = new Map();

  for (const baseLink of baseLinks || []) {
    const linkId = parsePositiveInt(baseLink.id);
    if (!linkId) {
      continue;
    }
    byLinkId.set(linkId, {
      linkId,
      contractId: parsePositiveInt(baseLink.contract_id),
      linkType: baseLink.link_type,
      baseTxn: Number(baseLink.linked_amount_txn || 0),
      baseBase: Number(baseLink.linked_amount_base || 0),
      deltaTxn: 0,
      deltaBase: 0,
      adjustmentCount: 0,
      unlinkCount: 0,
      effectiveTxn: Number(baseLink.linked_amount_txn || 0),
      effectiveBase: Number(baseLink.linked_amount_base || 0),
    });
  }

  for (const eventRow of eventRows || []) {
    const linkId = parsePositiveInt(eventRow.contract_document_link_id);
    const state = byLinkId.get(linkId);
    if (!state) {
      continue;
    }
    const deltaTxn = Number(eventRow.delta_amount_txn || 0);
    const deltaBase = Number(eventRow.delta_amount_base || 0);
    state.deltaTxn += deltaTxn;
    state.deltaBase += deltaBase;
    if (asUpper(eventRow.action_type) === LINK_EVENT_ACTION.UNLINK) {
      state.unlinkCount += 1;
    } else {
      state.adjustmentCount += 1;
    }
  }

  let totalEffectiveTxn = 0;
  let totalEffectiveBase = 0;
  for (const state of byLinkId.values()) {
    state.effectiveTxn = normalizeNearZero(state.baseTxn + state.deltaTxn);
    state.effectiveBase = normalizeNearZero(state.baseBase + state.deltaBase);
    if (state.effectiveTxn < -EPSILON) {
      throw badRequest(`contractDocumentLink ${state.linkId} has negative effective txn amount`);
    }
    if (state.effectiveBase < -EPSILON) {
      throw badRequest(`contractDocumentLink ${state.linkId} has negative effective base amount`);
    }
    totalEffectiveTxn += state.effectiveTxn;
    totalEffectiveBase += state.effectiveBase;
  }

  return {
    byLinkId,
    totalEffectiveTxn: normalizeNearZero(totalEffectiveTxn),
    totalEffectiveBase: normalizeNearZero(totalEffectiveBase),
  };
}

async function loadDocumentLinkEventStateTx({
  tenantId,
  legalEntityId,
  cariDocumentId,
  runQuery,
}) {
  const baseLinksResult = await runQuery(
    `SELECT
        id,
        contract_id,
        link_type,
        linked_amount_txn,
        linked_amount_base
     FROM contract_document_links
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND cari_document_id = ?
     FOR UPDATE`,
    [tenantId, legalEntityId, cariDocumentId]
  );
  const baseLinks = baseLinksResult.rows || [];
  const linkIds = baseLinks
    .map((row) => parsePositiveInt(row.id))
    .filter((value) => Number.isInteger(value) && value > 0);

  let eventRows = [];
  if (linkIds.length > 0) {
    const placeholders = inClausePlaceholders(linkIds);
    const eventResult = await runQuery(
      `SELECT
          id,
          contract_document_link_id,
          action_type,
          delta_amount_txn,
          delta_amount_base
       FROM contract_document_link_events
       WHERE tenant_id = ?
         AND contract_document_link_id IN (${placeholders})
       FOR UPDATE`,
      [tenantId, ...linkIds]
    );
    eventRows = eventResult.rows || [];
  }

  const eventState = buildLinkEventStateByLinkId(baseLinks, eventRows);
  return {
    links: baseLinks,
    eventRows,
    ...eventState,
  };
}

async function fetchContractDocumentLinkRowById({
  tenantId,
  linkId,
  runQuery = query,
}) {
  const result = await runQuery(
      `SELECT
          l.id,
          l.tenant_id,
          l.legal_entity_id,
          l.contract_id,
          l.cari_document_id,
          l.link_type,
          l.linked_amount_txn,
          l.linked_amount_base,
          l.contract_currency_code_snapshot,
          l.document_currency_code_snapshot,
          l.link_fx_rate_snapshot,
          COALESCE(SUM(e.delta_amount_txn), 0) AS delta_amount_txn,
          COALESCE(SUM(e.delta_amount_base), 0) AS delta_amount_base,
          SUM(CASE WHEN e.action_type = 'ADJUST' THEN 1 ELSE 0 END) AS adjustment_event_count,
          SUM(CASE WHEN e.action_type = 'UNLINK' THEN 1 ELSE 0 END) AS unlink_event_count,
        l.created_at,
        l.created_by_user_id,
        d.document_no,
        d.direction,
        d.status,
        d.document_date,
        d.amount_txn,
        d.amount_base
     FROM contract_document_links l
     JOIN cari_documents d
       ON d.tenant_id = l.tenant_id
      AND d.legal_entity_id = l.legal_entity_id
      AND d.id = l.cari_document_id
     LEFT JOIN contract_document_link_events e
       ON e.tenant_id = l.tenant_id
      AND e.contract_document_link_id = l.id
     WHERE l.tenant_id = ?
       AND l.id = ?
     GROUP BY
       l.id,
       l.tenant_id,
       l.legal_entity_id,
       l.contract_id,
        l.cari_document_id,
        l.link_type,
        l.linked_amount_txn,
        l.linked_amount_base,
        l.contract_currency_code_snapshot,
        l.document_currency_code_snapshot,
        l.link_fx_rate_snapshot,
        l.created_at,
        l.created_by_user_id,
        d.document_no,
       d.direction,
       d.status,
       d.document_date,
       d.amount_txn,
       d.amount_base
     LIMIT 1`,
    [tenantId, linkId]
  );
  return result.rows?.[0] || null;
}

async function fetchLockedDocumentRowTx({
  tenantId,
  legalEntityId,
  cariDocumentId,
  runQuery,
}) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        direction,
        status,
        document_no,
        document_date,
        amount_txn,
        amount_base,
        currency_code,
        fx_rate
     FROM cari_documents
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, legalEntityId, cariDocumentId]
  );
  return result.rows?.[0] || null;
}

async function fetchContractDocumentLinkBaseRowTx({
  tenantId,
  contractId,
  linkId,
  runQuery,
}) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        contract_id,
        cari_document_id,
        link_type,
        linked_amount_txn,
        linked_amount_base
     FROM contract_document_links
     WHERE tenant_id = ?
       AND contract_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, contractId, linkId]
  );
  return result.rows?.[0] || null;
}

async function insertContractDocumentLinkEventTx({
  tenantId,
  legalEntityId,
  contractId,
  linkId,
  actionType,
  deltaAmountTxn,
  deltaAmountBase,
  reason,
  userId,
  runQuery,
}) {
  const insertResult = await runQuery(
    `INSERT INTO contract_document_link_events (
        tenant_id,
        legal_entity_id,
        contract_id,
        contract_document_link_id,
        action_type,
        delta_amount_txn,
        delta_amount_base,
        reason,
        created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      legalEntityId,
      contractId,
      linkId,
      actionType,
      deltaAmountTxn,
      deltaAmountBase,
      reason,
      userId,
    ]
  );

  const eventId = parsePositiveInt(insertResult.rows?.insertId);
  if (!eventId) {
    throw new Error("Failed to create contract-document link event");
  }
  return eventId;
}

async function validateContractUpsertTx({
  payload,
  runQuery,
}) {
  await assertLegalEntityExists({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    runQuery,
  });
  await assertCurrencyExists({
    currencyCode: payload.currencyCode,
    runQuery,
  });

  const counterparty = await fetchCounterpartyRow({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    counterpartyId: payload.counterpartyId,
    runQuery,
  });
  assertCounterpartyRoleCompatibility(payload.contractType, counterparty);

  await validateContractLineAccountsTx({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    contractType: payload.contractType,
    lines: payload.lines,
    runQuery,
  });
}

function assertLinkDirectionCompatibility(contractType, documentDirection) {
  const normalizedContractType = asUpper(contractType);
  const normalizedDirection = asUpper(documentDirection);
  if (normalizedContractType === CONTRACT_TYPE.CUSTOMER && normalizedDirection !== "AR") {
    throw badRequest("Direction mismatch: CUSTOMER contracts can only link AR documents");
  }
  if (normalizedContractType === CONTRACT_TYPE.VENDOR && normalizedDirection !== "AP") {
    throw badRequest("Direction mismatch: VENDOR contracts can only link AP documents");
  }
}

function assertLifecycleTransition(action, currentStatus) {
  const rule = TRANSITIONS[action];
  if (!rule) {
    throw new Error(`Unsupported contract lifecycle action: ${action}`);
  }
  if (!rule.fromStatuses.has(asUpper(currentStatus))) {
    throw badRequest(`Cannot ${action} contract from status ${currentStatus}`);
  }
  return rule.toStatus;
}

export async function resolveContractScope(contractId, tenantId) {
  const parsedContractId = parsePositiveInt(contractId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedContractId || !parsedTenantId) {
    return null;
  }

  const result = await query(
    `SELECT legal_entity_id
     FROM contracts
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [parsedTenantId, parsedContractId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }

  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: Number(row.legal_entity_id),
  };
}

export async function listContracts({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["c.tenant_id = ?"];
  conditions.push(buildScopeFilter(req, "legal_entity", "c.legal_entity_id", params));

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("c.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.counterpartyId) {
    conditions.push("c.counterparty_id = ?");
    params.push(filters.counterpartyId);
  }
  if (filters.contractType) {
    conditions.push("c.contract_type = ?");
    params.push(filters.contractType);
  }
  if (filters.status) {
    conditions.push("c.status = ?");
    params.push(filters.status);
  }
  if (filters.q) {
    conditions.push("(c.contract_no LIKE ? OR COALESCE(c.notes, '') LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like);
  }

  const whereSql = conditions.join(" AND ");

  const totalResult = await query(
    `SELECT COUNT(*) AS total
     FROM contracts c
     WHERE ${whereSql}`,
    params
  );
  const total = Number(totalResult.rows?.[0]?.total || 0);
  const safeLimit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 100;
  const safeOffset =
    Number.isInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0;

  const listResult = await query(
    `SELECT
        c.id,
        c.tenant_id,
        c.legal_entity_id,
        c.counterparty_id,
        c.contract_no,
        c.contract_type,
        c.status,
        c.version_no,
        c.currency_code,
        c.start_date,
        c.end_date,
        c.total_amount_txn,
        c.total_amount_base,
        c.notes,
        c.created_by_user_id,
        c.created_at,
        c.updated_at,
        (
          SELECT COUNT(*)
          FROM contract_lines cl
          WHERE cl.tenant_id = c.tenant_id
            AND cl.legal_entity_id = c.legal_entity_id
            AND cl.contract_id = c.id
        ) AS line_count
     FROM contracts c
     WHERE ${whereSql}
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    rows: (listResult.rows || []).map((row) => mapContractSummaryRow(row)),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getContractByIdForTenant({
  req,
  tenantId,
  contractId,
  assertScopeAccess,
}) {
  const contract = await fetchContractRow({
    tenantId,
    contractId,
  });
  if (!contract) {
    throw badRequest("Contract not found");
  }

  assertScopeAccess(req, "legal_entity", contract.legal_entity_id, "contractId");

  const linesResult = await query(
    `SELECT
        id,
        tenant_id,
        contract_id,
        line_no,
        description,
        line_amount_txn,
        line_amount_base,
        recognition_method,
        recognition_start_date,
        recognition_end_date,
        deferred_account_id,
        revenue_account_id,
        status,
        created_at,
        updated_at
     FROM contract_lines
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND contract_id = ?
     ORDER BY line_no ASC, id ASC`,
    [tenantId, parsePositiveInt(contract.legal_entity_id), contractId]
  );

  const summary = mapContractSummaryRow(contract);
  return {
    ...summary,
    lines: (linesResult.rows || []).map((lineRow) => mapContractLineRow(lineRow)),
  };
}

export async function createContract({
  req,
  payload,
  assertScopeAccess,
}) {
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");

  try {
    return await withTransaction(async (tx) => {
      await validateContractUpsertTx({
        payload,
        runQuery: tx.query,
      });

      const totals = calculateHeaderTotals(payload.lines);
      const insertResult = await tx.query(
        `INSERT INTO contracts (
            tenant_id,
            legal_entity_id,
            counterparty_id,
            contract_no,
            contract_type,
            status,
            currency_code,
            start_date,
            end_date,
            total_amount_txn,
            total_amount_base,
            notes,
            created_by_user_id
         )
         VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.tenantId,
          payload.legalEntityId,
          payload.counterpartyId,
          payload.contractNo,
          payload.contractType,
          payload.currencyCode,
          payload.startDate,
          payload.endDate,
          totals.totalAmountTxn,
          totals.totalAmountBase,
          payload.notes,
          payload.userId,
        ]
      );

      const contractId = parsePositiveInt(insertResult.rows?.insertId);
      if (!contractId) {
        throw new Error("Failed to create contract");
      }

      await replaceContractLinesTx({
        tenantId: payload.tenantId,
        legalEntityId: payload.legalEntityId,
        contractId,
        lines: payload.lines,
        runQuery: tx.query,
      });

      const created = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId,
        runQuery: tx.query,
      });
      if (!created) {
        throw new Error("Contract create readback failed");
      }

      return mapContractSummaryRow(created);
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_contract_no")) {
      throw badRequest("contractNo must be unique in legalEntity scope");
    }
    throw err;
  }
}

export async function updateContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId: payload.tenantId,
    contractId: payload.contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");

  if (asUpper(existing.status) !== CONTRACT_STATUS.DRAFT) {
    throw badRequest("Only DRAFT contracts can be updated");
  }

  try {
    return await withTransaction(async (tx) => {
      const locked = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!locked) {
        throw badRequest("Contract not found");
      }
      if (asUpper(locked.status) !== CONTRACT_STATUS.DRAFT) {
        throw badRequest("Only DRAFT contracts can be updated");
      }

      await validateContractUpsertTx({
        payload,
        runQuery: tx.query,
      });

      const totals = calculateHeaderTotals(payload.lines);
      await tx.query(
        `UPDATE contracts
         SET legal_entity_id = ?,
             counterparty_id = ?,
             contract_no = ?,
             contract_type = ?,
             currency_code = ?,
             start_date = ?,
             end_date = ?,
             total_amount_txn = ?,
             total_amount_base = ?,
             notes = ?,
             version_no = version_no + 1
         WHERE tenant_id = ?
           AND id = ?`,
        [
          payload.legalEntityId,
          payload.counterpartyId,
          payload.contractNo,
          payload.contractType,
          payload.currencyCode,
          payload.startDate,
          payload.endDate,
          totals.totalAmountTxn,
          totals.totalAmountBase,
          payload.notes,
          payload.tenantId,
          payload.contractId,
        ]
      );

      await replaceContractLinesTx({
        tenantId: payload.tenantId,
        legalEntityId: payload.legalEntityId,
        contractId: payload.contractId,
        lines: payload.lines,
        runQuery: tx.query,
      });

      const updated = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        runQuery: tx.query,
      });
      if (!updated) {
        throw new Error("Contract update readback failed");
      }

      return mapContractSummaryRow(updated);
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_contract_no")) {
      throw badRequest("contractNo must be unique in legalEntity scope");
    }
    throw err;
  }
}

export async function amendContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId: payload.tenantId,
    contractId: payload.contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }

  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");
  assertScopeAccess(req, "legal_entity", payload.legalEntityId, "legalEntityId");

  if (!AMENDABLE_CONTRACT_STATUSES.has(asUpper(existing.status))) {
    throw badRequest("Only ACTIVE or SUSPENDED contracts can be amended");
  }

  try {
    return await withTransaction(async (tx) => {
      const locked = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!locked) {
        throw badRequest("Contract not found");
      }
      if (!AMENDABLE_CONTRACT_STATUSES.has(asUpper(locked.status))) {
        throw badRequest("Only ACTIVE or SUSPENDED contracts can be amended");
      }

      await validateContractUpsertTx({
        payload,
        runQuery: tx.query,
      });

      const totals = calculateHeaderTotals(payload.lines);
      await tx.query(
        `UPDATE contracts
         SET legal_entity_id = ?,
             counterparty_id = ?,
             contract_no = ?,
             contract_type = ?,
             currency_code = ?,
             start_date = ?,
             end_date = ?,
             total_amount_txn = ?,
             total_amount_base = ?,
             notes = ?,
             version_no = version_no + 1
         WHERE tenant_id = ?
           AND id = ?`,
        [
          payload.legalEntityId,
          payload.counterpartyId,
          payload.contractNo,
          payload.contractType,
          payload.currencyCode,
          payload.startDate,
          payload.endDate,
          totals.totalAmountTxn,
          totals.totalAmountBase,
          payload.notes,
          payload.tenantId,
          payload.contractId,
        ]
      );

      await replaceContractLinesTx({
        tenantId: payload.tenantId,
        legalEntityId: payload.legalEntityId,
        contractId: payload.contractId,
        lines: payload.lines,
        runQuery: tx.query,
      });

      const updated = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        runQuery: tx.query,
      });
      if (!updated) {
        throw new Error("Contract amendment readback failed");
      }

      await insertContractAmendmentTx({
        tenantId: payload.tenantId,
        legalEntityId: parsePositiveInt(updated.legal_entity_id),
        contractId: payload.contractId,
        versionNo: Number(updated.version_no || 1),
        amendmentType: CONTRACT_AMENDMENT_TYPE.FULL_REPLACE,
        reason: payload.reason,
        payload: {
          previousVersionNo: Number(locked.version_no || 1),
          nextVersionNo: Number(updated.version_no || 1),
          contractStatusBefore: locked.status,
          contractStatusAfter: updated.status,
          lineCountAfter: Array.isArray(payload.lines) ? payload.lines.length : 0,
        },
        userId: payload.userId,
        runQuery: tx.query,
      });

      return mapContractSummaryRow(updated);
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_contract_no")) {
      throw badRequest("contractNo must be unique in legalEntity scope");
    }
    throw err;
  }
}

export async function patchContractLineById({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId: payload.tenantId,
    contractId: payload.contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");

  return withTransaction(async (tx) => {
    const locked = await fetchContractRow({
      tenantId: payload.tenantId,
      contractId: payload.contractId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!locked) {
      throw badRequest("Contract not found");
    }
    if (!LINE_PATCHABLE_CONTRACT_STATUSES.has(asUpper(locked.status))) {
      throw badRequest("Only DRAFT, ACTIVE, or SUSPENDED contracts can patch lines");
    }

    const currentLine = await fetchContractLineRowById({
      tenantId: payload.tenantId,
      legalEntityId: parsePositiveInt(locked.legal_entity_id),
      contractId: payload.contractId,
      lineId: payload.lineId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!currentLine) {
      throw badRequest("Contract line not found");
    }

    const mergedLine = {
      description: String(currentLine.description || "").trim(),
      lineAmountTxn: Number(currentLine.line_amount_txn || 0),
      lineAmountBase: Number(currentLine.line_amount_base || 0),
      recognitionMethod: asUpper(currentLine.recognition_method) || "STRAIGHT_LINE",
      recognitionStartDate: toDateOnlyString(
        currentLine.recognition_start_date,
        "recognitionStartDate"
      ),
      recognitionEndDate: toDateOnlyString(
        currentLine.recognition_end_date,
        "recognitionEndDate"
      ),
      deferredAccountId: parsePositiveInt(currentLine.deferred_account_id),
      revenueAccountId: parsePositiveInt(currentLine.revenue_account_id),
      status: asUpper(currentLine.status) || "ACTIVE",
    };

    if (payload.patch.description !== undefined) {
      mergedLine.description = String(payload.patch.description || "").trim();
    }
    if (payload.patch.lineAmountTxn !== undefined) {
      mergedLine.lineAmountTxn = Number(payload.patch.lineAmountTxn || 0);
    }
    if (payload.patch.lineAmountBase !== undefined) {
      mergedLine.lineAmountBase = Number(payload.patch.lineAmountBase || 0);
    }
    if (payload.patch.recognitionMethod !== undefined) {
      mergedLine.recognitionMethod = asUpper(payload.patch.recognitionMethod) || "STRAIGHT_LINE";
    }
    if (payload.patch.recognitionStartDate !== undefined) {
      mergedLine.recognitionStartDate = payload.patch.recognitionStartDate || null;
    }
    if (payload.patch.recognitionEndDate !== undefined) {
      mergedLine.recognitionEndDate = payload.patch.recognitionEndDate || null;
    }
    if (payload.patch.deferredAccountId !== undefined) {
      mergedLine.deferredAccountId = payload.patch.deferredAccountId;
    }
    if (payload.patch.revenueAccountId !== undefined) {
      mergedLine.revenueAccountId = payload.patch.revenueAccountId;
    }
    if (payload.patch.status !== undefined) {
      mergedLine.status = asUpper(payload.patch.status);
    }

    if (!mergedLine.description) {
      throw badRequest("description is required");
    }
    if (
      !Number.isFinite(mergedLine.lineAmountTxn) ||
      Math.abs(mergedLine.lineAmountTxn) <= EPSILON
    ) {
      throw badRequest("lineAmountTxn must be non-zero");
    }
    if (
      !Number.isFinite(mergedLine.lineAmountBase) ||
      Math.abs(mergedLine.lineAmountBase) <= EPSILON
    ) {
      throw badRequest("lineAmountBase must be non-zero");
    }
    if (!["STRAIGHT_LINE", "MILESTONE", "MANUAL"].includes(mergedLine.recognitionMethod)) {
      throw badRequest("recognitionMethod must be STRAIGHT_LINE, MILESTONE, or MANUAL");
    }
    if (!["ACTIVE", "INACTIVE"].includes(mergedLine.status)) {
      throw badRequest("status must be ACTIVE or INACTIVE");
    }
    assertLineRecognitionDates(mergedLine, "linePatch");

    await validateContractLineAccountsTx({
      tenantId: payload.tenantId,
      legalEntityId: parsePositiveInt(locked.legal_entity_id),
      contractType: locked.contract_type,
      lines: [mergedLine],
      runQuery: tx.query,
    });

    await tx.query(
      `UPDATE contract_lines
       SET description = ?,
           line_amount_txn = ?,
           line_amount_base = ?,
           recognition_method = ?,
           recognition_start_date = ?,
           recognition_end_date = ?,
           deferred_account_id = ?,
           revenue_account_id = ?,
           status = ?
       WHERE tenant_id = ?
         AND contract_id = ?
         AND id = ?`,
      [
        mergedLine.description,
        toFixedAmount(mergedLine.lineAmountTxn),
        toFixedAmount(mergedLine.lineAmountBase),
        mergedLine.recognitionMethod,
        mergedLine.recognitionStartDate,
        mergedLine.recognitionEndDate,
        mergedLine.deferredAccountId,
        mergedLine.revenueAccountId,
        mergedLine.status,
        payload.tenantId,
        payload.contractId,
        payload.lineId,
      ]
    );

    const lineRows = await listContractLineRowsByContractId({
      tenantId: payload.tenantId,
      legalEntityId: parsePositiveInt(locked.legal_entity_id),
      contractId: payload.contractId,
      runQuery: tx.query,
    });
    const totals = calculateHeaderTotals(mapLineRowsForHeaderTotals(lineRows));

    await tx.query(
      `UPDATE contracts
       SET total_amount_txn = ?,
           total_amount_base = ?,
           version_no = version_no + 1
       WHERE tenant_id = ?
         AND id = ?`,
      [totals.totalAmountTxn, totals.totalAmountBase, payload.tenantId, payload.contractId]
    );

    const updatedContract = await fetchContractRow({
      tenantId: payload.tenantId,
      contractId: payload.contractId,
      runQuery: tx.query,
    });
    if (!updatedContract) {
      throw new Error("Contract line patch readback failed");
    }

    const updatedLine = await fetchContractLineRowById({
      tenantId: payload.tenantId,
      legalEntityId: parsePositiveInt(updatedContract.legal_entity_id),
      contractId: payload.contractId,
      lineId: payload.lineId,
      runQuery: tx.query,
    });
    if (!updatedLine) {
      throw new Error("Patched contract line readback failed");
    }

    await insertContractAmendmentTx({
      tenantId: payload.tenantId,
      legalEntityId: parsePositiveInt(updatedContract.legal_entity_id),
      contractId: payload.contractId,
      versionNo: Number(updatedContract.version_no || 1),
      amendmentType: CONTRACT_AMENDMENT_TYPE.LINE_PATCH,
      reason: payload.reason,
      payload: {
        previousVersionNo: Number(locked.version_no || 1),
        nextVersionNo: Number(updatedContract.version_no || 1),
        lineId: payload.lineId,
        changedFields: Object.keys(payload.patch || {}),
        before: mapContractLineRow(currentLine),
        after: mapContractLineRow(updatedLine),
      },
      userId: payload.userId,
      runQuery: tx.query,
    });

    return {
      row: mapContractSummaryRow(updatedContract),
      line: mapContractLineRow(updatedLine),
    };
  });
}

export async function listContractAmendments({
  req,
  tenantId,
  contractId,
  assertScopeAccess,
}) {
  const contract = await fetchContractRow({
    tenantId,
    contractId,
  });
  if (!contract) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", contract.legal_entity_id, "contractId");

  const result = await query(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        contract_id,
        version_no,
        amendment_type,
        reason,
        payload_json,
        created_by_user_id,
        created_at
     FROM contract_amendments
     WHERE tenant_id = ?
       AND contract_id = ?
     ORDER BY version_no DESC, id DESC`,
    [tenantId, contractId]
  );

  return (result.rows || []).map((row) => mapContractAmendmentRow(row));
}

async function transitionContractStatus({
  req,
  tenantId,
  contractId,
  action,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId,
    contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");

  return withTransaction(async (tx) => {
    const locked = await fetchContractRow({
      tenantId,
      contractId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!locked) {
      throw badRequest("Contract not found");
    }
    const nextStatus = assertLifecycleTransition(action, locked.status);

    await tx.query(
      `UPDATE contracts
       SET status = ?
       WHERE tenant_id = ?
         AND id = ?`,
      [nextStatus, tenantId, contractId]
    );

    const updated = await fetchContractRow({
      tenantId,
      contractId,
      runQuery: tx.query,
    });
    if (!updated) {
      throw new Error("Contract lifecycle update readback failed");
    }
    return mapContractSummaryRow(updated);
  });
}

export async function activateContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  return transitionContractStatus({
    req,
    tenantId: payload.tenantId,
    contractId: payload.contractId,
    action: "activate",
    assertScopeAccess,
  });
}

export async function suspendContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  return transitionContractStatus({
    req,
    tenantId: payload.tenantId,
    contractId: payload.contractId,
    action: "suspend",
    assertScopeAccess,
  });
}

export async function closeContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  return transitionContractStatus({
    req,
    tenantId: payload.tenantId,
    contractId: payload.contractId,
    action: "close",
    assertScopeAccess,
  });
}

export async function cancelContractById({
  req,
  payload,
  assertScopeAccess,
}) {
  return transitionContractStatus({
    req,
    tenantId: payload.tenantId,
    contractId: payload.contractId,
    action: "cancel",
    assertScopeAccess,
  });
}

export async function linkDocumentToContract({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId: payload.tenantId,
    contractId: payload.contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");

  try {
    return await withTransaction(async (tx) => {
      const contract = await fetchContractRow({
        tenantId: payload.tenantId,
        contractId: payload.contractId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!contract) {
        throw badRequest("Contract not found");
      }
      if (!LINKABLE_CONTRACT_STATUSES.has(asUpper(contract.status))) {
        throw badRequest(
          `Contract status ${contract.status} is not eligible for linking`
        );
      }

      const documentRow = await fetchLockedDocumentRowTx({
        tenantId: payload.tenantId,
        legalEntityId: contract.legal_entity_id,
        cariDocumentId: payload.cariDocumentId,
        runQuery: tx.query,
      });
      if (!documentRow) {
        throw badRequest("cariDocumentId must belong to contract legalEntityId");
      }
      if (!LINKABLE_DOCUMENT_STATUSES.has(asUpper(documentRow.status))) {
        throw badRequest(`Document status ${documentRow.status} is not linkable`);
      }

      assertLinkDirectionCompatibility(contract.contract_type, documentRow.direction);
      const contractCurrencyCodeSnapshot = asUpper(contract.currency_code);
      const documentCurrencyCodeSnapshot = asUpper(documentRow.currency_code);
      const linkFxRateSnapshot = resolveLinkFxRateSnapshot({
        contractCurrencyCode: contractCurrencyCodeSnapshot,
        documentCurrencyCode: documentCurrencyCodeSnapshot,
        linkedAmountTxn: payload.linkedAmountTxn,
        linkedAmountBase: payload.linkedAmountBase,
        requestedFxRate: payload.linkFxRate,
        documentFxRate: documentRow.fx_rate,
      });

      const documentLinkState = await loadDocumentLinkEventStateTx({
        tenantId: payload.tenantId,
        legalEntityId: contract.legal_entity_id,
        cariDocumentId: payload.cariDocumentId,
        runQuery: tx.query,
      });

      const alreadyLinkedSameTuple = documentLinkState.links.some(
        (row) =>
          parsePositiveInt(row.contract_id) === parsePositiveInt(payload.contractId) &&
          asUpper(row.link_type) === asUpper(payload.linkType)
      );
      if (alreadyLinkedSameTuple) {
        throw badRequest(
          "A link already exists for this (contractId, cariDocumentId, linkType) tuple"
        );
      }

      const currentLinkedTxn = Number(documentLinkState.totalEffectiveTxn || 0);
      const currentLinkedBase = Number(documentLinkState.totalEffectiveBase || 0);

      const nextTxn = currentLinkedTxn + Number(payload.linkedAmountTxn || 0);
      const nextBase = currentLinkedBase + Number(payload.linkedAmountBase || 0);
      const documentAmountTxn = Number(documentRow.amount_txn || 0);
      const documentAmountBase = Number(documentRow.amount_base || 0);

      if (nextTxn - documentAmountTxn > EPSILON) {
        throw badRequest("linkedAmountTxn exceeds source document amount cap");
      }
      if (nextBase - documentAmountBase > EPSILON) {
        throw badRequest("linkedAmountBase exceeds source document amount cap");
      }

      const insertResult = await tx.query(
        `INSERT INTO contract_document_links (
            tenant_id,
            legal_entity_id,
            contract_id,
            cari_document_id,
            link_type,
            linked_amount_txn,
            linked_amount_base,
            contract_currency_code_snapshot,
            document_currency_code_snapshot,
            link_fx_rate_snapshot,
            created_by_user_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.tenantId,
          contract.legal_entity_id,
          payload.contractId,
          payload.cariDocumentId,
          payload.linkType,
          payload.linkedAmountTxn,
          payload.linkedAmountBase,
          contractCurrencyCodeSnapshot,
          documentCurrencyCodeSnapshot,
          linkFxRateSnapshot,
          payload.userId,
        ]
      );

      const linkId = parsePositiveInt(insertResult.rows?.insertId);
      if (!linkId) {
        throw new Error("Failed to create contract-document link");
      }

      const createdLink = await fetchContractDocumentLinkRowById({
        tenantId: payload.tenantId,
        linkId,
        runQuery: tx.query,
      });
      if (!createdLink) {
        throw new Error("Contract-document link readback failed");
      }

      await insertContractAuditLog({
        req,
        runQuery: tx.query,
        tenantId: payload.tenantId,
        userId: payload.userId,
        action: AUDIT_ACTIONS.LINK_CREATE,
        legalEntityId: contract.legal_entity_id,
        linkId,
        payload: {
          contractId: payload.contractId,
          cariDocumentId: payload.cariDocumentId,
          linkType: payload.linkType,
          linkedAmountTxn: toDecimalNumber(payload.linkedAmountTxn),
          linkedAmountBase: toDecimalNumber(payload.linkedAmountBase),
          contractCurrencyCodeSnapshot,
          documentCurrencyCodeSnapshot,
          linkFxRateSnapshot: toDecimalNumber(linkFxRateSnapshot),
        },
      });

      return mapContractDocumentLinkRow(createdLink);
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_contract_doc_link")) {
      throw badRequest(
        "A link already exists for this (contractId, cariDocumentId, linkType) tuple"
      );
    }
    throw err;
  }
}

export async function adjustContractDocumentLink({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId: payload.tenantId,
    contractId: payload.contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");

  return withTransaction(async (tx) => {
    const contract = await fetchContractRow({
      tenantId: payload.tenantId,
      contractId: payload.contractId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!contract) {
      throw badRequest("Contract not found");
    }
    if (!LINK_CORRECTION_CONTRACT_STATUSES.has(asUpper(contract.status))) {
      throw badRequest(
        `Contract status ${contract.status} is not eligible for link correction`
      );
    }

    const linkBase = await fetchContractDocumentLinkBaseRowTx({
      tenantId: payload.tenantId,
      contractId: payload.contractId,
      linkId: payload.linkId,
      runQuery: tx.query,
    });
    if (!linkBase) {
      throw badRequest("Contract document link not found");
    }

    const documentRow = await fetchLockedDocumentRowTx({
      tenantId: payload.tenantId,
      legalEntityId: linkBase.legal_entity_id,
      cariDocumentId: linkBase.cari_document_id,
      runQuery: tx.query,
    });
    if (!documentRow) {
      throw badRequest("Linked cari document not found");
    }

    const linkState = await loadDocumentLinkEventStateTx({
      tenantId: payload.tenantId,
      legalEntityId: linkBase.legal_entity_id,
      cariDocumentId: linkBase.cari_document_id,
      runQuery: tx.query,
    });

    const targetState = linkState.byLinkId.get(payload.linkId);
    if (!targetState) {
      throw badRequest("Contract document link state not found");
    }
    if (targetState.unlinkCount > 0) {
      throw badRequest("Cannot adjust an unlinked contract document link");
    }

    const currentTxn = Number(targetState.effectiveTxn || 0);
    const currentBase = Number(targetState.effectiveBase || 0);
    const nextTxn = Number(payload.nextLinkedAmountTxn || 0);
    const nextBase = Number(payload.nextLinkedAmountBase || 0);

    if (nextTxn <= EPSILON || nextBase <= EPSILON) {
      throw badRequest(
        "nextLinkedAmountTxn and nextLinkedAmountBase must be > 0; use unlink endpoint for full removal"
      );
    }
    if (Math.abs(nextTxn - currentTxn) <= EPSILON && Math.abs(nextBase - currentBase) <= EPSILON) {
      throw badRequest("Requested link adjustment is a no-op");
    }

    const nextDocumentLinkedTxn = linkState.totalEffectiveTxn - currentTxn + nextTxn;
    const nextDocumentLinkedBase = linkState.totalEffectiveBase - currentBase + nextBase;
    const documentAmountTxn = Number(documentRow.amount_txn || 0);
    const documentAmountBase = Number(documentRow.amount_base || 0);
    if (nextDocumentLinkedTxn - documentAmountTxn > EPSILON) {
      throw badRequest("nextLinkedAmountTxn exceeds source document amount cap");
    }
    if (nextDocumentLinkedBase - documentAmountBase > EPSILON) {
      throw badRequest("nextLinkedAmountBase exceeds source document amount cap");
    }

    const deltaTxn = normalizeNearZero(nextTxn - currentTxn);
    const deltaBase = normalizeNearZero(nextBase - currentBase);
    if (Math.abs(deltaTxn) <= EPSILON && Math.abs(deltaBase) <= EPSILON) {
      throw badRequest("Requested link adjustment is a no-op");
    }

    await insertContractDocumentLinkEventTx({
      tenantId: payload.tenantId,
      legalEntityId: linkBase.legal_entity_id,
      contractId: payload.contractId,
      linkId: payload.linkId,
      actionType: LINK_EVENT_ACTION.ADJUST,
      deltaAmountTxn: toSignedFixedAmount(deltaTxn, "deltaAmountTxn"),
      deltaAmountBase: toSignedFixedAmount(deltaBase, "deltaAmountBase"),
      reason: payload.reason,
      userId: payload.userId,
      runQuery: tx.query,
    });

    const updatedLink = await fetchContractDocumentLinkRowById({
      tenantId: payload.tenantId,
      linkId: payload.linkId,
      runQuery: tx.query,
    });
    if (!updatedLink) {
      throw new Error("Adjusted contract-document link readback failed");
    }

    await insertContractAuditLog({
      req,
      runQuery: tx.query,
      tenantId: payload.tenantId,
      userId: payload.userId,
      action: AUDIT_ACTIONS.LINK_ADJUST,
      legalEntityId: linkBase.legal_entity_id,
      linkId: payload.linkId,
      payload: {
        contractId: payload.contractId,
        cariDocumentId: parsePositiveInt(linkBase.cari_document_id),
        linkType: linkBase.link_type,
        previousLinkedAmountTxn: currentTxn,
        previousLinkedAmountBase: currentBase,
        nextLinkedAmountTxn: nextTxn,
        nextLinkedAmountBase: nextBase,
        deltaAmountTxn: deltaTxn,
        deltaAmountBase: deltaBase,
        reason: payload.reason,
      },
    });

    return mapContractDocumentLinkRow(updatedLink);
  });
}

export async function unlinkContractDocumentLink({
  req,
  payload,
  assertScopeAccess,
}) {
  const existing = await fetchContractRow({
    tenantId: payload.tenantId,
    contractId: payload.contractId,
  });
  if (!existing) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", existing.legal_entity_id, "contractId");

  return withTransaction(async (tx) => {
    const contract = await fetchContractRow({
      tenantId: payload.tenantId,
      contractId: payload.contractId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!contract) {
      throw badRequest("Contract not found");
    }
    if (!LINK_CORRECTION_CONTRACT_STATUSES.has(asUpper(contract.status))) {
      throw badRequest(
        `Contract status ${contract.status} is not eligible for link correction`
      );
    }

    const linkBase = await fetchContractDocumentLinkBaseRowTx({
      tenantId: payload.tenantId,
      contractId: payload.contractId,
      linkId: payload.linkId,
      runQuery: tx.query,
    });
    if (!linkBase) {
      throw badRequest("Contract document link not found");
    }

    const documentRow = await fetchLockedDocumentRowTx({
      tenantId: payload.tenantId,
      legalEntityId: linkBase.legal_entity_id,
      cariDocumentId: linkBase.cari_document_id,
      runQuery: tx.query,
    });
    if (!documentRow) {
      throw badRequest("Linked cari document not found");
    }

    const linkState = await loadDocumentLinkEventStateTx({
      tenantId: payload.tenantId,
      legalEntityId: linkBase.legal_entity_id,
      cariDocumentId: linkBase.cari_document_id,
      runQuery: tx.query,
    });

    const targetState = linkState.byLinkId.get(payload.linkId);
    if (!targetState) {
      throw badRequest("Contract document link state not found");
    }
    if (targetState.unlinkCount > 0) {
      throw badRequest("Contract document link is already unlinked");
    }

    const currentTxn = Number(targetState.effectiveTxn || 0);
    const currentBase = Number(targetState.effectiveBase || 0);
    if (currentTxn <= EPSILON && currentBase <= EPSILON) {
      throw badRequest("Contract document link has no remaining amount to unlink");
    }

    const deltaTxn = normalizeNearZero(currentTxn * -1);
    const deltaBase = normalizeNearZero(currentBase * -1);
    await insertContractDocumentLinkEventTx({
      tenantId: payload.tenantId,
      legalEntityId: linkBase.legal_entity_id,
      contractId: payload.contractId,
      linkId: payload.linkId,
      actionType: LINK_EVENT_ACTION.UNLINK,
      deltaAmountTxn: toSignedFixedAmount(deltaTxn, "deltaAmountTxn"),
      deltaAmountBase: toSignedFixedAmount(deltaBase, "deltaAmountBase"),
      reason: payload.reason,
      userId: payload.userId,
      runQuery: tx.query,
    });

    const updatedLink = await fetchContractDocumentLinkRowById({
      tenantId: payload.tenantId,
      linkId: payload.linkId,
      runQuery: tx.query,
    });
    if (!updatedLink) {
      throw new Error("Unlinked contract-document link readback failed");
    }

    await insertContractAuditLog({
      req,
      runQuery: tx.query,
      tenantId: payload.tenantId,
      userId: payload.userId,
      action: AUDIT_ACTIONS.LINK_UNLINK,
      legalEntityId: linkBase.legal_entity_id,
      linkId: payload.linkId,
      payload: {
        contractId: payload.contractId,
        cariDocumentId: parsePositiveInt(linkBase.cari_document_id),
        linkType: linkBase.link_type,
        previousLinkedAmountTxn: currentTxn,
        previousLinkedAmountBase: currentBase,
        deltaAmountTxn: deltaTxn,
        deltaAmountBase: deltaBase,
        reason: payload.reason,
      },
    });

    return mapContractDocumentLinkRow(updatedLink);
  });
}

export async function listContractDocumentLinks({
  req,
  tenantId,
  contractId,
  assertScopeAccess,
}) {
  const contract = await fetchContractRow({
    tenantId,
    contractId,
  });
  if (!contract) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", contract.legal_entity_id, "contractId");

  const result = await query(
      `SELECT
          l.id,
          l.tenant_id,
          l.legal_entity_id,
          l.contract_id,
          l.cari_document_id,
          l.link_type,
          l.linked_amount_txn,
          l.linked_amount_base,
          l.contract_currency_code_snapshot,
          l.document_currency_code_snapshot,
          l.link_fx_rate_snapshot,
          COALESCE(SUM(e.delta_amount_txn), 0) AS delta_amount_txn,
          COALESCE(SUM(e.delta_amount_base), 0) AS delta_amount_base,
          SUM(CASE WHEN e.action_type = 'ADJUST' THEN 1 ELSE 0 END) AS adjustment_event_count,
          SUM(CASE WHEN e.action_type = 'UNLINK' THEN 1 ELSE 0 END) AS unlink_event_count,
        l.created_at,
        l.created_by_user_id,
        d.document_no,
        d.direction,
        d.status,
        d.document_date,
        d.amount_txn,
        d.amount_base
     FROM contract_document_links l
     JOIN cari_documents d
       ON d.tenant_id = l.tenant_id
      AND d.legal_entity_id = l.legal_entity_id
      AND d.id = l.cari_document_id
     LEFT JOIN contract_document_link_events e
       ON e.tenant_id = l.tenant_id
      AND e.contract_document_link_id = l.id
     WHERE l.tenant_id = ?
       AND l.contract_id = ?
     GROUP BY
       l.id,
       l.tenant_id,
       l.legal_entity_id,
       l.contract_id,
        l.cari_document_id,
        l.link_type,
        l.linked_amount_txn,
        l.linked_amount_base,
        l.contract_currency_code_snapshot,
        l.document_currency_code_snapshot,
        l.link_fx_rate_snapshot,
        l.created_at,
        l.created_by_user_id,
        d.document_no,
       d.direction,
       d.status,
       d.document_date,
       d.amount_txn,
       d.amount_base
     ORDER BY l.created_at DESC, l.id DESC`,
    [tenantId, contractId]
  );

  return (result.rows || []).map((row) => mapContractDocumentLinkRow(row));
}

export async function listContractLinkableDocuments({
  req,
  tenantId,
  contractId,
  q,
  limit = 100,
  offset = 0,
  assertScopeAccess,
}) {
  const contract = await fetchContractRow({
    tenantId,
    contractId,
  });
  if (!contract) {
    throw badRequest("Contract not found");
  }
  assertScopeAccess(req, "legal_entity", contract.legal_entity_id, "contractId");

  const direction = asUpper(contract.contract_type) === CONTRACT_TYPE.VENDOR ? "AP" : "AR";
  const statuses = Array.from(LINKABLE_DOCUMENT_STATUSES);
  const statusPlaceholders = inClausePlaceholders(statuses);
  const normalizedLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 100;
  const normalizedOffset =
    Number.isInteger(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;

  const params = [tenantId, contract.legal_entity_id, direction, ...statuses];
  const conditions = [
    "d.tenant_id = ?",
    "d.legal_entity_id = ?",
    "d.direction = ?",
    `d.status IN (${statusPlaceholders})`,
  ];

  if (q) {
    const like = `%${q}%`;
    conditions.push(
      "(d.document_no LIKE ? OR COALESCE(d.counterparty_code_snapshot, '') LIKE ? OR COALESCE(d.counterparty_name_snapshot, '') LIKE ?)"
    );
    params.push(like, like, like);
  }

  const result = await query(
    `SELECT
        d.id,
        d.document_no,
        d.direction,
        d.status,
        d.document_date,
        d.currency_code,
        d.amount_txn,
        d.amount_base,
        d.open_amount_txn,
        d.open_amount_base,
        d.fx_rate
     FROM cari_documents d
     WHERE ${conditions.join(" AND ")}
     ORDER BY d.document_date DESC, d.id DESC
     LIMIT ${normalizedLimit}
     OFFSET ${normalizedOffset}`,
    params
  );

  return (result.rows || []).map((row) => mapContractLinkableDocumentRow(row));
}
