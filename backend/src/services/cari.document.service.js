import { query, withTransaction } from "../db.js";
import {
  assertAccountBelongsToTenant,
  assertCurrencyExists,
  assertLegalEntityBelongsToTenant,
} from "../tenantGuards.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  buildOffsetPaginationResult,
  resolveOffsetPagination,
} from "../utils/pagination.js";
import { autoRemapCariPurposeMappingsForLegalEntity } from "./cari.purpose-mapping-autofix.service.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";
import {
  buildCariTaxAugmentation,
  buildCariTaxAugmentationFromStoredLineTaxes,
  resolveCariTaxComputation,
} from "./cari.tax.integration.service.js";
import {
  assertStrictStockDocumentPostingReadiness,
  listActiveWarehousesForOwnershipContext,
  resolveWarehouseForOwnershipContext,
} from "./inventory.service.js";
import { resolveItemCardLineDefaults } from "./item.card.service.js";
import {
  deriveOwnershipContextFromOperatingUnitId,
  isStockAffectingLine,
  isStockAffectingLineMode,
  normalizeStockImpactMode,
} from "./ownership.context.policy.service.js";
import { deriveStockLinkReadState } from "./stock.link.read-state.service.js";

const DRAFT_STATUS = "DRAFT";
const CANCELLED_STATUS = "CANCELLED";
const POSTED_STATUS = "POSTED";
const REVERSED_STATUS = "REVERSED";
const OPEN_ITEM_STATUS_OPEN = "OPEN";
const OPEN_ITEM_STATUS_CANCELLED = "CANCELLED";
const DRAFT_SEQUENCE_NAMESPACE = "DRAFT";
const FX_RATE_TYPE_SPOT = "SPOT";
const AMOUNT_PRECISION_SCALE = 6;
const AMOUNT_BALANCE_EPSILON = 0.000001;
const CARI_SUBLEDGER_REFERENCE_PREFIX = "CARI_DOC:";
const CARI_SUBLEDGER_REVERSE_REFERENCE_PREFIX = "CARI_DOC_REV:";
const CARI_POSTING_PURPOSES = Object.freeze({
  AR: Object.freeze({
    control: "CARI_AR_CONTROL",
    offset: "CARI_AR_OFFSET",
  }),
  AP: Object.freeze({
    control: "CARI_AP_CONTROL",
    offset: "CARI_AP_OFFSET",
  }),
});
const POSITIVE_SIGN_DOCUMENT_TYPES = new Set(["INVOICE", "DEBIT_NOTE"]);
const DUE_DATE_REQUIRED_TYPES = new Set(["INVOICE", "DEBIT_NOTE"]);
const FROZEN_TRANSACTION_KEYS = new Set([
  "AR:INVOICE",
  "AR:DEBIT_NOTE",
  "AR:CREDIT_NOTE",
  "AR:PAYMENT",
  "AR:ADJUSTMENT",
  "AP:INVOICE",
  "AP:DEBIT_NOTE",
  "AP:CREDIT_NOTE",
  "AP:PAYMENT",
  "AP:ADJUSTMENT",
]);
const STOCK_LINK_STATUS_PENDING = "PENDING";
const STOCK_LINK_STATUS_VOID = "VOID";

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
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
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
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function normalizeAmount(value, label = "amount", { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  if (allowZero ? parsed < 0 : parsed <= 0) {
    throw badRequest(
      allowZero ? `${label} must be >= 0` : `${label} must be > 0`
    );
  }
  return Number(parsed.toFixed(AMOUNT_PRECISION_SCALE));
}

function normalizeSignedAmount(value, label = "amount", { allowZero = true } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  if (!allowZero && Math.abs(parsed) <= AMOUNT_BALANCE_EPSILON) {
    throw badRequest(`${label} must not be zero`);
  }
  return Number(parsed.toFixed(AMOUNT_PRECISION_SCALE));
}

function normalizeOptionalPositiveDecimal(value, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${label} must be a numeric value greater than 0`);
  }
  return Number(parsed.toFixed(10));
}

function amountsAreEqual(left, right, epsilon = 0.0000001) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function ensureBalancedJournalLines(lines) {
  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of lines || []) {
    debitTotal += Number(line.debitBase || 0);
    creditTotal += Number(line.creditBase || 0);
  }
  if (Math.abs(debitTotal - creditTotal) > AMOUNT_BALANCE_EPSILON) {
    throw badRequest("Cari posting journal is not balanced");
  }
  return {
    totalDebit: Number(debitTotal.toFixed(AMOUNT_PRECISION_SCALE)),
    totalCredit: Number(creditTotal.toFixed(AMOUNT_PRECISION_SCALE)),
  };
}

function buildCariJournalNo(prefix, documentId) {
  const normalizedPrefix = normalizeUpperText(prefix || "CARI").slice(0, 12) || "CARI";
  const parsedDocumentId = parsePositiveInt(documentId);
  const stamp = Date.now().toString(36).toUpperCase();
  const base = parsedDocumentId
    ? `${normalizedPrefix}-${parsedDocumentId}-${stamp}`
    : `${normalizedPrefix}-${stamp}`;
  return base.slice(0, 40);
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

function normalizeDateInput(value, label) {
  const normalized = toDateOnlyString(value, label);
  if (!normalized) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  return normalized;
}

function addDays(dateString, daysToAdd) {
  const normalizedDate = normalizeDateInput(dateString, "documentDate");
  const utcDate = new Date(`${normalizedDate}T00:00:00.000Z`);
  if (Number.isNaN(utcDate.getTime())) {
    throw badRequest("documentDate must be a valid date");
  }

  const parsedDays = Number(daysToAdd || 0);
  if (!Number.isFinite(parsedDays)) {
    throw badRequest("payment term due/grace days must be numeric");
  }
  utcDate.setUTCDate(utcDate.getUTCDate() + parsedDays);
  return utcDate.toISOString().slice(0, 10);
}

function mapDocumentRow(row, { lines } = {}) {
  const documentDate = toDateOnlyString(row.document_date, "documentDate");
  const dueDate = toDateOnlyString(row.due_date, "dueDate");
  const dueDateSnapshot = toDateOnlyString(row.due_date_snapshot, "dueDateSnapshot");
  const mapped = {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
    counterpartyId: parsePositiveInt(row.counterparty_id),
    paymentTermId: parsePositiveInt(row.payment_term_id),
    paymentTermCode: row.payment_term_code || null,
    paymentTermName: row.payment_term_name || null,
    direction: row.direction,
    documentType: row.document_type,
    sequenceNamespace: row.sequence_namespace,
    fiscalYear: Number(row.fiscal_year),
    sequenceNo: Number(row.sequence_no),
    documentNo: row.document_no,
    status: row.status,
    documentDate,
    dueDate,
    subtotalAmountTxn: toDecimalNumber(row.subtotal_amount_txn),
    subtotalAmountBase: toDecimalNumber(row.subtotal_amount_base),
    taxAmountTxn: toDecimalNumber(row.tax_amount_txn),
    taxAmountBase: toDecimalNumber(row.tax_amount_base),
    grossAmountTxn: toDecimalNumber(row.gross_amount_txn ?? row.amount_txn),
    grossAmountBase: toDecimalNumber(row.gross_amount_base ?? row.amount_base),
    amountTxn: toDecimalNumber(row.amount_txn),
    amountBase: toDecimalNumber(row.amount_base),
    openAmountTxn: toDecimalNumber(row.open_amount_txn),
    openAmountBase: toDecimalNumber(row.open_amount_base),
    currencyCode: row.currency_code,
    fxRate: toDecimalNumber(row.fx_rate),
    counterpartyCodeSnapshot: row.counterparty_code_snapshot || null,
    counterpartyNameSnapshot: row.counterparty_name_snapshot || null,
    paymentTermSnapshot: row.payment_term_snapshot || null,
    dueDateSnapshot,
    currencyCodeSnapshot: row.currency_code_snapshot || null,
    fxRateSnapshot: toDecimalNumber(row.fx_rate_snapshot),
    postedJournalEntryId: parsePositiveInt(row.posted_journal_entry_id),
    reversalOfDocumentId: parsePositiveInt(row.reversal_of_document_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    rowVersion: Number(row.row_version || 1),
    postedAt: row.posted_at || null,
    reversedAt: row.reversed_at || null,
    draftSequenceAssigned: row.sequence_namespace === DRAFT_SEQUENCE_NAMESPACE,
  };
  if (lines !== undefined) {
    mapped.lines = Array.isArray(lines) ? lines : [];
    mapped.lineCount = mapped.lines.length;
  }
  return mapped;
}

function optimisticLockConflictError(message = "Document was modified by another request.") {
  const err = new Error(message);
  err.status = 409;
  err.code = "OPTIMISTIC_LOCK_CONFLICT";
  return err;
}

function conflictError(message, code, details = null) {
  const err = new Error(message);
  err.status = 409;
  if (code) {
    err.code = code;
  }
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

async function validateDocumentOperatingUnit({
  tenantId,
  legalEntityId,
  operatingUnitId,
  runQuery = query,
}) {
  const normalizedOperatingUnitId = parsePositiveInt(operatingUnitId);
  if (!normalizedOperatingUnitId) {
    return null;
  }

  const result = await runQuery(
    `SELECT id, legal_entity_id
     FROM operating_units
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, normalizedOperatingUnitId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    throw badRequest("operatingUnitId must belong to tenant");
  }
  if (parsePositiveInt(row.legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest("operatingUnitId must belong to legalEntityId");
  }
  return normalizedOperatingUnitId;
}

function assertDocumentScopeAccess(req, assertScopeAccess, row, fieldName = "documentId") {
  const operatingUnitId = parsePositiveInt(row?.operating_unit_id);
  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, fieldName);
    return;
  }
  assertScopeAccess(
    req,
    "legal_entity",
    parsePositiveInt(row?.legal_entity_id),
    fieldName
  );
}

function mapOpenItemRow(row) {
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    counterpartyId: parsePositiveInt(row.counterparty_id),
    documentId: parsePositiveInt(row.document_id),
    itemNo: Number(row.item_no || 0),
    status: row.status || null,
    documentDate: toDateOnlyString(row.document_date, "documentDate"),
    dueDate: toDateOnlyString(row.due_date, "dueDate"),
    originalAmountTxn: toDecimalNumber(row.original_amount_txn),
    originalAmountBase: toDecimalNumber(row.original_amount_base),
    residualAmountTxn: toDecimalNumber(row.residual_amount_txn),
    residualAmountBase: toDecimalNumber(row.residual_amount_base),
    settledAmountTxn: toDecimalNumber(row.settled_amount_txn),
    settledAmountBase: toDecimalNumber(row.settled_amount_base),
    currencyCode: row.currency_code || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapDocumentLineTaxRow(row) {
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    documentId: parsePositiveInt(row.cari_document_id),
    documentLineId: parsePositiveInt(row.cari_document_line_id),
    componentNo: Number(row.component_no || 0),
    taxCode: row.tax_code || null,
    taxKind: row.tax_kind || null,
    ratePct: toDecimalNumber(row.rate_pct),
    taxBaseAmountTxn: toDecimalNumber(row.tax_base_amount_txn),
    taxAmountTxn: toDecimalNumber(row.tax_amount_txn),
    taxBaseAmountBase: toDecimalNumber(row.tax_base_amount_base),
    taxAmountBase: toDecimalNumber(row.tax_amount_base),
    taxPurposeCode: row.tax_purpose_code || null,
    accountId: parsePositiveInt(row.account_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapDocumentLineStockLinkRow(row) {
  const readState = deriveStockLinkReadState(row);
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    documentId: parsePositiveInt(row.cari_document_id),
    documentLineId: parsePositiveInt(row.cari_document_line_id),
    documentLineNo: Number(row.document_line_no || 0),
    documentLineDescription: row.document_line_description || null,
    itemCardId: parsePositiveInt(row.item_card_id),
    itemCardCode: row.item_card_code || null,
    itemCardName: row.item_card_name || null,
    direction: row.direction || null,
    stockImpactMode: row.stock_impact_mode || null,
    linkStatus: row.link_status || null,
    requestedQuantity: toDecimalNumber(row.requested_quantity),
    postedNetAmountTxn: toDecimalNumber(row.posted_net_amount_txn),
    postedNetAmountBase: toDecimalNumber(row.posted_net_amount_base),
    boundWarehouseId: parsePositiveInt(row.bound_warehouse_id),
    boundWarehouseCode: row.bound_warehouse_code || null,
    boundWarehouseName: row.bound_warehouse_name || null,
    inventoryDocumentType: row.inventory_document_type || null,
    inventoryDocumentId: parsePositiveInt(row.inventory_document_id),
    inventoryMovementId: parsePositiveInt(row.inventory_movement_id),
    reopenedFromStockLinkId: parsePositiveInt(row.reopened_from_stock_link_id),
    supersededByStockLinkId: parsePositiveInt(row.superseded_by_stock_link_id),
    inventoryMovementType: row.inventory_movement_type || null,
    inventoryValuationStatus: row.inventory_valuation_status || null,
    inventoryMovementDate: toDateOnlyString(
      row.inventory_movement_date,
      "inventoryMovementDate"
    ),
    inventoryMovementReversedAt: row.inventory_movement_reversed_at || null,
    inventoryMovementReversalJournalEntryId: parsePositiveInt(
      row.inventory_movement_reversal_journal_entry_id
    ),
    inventoryWarehouseId: parsePositiveInt(row.inventory_warehouse_id),
    inventoryWarehouseCode: row.inventory_warehouse_code || null,
    inventoryWarehouseName: row.inventory_warehouse_name || null,
    resolvedAt: row.resolved_at || null,
    resolutionNote: row.resolution_note || null,
    queueState: readState.queueState,
    repairReasonCode: readState.repairReasonCode,
    successorInheritanceStatus: readState.successorInheritanceStatus,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function isActiveInventoryMovementForDocumentReverse(stockLinkRow) {
  if (!parsePositiveInt(stockLinkRow?.inventoryMovementId)) {
    return false;
  }
  if (
    parsePositiveInt(stockLinkRow?.inventoryMovementReversalJournalEntryId) ||
    toNullableString(stockLinkRow?.inventoryMovementReversedAt, 50)
  ) {
    return false;
  }
  return true;
}

function resolveInventoryReverseAction(stockLinkRow) {
  const movementType = normalizeUpperText(stockLinkRow?.inventoryMovementType);
  if (movementType === "ISSUE") {
    return {
      code: "REVERSE_INVENTORY_ISSUE_FIRST",
      message: "Reverse the linked inventory issue first.",
    };
  }
  if (movementType === "RECEIPT") {
    return {
      code: "UNDO_RECEIPT_MATERIALIZATION_FIRST",
      message: "Undo the linked inventory receipt materialization first.",
    };
  }
  return {
    code: "RESOLVE_LINKED_INVENTORY_MOVEMENT_FIRST",
    message: "Resolve the linked inventory movement first.",
  };
}

function buildDocumentReverseInventoryBlocks(stockLinkRows) {
  return (Array.isArray(stockLinkRows) ? stockLinkRows : [])
    .filter((row) => isActiveInventoryMovementForDocumentReverse(row))
    .map((row) => {
      const suggestedAction = resolveInventoryReverseAction(row);
      return {
        stockLinkId: parsePositiveInt(row.id),
        documentLineId: parsePositiveInt(row.documentLineId),
        documentLineNo: Number(row.documentLineNo || 0),
        stockImpactMode: row.stockImpactMode || null,
        linkStatus: row.linkStatus || null,
        inventoryMovementId: parsePositiveInt(row.inventoryMovementId),
        inventoryMovementType: row.inventoryMovementType || null,
        inventoryValuationStatus: row.inventoryValuationStatus || null,
        inventoryMovementDate: row.inventoryMovementDate || null,
        warehouseId: parsePositiveInt(row.inventoryWarehouseId),
        warehouseCode: row.inventoryWarehouseCode || null,
        warehouseName: row.inventoryWarehouseName || null,
        itemCardId: parsePositiveInt(row.itemCardId),
        itemCardCode: row.itemCardCode || null,
        itemCardName: row.itemCardName || null,
        requestedQuantity: toDecimalNumber(row.requestedQuantity),
        suggestedActionCode: suggestedAction.code,
        suggestedActionMessage: suggestedAction.message,
      };
    });
}

function documentReverseBlockedByInventoryError(documentId, inventoryBlocks) {
  const count = Array.isArray(inventoryBlocks) ? inventoryBlocks.length : 0;
  return conflictError(
    `Document reverse is blocked by ${count} active linked inventory movement${count === 1 ? "" : "s"}.`,
    "CARI_DOCUMENT_REVERSE_BLOCKED_BY_INVENTORY",
    {
      reason: "ACTIVE_LINKED_INVENTORY_MOVEMENTS",
      documentId: parsePositiveInt(documentId),
      inventoryBlocks,
    }
  );
}

function mapDocumentLineRow(row, taxes = [], stockLinks = []) {
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    documentId: parsePositiveInt(row.cari_document_id),
    lineNo: Number(row.line_no || 0),
    lineKind: row.line_kind || "STANDARD",
    description: row.description || null,
    itemCardId: parsePositiveInt(row.item_card_id),
    quantity: toDecimalNumber(row.quantity),
    unitPriceTxn: toDecimalNumber(row.unit_price_txn),
    lineNetAmountTxn: toDecimalNumber(row.line_net_amount_txn),
    lineTaxAmountTxn: toDecimalNumber(row.line_tax_amount_txn),
    lineGrossAmountTxn: toDecimalNumber(row.line_gross_amount_txn),
    lineNetAmountBase: toDecimalNumber(row.line_net_amount_base),
    lineTaxAmountBase: toDecimalNumber(row.line_tax_amount_base),
    lineGrossAmountBase: toDecimalNumber(row.line_gross_amount_base),
    postingAccountId: parsePositiveInt(row.posting_account_id),
    taxCategoryCode: row.tax_category_code || null,
    stockImpactMode: row.stock_impact_mode || "NONE",
    warehouseId: parsePositiveInt(row.warehouse_id),
    warehouseCode: row.warehouse_code || null,
    warehouseName: row.warehouse_name || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    taxes: Array.isArray(taxes) ? taxes : [],
    stockLinks: Array.isArray(stockLinks) ? stockLinks : [],
  };
}

function assertFrozenTransactionType(direction, documentType) {
  const key = `${direction}:${documentType}`;
  if (!FROZEN_TRANSACTION_KEYS.has(key)) {
    throw badRequest("Only frozen v1 transaction types are allowed");
  }
}

function assertDueDateByDocumentType({ documentType, dueDate }) {
  if (DUE_DATE_REQUIRED_TYPES.has(documentType) && !dueDate) {
    throw badRequest(`dueDate is required for documentType=${documentType}`);
  }
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
        primary_operating_unit_id,
        code,
        name,
        is_customer,
        is_vendor,
        ar_account_id,
        ap_account_id,
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

async function listCounterpartyOperatingUnitIds({
  tenantId,
  legalEntityId,
  counterpartyId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT operating_unit_id
     FROM counterparty_operating_units
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND counterparty_id = ?`,
    [tenantId, legalEntityId, counterpartyId]
  );
  return Array.from(
    new Set((result.rows || []).map((row) => parsePositiveInt(row.operating_unit_id)).filter(Boolean))
  );
}

function describeCounterparty(row) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code || name) {
    return code || name;
  }
  const id = parsePositiveInt(row?.id);
  return id ? `ID ${id}` : "selected counterparty";
}

function buildCounterpartyOperatingUnitRequiredError(counterpartyRow) {
  return badRequest(
    `Counterparty ${describeCounterparty(
      counterpartyRow
    )} is limited to specific operating units. Open the counterparty card and set a Primary Operating Unit, or add the owning operating unit under Allowed Operating Units, then retry the document save.`
  );
}

function buildCounterpartyOperatingUnitNotAssignedError(counterpartyRow) {
  return badRequest(
    `The selected operating unit is not assigned to counterparty ${describeCounterparty(
      counterpartyRow
    )}. Open the counterparty card and update Allowed Operating Units or Primary Operating Unit, then retry the document save.`
  );
}

async function resolveDocumentOperatingUnitForCounterparty({
  tenantId,
  legalEntityId,
  requestedOperatingUnitId,
  counterpartyRow,
  runQuery = query,
}) {
  const validatedOperatingUnitId = await validateDocumentOperatingUnit({
    tenantId,
    legalEntityId,
    operatingUnitId: requestedOperatingUnitId,
    runQuery,
  });
  if (!counterpartyRow) {
    return validatedOperatingUnitId;
  }

  const primaryOperatingUnitId =
    parsePositiveInt(counterpartyRow.primary_operating_unit_id) ||
    parsePositiveInt(counterpartyRow.primaryOperatingUnitId) ||
    null;
  const allowedOperatingUnitIds = await listCounterpartyOperatingUnitIds({
    tenantId,
    legalEntityId,
    counterpartyId: counterpartyRow.id,
    runQuery,
  });
  const constrainedOperatingUnitIds = new Set([
    ...allowedOperatingUnitIds,
    ...(primaryOperatingUnitId ? [primaryOperatingUnitId] : []),
  ]);
  if (constrainedOperatingUnitIds.size === 0) {
    return validatedOperatingUnitId;
  }
  if (!validatedOperatingUnitId) {
    if (primaryOperatingUnitId) {
      return primaryOperatingUnitId;
    }
    throw buildCounterpartyOperatingUnitRequiredError(counterpartyRow);
  }
  if (!constrainedOperatingUnitIds.has(validatedOperatingUnitId)) {
    throw buildCounterpartyOperatingUnitNotAssignedError(counterpartyRow);
  }
  return validatedOperatingUnitId;
}

async function fetchPaymentTermRow({
  tenantId,
  legalEntityId,
  paymentTermId,
  runQuery = query,
}) {
  if (!paymentTermId) {
    return null;
  }
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        code,
        name,
        due_days,
        grace_days,
        is_end_of_month,
        status
     FROM payment_terms
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, legalEntityId, paymentTermId]
  );
  return result.rows?.[0] || null;
}

async function fetchDocumentRow({
  tenantId,
  documentId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        d.*,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        pt.code AS payment_term_code,
        pt.name AS payment_term_name
     FROM cari_documents d
     LEFT JOIN operating_units ou
       ON ou.id = d.operating_unit_id
     LEFT JOIN payment_terms pt
       ON pt.tenant_id = d.tenant_id
      AND pt.legal_entity_id = d.legal_entity_id
      AND pt.id = d.payment_term_id
     WHERE d.tenant_id = ?
       AND d.id = ?
     LIMIT 1`,
    [tenantId, documentId]
  );
  return result.rows?.[0] || null;
}

async function listDocumentLineRows({
  tenantId,
  legalEntityId,
  documentId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        l.id,
        l.tenant_id,
        l.legal_entity_id,
        l.cari_document_id,
        l.line_no,
        l.line_kind,
        l.description,
        l.item_card_id,
        l.quantity,
        l.unit_price_txn,
        l.line_net_amount_txn,
        l.line_tax_amount_txn,
        l.line_gross_amount_txn,
        l.line_net_amount_base,
        l.line_tax_amount_base,
        l.line_gross_amount_base,
        l.posting_account_id,
        l.tax_category_code,
        l.stock_impact_mode,
        l.warehouse_id,
        w.code AS warehouse_code,
        w.name AS warehouse_name,
        l.created_at,
        l.updated_at
     FROM cari_document_lines l
     LEFT JOIN inventory_warehouses w
       ON w.tenant_id = l.tenant_id
      AND w.legal_entity_id = l.legal_entity_id
      AND w.id = l.warehouse_id
     WHERE l.tenant_id = ?
       AND l.legal_entity_id = ?
       AND l.cari_document_id = ?
     ORDER BY l.line_no ASC, l.id ASC`,
    [tenantId, legalEntityId, documentId]
  );
  return result.rows || [];
}

async function listDocumentLineTaxRows({
  tenantId,
  legalEntityId,
  documentId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        cari_document_id,
        cari_document_line_id,
        component_no,
        tax_code,
        tax_kind,
        rate_pct,
        tax_base_amount_txn,
        tax_amount_txn,
        tax_base_amount_base,
        tax_amount_base,
        tax_purpose_code,
        account_id,
        created_at,
        updated_at
     FROM cari_document_line_taxes
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND cari_document_id = ?
     ORDER BY cari_document_line_id ASC, component_no ASC, id ASC`,
    [tenantId, legalEntityId, documentId]
  );
  return result.rows || [];
}

async function listDocumentLineStockLinkRows({
  tenantId,
  legalEntityId,
  documentId,
  runQuery = query,
}) {
  const result = await runQuery(
      `SELECT
        sl.id,
        sl.tenant_id,
        sl.legal_entity_id,
        sl.cari_document_id,
        sl.cari_document_line_id,
        l.line_no AS document_line_no,
        l.description AS document_line_description,
        sl.item_card_id,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        sl.direction,
        sl.stock_impact_mode,
        sl.link_status,
        sl.requested_quantity,
        sl.posted_net_amount_txn,
        sl.posted_net_amount_base,
        sl.warehouse_id AS bound_warehouse_id,
        bw.code AS bound_warehouse_code,
        bw.name AS bound_warehouse_name,
        sl.inventory_document_type,
        sl.inventory_document_id,
        sl.inventory_movement_id,
        sl.reopened_from_stock_link_id,
        sl.superseded_by_stock_link_id,
        im.movement_type AS inventory_movement_type,
        im.valuation_status AS inventory_valuation_status,
        im.movement_date AS inventory_movement_date,
        im.reversed_at AS inventory_movement_reversed_at,
        im.reversal_journal_entry_id AS inventory_movement_reversal_journal_entry_id,
        iw.id AS inventory_warehouse_id,
        iw.code AS inventory_warehouse_code,
        iw.name AS inventory_warehouse_name,
        sl.resolved_at,
        sl.resolution_note,
        sl.created_at,
        sl.updated_at
     FROM cari_document_line_stock_links sl
     JOIN cari_document_lines l
       ON l.tenant_id = sl.tenant_id
      AND l.legal_entity_id = sl.legal_entity_id
      AND l.cari_document_id = sl.cari_document_id
      AND l.id = sl.cari_document_line_id
     LEFT JOIN item_cards ic
       ON ic.tenant_id = sl.tenant_id
      AND ic.id = sl.item_card_id
     LEFT JOIN inventory_warehouses bw
       ON bw.id = sl.warehouse_id
     LEFT JOIN inventory_movements im
       ON im.id = sl.inventory_movement_id
     LEFT JOIN inventory_warehouses iw
       ON iw.id = im.warehouse_id
     WHERE sl.tenant_id = ?
       AND sl.legal_entity_id = ?
       AND sl.cari_document_id = ?
     ORDER BY sl.cari_document_line_id ASC, sl.id ASC`,
    [tenantId, legalEntityId, documentId]
  );
  return result.rows || [];
}

async function loadDocumentLinesForDocument({
  tenantId,
  legalEntityId,
  documentId,
  runQuery = query,
}) {
  const lineRows = await listDocumentLineRows({
    tenantId,
    legalEntityId,
    documentId,
    runQuery,
  });
  const taxRows = await listDocumentLineTaxRows({
    tenantId,
    legalEntityId,
    documentId,
    runQuery,
  });
  const stockLinkRows = await listDocumentLineStockLinkRows({
    tenantId,
    legalEntityId,
    documentId,
    runQuery,
  });

  const taxesByLineId = new Map();
  for (const taxRow of taxRows) {
    const mappedTax = mapDocumentLineTaxRow(taxRow);
    const lineId = mappedTax.documentLineId;
    if (!taxesByLineId.has(lineId)) {
      taxesByLineId.set(lineId, []);
    }
    taxesByLineId.get(lineId).push(mappedTax);
  }
  const stockLinksByLineId = new Map();
  for (const stockLinkRow of stockLinkRows) {
    const mappedStockLink = mapDocumentLineStockLinkRow(stockLinkRow);
    const lineId = mappedStockLink.documentLineId;
    if (!stockLinksByLineId.has(lineId)) {
      stockLinksByLineId.set(lineId, []);
    }
    stockLinksByLineId.get(lineId).push(mappedStockLink);
  }

  return lineRows.map((lineRow) =>
    mapDocumentLineRow(
      lineRow,
      taxesByLineId.get(parsePositiveInt(lineRow.id)) || [],
      stockLinksByLineId.get(parsePositiveInt(lineRow.id)) || []
    )
  );
}

async function reserveDraftSequence({
  tenantId,
  legalEntityId,
  direction,
  documentDate,
  runQuery,
}) {
  const fiscalYear = Number(String(documentDate).slice(0, 4));
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900) {
    throw badRequest("documentDate must include a valid fiscal year");
  }

  const maxResult = await runQuery(
    `SELECT COALESCE(MAX(sequence_no), 0) AS current_max
     FROM cari_documents
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND direction = ?
       AND sequence_namespace = ?
       AND fiscal_year = ?
     FOR UPDATE`,
    [tenantId, legalEntityId, direction, DRAFT_SEQUENCE_NAMESPACE, fiscalYear]
  );
  const currentMax = Number(maxResult.rows?.[0]?.current_max || 0);
  const nextSequenceNo = currentMax + 1;
  const documentNo = `DRAFT-${direction}-${fiscalYear}-${String(nextSequenceNo).padStart(
    6,
    "0"
  )}`;

  return {
    sequenceNamespace: DRAFT_SEQUENCE_NAMESPACE,
    fiscalYear,
    sequenceNo: nextSequenceNo,
    documentNo: documentNo.slice(0, 80),
  };
}

function resolveDueDate({
  documentDate,
  dueDate,
  documentType,
  paymentTermRow,
}) {
  if (dueDate) {
    return dueDate;
  }

  if (!DUE_DATE_REQUIRED_TYPES.has(documentType)) {
    return null;
  }

  if (!paymentTermRow) {
    throw badRequest(`dueDate is required for documentType=${documentType}`);
  }

  const dueDays = Number(paymentTermRow.due_days || 0);
  const graceDays = Number(paymentTermRow.grace_days || 0);
  const totalDays = dueDays + graceDays;
  return addDays(documentDate, totalDays);
}

function assertDateOrder(documentDate, dueDate) {
  const normalizedDocumentDate = toDateOnlyString(documentDate, "documentDate");
  const normalizedDueDate = toDateOnlyString(dueDate, "dueDate");
  if (!normalizedDueDate) {
    return;
  }
  if (!normalizedDocumentDate) {
    throw badRequest("documentDate is required");
  }
  if (normalizedDueDate < normalizedDocumentDate) {
    throw badRequest("dueDate cannot be before documentDate");
  }
}

function buildPaymentTermSnapshot(paymentTermRow) {
  if (!paymentTermRow) {
    return null;
  }
  return safeStringify({
    code: String(paymentTermRow.code || ""),
    name: String(paymentTermRow.name || ""),
    dueDays: Number(paymentTermRow.due_days || 0),
    graceDays: Number(paymentTermRow.grace_days || 0),
    isEndOfMonth: Boolean(paymentTermRow.is_end_of_month),
    status: String(paymentTermRow.status || ""),
  });
}

function buildPostedDocumentNo({
  direction,
  documentType,
  fiscalYear,
  sequenceNo,
}) {
  const prefix = `${normalizeUpperText(direction)}-${normalizeUpperText(documentType)}`;
  const suffix = String(Number(sequenceNo || 0)).padStart(6, "0");
  return `${prefix}-${fiscalYear}-${suffix}`.slice(0, 80);
}

async function fetchDocumentRowForUpdate({
  tenantId,
  documentId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT *
     FROM cari_documents
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantId, documentId]
  );
  return result.rows?.[0] || null;
}

async function reservePostedSequence({
  tenantId,
  legalEntityId,
  direction,
  documentType,
  documentDate,
  runQuery,
}) {
  const fiscalYear = Number(String(documentDate).slice(0, 4));
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900) {
    throw badRequest("documentDate must include a valid fiscal year");
  }

  const sequenceNamespace = normalizeUpperText(documentType);
  const directionCode = normalizeUpperText(direction);
  const maxResult = await runQuery(
    `SELECT COALESCE(MAX(sequence_no), 0) AS current_max
     FROM cari_documents
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND direction = ?
       AND sequence_namespace = ?
       AND fiscal_year = ?
     FOR UPDATE`,
    [tenantId, legalEntityId, directionCode, sequenceNamespace, fiscalYear]
  );
  const currentMax = Number(maxResult.rows?.[0]?.current_max || 0);
  const nextSequenceNo = currentMax + 1;

  return {
    sequenceNamespace,
    fiscalYear,
    sequenceNo: nextSequenceNo,
    documentNo: buildPostedDocumentNo({
      direction: directionCode,
      documentType: sequenceNamespace,
      fiscalYear,
      sequenceNo: nextSequenceNo,
    }),
  };
}

async function resolveBookAndOpenPeriodForDate({
  tenantId,
  legalEntityId,
  targetDate,
  preferredBookId = null,
  runQuery = query,
}) {
  const normalizedDate = normalizeDateInput(targetDate, "documentDate");

  let book = null;
  if (preferredBookId) {
    const preferredBookResult = await runQuery(
      `SELECT id, calendar_id, base_currency_code
       FROM books
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id = ?
       LIMIT 1`,
      [tenantId, legalEntityId, preferredBookId]
    );
    book = preferredBookResult.rows?.[0] || null;
  }

  if (!book) {
    const bookResult = await runQuery(
      `SELECT id, calendar_id, base_currency_code, book_type
       FROM books
       WHERE tenant_id = ?
         AND legal_entity_id = ?
       ORDER BY
         CASE WHEN book_type = 'LOCAL' THEN 0 ELSE 1 END,
         id ASC
       LIMIT 1`,
      [tenantId, legalEntityId]
    );
    book = bookResult.rows?.[0] || null;
  }
  if (!book) {
    throw badRequest("No book found for document legalEntityId");
  }

  const bookId = parsePositiveInt(book.id);
  const calendarId = parsePositiveInt(book.calendar_id);
  if (!bookId || !calendarId) {
    throw badRequest("Book configuration is invalid for document posting");
  }

  const periodResult = await runQuery(
    `SELECT id, fiscal_year, period_no, start_date, end_date
     FROM fiscal_periods
     WHERE calendar_id = ?
       AND ? BETWEEN start_date AND end_date
     ORDER BY is_adjustment ASC, id ASC
     LIMIT 1`,
    [calendarId, normalizedDate]
  );
  const period = periodResult.rows?.[0] || null;
  if (!period) {
    throw badRequest("No fiscal period found for document date");
  }

  const fiscalPeriodId = parsePositiveInt(period.id);
  if (!fiscalPeriodId) {
    throw badRequest("Fiscal period configuration is invalid for document posting");
  }

  const statusResult = await runQuery(
    `SELECT status
     FROM period_statuses
     WHERE book_id = ?
       AND fiscal_period_id = ?
     LIMIT 1`,
    [bookId, fiscalPeriodId]
  );
  const periodStatus = normalizeUpperText(statusResult.rows?.[0]?.status || "OPEN");
  if (periodStatus !== "OPEN") {
    throw badRequest(`Period is ${periodStatus}; cannot post/reverse document`);
  }

  return {
    bookId,
    fiscalPeriodId,
    fiscalYear: Number(period.fiscal_year),
    baseCurrencyCode: normalizeUpperText(book.base_currency_code),
  };
}

async function resolveCounterpartyControlAccountOverride({
  tenantId,
  legalEntityId,
  direction,
  counterpartyRow,
  runQuery = query,
}) {
  if (!counterpartyRow || !parsePositiveInt(counterpartyRow.id)) {
    return null;
  }

  const normalizedDirection = normalizeUpperText(direction);
  const mapping =
    normalizedDirection === "AR"
      ? {
          accountId: parsePositiveInt(counterpartyRow.ar_account_id),
          roleEnabled: counterpartyRow.is_customer === true || Number(counterpartyRow.is_customer) === 1,
          fieldLabel: "arAccountId",
          expectedAccountType: "ASSET",
        }
      : normalizedDirection === "AP"
        ? {
            accountId: parsePositiveInt(counterpartyRow.ap_account_id),
            roleEnabled:
              counterpartyRow.is_vendor === true || Number(counterpartyRow.is_vendor) === 1,
            fieldLabel: "apAccountId",
            expectedAccountType: "LIABILITY",
          }
        : null;

  if (!mapping) {
    throw badRequest("direction must be AR or AP");
  }
  if (!mapping.accountId) {
    return null;
  }
  if (!mapping.roleEnabled) {
    throw badRequest(`${mapping.fieldLabel} requires compatible counterparty role`);
  }

  await assertAccountBelongsToTenant(tenantId, mapping.accountId, mapping.fieldLabel, {
    runQuery,
  });

  const accountResult = await runQuery(
    `SELECT
        a.id,
        a.code,
        a.account_type,
        a.is_active,
        a.allow_posting,
        c.scope AS coa_scope,
        c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [mapping.accountId, tenantId]
  );
  const account = accountResult.rows?.[0] || null;
  if (!account) {
    throw badRequest(`${mapping.fieldLabel} not found for tenant`);
  }

  if (normalizeUpperText(account.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${mapping.fieldLabel} must belong to a LEGAL_ENTITY chart`);
  }
  if (parsePositiveInt(account.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${mapping.fieldLabel} must belong to legalEntityId`);
  }
  if (normalizeUpperText(account.account_type) !== mapping.expectedAccountType) {
    throw badRequest(`${mapping.fieldLabel} must have accountType=${mapping.expectedAccountType}`);
  }
  if (!(account.is_active === true || Number(account.is_active) === 1)) {
    throw badRequest(`${mapping.fieldLabel} must reference an ACTIVE account`);
  }
  if (!(account.allow_posting === true || Number(account.allow_posting) === 1)) {
    throw badRequest(`${mapping.fieldLabel} must reference a postable account`);
  }

  return {
    id: parsePositiveInt(account.id),
    code: account.code || null,
  };
}

async function resolveCariOffsetAccountOverride({
  tenantId,
  legalEntityId,
  offsetAccountId = null,
  offsetAccountCode = null,
  runQuery = query,
}) {
  const normalizedOffsetAccountId = parsePositiveInt(offsetAccountId);
  const normalizedOffsetAccountCode = String(offsetAccountCode || "").trim();

  if (!normalizedOffsetAccountId && !normalizedOffsetAccountCode) {
    return null;
  }
  if (normalizedOffsetAccountId && normalizedOffsetAccountCode) {
    throw badRequest("Provide either offsetAccountId or offsetAccountCode, not both");
  }

  let account = null;
  if (normalizedOffsetAccountId) {
    await assertAccountBelongsToTenant(tenantId, normalizedOffsetAccountId, "offsetAccountId", {
      runQuery,
    });

    const result = await runQuery(
      `SELECT
          a.id,
          a.code,
          a.is_active,
          a.allow_posting,
          c.scope AS coa_scope,
          c.legal_entity_id AS coa_legal_entity_id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE a.id = ?
         AND c.tenant_id = ?
       LIMIT 1`,
      [normalizedOffsetAccountId, tenantId]
    );
    account = result.rows?.[0] || null;
    if (!account) {
      throw badRequest("offsetAccountId not found for tenant");
    }
  } else {
    const result = await runQuery(
      `SELECT
          a.id,
          a.code,
          a.is_active,
          a.allow_posting,
          c.scope AS coa_scope,
          c.legal_entity_id AS coa_legal_entity_id
       FROM accounts a
       JOIN charts_of_accounts c ON c.id = a.coa_id
       WHERE c.tenant_id = ?
         AND c.scope = 'LEGAL_ENTITY'
         AND c.legal_entity_id = ?
         AND UPPER(a.code) = UPPER(?)
       ORDER BY a.id ASC
       LIMIT 2`,
      [tenantId, legalEntityId, normalizedOffsetAccountCode]
    );
    const rows = result.rows || [];
    if (rows.length === 0) {
      throw badRequest("offsetAccountCode not found in legalEntity chart");
    }
    if (rows.length > 1) {
      throw badRequest("offsetAccountCode is ambiguous for legalEntity");
    }
    account = rows[0];
  }

  if (normalizeUpperText(account.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest("Offset account override must belong to a LEGAL_ENTITY chart");
  }
  if (parsePositiveInt(account.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest("Offset account override must belong to legalEntityId");
  }
  if (!(account.is_active === true || Number(account.is_active) === 1)) {
    throw badRequest("Offset account override must reference an ACTIVE account");
  }
  if (!(account.allow_posting === true || Number(account.allow_posting) === 1)) {
    throw badRequest("Offset account override must reference a postable account");
  }

  return {
    id: parsePositiveInt(account.id),
    code: String(account.code || ""),
  };
}

async function resolveCariPostingAccounts({
  tenantId,
  legalEntityId,
  direction,
  counterpartyRow = null,
  offsetAccountId = null,
  offsetAccountCode = null,
  runQuery = query,
}) {
  const purposeDefinition = CARI_POSTING_PURPOSES[normalizeUpperText(direction)];
  if (!purposeDefinition) {
    throw badRequest("direction must be AR or AP");
  }

  await autoRemapCariPurposeMappingsForLegalEntity({
    tenantId,
    legalEntityId,
    purposeCodes: [purposeDefinition.control, purposeDefinition.offset],
    runQuery,
  });

  const requestedPurposes = [purposeDefinition.control, purposeDefinition.offset];
  const placeholders = requestedPurposes.map(() => "?").join(", ");
  const result = await runQuery(
    `SELECT
       jpa.purpose_code,
       a.id AS account_id,
       a.code AS account_code
     FROM journal_purpose_accounts jpa
     JOIN accounts a ON a.id = jpa.account_id
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE jpa.tenant_id = ?
       AND jpa.legal_entity_id = ?
       AND jpa.purpose_code IN (${placeholders})
       AND c.tenant_id = ?
       AND c.legal_entity_id = ?
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE`,
    [tenantId, legalEntityId, ...requestedPurposes, tenantId, legalEntityId]
  );

  const byPurpose = new Map(
    (result.rows || []).map((row) => [
      normalizeUpperText(row.purpose_code),
      {
        id: parsePositiveInt(row.account_id),
        code: String(row.account_code || ""),
      },
    ])
  );

  const control = byPurpose.get(purposeDefinition.control);
  const mappedOffset = byPurpose.get(purposeDefinition.offset);
  if (!control?.id) {
    throw badRequest(
      `Setup required: configure journal_purpose_accounts for ${purposeDefinition.control}`
    );
  }

  const overrideControl = await resolveCounterpartyControlAccountOverride({
    tenantId,
    legalEntityId,
    direction,
    counterpartyRow,
    runQuery,
  });
  const effectiveControl = overrideControl?.id
    ? {
        id: overrideControl.id,
        code: overrideControl.code || null,
      }
    : control;

  const overrideOffset = await resolveCariOffsetAccountOverride({
    tenantId,
    legalEntityId,
    offsetAccountId,
    offsetAccountCode,
    runQuery,
  });
  const effectiveOffset = overrideOffset?.id
    ? {
        id: overrideOffset.id,
        code: overrideOffset.code || null,
      }
    : mappedOffset;
  if (!effectiveOffset?.id) {
    throw badRequest(
      `Setup required: configure journal_purpose_accounts for ${purposeDefinition.offset} or provide offsetAccountId/offsetAccountCode`
    );
  }

  if (effectiveControl.id === effectiveOffset.id) {
    throw badRequest("Cari control and offset accounts must be different");
  }

  return {
    controlAccountId: effectiveControl.id,
    offsetAccountId: effectiveOffset.id,
    controlAccountCode: effectiveControl.code || null,
    offsetAccountCode: effectiveOffset.code || null,
  };
}

export async function resolveCariControlAccountTx({
  tenantId,
  legalEntityId,
  direction,
  counterpartyId = null,
  counterpartyRow = null,
  runQuery = query,
}) {
  const purposeDefinition = CARI_POSTING_PURPOSES[normalizeUpperText(direction)];
  if (!purposeDefinition) {
    throw badRequest("direction must be AR or AP");
  }

  const normalizedCounterpartyId =
    parsePositiveInt(counterpartyId) || parsePositiveInt(counterpartyRow?.id) || null;

  let effectiveCounterpartyRow = counterpartyRow || null;
  if (!effectiveCounterpartyRow && normalizedCounterpartyId) {
    effectiveCounterpartyRow = await fetchCounterpartyRow({
      tenantId,
      legalEntityId,
      counterpartyId: normalizedCounterpartyId,
      runQuery,
    });
    if (!effectiveCounterpartyRow) {
      throw badRequest("counterpartyId must belong to legalEntityId");
    }
  }

  await autoRemapCariPurposeMappingsForLegalEntity({
    tenantId,
    legalEntityId,
    purposeCodes: [purposeDefinition.control],
    runQuery,
  });

  const result = await runQuery(
    `SELECT
        a.id AS account_id,
        a.code AS account_code
     FROM journal_purpose_accounts jpa
     JOIN accounts a ON a.id = jpa.account_id
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE jpa.tenant_id = ?
       AND jpa.legal_entity_id = ?
       AND jpa.purpose_code = ?
       AND c.tenant_id = ?
       AND c.legal_entity_id = ?
       AND a.is_active = TRUE
       AND a.allow_posting = TRUE
     ORDER BY jpa.id ASC
     LIMIT 1`,
    [tenantId, legalEntityId, purposeDefinition.control, tenantId, legalEntityId]
  );

  const mappedControl = result.rows?.[0]
    ? {
        id: parsePositiveInt(result.rows[0].account_id),
        code: String(result.rows[0].account_code || ""),
      }
    : null;
  if (!mappedControl?.id) {
    throw badRequest(
      `Setup required: configure journal_purpose_accounts for ${purposeDefinition.control}`
    );
  }

  const overrideControl = await resolveCounterpartyControlAccountOverride({
    tenantId,
    legalEntityId,
    direction,
    counterpartyRow: effectiveCounterpartyRow,
    runQuery,
  });
  const effectiveControl = overrideControl?.id
    ? {
        id: overrideControl.id,
        code: overrideControl.code || null,
      }
    : mappedControl;

  return {
    controlAccountId: effectiveControl.id,
    controlAccountCode: effectiveControl.code || null,
  };
}

function buildCariPostingLines({
  direction,
  documentType,
  amountTxn,
  amountBase,
  controlAccountId,
  offsetAccountId,
  lineDescription,
  subledgerReferenceNo,
  currencyCode,
}) {
  const normalizedDirection = normalizeUpperText(direction);
  const normalizedType = normalizeUpperText(documentType);
  const normalizedCurrency = normalizeUpperText(currencyCode);
  const postingAmountTxn = normalizeAmount(amountTxn, "amountTxn");
  const postingAmountBase = normalizeAmount(amountBase, "amountBase");

  const isPositiveSign = POSITIVE_SIGN_DOCUMENT_TYPES.has(normalizedType);
  let debitAccountId = null;
  let creditAccountId = null;

  if (normalizedDirection === "AR") {
    debitAccountId = isPositiveSign ? controlAccountId : offsetAccountId;
    creditAccountId = isPositiveSign ? offsetAccountId : controlAccountId;
  } else if (normalizedDirection === "AP") {
    debitAccountId = isPositiveSign ? offsetAccountId : controlAccountId;
    creditAccountId = isPositiveSign ? controlAccountId : offsetAccountId;
  } else {
    throw badRequest("direction must be AR or AP");
  }

  const lines = [
    {
      accountId: parsePositiveInt(debitAccountId),
      debitBase: postingAmountBase,
      creditBase: 0,
      amountTxn: postingAmountTxn,
      description: toNullableString(lineDescription, 255),
      subledgerReferenceNo: toNullableString(subledgerReferenceNo, 100),
      currencyCode: normalizedCurrency,
    },
    {
      accountId: parsePositiveInt(creditAccountId),
      debitBase: 0,
      creditBase: postingAmountBase,
      amountTxn: Number((postingAmountTxn * -1).toFixed(AMOUNT_PRECISION_SCALE)),
      description: toNullableString(lineDescription, 255),
      subledgerReferenceNo: toNullableString(subledgerReferenceNo, 100),
      currencyCode: normalizedCurrency,
    },
  ];

  for (const [index, line] of lines.entries()) {
    if (!line.accountId) {
      throw badRequest(`Posting line ${index + 1} account is invalid`);
    }
  }
  ensureBalancedJournalLines(lines);
  return lines;
}

function resolveCariPostingSides({ direction, documentType }) {
  const normalizedDirection = normalizeUpperText(direction);
  const normalizedType = normalizeUpperText(documentType);
  const isPositiveSign = POSITIVE_SIGN_DOCUMENT_TYPES.has(normalizedType);

  if (normalizedDirection === "AR") {
    return {
      controlSide: isPositiveSign ? "DEBIT" : "CREDIT",
      offsetSide: isPositiveSign ? "CREDIT" : "DEBIT",
    };
  }
  if (normalizedDirection === "AP") {
    return {
      controlSide: isPositiveSign ? "CREDIT" : "DEBIT",
      offsetSide: isPositiveSign ? "DEBIT" : "CREDIT",
    };
  }
  throw badRequest("direction must be AR or AP");
}

export function buildCariDirectionalJournalLine({
  accountId,
  side,
  amountTxn,
  amountBase,
  lineDescription,
  subledgerReferenceNo,
  currencyCode,
  operatingUnitId = null,
  taxCode = null,
}) {
  const normalizedSide = normalizeUpperText(side);
  if (!["DEBIT", "CREDIT"].includes(normalizedSide)) {
    throw badRequest("side must be DEBIT or CREDIT");
  }
  const normalizedAmountTxn = normalizeAmount(amountTxn, "amountTxn");
  const normalizedAmountBase = normalizeAmount(amountBase, "amountBase");
  return {
    accountId: parsePositiveInt(accountId),
    operatingUnitId: parsePositiveInt(operatingUnitId) || null,
    debitBase: normalizedSide === "DEBIT" ? normalizedAmountBase : 0,
    creditBase: normalizedSide === "CREDIT" ? normalizedAmountBase : 0,
    amountTxn:
      normalizedSide === "DEBIT"
        ? normalizedAmountTxn
        : Number((normalizedAmountTxn * -1).toFixed(AMOUNT_PRECISION_SCALE)),
    description: toNullableString(lineDescription, 255),
    subledgerReferenceNo: toNullableString(subledgerReferenceNo, 100),
    currencyCode: normalizeUpperText(currencyCode),
    taxCode: toNullableString(taxCode, 40),
  };
}

async function resolveCariLinePostingAccount({
  tenantId,
  legalEntityId,
  accountId,
  fieldLabel = "postingAccountId",
  runQuery = query,
}) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    return null;
  }

  await assertAccountBelongsToTenant(tenantId, normalizedAccountId, fieldLabel, {
    runQuery,
  });
  const result = await runQuery(
    `SELECT
        a.id,
        a.code,
        a.is_active,
        a.allow_posting,
        c.scope AS coa_scope,
        c.legal_entity_id AS coa_legal_entity_id
     FROM accounts a
     JOIN charts_of_accounts c ON c.id = a.coa_id
     WHERE a.id = ?
       AND c.tenant_id = ?
     LIMIT 1`,
    [normalizedAccountId, tenantId]
  );
  const account = result.rows?.[0] || null;
  if (!account) {
    throw badRequest(`${fieldLabel} not found for tenant`);
  }
  if (normalizeUpperText(account.coa_scope) !== "LEGAL_ENTITY") {
    throw badRequest(`${fieldLabel} must belong to a LEGAL_ENTITY chart`);
  }
  if (parsePositiveInt(account.coa_legal_entity_id) !== parsePositiveInt(legalEntityId)) {
    throw badRequest(`${fieldLabel} must belong to legalEntityId`);
  }
  if (!(account.is_active === true || Number(account.is_active) === 1)) {
    throw badRequest(`${fieldLabel} must reference an ACTIVE account`);
  }
  if (!(account.allow_posting === true || Number(account.allow_posting) === 1)) {
    throw badRequest(`${fieldLabel} must reference a postable account`);
  }
  return {
    id: normalizedAccountId,
    code: String(account.code || ""),
  };
}

function sumJournalLineAmountsTxn(lines) {
  let total = 0;
  for (const line of lines || []) {
    total = Number(
      (total + Math.abs(Number(line?.amountTxn || 0))).toFixed(AMOUNT_PRECISION_SCALE)
    );
  }
  return total;
}

function sumJournalLineAmountsBase(lines) {
  let total = 0;
  for (const line of lines || []) {
    total = Number(
      (
        total +
        Math.max(Number(line?.debitBase || 0), Number(line?.creditBase || 0))
      ).toFixed(AMOUNT_PRECISION_SCALE)
    );
  }
  return total;
}

function summarizePostingLineDescription({
  baseDescription,
  lineDescription,
  lineIndex,
  lineCount,
}) {
  const normalizedBase = toNullableString(baseDescription, 255) || "Cari posting line";
  const normalizedLineDescription = toNullableString(lineDescription, 255);
  if (normalizedLineDescription) {
    return `${normalizedBase} | ${normalizedLineDescription}`.slice(0, 255);
  }
  if (Number(lineCount || 0) > 1) {
    return `${normalizedBase} [Line ${Number(lineIndex) + 1}]`.slice(0, 255);
  }
  return normalizedBase;
}

export async function insertPostedJournalWithLinesTx(tx, payload) {
  const totals = ensureBalancedJournalLines(payload.lines);
  const insertResult = await tx.query(
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
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'POSTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.bookId,
      payload.fiscalPeriodId,
      payload.journalNo,
      payload.entryDate,
      payload.documentDate,
      payload.currencyCode,
      payload.description,
      payload.referenceNo,
      totals.totalDebit,
      totals.totalCredit,
      payload.userId,
      payload.userId,
    ]
  );
  const journalEntryId = parsePositiveInt(insertResult.rows?.insertId);
  if (!journalEntryId) {
    throw badRequest("Failed to create posted journal entry");
  }

  for (let i = 0; i < payload.lines.length; i += 1) {
    const line = payload.lines[i];
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
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        journalEntryId,
        i + 1,
        parsePositiveInt(line.accountId),
        parsePositiveInt(line.operatingUnitId ?? payload.operatingUnitId) || null,
        line.description || null,
        line.subledgerReferenceNo || null,
        line.currencyCode,
        normalizeSignedAmount(line.amountTxn, `line[${i}].amountTxn`),
        normalizeAmount(line.debitBase, `line[${i}].debitBase`, { allowZero: true }),
        normalizeAmount(line.creditBase, `line[${i}].creditBase`, { allowZero: true }),
        toNullableString(line.taxCode, 40),
      ]
    );
  }

  return {
    journalEntryId,
    lineCount: payload.lines.length,
    totalDebit: totals.totalDebit,
    totalCredit: totals.totalCredit,
  };
}

async function fetchPostedJournalWithLines({
  tenantId,
  journalEntryId,
  runQuery = query,
}) {
  const journalResult = await runQuery(
    `SELECT
       id,
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
       posted_at,
       reversal_journal_entry_id
     FROM journal_entries
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [tenantId, journalEntryId]
  );
  const journalRow = journalResult.rows?.[0] || null;
  if (!journalRow) {
    return null;
  }

  const lineResult = await runQuery(
    `SELECT
       id,
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
     FROM journal_lines
     WHERE journal_entry_id = ?
     ORDER BY line_no ASC`,
    [journalEntryId]
  );

  return {
    journal: journalRow,
    lines: lineResult.rows || [],
  };
}

async function resolveFxPostingPolicy({
  tenantId,
  documentDate,
  documentCurrencyCode,
  functionalCurrencyCode,
  draftFxRate,
  useFxOverride,
  fxOverrideReason,
  runQuery = query,
}) {
  const documentCurrency = normalizeUpperText(documentCurrencyCode);
  const functionalCurrency = normalizeUpperText(functionalCurrencyCode);
  const normalizedDocumentDate = normalizeDateInput(documentDate, "documentDate");
  const providedFxRate = normalizeOptionalPositiveDecimal(draftFxRate, "fxRate");

  if (!documentCurrency || !functionalCurrency) {
    throw badRequest("Document and functional currency codes are required for posting");
  }

  if (documentCurrency === functionalCurrency) {
    const effectiveFxRate = providedFxRate || 1;
    if (!amountsAreEqual(effectiveFxRate, 1)) {
      throw badRequest(
        "fxRate must be 1 when document currency equals legal entity functional currency"
      );
    }
    return {
      effectiveFxRate: 1,
      fxRateLocked: false,
      referenceFxRate: 1,
      overrideUsed: false,
      fxRateSource: "PARITY",
      fxRateDate: normalizedDocumentDate,
    };
  }

  const fxResult = await runQuery(
    `SELECT rate, is_locked, rate_date
     FROM fx_rates
     WHERE tenant_id = ?
       AND rate_date = ?
       AND from_currency_code = ?
       AND to_currency_code = ?
       AND rate_type = ?
     ORDER BY id DESC
     LIMIT 1`,
    [
      tenantId,
      normalizedDocumentDate,
      documentCurrency,
      functionalCurrency,
      FX_RATE_TYPE_SPOT,
    ]
  );
  const fxRow = fxResult.rows?.[0] || null;
  const referenceFxRate = normalizeOptionalPositiveDecimal(fxRow?.rate, "fxRates.rate");
  const fxRateLocked = Boolean(fxRow?.is_locked);

  let effectiveFxRate = providedFxRate || referenceFxRate;
  if (!effectiveFxRate) {
    throw badRequest(
      "fxRate is required because no SPOT FX rate exists for documentDate and currency pair"
    );
  }

  let overrideUsed = false;
  if (fxRateLocked && referenceFxRate && !amountsAreEqual(effectiveFxRate, referenceFxRate)) {
    if (!useFxOverride) {
      throw badRequest(
        "FX date is locked; useFxOverride=true with cari.fx.override permission is required"
      );
    }
    if (!toNullableString(fxOverrideReason, 500)) {
      throw badRequest("fxOverrideReason is required when overriding locked FX rate");
    }
    overrideUsed = true;
  }

  if (!providedFxRate && referenceFxRate) {
    effectiveFxRate = referenceFxRate;
  }

  return {
    effectiveFxRate,
    fxRateLocked,
    referenceFxRate: referenceFxRate || null,
    overrideUsed,
    fxRateSource: referenceFxRate ? "FX_TABLE" : "DOCUMENT",
    fxRateDate: toDateOnlyString(fxRow?.rate_date || normalizedDocumentDate, "fxRateDate"),
  };
}

function resolveDraftDocumentAmounts({
  amountTxn,
  amountBase,
  currencyCode,
  fxRate,
  functionalCurrencyCode,
}) {
  const normalizedAmountTxn = normalizeAmount(amountTxn, "amountTxn");
  const documentCurrency = normalizeUpperText(currencyCode);
  const functionalCurrency = normalizeUpperText(functionalCurrencyCode);
  const normalizedAmountBase =
    amountBase === null || amountBase === undefined || amountBase === ""
      ? null
      : normalizeAmount(amountBase, "amountBase");
  const normalizedFxRate = normalizeOptionalPositiveDecimal(fxRate, "fxRate");

  if (!documentCurrency || !functionalCurrency) {
    throw badRequest("Document and legal entity functional currencies are required");
  }

  if (documentCurrency === functionalCurrency) {
    if (normalizedFxRate !== null && !amountsAreEqual(normalizedFxRate, 1)) {
      throw badRequest("fxRate must be 1 when currencyCode matches legal entity functional currency");
    }
    if (
      normalizedAmountBase !== null &&
      !amountsAreEqual(normalizedAmountBase, normalizedAmountTxn, AMOUNT_BALANCE_EPSILON)
    ) {
      throw badRequest("amountBase must equal amountTxn when currencyCode matches legal entity functional currency");
    }
    return {
      amountTxn: normalizedAmountTxn,
      amountBase: normalizedAmountTxn,
      currencyCode: documentCurrency,
      fxRate: 1,
    };
  }

  if (!normalizedFxRate) {
    throw badRequest("fxRate is required when currencyCode differs from legal entity functional currency");
  }

  const derivedAmountBase = normalizeAmount(
    normalizedAmountTxn * normalizedFxRate,
    "amountBase"
  );
  if (
    normalizedAmountBase !== null &&
    !amountsAreEqual(normalizedAmountBase, derivedAmountBase, AMOUNT_BALANCE_EPSILON)
  ) {
    throw badRequest(
      "amountBase must equal amountTxn * fxRate when currencyCode differs from legal entity functional currency"
    );
  }

  return {
    amountTxn: normalizedAmountTxn,
    amountBase: derivedAmountBase,
    currencyCode: documentCurrency,
    fxRate: normalizedFxRate,
  };
}

function sumAmountRows(rows, fieldName) {
  let total = 0;
  for (const row of rows || []) {
    total = Number(
      (total + Number(row?.[fieldName] || 0)).toFixed(AMOUNT_PRECISION_SCALE)
    );
  }
  return total;
}

function normalizeExplicitDraftLines(linesInput) {
  return (linesInput || []).map((line, index) => {
    const quantity = normalizeAmount(
      line.quantity ?? 1,
      `lines[${index}].quantity`,
      { allowZero: true }
    );
    const lineNetAmountTxn = normalizeAmount(
      line.lineNetAmountTxn,
      `lines[${index}].lineNetAmountTxn`,
      { allowZero: true }
    );
    const lineTaxAmountTxn = normalizeAmount(
      line.lineTaxAmountTxn ?? 0,
      `lines[${index}].lineTaxAmountTxn`,
      { allowZero: true }
    );
    const lineGrossAmountTxn = normalizeAmount(
      line.lineGrossAmountTxn,
      `lines[${index}].lineGrossAmountTxn`,
      { allowZero: true }
    );
    const computedGrossAmountTxn = Number(
      (lineNetAmountTxn + lineTaxAmountTxn).toFixed(AMOUNT_PRECISION_SCALE)
    );
    if (!amountsAreEqual(lineGrossAmountTxn, computedGrossAmountTxn, AMOUNT_BALANCE_EPSILON)) {
      throw badRequest(
        `lines[${index}].lineGrossAmountTxn must equal lineNetAmountTxn + lineTaxAmountTxn`
      );
    }

    const unitPriceTxn =
      line.unitPriceTxn === null || line.unitPriceTxn === undefined
        ? quantity > 0
          ? Number((lineNetAmountTxn / quantity).toFixed(AMOUNT_PRECISION_SCALE))
          : lineNetAmountTxn
        : normalizeAmount(line.unitPriceTxn, `lines[${index}].unitPriceTxn`, {
            allowZero: true,
          });

    return {
      lineNo: Number(line.lineNo || index + 1),
      lineKind: normalizeUpperText(line.lineKind || "STANDARD"),
      description: toNullableString(line.description, 500),
      itemCardId: parsePositiveInt(line.itemCardId),
      quantity,
      unitPriceTxn,
      lineNetAmountTxn,
      lineTaxAmountTxn,
      lineGrossAmountTxn,
      lineNetAmountBase: null,
      lineTaxAmountBase: null,
      lineGrossAmountBase: null,
      postingAccountId: parsePositiveInt(line.postingAccountId),
      taxCodeId: parsePositiveInt(line.taxCodeId),
      taxCode: toNullableString(line.taxCode, 40),
      taxCategoryCode: toNullableString(line.taxCategoryCode, 60),
      stockImpactMode: normalizeStockImpactMode(line.stockImpactMode),
      warehouseId: parsePositiveInt(line.warehouseId),
      taxes: [],
    };
  });
}

function calculateDraftLineHeaderTotals(lines) {
  return {
    subtotalAmountTxn: sumAmountRows(lines, "lineNetAmountTxn"),
    subtotalAmountBase: sumAmountRows(lines, "lineNetAmountBase"),
    taxAmountTxn: sumAmountRows(lines, "lineTaxAmountTxn"),
    taxAmountBase: sumAmountRows(lines, "lineTaxAmountBase"),
    grossAmountTxn: sumAmountRows(lines, "lineGrossAmountTxn"),
    grossAmountBase: sumAmountRows(lines, "lineGrossAmountBase"),
  };
}

async function applyItemCardDefaultsToLines({
  tenantId,
  legalEntityId,
  direction,
  lines,
  runQuery = query,
  applyTaxCategoryDefaults = true,
  fieldCollectionLabel = "lines",
}) {
  const defaultsCache = new Map();
  let mutated = false;
  for (let index = 0; index < (lines || []).length; index += 1) {
    const line = lines[index] || {};
    const fieldPrefix = `${fieldCollectionLabel}[${index + 1}]`;
    const itemCardId = parsePositiveInt(line.itemCardId);
    const normalizedStockImpactMode = normalizeStockImpactMode(
      line.stockImpactMode
    );
    if ((line.stockImpactMode || "NONE") !== normalizedStockImpactMode) {
      line.stockImpactMode = normalizedStockImpactMode;
      mutated = true;
    } else {
      line.stockImpactMode = normalizedStockImpactMode;
    }

    if (!itemCardId) {
      if (isStockAffectingLineMode(line.stockImpactMode)) {
        throw badRequest(`${fieldPrefix}.stockImpactMode requires itemCardId`);
      }
      continue;
    }

    const cacheKey = `${itemCardId}:${normalizeUpperText(direction)}`;
    let defaults = defaultsCache.get(cacheKey);
    if (!defaults) {
      defaults = await resolveItemCardLineDefaults({
        tenantId,
        legalEntityId,
        itemCardId,
        direction,
        runQuery,
      });
      defaultsCache.set(cacheKey, defaults);
    }

    if (defaults.isStockItem) {
      const requiredStockImpactMode = defaults.defaultStockImpactMode || "NONE";
      if (
        isStockAffectingLineMode(line.stockImpactMode) &&
        line.stockImpactMode !== requiredStockImpactMode
      ) {
        throw badRequest(
          `${fieldPrefix}.stockImpactMode conflicts with itemCardId and direction`
        );
      }
      if (line.stockImpactMode !== requiredStockImpactMode) {
        line.stockImpactMode = requiredStockImpactMode;
        mutated = true;
      }
      const quantity = normalizeAmount(line.quantity || 0, `${fieldPrefix}.quantity`, {
        allowZero: true,
      });
      if (quantity <= AMOUNT_BALANCE_EPSILON) {
        throw badRequest(`${fieldPrefix}.quantity must be greater than 0 for STOCK_ITEM`);
      }
      const warehouseId = parsePositiveInt(line.warehouseId);
      if (!warehouseId) {
        throw badRequest(
          `${fieldPrefix}.warehouseId is required for stock-affecting lines`
        );
      }
      if (line.warehouseId !== warehouseId) {
        line.warehouseId = warehouseId;
        mutated = true;
      }
    } else if (isStockAffectingLineMode(line.stockImpactMode)) {
      throw badRequest(`${fieldPrefix}.stockImpactMode only allowed for STOCK_ITEM itemCardId`);
    } else if (line.stockImpactMode !== "NONE") {
      line.stockImpactMode = "NONE";
      mutated = true;
    }
    if (
      !isStockAffectingLineMode(line.stockImpactMode) &&
      (line.warehouseId !== undefined && line.warehouseId !== null && line.warehouseId !== "")
    ) {
      line.warehouseId = null;
      mutated = true;
    }

    if (!parsePositiveInt(line.postingAccountId) && defaults.defaultPostingAccountId) {
      line.postingAccountId = defaults.defaultPostingAccountId;
      mutated = true;
    }
    if (
      applyTaxCategoryDefaults &&
      !String(line.taxCategoryCode || "").trim() &&
      defaults.defaultTaxCategoryCode
    ) {
      line.taxCategoryCode = defaults.defaultTaxCategoryCode;
      mutated = true;
    }
  }
  return {
    lines,
    mutated,
  };
}

async function assertDraftLineWarehouseBindingsForDocumentContext({
  tenantId,
  legalEntityId,
  documentOperatingUnitId = null,
  lines,
  fieldCollectionLabel = "lines",
  runQuery = query,
}) {
  const ownershipContext =
    deriveOwnershipContextFromOperatingUnitId(documentOperatingUnitId);
  const warehouseCache = new Map();
  for (let index = 0; index < (lines || []).length; index += 1) {
    const line = lines[index] || {};
    if (!isStockAffectingLineMode(line.stockImpactMode)) {
      continue;
    }
    const warehouseId = parsePositiveInt(line.warehouseId);
    if (!warehouseId) {
      continue;
    }
    let warehouseRow = warehouseCache.get(warehouseId);
    if (!warehouseRow) {
      warehouseRow = await resolveWarehouseForOwnershipContext({
        tenantId,
        legalEntityId,
        warehouseId,
        ownershipContext,
        ownerLabel: "document",
        warehouseFieldLabel: `${fieldCollectionLabel}[${index + 1}].warehouseId`,
        requireActive: false,
        runQuery,
      });
      warehouseCache.set(warehouseId, warehouseRow);
    }
  }
}

function applyDocumentFxToDraftLines(lines, resolvedAmounts) {
  const documentFxRate =
    Number(resolvedAmounts?.amountTxn || 0) > AMOUNT_BALANCE_EPSILON
      ? Number(resolvedAmounts.amountBase || 0) / Number(resolvedAmounts.amountTxn || 1)
      : Number(resolvedAmounts?.fxRate || 1) || 1;
  for (const line of lines || []) {
    line.lineNetAmountBase = Number(
      (Number(line.lineNetAmountTxn || 0) * documentFxRate).toFixed(AMOUNT_PRECISION_SCALE)
    );
    line.lineTaxAmountBase = Number(
      (Number(line.lineTaxAmountTxn || 0) * documentFxRate).toFixed(AMOUNT_PRECISION_SCALE)
    );
    line.lineGrossAmountBase = Number(
      (Number(line.lineGrossAmountTxn || 0) * documentFxRate).toFixed(AMOUNT_PRECISION_SCALE)
    );
    for (const taxRow of line.taxes || []) {
      taxRow.taxBaseAmountBase = Number(
        (Number(taxRow.taxBaseAmountTxn || 0) * documentFxRate).toFixed(
          AMOUNT_PRECISION_SCALE
        )
      );
      taxRow.taxAmountBase = Number(
        (Number(taxRow.taxAmountTxn || 0) * documentFxRate).toFixed(
          AMOUNT_PRECISION_SCALE
        )
      );
    }
  }
}

async function applyResolvedLineTaxes({
  tenantId,
  legalEntityId,
  postingDate,
  direction,
  documentType,
  currencyCode,
  lines,
  runQuery = query,
}) {
  let requestedTaxResolution = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const wantsTaxResolution = Boolean(
      line.taxCategoryCode || line.taxCodeId || line.taxCode
    );
    if (!wantsTaxResolution) {
      if (Number(line.lineTaxAmountTxn || 0) > AMOUNT_BALANCE_EPSILON) {
        throw badRequest(
          `lines[${index}].lineTaxAmountTxn requires taxCategoryCode or taxCode`
        );
      }
      line.taxes = [];
      continue;
    }
    requestedTaxResolution = true;
    const computation = await resolveCariTaxComputation({
      tenantId,
      legalEntityId,
      postingDate,
      direction,
      documentType,
      baseAmount: line.lineNetAmountTxn,
      currencyCode,
      taxCodeId: line.taxCodeId,
      taxCode: line.taxCode,
      taxCategoryCode: line.taxCategoryCode,
      lineKind: line.lineKind,
      runQuery,
    });
    if (!computation.enabled) {
      throw badRequest(
        `Tax engine is disabled; cannot resolve tax for lines[${index + 1}]`
      );
    }

    const taxRows = (computation.taxLines || []).map((taxLine, componentIndex) => {
      const taxAmountTxn = Math.abs(Number(taxLine.amountTxn || 0));
      return {
        componentNo: componentIndex + 1,
        taxCode: toNullableString(taxLine.taxCode || computation.summary?.taxCode, 40),
        taxKind: computation.resolved?.taxCodeRow?.tax_kind || "VAT",
        ratePct: Number(computation.breakdown?.ratePct || 0),
        taxBaseAmountTxn: Number(computation.summary?.taxableBaseAmount || line.lineNetAmountTxn),
        taxAmountTxn,
        taxBaseAmountBase: null,
        taxAmountBase: null,
        taxPurposeCode: toNullableString(
          taxLine.taxPurposeCode || computation.summary?.taxPurposeCode,
          40
        ),
        accountId: parsePositiveInt(taxLine.accountId),
      };
    });
    line.taxes = taxRows;
    line.lineTaxAmountTxn = sumAmountRows(taxRows, "taxAmountTxn");
    line.lineGrossAmountTxn = Number(
      (Number(line.lineNetAmountTxn || 0) + Number(line.lineTaxAmountTxn || 0)).toFixed(
        AMOUNT_PRECISION_SCALE
      )
    );
  }
  return {
    requestedTaxResolution,
    lines,
  };
}

function buildSyntheticDraftLines({
  resolvedAmounts,
  existingLineRows = [],
}) {
  const existingSingleLine =
    Array.isArray(existingLineRows) && existingLineRows.length === 1
      ? existingLineRows[0]
      : null;
  const preservedQuantity = existingSingleLine
    ? normalizeAmount(existingSingleLine.quantity || 1, "existingLine.quantity", {
        allowZero: true,
      })
    : 1;
  const quantity = preservedQuantity > 0 ? preservedQuantity : 1;
  const unitPriceTxn =
    quantity > 0
      ? Number((resolvedAmounts.amountTxn / quantity).toFixed(AMOUNT_PRECISION_SCALE))
      : resolvedAmounts.amountTxn;

  return {
    lines: [
      {
        lineNo: 1,
        lineKind: normalizeUpperText(existingSingleLine?.line_kind || "STANDARD"),
        description: toNullableString(existingSingleLine?.description, 500),
        itemCardId: parsePositiveInt(existingSingleLine?.item_card_id),
        quantity,
        unitPriceTxn,
        lineNetAmountTxn: resolvedAmounts.amountTxn,
        lineTaxAmountTxn: 0,
        lineGrossAmountTxn: resolvedAmounts.amountTxn,
        lineNetAmountBase: resolvedAmounts.amountBase,
        lineTaxAmountBase: 0,
        lineGrossAmountBase: resolvedAmounts.amountBase,
        postingAccountId: parsePositiveInt(existingSingleLine?.posting_account_id),
        taxCodeId: null,
        taxCode: null,
        taxCategoryCode: toNullableString(existingSingleLine?.tax_category_code, 60),
        stockImpactMode: normalizeStockImpactMode(
          existingSingleLine?.stock_impact_mode
        ),
        warehouseId: parsePositiveInt(existingSingleLine?.warehouse_id),
        taxes: [],
      },
    ],
    headerTotals: {
      subtotalAmountTxn: resolvedAmounts.amountTxn,
      subtotalAmountBase: resolvedAmounts.amountBase,
      taxAmountTxn: 0,
      taxAmountBase: 0,
      grossAmountTxn: resolvedAmounts.amountTxn,
      grossAmountBase: resolvedAmounts.amountBase,
    },
    isSynthetic: true,
  };
}

async function replaceDocumentLinesTx(tx, { tenantId, legalEntityId, documentId, lines }) {
  await tx.query(
    `DELETE FROM cari_document_line_stock_links
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND cari_document_id = ?`,
    [tenantId, legalEntityId, documentId]
  );
  await tx.query(
    `DELETE FROM cari_document_line_taxes
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND cari_document_id = ?`,
    [tenantId, legalEntityId, documentId]
  );
  await tx.query(
    `DELETE FROM cari_document_lines
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND cari_document_id = ?`,
    [tenantId, legalEntityId, documentId]
  );

  for (const line of lines || []) {
    const insertResult = await tx.query(
      `INSERT INTO cari_document_lines (
          tenant_id,
          legal_entity_id,
          cari_document_id,
          line_no,
          line_kind,
          description,
          item_card_id,
          quantity,
          unit_price_txn,
          line_net_amount_txn,
          line_tax_amount_txn,
          line_gross_amount_txn,
          line_net_amount_base,
          line_tax_amount_base,
          line_gross_amount_base,
          posting_account_id,
          tax_category_code,
          stock_impact_mode,
          warehouse_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        documentId,
        line.lineNo,
        line.lineKind,
        line.description,
        line.itemCardId,
        line.quantity,
        line.unitPriceTxn,
        line.lineNetAmountTxn,
        line.lineTaxAmountTxn,
        line.lineGrossAmountTxn,
        line.lineNetAmountBase,
        line.lineTaxAmountBase,
        line.lineGrossAmountBase,
        line.postingAccountId,
        line.taxCategoryCode,
        line.stockImpactMode,
        line.warehouseId || null,
      ]
    );
    const insertedLineId = parsePositiveInt(insertResult.rows?.insertId);
    for (const taxRow of line.taxes || []) {
      await tx.query(
        `INSERT INTO cari_document_line_taxes (
            tenant_id,
            legal_entity_id,
            cari_document_id,
            cari_document_line_id,
            component_no,
            tax_code,
            tax_kind,
            rate_pct,
            tax_base_amount_txn,
            tax_amount_txn,
            tax_base_amount_base,
            tax_amount_base,
            tax_purpose_code,
            account_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          documentId,
          insertedLineId,
          taxRow.componentNo,
          taxRow.taxCode,
          taxRow.taxKind,
          taxRow.ratePct,
          taxRow.taxBaseAmountTxn,
          taxRow.taxAmountTxn,
          taxRow.taxBaseAmountBase,
          taxRow.taxAmountBase,
          taxRow.taxPurposeCode,
          taxRow.accountId,
        ]
      );
    }
  }
}

async function syncStoredDocumentLinesForPostingTx({
  tx,
  tenantId,
  legalEntityId,
  documentId,
  direction,
  documentLines,
}) {
  const workingLines = (documentLines || []).map((line) => ({
    ...line,
    taxes: Array.isArray(line?.taxes) ? line.taxes.map((tax) => ({ ...tax })) : [],
  }));
  const { mutated } = await applyItemCardDefaultsToLines({
    tenantId,
    legalEntityId,
    direction,
    lines: workingLines,
    runQuery: tx.query,
    applyTaxCategoryDefaults: false,
    fieldCollectionLabel: "storedLines",
  });
  if (!mutated) {
    return workingLines;
  }

  await replaceDocumentLinesTx(tx, {
    tenantId,
    legalEntityId,
    documentId,
    lines: workingLines,
  });
  return loadDocumentLinesForDocument({
    tenantId,
    legalEntityId,
    documentId,
    runQuery: tx.query,
  });
}

async function replaceDocumentLineStockLinksTx(
  tx,
  { tenantId, legalEntityId, documentId, direction, lines }
) {
  await tx.query(
    `DELETE FROM cari_document_line_stock_links
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND cari_document_id = ?`,
    [tenantId, legalEntityId, documentId]
  );

  for (const line of lines || []) {
    const lineId = parsePositiveInt(line.id);
    const itemCardId = parsePositiveInt(line.itemCardId);
    const stockImpactMode = normalizeStockImpactMode(line.stockImpactMode);
    if (!lineId || !itemCardId || !isStockAffectingLine({ stockImpactMode })) {
      continue;
    }

    await tx.query(
      `INSERT INTO cari_document_line_stock_links (
          tenant_id,
          legal_entity_id,
          cari_document_id,
          cari_document_line_id,
          item_card_id,
          direction,
          stock_impact_mode,
          link_status,
          requested_quantity,
          posted_net_amount_txn,
          posted_net_amount_base,
          warehouse_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        documentId,
        lineId,
        itemCardId,
        normalizeUpperText(direction),
        stockImpactMode,
        STOCK_LINK_STATUS_PENDING,
        normalizeAmount(line.quantity || 0, "stockLink.requestedQuantity", {
          allowZero: true,
        }),
        normalizeAmount(line.lineNetAmountTxn || 0, "stockLink.postedNetAmountTxn", {
          allowZero: true,
        }),
        normalizeAmount(line.lineNetAmountBase || 0, "stockLink.postedNetAmountBase", {
          allowZero: true,
        }),
        parsePositiveInt(line.warehouseId),
      ]
    );
  }
}

async function voidPendingDocumentLineStockLinksTx(
  tx,
  { tenantId, legalEntityId, documentId, resolutionNote }
) {
  await tx.query(
    `UPDATE cari_document_line_stock_links
     SET link_status = ?,
         resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
         resolution_note = ?
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND cari_document_id = ?
       AND link_status = ?`,
    [
      STOCK_LINK_STATUS_VOID,
      toNullableString(resolutionNote, 255),
      tenantId,
      legalEntityId,
      documentId,
      STOCK_LINK_STATUS_PENDING,
    ]
  );
}

async function resolveDraftDocumentWriteModel({
  tenantId,
  legalEntityId,
  documentOperatingUnitId = null,
  documentDate,
  direction,
  documentType,
  linesInput,
  amountTxn,
  amountBase,
  currencyCode,
  fxRate,
  functionalCurrencyCode,
  existingLineRows = [],
  runQuery = query,
}) {
  if (Array.isArray(linesInput) && linesInput.length > 0) {
    const normalizedLines = normalizeExplicitDraftLines(linesInput);
    await applyItemCardDefaultsToLines({
      tenantId,
      legalEntityId,
      direction,
      lines: normalizedLines,
      runQuery,
      applyTaxCategoryDefaults: true,
    });
    await assertDraftLineWarehouseBindingsForDocumentContext({
      tenantId,
      legalEntityId,
      documentOperatingUnitId,
      lines: normalizedLines,
      runQuery,
    });
    await applyResolvedLineTaxes({
      tenantId,
      legalEntityId,
      postingDate: documentDate,
      direction,
      documentType,
      currencyCode,
      lines: normalizedLines,
      runQuery,
    });
    const normalizedHeaderTotals = calculateDraftLineHeaderTotals(normalizedLines);
    const effectiveAmountTxn =
      amountTxn === null || amountTxn === undefined
        ? normalizedHeaderTotals.grossAmountTxn
        : amountTxn;
    const resolvedAmounts = resolveDraftDocumentAmounts({
      amountTxn: effectiveAmountTxn,
      amountBase,
      currencyCode,
      fxRate,
      functionalCurrencyCode,
    });
    if (
      !amountsAreEqual(
        normalizedHeaderTotals.grossAmountTxn,
        resolvedAmounts.amountTxn,
        AMOUNT_BALANCE_EPSILON
      )
    ) {
      throw badRequest("lines gross total must equal draft amountTxn");
    }
    applyDocumentFxToDraftLines(normalizedLines, resolvedAmounts);
    const headerTotals = calculateDraftLineHeaderTotals(normalizedLines);
    return {
      resolvedAmounts,
      lines: normalizedLines,
      headerTotals,
      isSynthetic: false,
    };
  }

  const resolvedAmounts = resolveDraftDocumentAmounts({
    amountTxn,
    amountBase,
    currencyCode,
    fxRate,
    functionalCurrencyCode,
  });
  const syntheticWriteModel = buildSyntheticDraftLines({
    resolvedAmounts,
    existingLineRows,
  });
  await applyItemCardDefaultsToLines({
    tenantId,
    legalEntityId,
    direction,
    lines: syntheticWriteModel.lines,
    runQuery,
    applyTaxCategoryDefaults: false,
  });
  await assertDraftLineWarehouseBindingsForDocumentContext({
    tenantId,
    legalEntityId,
    documentOperatingUnitId,
    lines: syntheticWriteModel.lines,
    runQuery,
  });
  return {
    resolvedAmounts,
    ...syntheticWriteModel,
  };
}

async function findReversalDocumentByOriginalId({
  tenantId,
  originalDocumentId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT id
     FROM cari_documents
     WHERE tenant_id = ?
       AND reversal_of_document_id = ?
     LIMIT 1`,
    [tenantId, originalDocumentId]
  );
  return parsePositiveInt(result.rows?.[0]?.id);
}

function isDuplicateKeyError(err, constraintName = null) {
  if (Number(err?.errno) !== 1062) {
    return false;
  }
  if (!constraintName) {
    return true;
  }
  return String(err?.message || "").includes(constraintName);
}

async function insertAuditLog({
  req,
  runQuery = query,
  tenantId,
  userId,
  action,
  legalEntityId,
  documentId,
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
      "cari_document",
      documentId ? String(documentId) : null,
      legalEntityId ? "LEGAL_ENTITY" : null,
      legalEntityId || null,
      toNullableString(req?.requestId || req?.headers?.["x-request-id"], 80),
      resolveClientIp(req),
      toNullableString(req?.headers?.["user-agent"], 255),
      safeStringify(payload || null),
    ]
  );
}

export async function resolveCariDocumentScope(documentId, tenantId) {
  const parsedDocumentId = parsePositiveInt(documentId);
  const parsedTenantId = parsePositiveInt(tenantId);
  if (!parsedDocumentId || !parsedTenantId) {
    return null;
  }

  const result = await query(
    `SELECT legal_entity_id, operating_unit_id
     FROM cari_documents
     WHERE tenant_id = ?
       AND id = ?
     LIMIT 1`,
    [parsedTenantId, parsedDocumentId]
  );
  const row = result.rows?.[0] || null;
  if (!row) {
    return null;
  }

  const operatingUnitId = parsePositiveInt(row.operating_unit_id);
  if (operatingUnitId) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: operatingUnitId,
    };
  }

  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: parsePositiveInt(row.legal_entity_id),
  };
}

export async function listCariDocuments({
  req,
  tenantId,
  filters,
  buildScopeFilter,
  assertScopeAccess,
}) {
  const params = [tenantId];
  const conditions = ["d.tenant_id = ?"];
  if (filters.operatingUnitId) {
    conditions.push(buildScopeFilter(req, "operating_unit", "d.operating_unit_id", params));
  } else {
    conditions.push(buildScopeFilter(req, "legal_entity", "d.legal_entity_id", params));
  }

  if (filters.legalEntityId) {
    assertScopeAccess(req, "legal_entity", filters.legalEntityId, "legalEntityId");
    conditions.push("d.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.operatingUnitId) {
    assertScopeAccess(req, "operating_unit", filters.operatingUnitId, "operatingUnitId");
    conditions.push("d.operating_unit_id = ?");
    params.push(filters.operatingUnitId);
  }

  if (filters.counterpartyId) {
    conditions.push("d.counterparty_id = ?");
    params.push(filters.counterpartyId);
  }
  if (filters.direction) {
    conditions.push("d.direction = ?");
    params.push(filters.direction);
  }
  if (filters.documentType) {
    conditions.push("d.document_type = ?");
    params.push(filters.documentType);
  }
  if (filters.status) {
    conditions.push("d.status = ?");
    params.push(filters.status);
  }
  if (filters.dateFrom) {
    conditions.push("d.document_date >= ?");
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push("d.document_date <= ?");
    params.push(filters.dateTo);
  }
  if (filters.q) {
    conditions.push(
      "(d.document_no LIKE ? OR d.counterparty_code_snapshot LIKE ? OR d.counterparty_name_snapshot LIKE ?)"
    );
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }

  const whereSql = conditions.join(" AND ");
  const totalResult = await query(
    `SELECT COUNT(*) AS row_count
     FROM cari_documents d
     WHERE ${whereSql}`,
    params
  );
  const total = Number(totalResult.rows?.[0]?.row_count || 0);

  const pagination = resolveOffsetPagination(filters, {
    defaultLimit: 100,
    defaultOffset: 0,
    maxLimit: 300,
  });

  const rowsResult = await query(
    `SELECT
        d.*,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        pt.code AS payment_term_code,
        pt.name AS payment_term_name
     FROM cari_documents d
     LEFT JOIN operating_units ou
       ON ou.id = d.operating_unit_id
     LEFT JOIN payment_terms pt
       ON pt.tenant_id = d.tenant_id
      AND pt.legal_entity_id = d.legal_entity_id
      AND pt.id = d.payment_term_id
     WHERE ${whereSql}
     ORDER BY d.id DESC
     LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params
  );

  return buildOffsetPaginationResult({
    rows: (rowsResult.rows || []).map(mapDocumentRow),
    total,
    limit: pagination.limit,
    offset: pagination.offset,
  });
}

export async function listCariDocumentWarehouseOptions({
  req,
  tenantId,
  filters,
  assertScopeAccess,
}) {
  const legalEntityId = parsePositiveInt(filters?.legalEntityId);
  if (!legalEntityId) {
    throw badRequest("legalEntityId is required");
  }
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");
  const operatingUnitId = parsePositiveInt(filters?.operatingUnitId);
  if (operatingUnitId) {
    assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
  } else {
    assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
  }
  return listActiveWarehousesForOwnershipContext({
    tenantId,
    legalEntityId,
    ownershipContext: deriveOwnershipContextFromOperatingUnitId(operatingUnitId),
    q: filters?.q,
    limit: filters?.limit,
    offset: filters?.offset,
  });
}

export async function getCariDocumentByIdForTenant({
  req,
  tenantId,
  documentId,
  assertScopeAccess,
  runQuery = query,
}) {
  const row = await fetchDocumentRow({ tenantId, documentId, runQuery });
  if (!row) {
    throw badRequest("Document not found");
  }
  assertDocumentScopeAccess(req, assertScopeAccess, row, "documentId");
  const lines = await loadDocumentLinesForDocument({
    tenantId,
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    documentId,
    runQuery,
  });
  return mapDocumentRow(row, { lines });
}

export async function listCariDocumentOpenItemsByIdForTenant({
  req,
  tenantId,
  documentId,
  assertScopeAccess,
}) {
  const row = await fetchDocumentRow({ tenantId, documentId });
  if (!row) {
    throw badRequest("Document not found");
  }

  const legalEntityId = parsePositiveInt(row.legal_entity_id);
  assertDocumentScopeAccess(req, assertScopeAccess, row, "documentId");

  const result = await query(
    `SELECT
        id,
        tenant_id,
        legal_entity_id,
        counterparty_id,
        document_id,
        item_no,
        status,
        document_date,
        due_date,
        original_amount_txn,
        original_amount_base,
        residual_amount_txn,
        residual_amount_base,
        settled_amount_txn,
        settled_amount_base,
        currency_code,
        created_at,
        updated_at
     FROM cari_open_items
     WHERE tenant_id = ?
       AND legal_entity_id = ?
       AND document_id = ?
     ORDER BY item_no ASC, id ASC`,
    [tenantId, legalEntityId, documentId]
  );

  return (result.rows || []).map(mapOpenItemRow);
}

export async function createCariDraftDocument({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const legalEntityId = payload.legalEntityId;
  const counterpartyId = payload.counterpartyId;
  const requestedOperatingUnitId = payload.operatingUnitId;

  assertFrozenTransactionType(payload.direction, payload.documentType);
  const legalEntity = await assertLegalEntityBelongsToTenant(
    tenantId,
    legalEntityId,
    "legalEntityId"
  );
  await assertCurrencyExists(payload.currencyCode, "currencyCode");

  const created = await withTransaction(async (tx) => {
    const counterparty = await fetchCounterpartyRow({
      tenantId,
      legalEntityId,
      counterpartyId,
      runQuery: tx.query,
    });
    if (!counterparty) {
      throw badRequest("counterpartyId must belong to legalEntityId");
    }

    const operatingUnitId = await resolveDocumentOperatingUnitForCounterparty({
      tenantId,
      legalEntityId,
      requestedOperatingUnitId,
      counterpartyRow: counterparty,
      runQuery: tx.query,
    });
    if (operatingUnitId) {
      assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
    } else {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const paymentTerm = await fetchPaymentTermRow({
      tenantId,
      legalEntityId,
      paymentTermId: payload.paymentTermId,
      runQuery: tx.query,
    });
    if (payload.paymentTermId && !paymentTerm) {
      throw badRequest("paymentTermId must belong to legalEntityId");
    }

    const resolvedDueDate = resolveDueDate({
      documentDate: payload.documentDate,
      dueDate: payload.dueDate,
      documentType: payload.documentType,
      paymentTermRow: paymentTerm,
    });
    assertDateOrder(payload.documentDate, resolvedDueDate);
    assertDueDateByDocumentType({
      documentType: payload.documentType,
      dueDate: resolvedDueDate,
    });
    const draftWriteModel = await resolveDraftDocumentWriteModel({
      tenantId,
      legalEntityId,
      documentOperatingUnitId: operatingUnitId,
      documentDate: payload.documentDate,
      direction: payload.direction,
      documentType: payload.documentType,
      linesInput: payload.lines,
      amountTxn: payload.amountTxn,
      amountBase: payload.amountBase,
      currencyCode: payload.currencyCode,
      fxRate: payload.fxRate,
      functionalCurrencyCode: legalEntity.functional_currency_code,
      runQuery: tx.query,
    });
    const { resolvedAmounts, headerTotals } = draftWriteModel;

    const draftNumbering = await reserveDraftSequence({
      tenantId,
      legalEntityId,
      direction: payload.direction,
      documentDate: payload.documentDate,
      runQuery: tx.query,
    });

    const insertResult = await tx.query(
      `INSERT INTO cari_documents (
          tenant_id,
          legal_entity_id,
          operating_unit_id,
          counterparty_id,
          payment_term_id,
          direction,
          document_type,
          sequence_namespace,
          fiscal_year,
          sequence_no,
          document_no,
          status,
          document_date,
          due_date,
          amount_txn,
          amount_base,
          subtotal_amount_txn,
          subtotal_amount_base,
          tax_amount_txn,
          tax_amount_base,
          gross_amount_txn,
          gross_amount_base,
          open_amount_txn,
          open_amount_base,
          currency_code,
          fx_rate,
          counterparty_code_snapshot,
          counterparty_name_snapshot,
          payment_term_snapshot,
          due_date_snapshot,
          currency_code_snapshot,
          fx_rate_snapshot
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        tenantId,
        legalEntityId,
        operatingUnitId,
        counterpartyId,
        payload.paymentTermId,
        payload.direction,
        payload.documentType,
        draftNumbering.sequenceNamespace,
        draftNumbering.fiscalYear,
        draftNumbering.sequenceNo,
        draftNumbering.documentNo,
        DRAFT_STATUS,
        payload.documentDate,
        resolvedDueDate,
        resolvedAmounts.amountTxn,
        resolvedAmounts.amountBase,
        headerTotals.subtotalAmountTxn,
        headerTotals.subtotalAmountBase,
        headerTotals.taxAmountTxn,
        headerTotals.taxAmountBase,
        headerTotals.grossAmountTxn,
        headerTotals.grossAmountBase,
        resolvedAmounts.amountTxn,
        resolvedAmounts.amountBase,
        resolvedAmounts.currencyCode,
        resolvedAmounts.fxRate,
        counterparty.code,
        counterparty.name,
        paymentTerm?.code || null,
        resolvedDueDate,
        resolvedAmounts.currencyCode,
        resolvedAmounts.fxRate,
      ]
    );
    const documentId = parsePositiveInt(insertResult.rows?.insertId);
    if (!documentId) {
      throw new Error("Document create failed");
    }

    await replaceDocumentLinesTx(tx, {
      tenantId,
      legalEntityId,
      documentId,
      lines: draftWriteModel.lines,
    });

    const row = await fetchDocumentRow({
      tenantId,
      documentId,
      runQuery: tx.query,
    });
    if (!row) {
      throw new Error("Document create readback failed");
    }

    await insertAuditLog({
      req,
      runQuery: tx.query,
      tenantId,
      userId: payload.userId,
      action: "cari.document.draft.create",
      legalEntityId,
      documentId,
      payload: {
        direction: row.direction,
        documentType: row.document_type,
        status: row.status,
        lineCount: draftWriteModel.lines.length,
        syntheticLineMode: draftWriteModel.isSynthetic,
      },
    });

    const lines = await loadDocumentLinesForDocument({
      tenantId,
      legalEntityId,
      documentId,
      runQuery: tx.query,
    });
    return mapDocumentRow(row, { lines });
  });

  return created;
}

export async function updateCariDraftDocumentById({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const documentId = payload.documentId;
  const existing = await fetchDocumentRow({
    tenantId,
    documentId,
  });
  if (!existing) {
    throw badRequest("Document not found");
  }

  const existingLegalEntityId = parsePositiveInt(existing.legal_entity_id);
  const existingOperatingUnitId = parsePositiveInt(existing.operating_unit_id);
  assertDocumentScopeAccess(req, assertScopeAccess, existing, "documentId");
  if (existing.status !== DRAFT_STATUS) {
    throw badRequest("Only DRAFT documents can be updated");
  }

  if (
    payload.legalEntityId !== undefined &&
    payload.legalEntityId !== null &&
    payload.legalEntityId !== existingLegalEntityId
  ) {
    throw badRequest("legalEntityId cannot be changed for existing documents");
  }
  const legalEntityId = existingLegalEntityId;
  const nextOperatingUnitId =
    payload.operatingUnitId === undefined
      ? existingOperatingUnitId
      : payload.operatingUnitId;
  const expectedRowVersion = Number(payload.rowVersion || 0);
  if (!Number.isInteger(expectedRowVersion) || expectedRowVersion <= 0) {
    throw badRequest("rowVersion is required");
  }

  const nextDirection = payload.direction || existing.direction;
  const nextDocumentType = payload.documentType || existing.document_type;
  const nextDocumentDate =
    payload.documentDate || toDateOnlyString(existing.document_date, "documentDate");
  const nextCounterpartyId =
    payload.counterpartyId === undefined
      ? parsePositiveInt(existing.counterparty_id)
      : payload.counterpartyId;
  const nextPaymentTermId =
    payload.paymentTermId === undefined
      ? parsePositiveInt(existing.payment_term_id)
      : payload.paymentTermId;
  const nextAmountTxn =
    payload.amountTxn === undefined ? existing.amount_txn : payload.amountTxn;
  const nextAmountBase =
    payload.amountBase === undefined ? existing.amount_base : payload.amountBase;
  const nextCurrencyCode =
    payload.currencyCode === undefined ? existing.currency_code : payload.currencyCode;
  const nextFxRate = payload.fxRate === undefined ? existing.fx_rate : payload.fxRate;
  const financialFieldsTouched =
    payload.amountTxn !== undefined ||
    payload.amountBase !== undefined ||
    payload.currencyCode !== undefined ||
    payload.fxRate !== undefined;

  assertFrozenTransactionType(nextDirection, nextDocumentType);
  const legalEntity = await assertLegalEntityBelongsToTenant(
    tenantId,
    legalEntityId,
    "legalEntityId"
  );
  await assertCurrencyExists(nextCurrencyCode, "currencyCode");

  const updated = await withTransaction(async (tx) => {
    const counterparty = await fetchCounterpartyRow({
      tenantId,
      legalEntityId,
      counterpartyId: nextCounterpartyId,
      runQuery: tx.query,
    });
    if (!counterparty) {
      throw badRequest("counterpartyId must belong to legalEntityId");
    }

    const operatingUnitId = await resolveDocumentOperatingUnitForCounterparty({
      tenantId,
      legalEntityId,
      requestedOperatingUnitId: nextOperatingUnitId,
      counterpartyRow: counterparty,
      runQuery: tx.query,
    });
    if (operatingUnitId) {
      assertScopeAccess(req, "operating_unit", operatingUnitId, "operatingUnitId");
    } else if (payload.operatingUnitId !== undefined || legalEntityId !== parsePositiveInt(existing.legal_entity_id)) {
      assertScopeAccess(req, "legal_entity", legalEntityId, "legalEntityId");
    }

    const paymentTerm = await fetchPaymentTermRow({
      tenantId,
      legalEntityId,
      paymentTermId: nextPaymentTermId,
      runQuery: tx.query,
    });
    if (nextPaymentTermId && !paymentTerm) {
      throw badRequest("paymentTermId must belong to legalEntityId");
    }

    const requestedDueDate =
      payload.dueDate === undefined
        ? toDateOnlyString(existing.due_date, "dueDate")
        : payload.dueDate;
    const resolvedDueDate = resolveDueDate({
      documentDate: nextDocumentDate,
      dueDate: requestedDueDate,
      documentType: nextDocumentType,
      paymentTermRow: paymentTerm,
    });
    assertDateOrder(nextDocumentDate, resolvedDueDate);
    assertDueDateByDocumentType({
      documentType: nextDocumentType,
      dueDate: resolvedDueDate,
    });
    const existingLineRows = await listDocumentLineRows({
      tenantId,
      legalEntityId,
      documentId,
      runQuery: tx.query,
    });
    const hasExplicitLines = Array.isArray(payload.lines);
    if (!hasExplicitLines && existingLineRows.length > 1 && financialFieldsTouched) {
      throw badRequest(
        "lines is required when updating amount/fx fields on a multi-line document"
      );
    }

    const shouldReplaceLines =
      hasExplicitLines || existingLineRows.length === 0 || (existingLineRows.length <= 1 && financialFieldsTouched);
    const draftWriteModel = shouldReplaceLines
      ? await resolveDraftDocumentWriteModel({
          tenantId,
          legalEntityId,
          documentOperatingUnitId: operatingUnitId,
          documentDate: nextDocumentDate,
          direction: nextDirection,
          documentType: nextDocumentType,
          linesInput: hasExplicitLines ? payload.lines : null,
          amountTxn: hasExplicitLines ? payload.amountTxn : nextAmountTxn,
          amountBase: payload.amountBase,
          currencyCode: nextCurrencyCode,
          fxRate: nextFxRate,
          functionalCurrencyCode: legalEntity.functional_currency_code,
          existingLineRows,
          runQuery: tx.query,
        })
      : null;
    const resolvedAmounts = draftWriteModel
      ? draftWriteModel.resolvedAmounts
      : {
          amountTxn: normalizeAmount(nextAmountTxn, "amountTxn"),
          amountBase: normalizeAmount(nextAmountBase, "amountBase"),
          currencyCode: normalizeUpperText(nextCurrencyCode),
          fxRate: normalizeOptionalPositiveDecimal(nextFxRate, "fxRate"),
        };
    const headerTotals = draftWriteModel
      ? draftWriteModel.headerTotals
      : {
          subtotalAmountTxn: toDecimalNumber(existing.subtotal_amount_txn),
          subtotalAmountBase: toDecimalNumber(existing.subtotal_amount_base),
          taxAmountTxn: toDecimalNumber(existing.tax_amount_txn),
          taxAmountBase: toDecimalNumber(existing.tax_amount_base),
          grossAmountTxn: toDecimalNumber(existing.gross_amount_txn),
          grossAmountBase: toDecimalNumber(existing.gross_amount_base),
        };

    let sequenceNamespace = existing.sequence_namespace;
    let fiscalYear = Number(existing.fiscal_year);
    let sequenceNo = Number(existing.sequence_no);
    let documentNo = existing.document_no;

    const nextFiscalYear = Number(String(nextDocumentDate).slice(0, 4));
    const shouldReassignDraftNumber =
      existing.sequence_namespace === DRAFT_SEQUENCE_NAMESPACE &&
      (nextDirection !== existing.direction || nextFiscalYear !== Number(existing.fiscal_year));

    if (shouldReassignDraftNumber) {
      const draftNumbering = await reserveDraftSequence({
        tenantId,
        legalEntityId,
        direction: nextDirection,
        documentDate: nextDocumentDate,
        runQuery: tx.query,
      });
      sequenceNamespace = draftNumbering.sequenceNamespace;
      fiscalYear = draftNumbering.fiscalYear;
      sequenceNo = draftNumbering.sequenceNo;
      documentNo = draftNumbering.documentNo;
    }

    await tx.query(
      `UPDATE cari_documents
       SET operating_unit_id = ?,
           counterparty_id = ?,
           payment_term_id = ?,
           direction = ?,
           document_type = ?,
           sequence_namespace = ?,
           fiscal_year = ?,
           sequence_no = ?,
           document_no = ?,
           document_date = ?,
           due_date = ?,
           amount_txn = ?,
           amount_base = ?,
           subtotal_amount_txn = ?,
           subtotal_amount_base = ?,
           tax_amount_txn = ?,
           tax_amount_base = ?,
           gross_amount_txn = ?,
           gross_amount_base = ?,
           open_amount_txn = ?,
           open_amount_base = ?,
           currency_code = ?,
           fx_rate = ?,
           counterparty_code_snapshot = ?,
           counterparty_name_snapshot = ?,
           payment_term_snapshot = ?,
           due_date_snapshot = ?,
           currency_code_snapshot = ?,
           fx_rate_snapshot = ?,
           row_version = row_version + 1
       WHERE tenant_id = ?
         AND id = ?
         AND row_version = ?`,
      [
        operatingUnitId,
        nextCounterpartyId,
        nextPaymentTermId,
        nextDirection,
        nextDocumentType,
        sequenceNamespace,
        fiscalYear,
        sequenceNo,
        documentNo,
        nextDocumentDate,
        resolvedDueDate,
        resolvedAmounts.amountTxn,
        resolvedAmounts.amountBase,
        headerTotals.subtotalAmountTxn,
        headerTotals.subtotalAmountBase,
        headerTotals.taxAmountTxn,
        headerTotals.taxAmountBase,
        headerTotals.grossAmountTxn,
        headerTotals.grossAmountBase,
        resolvedAmounts.amountTxn,
        resolvedAmounts.amountBase,
        resolvedAmounts.currencyCode,
        resolvedAmounts.fxRate,
        counterparty.code,
        counterparty.name,
        paymentTerm?.code || null,
        resolvedDueDate,
        resolvedAmounts.currencyCode,
        resolvedAmounts.fxRate,
        tenantId,
        documentId,
        expectedRowVersion,
      ]
    );
    const updateResult = await tx.query(
      `SELECT ROW_COUNT() AS affected_rows`
    );
    const affectedRows = Number(updateResult.rows?.[0]?.affected_rows || 0);
    if (affectedRows !== 1) {
      throw optimisticLockConflictError(
        "Document update conflict: refresh and retry with latest rowVersion."
      );
    }

    if (shouldReplaceLines) {
      await replaceDocumentLinesTx(tx, {
        tenantId,
        legalEntityId,
        documentId,
        lines: draftWriteModel.lines,
      });
    }

    const row = await fetchDocumentRow({
      tenantId,
      documentId,
      runQuery: tx.query,
    });
    if (!row) {
      throw new Error("Document update readback failed");
    }

    await insertAuditLog({
      req,
      runQuery: tx.query,
      tenantId,
      userId: payload.userId,
      action: "cari.document.draft.update",
      legalEntityId,
      documentId,
      payload: {
        before: {
          direction: existing.direction,
          documentType: existing.document_type,
          amountTxn: toDecimalNumber(existing.amount_txn),
          amountBase: toDecimalNumber(existing.amount_base),
          documentDate: existing.document_date,
          dueDate: existing.due_date,
          lineCount: existingLineRows.length,
        },
        after: {
          direction: row.direction,
          documentType: row.document_type,
          amountTxn: toDecimalNumber(row.amount_txn),
          amountBase: toDecimalNumber(row.amount_base),
          documentDate: row.document_date,
          dueDate: row.due_date,
          lineCount: shouldReplaceLines
            ? draftWriteModel.lines.length
            : existingLineRows.length,
        },
      },
    });

    const lines = await loadDocumentLinesForDocument({
      tenantId,
      legalEntityId,
      documentId,
      runQuery: tx.query,
    });
    return mapDocumentRow(row, { lines });
  });

  return updated;
}

export async function cancelCariDraftDocumentById({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const documentId = payload.documentId;
  const existing = await fetchDocumentRow({
    tenantId,
    documentId,
  });
  if (!existing) {
    throw badRequest("Document not found");
  }

  const legalEntityId = parsePositiveInt(existing.legal_entity_id);
  assertDocumentScopeAccess(req, assertScopeAccess, existing, "documentId");
  if (existing.status !== DRAFT_STATUS) {
    throw badRequest("Only DRAFT documents can be cancelled");
  }

  const updated = await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE cari_documents
       SET status = ?,
           open_amount_txn = 0.000000,
           open_amount_base = 0.000000
       WHERE tenant_id = ?
         AND id = ?`,
      [CANCELLED_STATUS, tenantId, documentId]
    );

    const row = await fetchDocumentRow({
      tenantId,
      documentId,
      runQuery: tx.query,
    });
    if (!row) {
      throw new Error("Document cancel readback failed");
    }

    await insertAuditLog({
      req,
      runQuery: tx.query,
      tenantId,
      userId: payload.userId,
      action: "cari.document.draft.cancel",
      legalEntityId,
      documentId,
      payload: {
        beforeStatus: existing.status,
        afterStatus: row.status,
      },
    });

    return mapDocumentRow(row);
  });

  return updated;
}

export async function postCariDocumentById({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const documentId = payload.documentId;

  const existing = await fetchDocumentRow({
    tenantId,
    documentId,
  });
  if (!existing) {
    throw badRequest("Document not found");
  }

  const legalEntityId = parsePositiveInt(existing.legal_entity_id);
  assertDocumentScopeAccess(req, assertScopeAccess, existing, "documentId");
  if (normalizeUpperText(existing.status) !== DRAFT_STATUS) {
    throw badRequest("Only DRAFT documents can be posted");
  }

  const posted = await withTransaction(async (tx) => {
    const lockedDocument = await fetchDocumentRowForUpdate({
      tenantId,
      documentId,
      runQuery: tx.query,
    });
    if (!lockedDocument) {
      throw badRequest("Document not found");
    }

    const lockedLegalEntityId = parsePositiveInt(lockedDocument.legal_entity_id);
    const documentOperatingUnitId = parsePositiveInt(lockedDocument.operating_unit_id) || null;
    if (normalizeUpperText(lockedDocument.status) !== DRAFT_STATUS) {
      throw badRequest("Only DRAFT documents can be posted");
    }

    await assertLegalEntityBelongsToTenant(
      tenantId,
      lockedLegalEntityId,
      "legalEntityId"
    );

    const documentDate = normalizeDateInput(
      lockedDocument.document_date,
      "documentDate"
    );
    const direction = normalizeUpperText(lockedDocument.direction);
    const documentType = normalizeUpperText(lockedDocument.document_type);
    const currencyCode = normalizeUpperText(lockedDocument.currency_code);
    const counterpartyId = parsePositiveInt(lockedDocument.counterparty_id);
    const paymentTermId = parsePositiveInt(lockedDocument.payment_term_id);

    const counterparty = await fetchCounterpartyRow({
      tenantId,
      legalEntityId: lockedLegalEntityId,
      counterpartyId,
      runQuery: tx.query,
    });
    if (!counterparty) {
      throw badRequest("counterpartyId must belong to legalEntityId");
    }

    const paymentTerm = await fetchPaymentTermRow({
      tenantId,
      legalEntityId: lockedLegalEntityId,
      paymentTermId,
      runQuery: tx.query,
    });
    if (paymentTermId && !paymentTerm) {
      throw badRequest("paymentTermId must belong to legalEntityId");
    }

    const resolvedDueDate = resolveDueDate({
      documentDate,
      dueDate: toDateOnlyString(lockedDocument.due_date, "dueDate"),
      documentType,
      paymentTermRow: paymentTerm,
    });
    assertDateOrder(documentDate, resolvedDueDate);
    assertDueDateByDocumentType({
      documentType,
      dueDate: resolvedDueDate,
    });

    const legalEntity = await assertLegalEntityBelongsToTenant(
      tenantId,
      lockedLegalEntityId,
      "legalEntityId"
    );
    const fxPolicy = await resolveFxPostingPolicy({
      tenantId,
      documentDate,
      documentCurrencyCode: currencyCode,
      functionalCurrencyCode: legalEntity.functional_currency_code,
      draftFxRate: lockedDocument.fx_rate,
      useFxOverride: Boolean(payload.useFxOverride),
      fxOverrideReason: payload.fxOverrideReason,
      runQuery: tx.query,
    });

    const postingAccounts = await resolveCariPostingAccounts({
      tenantId,
      legalEntityId: lockedLegalEntityId,
      direction,
      counterpartyRow: counterparty,
      offsetAccountId: payload.offsetAccountId,
      offsetAccountCode: payload.offsetAccountCode,
      runQuery: tx.query,
    });

    let documentLines = await loadDocumentLinesForDocument({
      tenantId,
      legalEntityId: lockedLegalEntityId,
      documentId,
      runQuery: tx.query,
    });
    documentLines = await syncStoredDocumentLinesForPostingTx({
      tx,
      tenantId,
      legalEntityId: lockedLegalEntityId,
      documentId,
      direction,
      documentLines,
    });
    await assertStrictStockDocumentPostingReadiness({
      tenantId,
      legalEntityId: lockedLegalEntityId,
      documentOperatingUnitId,
      documentLines,
      fieldCollectionLabel: "storedLines",
      ownerLabel: "document",
      runQuery: tx.query,
    });
    const postedNumbering = await reservePostedSequence({
      tenantId,
      legalEntityId: lockedLegalEntityId,
      direction,
      documentType,
      documentDate,
      runQuery: tx.query,
    });
    const usesStoredLineTaxes = documentLines.some(
      (line) => Array.isArray(line?.taxes) && line.taxes.length > 0
    );
    if (
      usesStoredLineTaxes &&
      Array.isArray(payload.postingLines) &&
      payload.postingLines.length > 0
    ) {
      throw badRequest("postingLines are not supported for line-taxed documents yet");
    }

    const documentNetAmountTxn = normalizeAmount(
      documentLines.length > 0
        ? sumAmountRows(documentLines, "lineNetAmountTxn")
        : lockedDocument.subtotal_amount_txn ?? lockedDocument.amount_txn,
      "documentNetAmountTxn"
    );
    const documentNetAmountBase = normalizeAmount(
      documentLines.length > 0
        ? sumAmountRows(documentLines, "lineNetAmountBase")
        : lockedDocument.subtotal_amount_base ?? lockedDocument.amount_base,
      "documentNetAmountBase"
    );
    const subledgerReferenceNo = `${CARI_SUBLEDGER_REFERENCE_PREFIX}${documentId}`;
    const defaultLineDescription = `Cari ${direction} ${documentType} ${postedNumbering.documentNo}`;
    const postingLineRows = Array.isArray(payload.postingLines) ? payload.postingLines : null;
    const postingSides = resolveCariPostingSides({ direction, documentType });
    const postingLineSummary = [];
    const postingLines = [];
    let postingLinesUseLineLevelOffsets = false;

    if (postingLineRows?.length) {
      let postingLinesTotalTxn = 0;
      let postingLinesTotalBase = 0;

      for (let index = 0; index < postingLineRows.length; index += 1) {
        const line = postingLineRows[index] || {};
        const lineAmountTxn = normalizeAmount(
          line.amountTxn,
          `postingLines[${index}].amountTxn`
        );
        const lineAmountBase = normalizeAmount(
          line.amountBase,
          `postingLines[${index}].amountBase`
        );
        const lineHasOffsetOverride =
          parsePositiveInt(line.offsetAccountId) ||
          String(line.offsetAccountCode || "").trim();

        let linePostingAccounts = postingAccounts;
        if (lineHasOffsetOverride) {
          linePostingAccounts = await resolveCariPostingAccounts({
            tenantId,
            legalEntityId: lockedLegalEntityId,
            direction,
            counterpartyRow: counterparty,
            offsetAccountId: line.offsetAccountId,
            offsetAccountCode: line.offsetAccountCode,
            runQuery: tx.query,
          });
          postingLinesUseLineLevelOffsets = true;
        }

        if (
          parsePositiveInt(linePostingAccounts.controlAccountId) !==
          parsePositiveInt(postingAccounts.controlAccountId)
        ) {
          throw badRequest(
            `postingLines[${index}] resolved a different control account; check counterparty or mapping setup`
          );
        }

        postingLinesTotalTxn = Number(
          (postingLinesTotalTxn + lineAmountTxn).toFixed(AMOUNT_PRECISION_SCALE)
        );
        postingLinesTotalBase = Number(
          (postingLinesTotalBase + lineAmountBase).toFixed(AMOUNT_PRECISION_SCALE)
        );

        const lineDescription = summarizePostingLineDescription({
          baseDescription: defaultLineDescription,
          lineDescription: line.description,
          lineIndex: index,
          lineCount: postingLineRows.length,
        });
        postingLineSummary.push({
          lineNo: index + 1,
          amountTxn: lineAmountTxn,
          amountBase: lineAmountBase,
          offsetAccountId: linePostingAccounts.offsetAccountId,
          offsetAccountCode: linePostingAccounts.offsetAccountCode || null,
          description: toNullableString(line.description, 255),
        });
        postingLines.push(
          buildCariDirectionalJournalLine({
            accountId: linePostingAccounts.offsetAccountId,
            side: postingSides.offsetSide,
            amountTxn: lineAmountTxn,
            amountBase: lineAmountBase,
            lineDescription,
            subledgerReferenceNo,
            currencyCode,
          })
        );
      }

      if (
        !amountsAreEqual(
          postingLinesTotalTxn,
          documentNetAmountTxn,
          AMOUNT_BALANCE_EPSILON
        ) ||
        !amountsAreEqual(
          postingLinesTotalBase,
          documentNetAmountBase,
          AMOUNT_BALANCE_EPSILON
        )
      ) {
        throw badRequest(
          "postingLines totals must equal draft net/subtotal amountTxn and amountBase"
        );
      }
    } else if (documentLines.length > 0) {
      let lineDrivenTotalTxn = 0;
      let lineDrivenTotalBase = 0;

      for (let index = 0; index < documentLines.length; index += 1) {
        const line = documentLines[index] || {};
        const lineAmountTxn = normalizeAmount(
          line.lineNetAmountTxn ?? 0,
          `documentLines[${index}].lineNetAmountTxn`,
          { allowZero: true }
        );
        const lineAmountBase = normalizeAmount(
          line.lineNetAmountBase ?? 0,
          `documentLines[${index}].lineNetAmountBase`,
          { allowZero: true }
        );
        if (
          lineAmountTxn <= AMOUNT_BALANCE_EPSILON &&
          lineAmountBase <= AMOUNT_BALANCE_EPSILON
        ) {
          continue;
        }

        lineDrivenTotalTxn = Number(
          (lineDrivenTotalTxn + lineAmountTxn).toFixed(AMOUNT_PRECISION_SCALE)
        );
        lineDrivenTotalBase = Number(
          (lineDrivenTotalBase + lineAmountBase).toFixed(AMOUNT_PRECISION_SCALE)
        );

        const resolvedLinePostingAccount = parsePositiveInt(line.postingAccountId)
          ? await resolveCariLinePostingAccount({
              tenantId,
              legalEntityId: lockedLegalEntityId,
              accountId: line.postingAccountId,
              fieldLabel: `lines[${index + 1}].postingAccountId`,
              runQuery: tx.query,
            })
          : {
              id: postingAccounts.offsetAccountId,
              code: postingAccounts.offsetAccountCode || null,
            };
        const lineDescription = summarizePostingLineDescription({
          baseDescription: defaultLineDescription,
          lineDescription: line.description,
          lineIndex: index,
          lineCount: documentLines.length,
        });
        postingLineSummary.push({
          lineNo: Number(line.lineNo || index + 1),
          amountTxn: lineAmountTxn,
          amountBase: lineAmountBase,
          offsetAccountId: resolvedLinePostingAccount.id,
          offsetAccountCode: resolvedLinePostingAccount.code || null,
          description: toNullableString(line.description, 255),
        });
        postingLines.push(
          buildCariDirectionalJournalLine({
            accountId: resolvedLinePostingAccount.id,
            side: postingSides.offsetSide,
            amountTxn: lineAmountTxn,
            amountBase: lineAmountBase,
            lineDescription,
            subledgerReferenceNo,
            currencyCode,
          })
        );
      }

      if (
        !amountsAreEqual(
          lineDrivenTotalTxn,
          documentNetAmountTxn,
          AMOUNT_BALANCE_EPSILON
        ) ||
        !amountsAreEqual(
          lineDrivenTotalBase,
          documentNetAmountBase,
          AMOUNT_BALANCE_EPSILON
        )
      ) {
        throw badRequest(
          "Stored document lines are out of sync with draft subtotal amounts"
        );
      }
    } else {
      postingLineSummary.push({
        lineNo: 1,
        amountTxn: documentNetAmountTxn,
        amountBase: documentNetAmountBase,
        offsetAccountId: postingAccounts.offsetAccountId,
        offsetAccountCode: postingAccounts.offsetAccountCode || null,
        description: null,
      });
      postingLines.push(
        buildCariDirectionalJournalLine({
          accountId: postingAccounts.offsetAccountId,
          side: postingSides.offsetSide,
          amountTxn: documentNetAmountTxn,
          amountBase: documentNetAmountBase,
          lineDescription: defaultLineDescription,
          subledgerReferenceNo,
          currencyCode,
        })
      );
    }

    const taxAugmentation = usesStoredLineTaxes
      ? {
          enabled: true,
          lines: buildCariTaxAugmentationFromStoredLineTaxes({
            lineTaxes: documentLines.flatMap((line) => line.taxes || []),
            controlAccountId: postingAccounts.controlAccountId,
            direction,
            reverseTaxSign: !POSITIVE_SIGN_DOCUMENT_TYPES.has(documentType),
            currencyCode,
            subledgerReferenceNo,
            lineDescription: `Cari tax ${direction} ${documentType} ${postedNumbering.documentNo}`.slice(
              0,
              255
            ),
            includeControlBalancing: false,
          }),
          summary: null,
        }
      : await buildCariTaxAugmentation({
          tenantId,
          legalEntityId: lockedLegalEntityId,
          postingDate: documentDate,
          direction,
          documentType,
          baseAmount: documentNetAmountBase,
          controlAccountId: postingAccounts.controlAccountId,
          currencyCode,
          subledgerReferenceNo,
          lineDescription: `Cari tax ${direction} ${documentType} ${postedNumbering.documentNo}`.slice(
            0,
            255
          ),
          reverseTaxSign: !POSITIVE_SIGN_DOCUMENT_TYPES.has(documentType),
          includeControlBalancing: false,
          runQuery: tx.query,
        });
    const taxAmountTxn = taxAugmentation.lines.length
      ? sumJournalLineAmountsTxn(taxAugmentation.lines)
      : normalizeAmount(lockedDocument.tax_amount_txn ?? 0, "taxAmountTxn", {
          allowZero: true,
        });
    const taxAmountBase = taxAugmentation.lines.length
      ? sumJournalLineAmountsBase(taxAugmentation.lines)
      : normalizeAmount(lockedDocument.tax_amount_base ?? 0, "taxAmountBase", {
          allowZero: true,
        });
    const grossAmountTxn = Number(
      (documentNetAmountTxn + taxAmountTxn).toFixed(AMOUNT_PRECISION_SCALE)
    );
    const grossAmountBase = Number(
      (documentNetAmountBase + taxAmountBase).toFixed(AMOUNT_PRECISION_SCALE)
    );

    if (taxAugmentation.lines.length > 0) {
      postingLines.push(...taxAugmentation.lines);
    }
    postingLines.push(
      buildCariDirectionalJournalLine({
        accountId: postingAccounts.controlAccountId,
        side: postingSides.controlSide,
        amountTxn: grossAmountTxn,
        amountBase: grossAmountBase,
        lineDescription: defaultLineDescription,
        subledgerReferenceNo,
        currencyCode,
      })
    );
    ensureBalancedJournalLines(postingLines);

    const journalContext = await resolveBookAndOpenPeriodForDate({
      tenantId,
      legalEntityId: lockedLegalEntityId,
      targetDate: documentDate,
      runQuery: tx.query,
    });

    const journalResult = await insertPostedJournalWithLinesTx(tx, {
      tenantId,
      legalEntityId: lockedLegalEntityId,
      operatingUnitId: documentOperatingUnitId,
      bookId: journalContext.bookId,
      fiscalPeriodId: journalContext.fiscalPeriodId,
      userId: payload.userId,
      journalNo: buildCariJournalNo("CARI", documentId),
      entryDate: documentDate,
      documentDate,
      currencyCode,
      description: `Cari ${direction} ${documentType} ${postedNumbering.documentNo}`.slice(
        0,
        500
      ),
      referenceNo: toNullableString(postedNumbering.documentNo, 100),
      lines: postingLines,
    });
    await upsertJournalSourceLinkTx(tx, {
      tenantId,
      legalEntityId: lockedLegalEntityId,
      journalEntryId: journalResult.journalEntryId,
      sourceRefType: "CARI_DOCUMENT",
      sourceRefId: documentId,
    });

    const paymentTermSnapshot = buildPaymentTermSnapshot(paymentTerm);
    await tx.query(
      `UPDATE cari_documents
       SET payment_term_id = ?,
           sequence_namespace = ?,
           fiscal_year = ?,
           sequence_no = ?,
           document_no = ?,
           status = ?,
           due_date = ?,
           subtotal_amount_txn = ?,
           subtotal_amount_base = ?,
           tax_amount_txn = ?,
           tax_amount_base = ?,
           gross_amount_txn = ?,
           gross_amount_base = ?,
           amount_txn = ?,
           amount_base = ?,
           open_amount_txn = ?,
           open_amount_base = ?,
           fx_rate = ?,
           counterparty_code_snapshot = ?,
           counterparty_name_snapshot = ?,
           payment_term_snapshot = ?,
           due_date_snapshot = ?,
           currency_code_snapshot = ?,
           fx_rate_snapshot = ?,
           posted_journal_entry_id = ?,
           posted_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND id = ?`,
      [
        paymentTermId || null,
        postedNumbering.sequenceNamespace,
        postedNumbering.fiscalYear,
        postedNumbering.sequenceNo,
        postedNumbering.documentNo,
        POSTED_STATUS,
        resolvedDueDate,
        documentNetAmountTxn,
        documentNetAmountBase,
        taxAmountTxn,
        taxAmountBase,
        grossAmountTxn,
        grossAmountBase,
        grossAmountTxn,
        grossAmountBase,
        grossAmountTxn,
        grossAmountBase,
        fxPolicy.effectiveFxRate,
        counterparty.code,
        counterparty.name,
        paymentTermSnapshot,
        resolvedDueDate,
        currencyCode,
        fxPolicy.effectiveFxRate,
        journalResult.journalEntryId,
        tenantId,
        documentId,
      ]
    );

    const openItemDueDate = resolvedDueDate || documentDate;
    await tx.query(
      `INSERT INTO cari_open_items (
          tenant_id,
          legal_entity_id,
          counterparty_id,
          document_id,
          item_no,
          status,
          document_date,
          due_date,
          original_amount_txn,
          original_amount_base,
          residual_amount_txn,
          residual_amount_base,
          settled_amount_txn,
          settled_amount_base,
          currency_code
       )
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0.000000, 0.000000, ?)`,
      [
        tenantId,
        lockedLegalEntityId,
        counterpartyId,
        documentId,
        OPEN_ITEM_STATUS_OPEN,
        documentDate,
        openItemDueDate,
        grossAmountTxn,
        grossAmountBase,
        grossAmountTxn,
        grossAmountBase,
        currencyCode,
      ]
    );
    await replaceDocumentLineStockLinksTx(tx, {
      tenantId,
      legalEntityId: lockedLegalEntityId,
      documentId,
      direction,
      lines: documentLines,
    });

    const row = await fetchDocumentRow({
      tenantId,
      documentId,
      runQuery: tx.query,
    });
    if (!row) {
      throw new Error("Document post readback failed");
    }

    await insertAuditLog({
      req,
      runQuery: tx.query,
      tenantId,
      userId: payload.userId,
      action: "cari.document.post",
      legalEntityId: lockedLegalEntityId,
      documentId,
      payload: {
        status: row.status,
        sequenceNamespace: row.sequence_namespace,
        fiscalYear: Number(row.fiscal_year),
        sequenceNo: Number(row.sequence_no),
        documentNo: row.document_no,
        postedJournalEntryId: journalResult.journalEntryId,
        subledgerReferenceNo,
        controlAccountCode: postingAccounts.controlAccountCode || null,
        offsetAccountCode: postingAccounts.offsetAccountCode || null,
        offsetAccountOverrideProvided: Boolean(
          payload.offsetAccountId ||
            String(payload.offsetAccountCode || "").trim() ||
            postingLinesUseLineLevelOffsets
        ),
        postingLines: postingLineSummary,
        postingLinesUseLineLevelOffsets,
        fxRate: fxPolicy.effectiveFxRate,
        tax: taxAugmentation.summary,
      },
    });

    if (fxPolicy.overrideUsed) {
      await insertAuditLog({
        req,
        runQuery: tx.query,
        tenantId,
        userId: payload.userId,
        action: "cari.document.post.fx_override",
        legalEntityId: lockedLegalEntityId,
        documentId,
        payload: {
          reason: payload.fxOverrideReason || null,
          documentDate,
          documentCurrencyCode: currencyCode,
          functionalCurrencyCode: normalizeUpperText(
            legalEntity.functional_currency_code
          ),
          referenceFxRate: fxPolicy.referenceFxRate,
          overriddenFxRate: fxPolicy.effectiveFxRate,
          fxRateDate: fxPolicy.fxRateDate,
        },
      });
    }
    const lines = await loadDocumentLinesForDocument({
      tenantId,
      legalEntityId: lockedLegalEntityId,
      documentId,
      runQuery: tx.query,
    });

    return {
      row: mapDocumentRow(row, { lines }),
      journal: {
        journalEntryId: journalResult.journalEntryId,
        bookId: journalContext.bookId,
        fiscalPeriodId: journalContext.fiscalPeriodId,
        lineCount: journalResult.lineCount,
        totalDebit: journalResult.totalDebit,
        totalCredit: journalResult.totalCredit,
        subledgerReferenceNo,
        tax: taxAugmentation.summary,
      },
    };
  });

  return posted;
}

export async function reverseCariPostedDocumentById({
  req,
  payload,
  assertScopeAccess,
}) {
  const tenantId = payload.tenantId;
  const documentId = payload.documentId;

  const existing = await fetchDocumentRow({
    tenantId,
    documentId,
  });
  if (!existing) {
    throw badRequest("Document not found");
  }

  const legalEntityId = parsePositiveInt(existing.legal_entity_id);
  assertDocumentScopeAccess(req, assertScopeAccess, existing, "documentId");
  if (normalizeUpperText(existing.status) !== POSTED_STATUS) {
    throw badRequest("Only POSTED documents can be reversed");
  }

  try {
    const reversed = await withTransaction(async (tx) => {
      const original = await fetchDocumentRowForUpdate({
        tenantId,
        documentId,
        runQuery: tx.query,
      });
      if (!original) {
        throw badRequest("Document not found");
      }
      if (normalizeUpperText(original.status) !== POSTED_STATUS) {
        throw badRequest("Only POSTED documents can be reversed");
      }

      const lockedLegalEntityId = parsePositiveInt(original.legal_entity_id);
      const existingReversalId = await findReversalDocumentByOriginalId({
        tenantId,
        originalDocumentId: documentId,
        runQuery: tx.query,
      });
      if (existingReversalId) {
        throw badRequest("Document is already reversed");
      }

      const originalPostedJournalEntryId = parsePositiveInt(
        original.posted_journal_entry_id
      );
      if (!originalPostedJournalEntryId) {
        throw badRequest("Posted journal entry linkage is missing on document");
      }

      const originalJournalWithLines = await fetchPostedJournalWithLines({
        tenantId,
        journalEntryId: originalPostedJournalEntryId,
        runQuery: tx.query,
      });
      const originalJournal = originalJournalWithLines?.journal || null;
      const originalJournalLines = originalJournalWithLines?.lines || [];
      if (!originalJournal) {
        throw badRequest("Original posted journal not found for document reversal");
      }
      if (normalizeUpperText(originalJournal.status) !== POSTED_STATUS) {
        throw badRequest("Only POSTED journals can be reversed");
      }
      if (parsePositiveInt(originalJournal.reversal_journal_entry_id)) {
        throw badRequest("Journal is already reversed");
      }
      if (originalJournalLines.length === 0) {
        throw badRequest("Original journal has no lines to reverse");
      }
      const originalDocumentLines = await loadDocumentLinesForDocument({
        tenantId,
        legalEntityId: lockedLegalEntityId,
        documentId,
        runQuery: tx.query,
      });
      const inventoryReverseBlocks = buildDocumentReverseInventoryBlocks(
        originalDocumentLines.flatMap((line) =>
          Array.isArray(line?.stockLinks) ? line.stockLinks : []
        )
      );
      if (inventoryReverseBlocks.length > 0) {
        throw documentReverseBlockedByInventoryError(
          documentId,
          inventoryReverseBlocks
        );
      }

      const reversalDate =
        payload.reversalDate || toDateOnlyString(new Date(), "reversalDate");
      const reversalPeriodContext = await resolveBookAndOpenPeriodForDate({
        tenantId,
        legalEntityId: lockedLegalEntityId,
        targetDate: reversalDate,
        preferredBookId: parsePositiveInt(originalJournal.book_id),
        runQuery: tx.query,
      });

      const reversalSubledgerReferenceNo = `${CARI_SUBLEDGER_REVERSE_REFERENCE_PREFIX}${documentId}`;
      const reversalLines = originalJournalLines.map((line) => ({
        accountId: parsePositiveInt(line.account_id),
        operatingUnitId: parsePositiveInt(line.operating_unit_id) || null,
        debitBase: Number(line.credit_base || 0),
        creditBase: Number(line.debit_base || 0),
        amountTxn: Number((Number(line.amount_txn || 0) * -1).toFixed(AMOUNT_PRECISION_SCALE)),
        description: line.description
          ? String(line.description).slice(0, 255)
          : `Reversal of ${original.document_no || `DOC-${documentId}`}`,
        subledgerReferenceNo: reversalSubledgerReferenceNo,
        currencyCode: normalizeUpperText(line.currency_code || original.currency_code),
        taxCode: toNullableString(line.tax_code, 40),
      }));
      ensureBalancedJournalLines(reversalLines);

      const reversalJournalResult = await insertPostedJournalWithLinesTx(tx, {
        tenantId,
        legalEntityId: lockedLegalEntityId,
        operatingUnitId: parsePositiveInt(original.operating_unit_id) || null,
        bookId: reversalPeriodContext.bookId,
        fiscalPeriodId: reversalPeriodContext.fiscalPeriodId,
        userId: payload.userId,
        journalNo: buildCariJournalNo("CARI-REV", documentId),
        entryDate: reversalDate,
        documentDate: reversalDate,
        currencyCode: normalizeUpperText(original.currency_code),
        description: `Reversal of ${original.document_no || `DOC-${documentId}`}`.slice(
          0,
          500
        ),
        referenceNo: toNullableString(`REV:${original.document_no || documentId}`, 100),
        lines: reversalLines,
      });
      await upsertJournalSourceLinkTx(tx, {
        tenantId,
        legalEntityId: lockedLegalEntityId,
        journalEntryId: originalPostedJournalEntryId,
        sourceRefType: "CARI_DOCUMENT",
        sourceRefId: documentId,
      });

      const reverseJournalUpdateResult = await tx.query(
        `UPDATE journal_entries
         SET status = 'REVERSED',
             reversed_by_user_id = ?,
             reversed_at = CURRENT_TIMESTAMP,
             reversal_journal_entry_id = ?,
             reverse_reason = ?
         WHERE tenant_id = ?
           AND id = ?
           AND status = 'POSTED'
           AND reversal_journal_entry_id IS NULL`,
        [
          payload.userId,
          reversalJournalResult.journalEntryId,
          payload.reason || "Manual reversal",
          tenantId,
          originalPostedJournalEntryId,
        ]
      );
      if (Number(reverseJournalUpdateResult.rows?.affectedRows || 0) === 0) {
        throw badRequest("Journal is already reversed");
      }

      const reversalNumbering = await reservePostedSequence({
        tenantId,
        legalEntityId: lockedLegalEntityId,
        direction: original.direction,
        documentType: original.document_type,
        documentDate: reversalDate,
        runQuery: tx.query,
      });

      const reversalDocumentInsertResult = await tx.query(
        `INSERT INTO cari_documents (
            tenant_id,
            legal_entity_id,
            operating_unit_id,
            counterparty_id,
            payment_term_id,
            direction,
            document_type,
            sequence_namespace,
            fiscal_year,
            sequence_no,
            document_no,
            status,
            document_date,
            due_date,
            subtotal_amount_txn,
            subtotal_amount_base,
            tax_amount_txn,
            tax_amount_base,
            gross_amount_txn,
            gross_amount_base,
            amount_txn,
            amount_base,
            open_amount_txn,
            open_amount_base,
            currency_code,
            fx_rate,
            counterparty_code_snapshot,
            counterparty_name_snapshot,
            payment_term_snapshot,
            due_date_snapshot,
            currency_code_snapshot,
            fx_rate_snapshot,
            posted_journal_entry_id,
            reversal_of_document_id,
            posted_at,
            reversed_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.000000, 0.000000, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          tenantId,
          lockedLegalEntityId,
          parsePositiveInt(original.operating_unit_id) || null,
          parsePositiveInt(original.counterparty_id),
          parsePositiveInt(original.payment_term_id),
          normalizeUpperText(original.direction),
          normalizeUpperText(original.document_type),
          reversalNumbering.sequenceNamespace,
          reversalNumbering.fiscalYear,
          reversalNumbering.sequenceNo,
          reversalNumbering.documentNo,
          REVERSED_STATUS,
          reversalDate,
          reversalDate,
          normalizeAmount(
            original.subtotal_amount_txn ?? original.amount_txn,
            "subtotalAmountTxn"
          ),
          normalizeAmount(
            original.subtotal_amount_base ?? original.amount_base,
            "subtotalAmountBase"
          ),
          normalizeAmount(original.tax_amount_txn ?? 0, "taxAmountTxn", {
            allowZero: true,
          }),
          normalizeAmount(original.tax_amount_base ?? 0, "taxAmountBase", {
            allowZero: true,
          }),
          normalizeAmount(
            original.gross_amount_txn ?? original.amount_txn,
            "grossAmountTxn"
          ),
          normalizeAmount(
            original.gross_amount_base ?? original.amount_base,
            "grossAmountBase"
          ),
          normalizeAmount(original.amount_txn, "amountTxn"),
          normalizeAmount(original.amount_base, "amountBase"),
          normalizeUpperText(original.currency_code),
          normalizeOptionalPositiveDecimal(original.fx_rate, "fxRate"),
          original.counterparty_code_snapshot,
          original.counterparty_name_snapshot,
          original.payment_term_snapshot,
          reversalDate,
          original.currency_code_snapshot || original.currency_code,
          normalizeOptionalPositiveDecimal(original.fx_rate_snapshot, "fxRateSnapshot"),
          reversalJournalResult.journalEntryId,
          documentId,
        ]
      );
      const reversalDocumentId = parsePositiveInt(
        reversalDocumentInsertResult.rows?.insertId
      );
      if (!reversalDocumentId) {
        throw new Error("Reversal document create failed");
      }
      if (originalDocumentLines.length > 0) {
        await replaceDocumentLinesTx(tx, {
          tenantId,
          legalEntityId: lockedLegalEntityId,
          documentId: reversalDocumentId,
          lines: originalDocumentLines.map((line) => ({
            lineNo: Number(line.lineNo || 0),
            lineKind: normalizeUpperText(line.lineKind || "STANDARD"),
            description: toNullableString(line.description, 500),
            itemCardId: parsePositiveInt(line.itemCardId),
            quantity: normalizeAmount(line.quantity || 0, "reversalLine.quantity", {
              allowZero: true,
            }),
            unitPriceTxn: normalizeAmount(
              line.unitPriceTxn || 0,
              "reversalLine.unitPriceTxn",
              { allowZero: true }
            ),
            lineNetAmountTxn: normalizeAmount(
              line.lineNetAmountTxn || 0,
              "reversalLine.lineNetAmountTxn",
              { allowZero: true }
            ),
            lineTaxAmountTxn: normalizeAmount(
              line.lineTaxAmountTxn || 0,
              "reversalLine.lineTaxAmountTxn",
              { allowZero: true }
            ),
            lineGrossAmountTxn: normalizeAmount(
              line.lineGrossAmountTxn || 0,
              "reversalLine.lineGrossAmountTxn",
              { allowZero: true }
            ),
            lineNetAmountBase: normalizeAmount(
              line.lineNetAmountBase || 0,
              "reversalLine.lineNetAmountBase",
              { allowZero: true }
            ),
            lineTaxAmountBase: normalizeAmount(
              line.lineTaxAmountBase || 0,
              "reversalLine.lineTaxAmountBase",
              { allowZero: true }
            ),
            lineGrossAmountBase: normalizeAmount(
              line.lineGrossAmountBase || 0,
              "reversalLine.lineGrossAmountBase",
              { allowZero: true }
            ),
            postingAccountId: parsePositiveInt(line.postingAccountId),
            taxCategoryCode: toNullableString(line.taxCategoryCode, 60),
            stockImpactMode: normalizeStockImpactMode(line.stockImpactMode),
            warehouseId: parsePositiveInt(line.warehouseId),
            taxes: (line.taxes || []).map((tax) => ({
              componentNo: Number(tax.componentNo || 0),
              taxCode: toNullableString(tax.taxCode, 40),
              taxKind: toNullableString(tax.taxKind, 40),
              ratePct: normalizeAmount(tax.ratePct || 0, "reversalTax.ratePct", {
                allowZero: true,
              }),
              taxBaseAmountTxn: normalizeAmount(
                tax.taxBaseAmountTxn || 0,
                "reversalTax.taxBaseAmountTxn",
                { allowZero: true }
              ),
              taxAmountTxn: normalizeAmount(
                tax.taxAmountTxn || 0,
                "reversalTax.taxAmountTxn",
                { allowZero: true }
              ),
              taxBaseAmountBase: normalizeAmount(
                tax.taxBaseAmountBase || 0,
                "reversalTax.taxBaseAmountBase",
                { allowZero: true }
              ),
              taxAmountBase: normalizeAmount(
                tax.taxAmountBase || 0,
                "reversalTax.taxAmountBase",
                { allowZero: true }
              ),
              taxPurposeCode: toNullableString(tax.taxPurposeCode, 40),
              accountId: parsePositiveInt(tax.accountId),
            })),
          })),
        });
      }
      await upsertJournalSourceLinkTx(tx, {
        tenantId,
        legalEntityId: lockedLegalEntityId,
        journalEntryId: reversalJournalResult.journalEntryId,
        sourceRefType: "CARI_DOCUMENT",
        sourceRefId: reversalDocumentId,
      });
      await upsertJournalSourceLinkTx(tx, {
        tenantId,
        legalEntityId: lockedLegalEntityId,
        journalEntryId: reversalJournalResult.journalEntryId,
        sourceRefType: "CARI_DOCUMENT",
        sourceRefId: documentId,
        linkRole: "REVERSAL_OF",
      });

      await tx.query(
        `UPDATE cari_documents
         SET status = ?,
             open_amount_txn = 0.000000,
             open_amount_base = 0.000000,
             reversed_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?
           AND id = ?`,
        [REVERSED_STATUS, tenantId, documentId]
      );

      await tx.query(
        `UPDATE cari_open_items
         SET status = ?,
             residual_amount_txn = 0.000000,
             residual_amount_base = 0.000000,
             settled_amount_txn = 0.000000,
             settled_amount_base = 0.000000
         WHERE tenant_id = ?
           AND legal_entity_id = ?
          AND document_id = ?`,
        [OPEN_ITEM_STATUS_CANCELLED, tenantId, lockedLegalEntityId, documentId]
      );
      await voidPendingDocumentLineStockLinksTx(tx, {
        tenantId,
        legalEntityId: lockedLegalEntityId,
        documentId,
        resolutionNote: `Voided by reversal document ${reversalDocumentId}`,
      });

      const reversalRow = await fetchDocumentRow({
        tenantId,
        documentId: reversalDocumentId,
        runQuery: tx.query,
      });
      const originalRow = await fetchDocumentRow({
        tenantId,
        documentId,
        runQuery: tx.query,
      });
      const reversalDocumentLines = await loadDocumentLinesForDocument({
        tenantId,
        legalEntityId: lockedLegalEntityId,
        documentId: reversalDocumentId,
        runQuery: tx.query,
      });
      const originalLines = await loadDocumentLinesForDocument({
        tenantId,
        legalEntityId: lockedLegalEntityId,
        documentId,
        runQuery: tx.query,
      });
      if (!reversalRow || !originalRow) {
        throw new Error("Reversal readback failed");
      }

      await insertAuditLog({
        req,
        runQuery: tx.query,
        tenantId,
        userId: payload.userId,
        action: "cari.document.reverse",
        legalEntityId: lockedLegalEntityId,
        documentId,
        payload: {
          reason: payload.reason || null,
          originalDocumentId: documentId,
          reversalDocumentId,
          originalPostedJournalEntryId,
          reversalPostedJournalEntryId: reversalJournalResult.journalEntryId,
        },
      });

      return {
        row: mapDocumentRow(reversalRow, { lines: reversalDocumentLines }),
        original: mapDocumentRow(originalRow, { lines: originalLines }),
        journal: {
          originalJournalEntryId: originalPostedJournalEntryId,
          reversalJournalEntryId: reversalJournalResult.journalEntryId,
          lineCount: reversalJournalResult.lineCount,
          totalDebit: reversalJournalResult.totalDebit,
          totalCredit: reversalJournalResult.totalCredit,
          subledgerReferenceNo: reversalSubledgerReferenceNo,
        },
      };
    });

    return reversed;
  } catch (err) {
    if (isDuplicateKeyError(err, "uk_cari_docs_single_reversal")) {
      throw badRequest("Document is already reversed");
    }
    throw err;
  }
}
