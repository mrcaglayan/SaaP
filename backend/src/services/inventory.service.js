import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertAccountBelongsToTenant,
  assertLegalEntityBelongsToTenant,
  assertCurrencyExists,
} from "../tenantGuards.js";
import { getItemCardByIdForTenant } from "./item.card.service.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";

const AMOUNT_SCALE = 6;
const BALANCE_EPSILON = 0.000001;

function toDecimalNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value, maxLength = 255, { required = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    if (required) {
      throw badRequest("value is required");
    }
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeUpperText(value, maxLength = 255, options = {}) {
  const normalized = normalizeText(value, maxLength, options);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeAmount(value, label, { allowZero = false, allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) {
      return null;
    }
    throw badRequest(`${label} is required`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  if (allowZero ? parsed < 0 : parsed <= 0) {
    throw badRequest(allowZero ? `${label} must be >= 0` : `${label} must be > 0`);
  }
  return Number(parsed.toFixed(AMOUNT_SCALE));
}

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(AMOUNT_SCALE));
}

function normalizeDateOnly(value, label = "date") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw badRequest(`${label} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw badRequest(`${label} must be YYYY-MM-DD`);
  }
  return normalized;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function buildInventoryJournalNo(prefix, movementId) {
  const normalizedMovementId = parsePositiveInt(movementId);
  if (!normalizedMovementId) {
    throw badRequest("movementId is required for journal numbering");
  }
  return `${String(prefix || "INV").trim().toUpperCase()}-${normalizedMovementId}`;
}

function mapWarehouseRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    code: row.code || null,
    name: row.name || null,
    status: row.status || null,
    notes: row.notes || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapPendingStockLinkRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    documentId: parsePositiveInt(row.cari_document_id),
    documentLineId: parsePositiveInt(row.cari_document_line_id),
    documentNo: row.document_no || null,
    documentDate: row.document_date || null,
    direction: row.direction || null,
    stockImpactMode: row.stock_impact_mode || null,
    linkStatus: row.link_status || null,
    requestedQuantity: toDecimalNumber(row.requested_quantity),
    postedNetAmountTxn: toDecimalNumber(row.posted_net_amount_txn),
    postedNetAmountBase: toDecimalNumber(row.posted_net_amount_base),
    currencyCode: row.currency_code || null,
    itemCardId: parsePositiveInt(row.item_card_id),
    itemCardCode: row.item_card_code || null,
    itemCardName: row.item_card_name || null,
    itemType: row.item_type || null,
    lineNo: Number(row.line_no || 0),
    lineDescription: row.line_description || null,
    inventoryMovementId: parsePositiveInt(row.inventory_movement_id),
    inventoryDocumentId: parsePositiveInt(row.inventory_document_id),
    reopenedFromStockLinkId: parsePositiveInt(row.reopened_from_stock_link_id),
    supersededByStockLinkId: parsePositiveInt(row.superseded_by_stock_link_id),
    resolvedAt: row.resolved_at || null,
    resolutionNote: row.resolution_note || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapMovementRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    warehouseId: parsePositiveInt(row.warehouse_id),
    warehouseCode: row.warehouse_code || null,
    warehouseName: row.warehouse_name || null,
    itemCardId: parsePositiveInt(row.item_card_id),
    itemCardCode: row.item_card_code || null,
    itemCardName: row.item_card_name || null,
    movementType: row.movement_type || null,
    sourceType: row.source_type || null,
    sourceStockLinkId: parsePositiveInt(row.source_stock_link_id),
    sourceDocumentType: row.source_document_type || null,
    sourceDocumentId: parsePositiveInt(row.source_document_id),
    sourceDocumentLineId: parsePositiveInt(row.source_document_line_id),
    reversalOfMovementId: parsePositiveInt(row.reversal_of_movement_id),
    reversalOfMovementType: row.reversal_of_movement_type || null,
    reversalOfMovementDate: row.reversal_of_movement_date || null,
    reversalMovementId: parsePositiveInt(row.reversal_movement_id),
    reversalMovementType: row.reversal_movement_type || null,
    reversalMovementDate: row.reversal_movement_date || null,
    sourceDocumentNo: row.source_document_no || null,
    movementDate: row.movement_date || null,
    quantity: toDecimalNumber(row.quantity),
    unitCostTxn: toDecimalNumber(row.unit_cost_txn),
    unitCostBase: toDecimalNumber(row.unit_cost_base),
    totalCostTxn: toDecimalNumber(row.total_cost_txn),
    totalCostBase: toDecimalNumber(row.total_cost_base),
    currencyCode: row.currency_code || null,
    valuationStatus: row.valuation_status || null,
    postedJournalEntryId: parsePositiveInt(row.posted_journal_entry_id),
    postedJournalNo: row.posted_journal_no || null,
    postedAt: row.posted_at || null,
    reversalJournalEntryId: parsePositiveInt(row.reversal_journal_entry_id),
    reversalJournalNo: row.reversal_journal_no || null,
    reversedAt: row.reversed_at || null,
    note: row.note || null,
    layerConsumptions: Array.isArray(row.layerConsumptions)
      ? row.layerConsumptions.map((entry) => ({ ...entry }))
      : [],
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapCostLayerRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    warehouseId: parsePositiveInt(row.warehouse_id),
    warehouseCode: row.warehouse_code || null,
    warehouseName: row.warehouse_name || null,
    itemCardId: parsePositiveInt(row.item_card_id),
    itemCardCode: row.item_card_code || null,
    itemCardName: row.item_card_name || null,
    sourceMovementId: parsePositiveInt(row.source_movement_id),
    sourceStockLinkId: parsePositiveInt(row.source_stock_link_id),
    valuationMethod: row.valuation_method || null,
    layerStatus: row.layer_status || null,
    currencyCode: row.currency_code || null,
    quantityIn: toDecimalNumber(row.quantity_in),
    quantityRemaining: toDecimalNumber(row.quantity_remaining),
    unitCostTxn: toDecimalNumber(row.unit_cost_txn),
    unitCostBase: toDecimalNumber(row.unit_cost_base),
    totalCostTxn: toDecimalNumber(row.total_cost_txn),
    totalCostBase: toDecimalNumber(row.total_cost_base),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapIssueLayerConsumptionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    issueMovementId: parsePositiveInt(row.issue_movement_id),
    costLayerId: parsePositiveInt(row.cost_layer_id),
    consumptionNo: Number(row.consumption_no || 0),
    quantityConsumed: toDecimalNumber(row.quantity_consumed),
    unitCostTxn: toDecimalNumber(row.unit_cost_txn),
    unitCostBase: toDecimalNumber(row.unit_cost_base),
    totalCostTxn: toDecimalNumber(row.total_cost_txn),
    totalCostBase: toDecimalNumber(row.total_cost_base),
    currencyCode: row.currency_code || null,
    layerStatus: row.layer_status || null,
    valuationMethod: row.valuation_method || null,
    sourceMovementId: parsePositiveInt(row.source_movement_id),
    sourceStockLinkId: parsePositiveInt(row.source_stock_link_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function makeInClause(values) {
  return values.map(() => "?").join(", ");
}

async function fetchWarehouseById({
  tenantId,
  legalEntityId,
  warehouseId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT w.*, le.code AS legal_entity_code
       FROM inventory_warehouses w
       JOIN legal_entities le
         ON le.tenant_id = w.tenant_id
        AND le.id = w.legal_entity_id
      WHERE w.tenant_id = ?
        AND w.legal_entity_id = ?
        AND w.id = ?
      LIMIT 1`,
    [tenantId, legalEntityId, warehouseId]
  );
  return result.rows?.[0] || null;
}

async function fetchPendingStockLinkById({
  tenantId,
  legalEntityId,
  stockLinkId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
        sl.*,
        le.code AS legal_entity_code,
        d.document_no,
        d.document_date,
        d.direction,
        d.currency_code,
        l.line_no,
        l.description AS line_description,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        ic.item_type
      FROM cari_document_line_stock_links sl
      JOIN legal_entities le
        ON le.tenant_id = sl.tenant_id
       AND le.id = sl.legal_entity_id
      JOIN cari_documents d
        ON d.tenant_id = sl.tenant_id
       AND d.legal_entity_id = sl.legal_entity_id
       AND d.id = sl.cari_document_id
      JOIN cari_document_lines l
        ON l.tenant_id = sl.tenant_id
       AND l.legal_entity_id = sl.legal_entity_id
       AND l.cari_document_id = sl.cari_document_id
       AND l.id = sl.cari_document_line_id
      JOIN item_cards ic
        ON ic.tenant_id = sl.tenant_id
       AND ic.id = sl.item_card_id
      WHERE sl.tenant_id = ?
        AND sl.legal_entity_id = ?
        AND sl.id = ?
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, legalEntityId, stockLinkId]
  );
  return result.rows?.[0] || null;
}

async function fetchSuccessorStockLinkByOriginalId({
  tenantId,
  legalEntityId,
  originalStockLinkId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
        sl.*,
        le.code AS legal_entity_code,
        d.document_no,
        d.document_date,
        d.direction,
        d.currency_code,
        l.line_no,
        l.description AS line_description,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        ic.item_type
      FROM cari_document_line_stock_links sl
      JOIN legal_entities le
        ON le.tenant_id = sl.tenant_id
       AND le.id = sl.legal_entity_id
      JOIN cari_documents d
        ON d.tenant_id = sl.tenant_id
       AND d.legal_entity_id = sl.legal_entity_id
       AND d.id = sl.cari_document_id
      JOIN cari_document_lines l
        ON l.tenant_id = sl.tenant_id
       AND l.legal_entity_id = sl.legal_entity_id
       AND l.cari_document_id = sl.cari_document_id
       AND l.id = sl.cari_document_line_id
      JOIN item_cards ic
        ON ic.tenant_id = sl.tenant_id
       AND ic.id = sl.item_card_id
      WHERE sl.tenant_id = ?
        AND sl.legal_entity_id = ?
        AND sl.reopened_from_stock_link_id = ?
      ORDER BY sl.id DESC
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, legalEntityId, originalStockLinkId]
  );
  return result.rows?.[0] || null;
}

async function fetchReceiptCostLayerBySourceMovementId({
  tenantId,
  movementId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT *
       FROM inventory_cost_layers
      WHERE tenant_id = ?
        AND source_movement_id = ?
      ORDER BY id ASC
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, movementId]
  );
  return result.rows?.[0] || null;
}

async function fetchReceiptReversalMovementByOriginalId({
  tenantId,
  originalMovementId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT *
       FROM inventory_movements
      WHERE tenant_id = ?
        AND reversal_of_movement_id = ?
      ORDER BY id DESC
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [tenantId, originalMovementId]
  );
  return result.rows?.[0] || null;
}

async function fetchInventoryMovementDbRowById({
  movementId,
  runQuery = query,
  forUpdate = false,
}) {
  const result = await runQuery(
    `SELECT
        m.*,
        d.document_no AS source_document_no
      FROM inventory_movements m
      LEFT JOIN cari_documents d
        ON m.source_document_type = 'CARI_DOCUMENT'
       AND d.tenant_id = m.tenant_id
       AND d.id = m.source_document_id
      WHERE m.id = ?
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [movementId]
  );
  return result.rows?.[0] || null;
}

async function fetchLegalEntityBaseCurrencyCode({
  tenantId,
  legalEntityId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT functional_currency_code
       FROM legal_entities
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, legalEntityId]
  );
  const currencyCode = normalizeUpperText(result.rows?.[0]?.functional_currency_code, 3);
  if (!currencyCode) {
    throw badRequest("legalEntityId base currency is not configured");
  }
  return currencyCode;
}

async function fetchOpenCostLayersForIssue({
  tenantId,
  legalEntityId,
  warehouseId,
  itemCardId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        cl.*,
        m.movement_date AS source_movement_date,
        m.source_stock_link_id
      FROM inventory_cost_layers cl
      JOIN inventory_movements m
        ON m.id = cl.source_movement_id
      WHERE cl.tenant_id = ?
        AND cl.legal_entity_id = ?
        AND cl.warehouse_id = ?
        AND cl.item_card_id = ?
        AND cl.layer_status = 'OPEN'
        AND cl.quantity_remaining > 0
      ORDER BY m.movement_date ASC, cl.created_at ASC, cl.id ASC
      FOR UPDATE`,
    [tenantId, legalEntityId, warehouseId, itemCardId]
  );
  return result.rows || [];
}

function buildIssueValuationPlan({
  openLayerRows,
  quantity,
  itemCard,
  warehouseRow,
  baseCurrencyCode,
}) {
  const requestedQuantity = normalizeAmount(quantity, "requestedQuantity");
  const availableQuantity = roundAmount(
    (Array.isArray(openLayerRows) ? openLayerRows : []).reduce(
      (sum, row) => sum + Number(row?.quantity_remaining || 0),
      0
    )
  );
  if (availableQuantity + 0.000001 < requestedQuantity) {
    const itemLabel = String(itemCard?.code || itemCard?.name || itemCard?.id || "item").trim();
    const warehouseLabel = String(warehouseRow?.code || warehouseRow?.name || warehouseRow?.id || "warehouse").trim();
    throw badRequest(
      `Insufficient available stock for ${itemLabel} in ${warehouseLabel}: requested ${requestedQuantity}, available ${availableQuantity}`
    );
  }

  let remainingQuantity = requestedQuantity;
  const normalizedBaseCurrencyCode = normalizeUpperText(baseCurrencyCode, 3, {
    required: true,
  });
  const sourceCurrencyCodes = new Set();
  let firstSourceCurrencyCode = null;
  let isMixedSourceCurrency = false;
  let totalCostTxn = 0;
  let totalCostBase = 0;
  const consumptions = [];

  for (const layerRow of openLayerRows || []) {
    if (remainingQuantity <= 0) {
      break;
    }
    const layerRemaining = normalizeAmount(layerRow.quantity_remaining, "layer.quantityRemaining");
    const quantityConsumed = roundAmount(Math.min(remainingQuantity, layerRemaining));
    if (quantityConsumed <= 0) {
      continue;
    }

    const layerCurrencyCode = normalizeText(layerRow.currency_code, 3, {
      required: true,
    }).toUpperCase();
    sourceCurrencyCodes.add(layerCurrencyCode);
    if (!firstSourceCurrencyCode) {
      firstSourceCurrencyCode = layerCurrencyCode;
    } else if (firstSourceCurrencyCode !== layerCurrencyCode) {
      isMixedSourceCurrency = true;
    }

    const unitCostTxn = normalizeAmount(layerRow.unit_cost_txn, "layer.unitCostTxn", {
      allowZero: true,
    });
    const unitCostBase = normalizeAmount(layerRow.unit_cost_base, "layer.unitCostBase", {
      allowZero: true,
    });
    const totalCostTxnLine = roundAmount(quantityConsumed * unitCostTxn);
    const totalCostBaseLine = roundAmount(quantityConsumed * unitCostBase);
    const quantityRemainingAfter = roundAmount(layerRemaining - quantityConsumed);

    consumptions.push({
      costLayerId: parsePositiveInt(layerRow.id),
      quantityConsumed,
      quantityRemainingAfter,
      unitCostTxn,
      unitCostBase,
      totalCostTxn: totalCostTxnLine,
      totalCostBase: totalCostBaseLine,
      currencyCode: layerCurrencyCode,
    });

    totalCostTxn = roundAmount(totalCostTxn + totalCostTxnLine);
    totalCostBase = roundAmount(totalCostBase + totalCostBaseLine);
    remainingQuantity = roundAmount(remainingQuantity - quantityConsumed);
  }

  if (remainingQuantity > 0.000001) {
    throw badRequest("Issue valuation plan could not consume the full requested quantity");
  }

  const issueCurrencyCode = isMixedSourceCurrency
    ? normalizedBaseCurrencyCode
    : firstSourceCurrencyCode || normalizedBaseCurrencyCode;
  const issueTotalCostTxn = isMixedSourceCurrency ? totalCostBase : totalCostTxn;

  return {
    currencyCode: issueCurrencyCode,
    totalCostTxn: issueTotalCostTxn,
    totalCostBase,
    unitCostTxn: roundAmount(issueTotalCostTxn / requestedQuantity),
    unitCostBase: roundAmount(totalCostBase / requestedQuantity),
    consumptions,
    isMixedSourceCurrency,
    sourceCurrencyCodes: Array.from(sourceCurrencyCodes),
  };
}

async function fetchIssueLayerConsumptionsForUpdate({
  issueMovementId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        c.*,
        cl.quantity_in,
        cl.quantity_remaining,
        cl.layer_status
      FROM inventory_issue_layer_consumptions c
      JOIN inventory_cost_layers cl
        ON cl.id = c.cost_layer_id
      WHERE c.issue_movement_id = ?
      ORDER BY c.consumption_no ASC
      FOR UPDATE`,
    [issueMovementId]
  );
  return result.rows || [];
}

async function fetchJournalEntryWithLines({
  tenantId,
  journalEntryId,
  runQuery = query,
}) {
  const journalResult = await runQuery(
    `SELECT *
       FROM journal_entries
      WHERE tenant_id = ?
        AND id = ?
      LIMIT 1`,
    [tenantId, journalEntryId]
  );
  const journal = journalResult.rows?.[0] || null;
  if (!journal) {
    return {
      journal: null,
      lines: [],
    };
  }
  const linesResult = await runQuery(
    `SELECT
        line_no,
        account_id,
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
    journal,
    lines: linesResult.rows || [],
  };
}

async function ensureIssueReopenedStockLinkTx({
  tx,
  tenantId,
  legalEntityId,
  originalStockLinkRow,
  movementRow,
  reversalDate,
}) {
  const originalStockLinkId = parsePositiveInt(originalStockLinkRow?.id);
  if (!originalStockLinkId) {
    return null;
  }
  if (
    normalizeUpperText(originalStockLinkRow?.stock_impact_mode) !== "ISSUE_PENDING"
  ) {
    return null;
  }

  let successorRow = await fetchSuccessorStockLinkByOriginalId({
    tenantId,
    legalEntityId,
    originalStockLinkId,
    runQuery: tx.query,
    forUpdate: true,
  });

  if (!successorRow) {
    const reopenNote = [
      `Reopened from stock link ${originalStockLinkId}`,
      `after issue movement ${parsePositiveInt(movementRow?.id) || "-"}`,
      `reverse on ${reversalDate}`,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 255);
    const insertResult = await tx.query(
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
          inventory_document_type,
          inventory_document_id,
          inventory_movement_id,
          reopened_from_stock_link_id,
          superseded_by_stock_link_id,
          resolved_at,
          resolution_note
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?)`,
      [
        tenantId,
        legalEntityId,
        parsePositiveInt(originalStockLinkRow.cari_document_id),
        parsePositiveInt(originalStockLinkRow.cari_document_line_id),
        parsePositiveInt(originalStockLinkRow.item_card_id),
        normalizeUpperText(originalStockLinkRow.direction, 10, {
          required: true,
        }),
        normalizeUpperText(originalStockLinkRow.stock_impact_mode, 40, {
          required: true,
        }),
        normalizeAmount(originalStockLinkRow.requested_quantity, "requestedQuantity"),
        normalizeAmount(originalStockLinkRow.posted_net_amount_txn, "postedNetAmountTxn", {
          allowZero: true,
        }),
        normalizeAmount(originalStockLinkRow.posted_net_amount_base, "postedNetAmountBase", {
          allowZero: true,
        }),
        originalStockLinkId,
        reopenNote,
      ]
    );
    const successorStockLinkId = parsePositiveInt(insertResult.rows?.insertId);
    if (!successorStockLinkId) {
      throw new Error("Reopened successor stock link create failed");
    }
    successorRow = await fetchPendingStockLinkById({
      tenantId,
      legalEntityId,
      stockLinkId: successorStockLinkId,
      runQuery: tx.query,
      forUpdate: true,
    });
  }

  const successorStockLinkId = parsePositiveInt(successorRow?.id);
  const originalResolutionNote = [
    normalizeText(originalStockLinkRow?.resolution_note, 255),
    `Successor stock link ${successorStockLinkId || "-"} created after issue reversal on ${reversalDate}`,
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 255);
  await tx.query(
    `UPDATE cari_document_line_stock_links
        SET superseded_by_stock_link_id = COALESCE(superseded_by_stock_link_id, ?),
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            resolution_note = ?
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND id = ?`,
    [
      successorStockLinkId,
      originalResolutionNote,
      tenantId,
      legalEntityId,
      originalStockLinkId,
    ]
  );

  return successorRow;
}

async function ensureReceiptUndoMovementTx({
  tx,
  tenantId,
  legalEntityId,
  originalMovementRow,
  receiptCostLayerRow,
  stockLinkRow,
  reversalDate,
  reason,
}) {
  const originalMovementId = parsePositiveInt(originalMovementRow?.id);
  if (!originalMovementId) {
    return null;
  }

  let reversalMovementRow = await fetchReceiptReversalMovementByOriginalId({
    tenantId,
    originalMovementId,
    runQuery: tx.query,
    forUpdate: true,
  });

  if (!reversalMovementRow) {
    const quantity = normalizeAmount(
      receiptCostLayerRow?.quantity_in ?? originalMovementRow?.quantity,
      "receiptQuantity"
    );
    const unitCostTxn = normalizeAmount(
      receiptCostLayerRow?.unit_cost_txn ?? originalMovementRow?.unit_cost_txn,
      "receiptUnitCostTxn",
      { allowZero: true }
    );
    const unitCostBase = normalizeAmount(
      receiptCostLayerRow?.unit_cost_base ?? originalMovementRow?.unit_cost_base,
      "receiptUnitCostBase",
      { allowZero: true }
    );
    const totalCostTxn = normalizeAmount(
      receiptCostLayerRow?.total_cost_txn ?? originalMovementRow?.total_cost_txn,
      "receiptTotalCostTxn",
      { allowZero: true }
    );
    const totalCostBase = normalizeAmount(
      receiptCostLayerRow?.total_cost_base ?? originalMovementRow?.total_cost_base,
      "receiptTotalCostBase",
      { allowZero: true }
    );
    const reversalNote = [
      "Receipt materialization undo",
      `of movement ${originalMovementId}`,
      `on ${reversalDate}`,
      normalizeText(reason, 120),
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 255);

    const insertResult = await tx.query(
      `INSERT INTO inventory_movements (
          tenant_id,
          legal_entity_id,
          warehouse_id,
          item_card_id,
          movement_type,
          source_type,
          source_stock_link_id,
          source_document_type,
          source_document_id,
          source_document_line_id,
          reversal_of_movement_id,
          movement_date,
          quantity,
          unit_cost_txn,
          unit_cost_base,
          total_cost_txn,
          total_cost_base,
          currency_code,
          valuation_status,
          note
       ) VALUES (?, ?, ?, ?, 'ADJUSTMENT_OUT', 'MANUAL', NULL, 'INVENTORY_MOVEMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)` ,
      [
        tenantId,
        legalEntityId,
        parsePositiveInt(originalMovementRow?.warehouse_id),
        parsePositiveInt(originalMovementRow?.item_card_id),
        originalMovementId,
        parsePositiveInt(originalMovementRow?.source_document_line_id) || null,
        originalMovementId,
        reversalDate,
        quantity,
        unitCostTxn,
        unitCostBase,
        totalCostTxn,
        totalCostBase,
        normalizeUpperText(
          receiptCostLayerRow?.currency_code || originalMovementRow?.currency_code,
          3,
          { required: true }
        ),
        reversalNote,
      ]
    );
    const reversalMovementId = parsePositiveInt(insertResult.rows?.insertId);
    if (!reversalMovementId) {
      throw new Error("Receipt undo movement create failed");
    }
    reversalMovementRow = await fetchInventoryMovementDbRowById({
      movementId: reversalMovementId,
      runQuery: tx.query,
      forUpdate: true,
    });
  }

  if (stockLinkRow) {
    const stockLinkId = parsePositiveInt(stockLinkRow?.id);
    if (stockLinkId) {
      const resolutionNote = [
        normalizeText(stockLinkRow?.resolution_note, 180),
        `Receipt materialization undone by movement ${
          parsePositiveInt(reversalMovementRow?.id) || "-"
        } on ${reversalDate}`,
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 255);
      await tx.query(
        `UPDATE cari_document_line_stock_links
            SET resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
                resolution_note = ?
          WHERE tenant_id = ?
            AND legal_entity_id = ?
            AND id = ?`,
        [resolutionNote, tenantId, legalEntityId, stockLinkId]
      );
    }
  }

  return reversalMovementRow;
}

async function assertNoLaterValuedIssueExistsForReverse({
  tenantId,
  movementRow,
  runQuery = query,
}) {
  const movementId = parsePositiveInt(movementRow?.id);
  const result = await runQuery(
    `SELECT id
       FROM inventory_movements
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND warehouse_id = ?
        AND item_card_id = ?
        AND movement_type = 'ISSUE'
        AND valuation_status = 'VALUED'
        AND reversed_at IS NULL
        AND id <> ?
        AND (
          movement_date > ?
          OR (movement_date = ? AND id > ?)
        )
      LIMIT 1
      FOR UPDATE`,
    [
      tenantId,
      parsePositiveInt(movementRow?.legal_entity_id),
      parsePositiveInt(movementRow?.warehouse_id),
      parsePositiveInt(movementRow?.item_card_id),
      movementId,
      normalizeDateOnly(movementRow?.movement_date, "movementDate"),
      normalizeDateOnly(movementRow?.movement_date, "movementDate"),
      movementId,
    ]
  );
  if (parsePositiveInt(result.rows?.[0]?.id)) {
    throw badRequest(
      "Cannot reverse this issue while later valued issues exist for the same warehouse/item"
    );
  }
}

async function attachIssueLayerConsumptions({
  movementRows,
  runQuery = query,
}) {
  if (!Array.isArray(movementRows) || movementRows.length === 0) {
    return [];
  }
  const issueMovementIds = movementRows
    .filter((row) => String(row?.movementType || "").trim().toUpperCase() === "ISSUE")
    .map((row) => parsePositiveInt(row?.id))
    .filter(Boolean);
  if (issueMovementIds.length === 0) {
    return movementRows.map((row) => ({
      ...row,
      layerConsumptions: [],
    }));
  }

  const result = await runQuery(
    `SELECT
        c.*,
        cl.layer_status,
        cl.valuation_method,
        cl.source_movement_id,
        sm.source_stock_link_id
      FROM inventory_issue_layer_consumptions c
      JOIN inventory_cost_layers cl
        ON cl.id = c.cost_layer_id
      JOIN inventory_movements sm
        ON sm.id = cl.source_movement_id
      WHERE c.issue_movement_id IN (${makeInClause(issueMovementIds)})
      ORDER BY c.issue_movement_id ASC, c.consumption_no ASC`,
    issueMovementIds
  );

  const grouped = new Map();
  for (const row of result.rows || []) {
    const issueMovementId = parsePositiveInt(row.issue_movement_id);
    if (!grouped.has(issueMovementId)) {
      grouped.set(issueMovementId, []);
    }
    grouped.get(issueMovementId).push(mapIssueLayerConsumptionRow(row));
  }

  return movementRows.map((row) => ({
    ...row,
    layerConsumptions: grouped.get(parsePositiveInt(row?.id)) || [],
  }));
}

async function fetchMovementById({
  movementId,
  runQuery = query,
}) {
  const directRow = await runQuery(
    `SELECT
        m.*,
        le.code AS legal_entity_code,
        w.code AS warehouse_code,
        w.name AS warehouse_name,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        d.document_no AS source_document_no,
        om.id AS reversal_of_movement_id,
        om.movement_type AS reversal_of_movement_type,
        om.movement_date AS reversal_of_movement_date,
        rm.id AS reversal_movement_id,
        rm.movement_type AS reversal_movement_type,
        rm.movement_date AS reversal_movement_date,
        pj.journal_no AS posted_journal_no,
        rj.journal_no AS reversal_journal_no
      FROM inventory_movements m
      JOIN legal_entities le
        ON le.tenant_id = m.tenant_id
       AND le.id = m.legal_entity_id
      JOIN inventory_warehouses w
        ON w.id = m.warehouse_id
      JOIN item_cards ic
        ON ic.tenant_id = m.tenant_id
       AND ic.id = m.item_card_id
      LEFT JOIN cari_documents d
        ON m.source_document_type = 'CARI_DOCUMENT'
       AND d.tenant_id = m.tenant_id
       AND d.id = m.source_document_id
      LEFT JOIN inventory_movements om
        ON om.id = m.reversal_of_movement_id
      LEFT JOIN inventory_movements rm
        ON rm.reversal_of_movement_id = m.id
      LEFT JOIN journal_entries pj
        ON pj.id = m.posted_journal_entry_id
      LEFT JOIN journal_entries rj
        ON rj.id = m.reversal_journal_entry_id
      WHERE m.id = ?
      LIMIT 1`,
    [movementId]
  );
  const mappedRow = mapMovementRow(directRow.rows?.[0] || null);
  if (!mappedRow) {
    return null;
  }
  const [rowWithConsumptions] = await attachIssueLayerConsumptions({
    movementRows: [mappedRow],
    runQuery,
  });
  return rowWithConsumptions || null;
}

async function resolveBookAndOpenPeriodForDate({
  tenantId,
  legalEntityId,
  targetDate,
  preferredBookId = null,
  runQuery = query,
}) {
  const normalizedDate = normalizeDateOnly(targetDate, "movementDate");

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
    throw badRequest("No book found for inventory legalEntityId");
  }

  const bookId = parsePositiveInt(book.id);
  const calendarId = parsePositiveInt(book.calendar_id);
  if (!bookId || !calendarId) {
    throw badRequest("Book configuration is invalid for inventory posting");
  }

  const periodResult = await runQuery(
    `SELECT id, fiscal_year
       FROM fiscal_periods
      WHERE calendar_id = ?
        AND ? BETWEEN start_date AND end_date
      ORDER BY is_adjustment ASC, id ASC
      LIMIT 1`,
    [calendarId, normalizedDate]
  );
  const period = periodResult.rows?.[0] || null;
  if (!period) {
    throw badRequest("No fiscal period found for movement date");
  }

  const fiscalPeriodId = parsePositiveInt(period.id);
  if (!fiscalPeriodId) {
    throw badRequest("Fiscal period configuration is invalid for inventory posting");
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
    throw badRequest(`Period is ${periodStatus}; cannot post inventory issue`);
  }

  return {
    bookId,
    fiscalPeriodId,
    fiscalYear: Number(period.fiscal_year),
    baseCurrencyCode: normalizeUpperText(book.base_currency_code),
  };
}

async function resolveInventoryPostingAccount({
  tenantId,
  legalEntityId,
  accountId,
  fieldLabel,
  runQuery = query,
}) {
  const normalizedAccountId = parsePositiveInt(accountId);
  if (!normalizedAccountId) {
    throw badRequest(`${fieldLabel} is required`);
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
      JOIN charts_of_accounts c
        ON c.id = a.coa_id
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

async function resolveInventoryIssuePostingAccounts({
  tenantId,
  legalEntityId,
  itemCard,
  runQuery = query,
}) {
  const cogsAccountId =
    parsePositiveInt(itemCard?.defaultCogsAccountId) ||
    parsePositiveInt(itemCard?.defaultPurchaseAccountId);
  if (!cogsAccountId) {
    throw badRequest(
      "STOCK_ITEM issue posting requires defaultCogsAccountId or defaultPurchaseAccountId"
    );
  }
  const inventoryAssetAccountId = parsePositiveInt(itemCard?.inventoryAssetAccountId);
  if (!inventoryAssetAccountId) {
    throw badRequest("STOCK_ITEM issue posting requires inventoryAssetAccountId");
  }

  const cogsAccount = await resolveInventoryPostingAccount({
    tenantId,
    legalEntityId,
    accountId: cogsAccountId,
    fieldLabel: "defaultCogsAccountId",
    runQuery,
  });
  const inventoryAssetAccount = await resolveInventoryPostingAccount({
    tenantId,
    legalEntityId,
    accountId: inventoryAssetAccountId,
    fieldLabel: "inventoryAssetAccountId",
    runQuery,
  });

  return {
    cogsAccount,
    inventoryAssetAccount,
  };
}

function ensureBalancedJournalLines(lines) {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines || []) {
    totalDebit = roundAmount(totalDebit + Number(line?.debitBase || 0));
    totalCredit = roundAmount(totalCredit + Number(line?.creditBase || 0));
  }
  if (Math.abs(totalDebit - totalCredit) > BALANCE_EPSILON) {
    throw badRequest("Inventory issue journal is not balanced");
  }
  if (totalDebit <= 0 || totalCredit <= 0) {
    throw badRequest("Inventory issue journal must contain positive debit and credit totals");
  }
  return {
    totalDebit,
    totalCredit,
  };
}

async function insertPostedJournalWithLinesTx(tx, payload) {
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
    throw badRequest("Failed to create inventory issue journal entry");
  }

  for (let index = 0; index < payload.lines.length; index += 1) {
    const line = payload.lines[index];
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
        VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        journalEntryId,
        index + 1,
        parsePositiveInt(line.accountId),
        line.description || null,
        line.subledgerReferenceNo || null,
        line.currencyCode,
        Number(line.amountTxn || 0),
        Number(line.debitBase || 0),
        Number(line.creditBase || 0),
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

async function ensureInventoryIssueJournalPostedTx({
  tx,
  tenantId,
  legalEntityId,
  userId,
  movementRow,
  itemCard,
  stockLinkRow,
}) {
  if (parsePositiveInt(movementRow?.posted_journal_entry_id)) {
    return {
      journalEntryId: parsePositiveInt(movementRow.posted_journal_entry_id),
      idempotent: true,
    };
  }

  const totalCostTxn = normalizeAmount(movementRow?.total_cost_txn, "issueTotalCostTxn", {
    allowZero: true,
  });
  const totalCostBase = normalizeAmount(movementRow?.total_cost_base, "issueTotalCostBase", {
    allowZero: true,
  });
  if (totalCostTxn <= 0 && totalCostBase <= 0) {
    return {
      journalEntryId: null,
      idempotent: true,
      skippedReason: "ZERO_COST_ISSUE",
    };
  }

  const postingUserId =
    parsePositiveInt(userId);
  if (!postingUserId) {
    throw badRequest("userId is required to post inventory issue journal");
  }

  const journalContext = await resolveBookAndOpenPeriodForDate({
    tenantId,
    legalEntityId,
    targetDate: movementRow.movement_date,
    runQuery: tx.query,
  });
  const postingAccounts = await resolveInventoryIssuePostingAccounts({
    tenantId,
    legalEntityId,
    itemCard,
    runQuery: tx.query,
  });
  const currencyCode = normalizeUpperText(movementRow.currency_code, 3, {
    required: true,
  });
  await assertCurrencyExists(currencyCode, "currencyCode", {
    runQuery: tx.query,
  });

  const movementId = parsePositiveInt(movementRow.id);
  const subledgerReferenceNo = `INVENTORY_MOVEMENT:${movementId}`.slice(0, 100);
  const documentRef =
    stockLinkRow?.document_no ||
    movementRow?.source_document_no ||
    `Doc #${parsePositiveInt(movementRow?.source_document_id) || "-"}`;
  const baseDescription = `Inventory issue COGS ${documentRef}`.slice(0, 255);
  const lines = [
    {
      accountId: postingAccounts.cogsAccount.id,
      description: `${baseDescription} | DR COGS`.slice(0, 255),
      subledgerReferenceNo,
      currencyCode,
      amountTxn: totalCostTxn,
      debitBase: totalCostBase,
      creditBase: 0,
    },
    {
      accountId: postingAccounts.inventoryAssetAccount.id,
      description: `${baseDescription} | CR Inventory`.slice(0, 255),
      subledgerReferenceNo,
      currencyCode,
      amountTxn: Number((totalCostTxn * -1).toFixed(AMOUNT_SCALE)),
      debitBase: 0,
      creditBase: totalCostBase,
    },
  ];

  const journalResult = await insertPostedJournalWithLinesTx(tx, {
    tenantId,
    legalEntityId,
    bookId: journalContext.bookId,
    fiscalPeriodId: journalContext.fiscalPeriodId,
    userId: postingUserId,
    journalNo: `INVISS-${movementId}`.slice(0, 40),
    entryDate: movementRow.movement_date,
    documentDate: movementRow.movement_date,
    currencyCode,
    description: baseDescription.slice(0, 500),
    referenceNo: `INV-MOV-${movementId}`.slice(0, 100),
    lines,
  });

  await upsertJournalSourceLinkTx(tx, {
    tenantId,
    legalEntityId,
    journalEntryId: journalResult.journalEntryId,
    sourceRefType: "INVENTORY_MOVEMENT",
    sourceRefId: movementId,
    linkRole: "PRIMARY",
  });
  const stockLinkId = parsePositiveInt(movementRow?.source_stock_link_id);
  if (stockLinkId) {
    await upsertJournalSourceLinkTx(tx, {
      tenantId,
      legalEntityId,
      journalEntryId: journalResult.journalEntryId,
      sourceRefType: "CARI_STOCK_LINK",
      sourceRefId: stockLinkId,
      linkRole: "SUPPORTING",
    });
  }

  await tx.query(
    `UPDATE inventory_movements
        SET posted_journal_entry_id = ?,
            posted_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND posted_journal_entry_id IS NULL`,
    [journalResult.journalEntryId, movementId]
  );

  return {
    journalEntryId: journalResult.journalEntryId,
    idempotent: false,
  };
}

export async function listInventoryWarehouses({
  tenantId,
  filters,
  runQuery = query,
}) {
  const limit = Math.max(0, Number(filters?.limit || 200));
  const offset = Math.max(0, Number(filters?.offset || 0));
  const params = [tenantId];
  let whereSql = "WHERE w.tenant_id = ?";
  const legalEntityId = parsePositiveInt(filters?.legalEntityId);
  if (legalEntityId) {
    whereSql += " AND w.legal_entity_id = ?";
    params.push(legalEntityId);
  }
  if (filters?.status) {
    whereSql += " AND w.status = ?";
    params.push(filters.status);
  }
  if (filters?.q) {
    whereSql += " AND (w.code LIKE ? OR w.name LIKE ?)";
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const result = await runQuery(
    `SELECT
        w.*,
        le.code AS legal_entity_code
       FROM inventory_warehouses w
       JOIN legal_entities le
         ON le.tenant_id = w.tenant_id
        AND le.id = w.legal_entity_id
       ${whereSql}
      ORDER BY le.code ASC, w.code ASC, w.id ASC
      LIMIT ${limit}
      OFFSET ${offset}`,
    params
  );
  return {
    rows: (result.rows || []).map(mapWarehouseRow),
  };
}

export async function createInventoryWarehouse({
  payload,
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  if (!tenantId || !legalEntityId) {
    throw badRequest("tenantId and legalEntityId are required");
  }
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId", {
    runQuery,
  });

  try {
    const insertResult = await runQuery(
      `INSERT INTO inventory_warehouses (
          tenant_id,
          legal_entity_id,
          code,
          name,
          status,
          notes
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        normalizeText(payload.code, 80, { required: true }).toUpperCase(),
        normalizeText(payload.name, 200, { required: true }),
        payload.status || "ACTIVE",
        normalizeText(payload.notes, 255),
      ]
    );
    const row = await fetchWarehouseById({
      tenantId,
      legalEntityId,
      warehouseId: insertResult.rows?.insertId,
      runQuery,
    });
    return mapWarehouseRow(row);
  } catch (error) {
    if (Number(error?.errno) === 1062) {
      throw badRequest("Warehouse code already exists in the selected legal entity");
    }
    throw error;
  }
}

export async function listPendingInventoryStockLinks({
  tenantId,
  filters,
  runQuery = query,
}) {
  const limit = Math.max(0, Number(filters?.limit || 200));
  const offset = Math.max(0, Number(filters?.offset || 0));
  const params = [tenantId];
  let whereSql = "WHERE sl.tenant_id = ?";
  const legalEntityId = parsePositiveInt(filters?.legalEntityId);
  if (legalEntityId) {
    whereSql += " AND sl.legal_entity_id = ?";
    params.push(legalEntityId);
  }
  if (filters?.linkStatus) {
    whereSql += " AND sl.link_status = ?";
    params.push(filters.linkStatus);
  }
  if (filters?.warehouseLinked === true) {
    whereSql += " AND sl.inventory_movement_id IS NOT NULL";
  }
  if (filters?.warehouseLinked === false) {
    whereSql += " AND sl.inventory_movement_id IS NULL";
  }

  const result = await runQuery(
    `SELECT
        sl.*,
        le.code AS legal_entity_code,
        d.document_no,
        d.document_date,
        d.direction,
        d.currency_code,
        l.line_no,
        l.description AS line_description,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        ic.item_type
       FROM cari_document_line_stock_links sl
       JOIN legal_entities le
         ON le.tenant_id = sl.tenant_id
        AND le.id = sl.legal_entity_id
       JOIN cari_documents d
         ON d.tenant_id = sl.tenant_id
        AND d.legal_entity_id = sl.legal_entity_id
        AND d.id = sl.cari_document_id
       JOIN cari_document_lines l
         ON l.tenant_id = sl.tenant_id
        AND l.legal_entity_id = sl.legal_entity_id
        AND l.cari_document_id = sl.cari_document_id
        AND l.id = sl.cari_document_line_id
       JOIN item_cards ic
         ON ic.tenant_id = sl.tenant_id
        AND ic.id = sl.item_card_id
       ${whereSql}
      ORDER BY sl.link_status ASC, d.document_date DESC, d.document_no DESC, l.line_no ASC
      LIMIT ${limit}
      OFFSET ${offset}`,
    params
  );
  return {
    rows: (result.rows || []).map(mapPendingStockLinkRow),
  };
}

export async function listInventoryMovements({
  tenantId,
  filters,
  runQuery = query,
}) {
  const limit = Math.max(0, Number(filters?.limit || 200));
  const offset = Math.max(0, Number(filters?.offset || 0));
  const params = [tenantId];
  let whereSql = "WHERE m.tenant_id = ?";
  const legalEntityId = parsePositiveInt(filters?.legalEntityId);
  if (legalEntityId) {
    whereSql += " AND m.legal_entity_id = ?";
    params.push(legalEntityId);
  }
  const warehouseId = parsePositiveInt(filters?.warehouseId);
  if (warehouseId) {
    whereSql += " AND m.warehouse_id = ?";
    params.push(warehouseId);
  }
  if (filters?.movementType) {
    whereSql += " AND m.movement_type = ?";
    params.push(filters.movementType);
  }
  if (filters?.valuationStatus) {
    whereSql += " AND m.valuation_status = ?";
    params.push(filters.valuationStatus);
  }

  const result = await runQuery(
    `SELECT
        m.*,
        le.code AS legal_entity_code,
        w.code AS warehouse_code,
        w.name AS warehouse_name,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        d.document_no AS source_document_no,
        om.id AS reversal_of_movement_id,
        om.movement_type AS reversal_of_movement_type,
        om.movement_date AS reversal_of_movement_date,
        rm.id AS reversal_movement_id,
        rm.movement_type AS reversal_movement_type,
        rm.movement_date AS reversal_movement_date,
        pj.journal_no AS posted_journal_no,
        rj.journal_no AS reversal_journal_no
       FROM inventory_movements m
       JOIN legal_entities le
         ON le.tenant_id = m.tenant_id
        AND le.id = m.legal_entity_id
       JOIN inventory_warehouses w
         ON w.id = m.warehouse_id
       JOIN item_cards ic
         ON ic.tenant_id = m.tenant_id
        AND ic.id = m.item_card_id
       LEFT JOIN cari_documents d
         ON m.source_document_type = 'CARI_DOCUMENT'
        AND d.tenant_id = m.tenant_id
        AND d.id = m.source_document_id
       LEFT JOIN inventory_movements om
         ON om.id = m.reversal_of_movement_id
       LEFT JOIN inventory_movements rm
         ON rm.reversal_of_movement_id = m.id
       LEFT JOIN journal_entries pj
         ON pj.id = m.posted_journal_entry_id
       LEFT JOIN journal_entries rj
         ON rj.id = m.reversal_journal_entry_id
       ${whereSql}
      ORDER BY m.movement_date DESC, m.id DESC
      LIMIT ${limit}
      OFFSET ${offset}`,
    params
  );
  const mappedRows = (result.rows || []).map(mapMovementRow);
  return {
    rows: await attachIssueLayerConsumptions({
      movementRows: mappedRows,
      runQuery,
    }),
  };
}

export async function listInventoryCostLayers({
  tenantId,
  filters,
  runQuery = query,
}) {
  const limit = Math.max(0, Number(filters?.limit || 200));
  const offset = Math.max(0, Number(filters?.offset || 0));
  const params = [tenantId];
  let whereSql = "WHERE cl.tenant_id = ?";
  const legalEntityId = parsePositiveInt(filters?.legalEntityId);
  if (legalEntityId) {
    whereSql += " AND cl.legal_entity_id = ?";
    params.push(legalEntityId);
  }
  const warehouseId = parsePositiveInt(filters?.warehouseId);
  if (warehouseId) {
    whereSql += " AND cl.warehouse_id = ?";
    params.push(warehouseId);
  }
  const itemCardId = parsePositiveInt(filters?.itemCardId);
  if (itemCardId) {
    whereSql += " AND cl.item_card_id = ?";
    params.push(itemCardId);
  }
  if (filters?.layerStatus) {
    whereSql += " AND cl.layer_status = ?";
    params.push(filters.layerStatus);
  }

  const result = await runQuery(
    `SELECT
        cl.*,
        le.code AS legal_entity_code,
        w.code AS warehouse_code,
        w.name AS warehouse_name,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        m.source_stock_link_id
       FROM inventory_cost_layers cl
       JOIN legal_entities le
         ON le.tenant_id = cl.tenant_id
        AND le.id = cl.legal_entity_id
       JOIN inventory_warehouses w
         ON w.id = cl.warehouse_id
       JOIN item_cards ic
         ON ic.tenant_id = cl.tenant_id
        AND ic.id = cl.item_card_id
       JOIN inventory_movements m
         ON m.id = cl.source_movement_id
       ${whereSql}
      ORDER BY cl.created_at DESC, cl.id DESC
      LIMIT ${limit}
      OFFSET ${offset}`,
    params
  );
  return {
    rows: (result.rows || []).map(mapCostLayerRow),
  };
}

export async function createInventoryMovementFromStockLink({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  const warehouseId = parsePositiveInt(payload?.warehouseId);
  const stockLinkId = parsePositiveInt(payload?.sourceStockLinkId);
  if (!tenantId || !legalEntityId || !warehouseId || !stockLinkId) {
    throw badRequest("tenantId, legalEntityId, warehouseId, and sourceStockLinkId are required");
  }
  const movementDate = normalizeDateOnly(payload?.movementDate, "movementDate");
  const note = normalizeText(payload?.note, 255);

  return withTransaction(async (tx) => {
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId", {
      runQuery: tx.query,
    });
    const warehouseRow = await fetchWarehouseById({
      tenantId,
      legalEntityId,
      warehouseId,
      runQuery: tx.query,
    });
    if (!warehouseRow) {
      throw badRequest("warehouseId must belong to legalEntityId");
    }
    if (String(warehouseRow.status || "").toUpperCase() !== "ACTIVE") {
      throw badRequest("warehouseId must reference an ACTIVE warehouse");
    }

    const stockLinkRow = await fetchPendingStockLinkById({
      tenantId,
      legalEntityId,
      stockLinkId,
      runQuery: tx.query,
    });
    if (!stockLinkRow) {
      throw badRequest("sourceStockLinkId not found for legalEntityId");
    }
    const stockLinkStatus = String(stockLinkRow.link_status || "").toUpperCase();
    if (
      stockLinkStatus === "LINKED" &&
      parsePositiveInt(stockLinkRow.inventory_movement_id)
    ) {
      const existingMovementRow = await fetchInventoryMovementDbRowById({
        movementId: stockLinkRow.inventory_movement_id,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!existingMovementRow) {
        throw badRequest("sourceStockLinkId references a missing inventory movement");
      }
      if (String(existingMovementRow.movement_type || "").toUpperCase() === "ISSUE") {
        await ensureInventoryIssueJournalPostedTx({
          tx,
          tenantId,
          legalEntityId,
          userId: payload?.userId,
          movementRow: existingMovementRow,
          itemCard: await getItemCardByIdForTenant({
            tenantId,
            itemCardId: existingMovementRow.item_card_id,
            runQuery: tx.query,
          }),
          stockLinkRow,
        });
      }
      return fetchMovementById({
        movementId: existingMovementRow.id,
        runQuery: async (sql, params = []) => {
          const nextParams = [...params];
          return tx.query(sql, nextParams);
        },
      });
    }
    if (stockLinkStatus !== "PENDING") {
      throw badRequest("sourceStockLinkId must be PENDING");
    }

    const itemCard = await getItemCardByIdForTenant({
      tenantId,
      itemCardId: stockLinkRow.item_card_id,
      runQuery: tx.query,
    });
    if (String(itemCard?.itemType || "").toUpperCase() !== "STOCK_ITEM") {
      throw badRequest("sourceStockLinkId must reference a STOCK_ITEM");
    }

    const quantity = normalizeAmount(stockLinkRow.requested_quantity, "requestedQuantity");
    const postedNetAmountTxn = normalizeAmount(stockLinkRow.posted_net_amount_txn, "postedNetAmountTxn", {
      allowZero: true,
    });
    const postedNetAmountBase = normalizeAmount(stockLinkRow.posted_net_amount_base, "postedNetAmountBase", {
      allowZero: true,
    });
    const stockLinkCurrencyCode = normalizeText(stockLinkRow.currency_code, 3, {
      required: true,
    }).toUpperCase();

    const stockImpactMode = String(stockLinkRow.stock_impact_mode || "").trim().toUpperCase();
    if (!["RECEIPT_PENDING", "ISSUE_PENDING"].includes(stockImpactMode)) {
      throw badRequest("sourceStockLinkId must reference a pending stock-impact mode");
    }
    const movementType = stockImpactMode === "RECEIPT_PENDING" ? "RECEIPT" : "ISSUE";
    let currencyCode = stockLinkCurrencyCode;
    let valuationStatus = "VALUED";
    let totalCostTxn = null;
    let totalCostBase = null;
    let unitCostTxn = null;
    let unitCostBase = null;
    let issueValuationPlan = null;

    if (movementType === "RECEIPT") {
      await assertCurrencyExists(currencyCode, "currencyCode", {
        runQuery: tx.query,
      });
      totalCostTxn = postedNetAmountTxn;
      totalCostBase = postedNetAmountBase;
      unitCostTxn = Number((postedNetAmountTxn / quantity).toFixed(AMOUNT_SCALE));
      unitCostBase = Number((postedNetAmountBase / quantity).toFixed(AMOUNT_SCALE));
    } else {
      const baseCurrencyCode = await fetchLegalEntityBaseCurrencyCode({
        tenantId,
        legalEntityId,
        runQuery: tx.query,
      });
      issueValuationPlan = buildIssueValuationPlan({
        openLayerRows: await fetchOpenCostLayersForIssue({
          tenantId,
          legalEntityId,
          warehouseId,
          itemCardId: itemCard.id,
          runQuery: tx.query,
        }),
        quantity,
        itemCard,
        warehouseRow,
        baseCurrencyCode,
      });
      currencyCode = issueValuationPlan.currencyCode;
      totalCostTxn = issueValuationPlan.totalCostTxn;
      totalCostBase = issueValuationPlan.totalCostBase;
      unitCostTxn = issueValuationPlan.unitCostTxn;
      unitCostBase = issueValuationPlan.unitCostBase;
    }

    const movementInsert = await tx.query(
      `INSERT INTO inventory_movements (
          tenant_id,
          legal_entity_id,
          warehouse_id,
          item_card_id,
          movement_type,
          source_type,
          source_stock_link_id,
          source_document_type,
          source_document_id,
          source_document_line_id,
          movement_date,
          quantity,
          unit_cost_txn,
          unit_cost_base,
          total_cost_txn,
          total_cost_base,
          currency_code,
          valuation_status,
          note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        warehouseId,
        itemCard.id,
        movementType,
        "CARI_STOCK_LINK",
        stockLinkId,
        "CARI_DOCUMENT",
        parsePositiveInt(stockLinkRow.cari_document_id),
        parsePositiveInt(stockLinkRow.cari_document_line_id),
        movementDate,
        quantity,
        unitCostTxn,
        unitCostBase,
        totalCostTxn,
        totalCostBase,
        currencyCode,
        valuationStatus,
        note,
      ]
    );
    const movementId = parsePositiveInt(movementInsert.rows?.insertId);
    if (!movementId) {
      throw new Error("Inventory movement create failed");
    }

    if (movementType === "RECEIPT") {
      await tx.query(
        `INSERT INTO inventory_cost_layers (
            tenant_id,
            legal_entity_id,
            warehouse_id,
            item_card_id,
            source_movement_id,
            valuation_method,
            layer_status,
            currency_code,
            quantity_in,
            quantity_remaining,
            unit_cost_txn,
            unit_cost_base,
            total_cost_txn,
            total_cost_base
         ) VALUES (?, ?, ?, ?, ?, 'FIFO', 'OPEN', ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          warehouseId,
          itemCard.id,
          movementId,
          currencyCode,
          quantity,
          quantity,
          unitCostTxn,
          unitCostBase,
          totalCostTxn,
          totalCostBase,
        ]
      );
    } else {
      for (const [index, consumption] of (issueValuationPlan?.consumptions || []).entries()) {
        await tx.query(
          `INSERT INTO inventory_issue_layer_consumptions (
              tenant_id,
              legal_entity_id,
              issue_movement_id,
              cost_layer_id,
              consumption_no,
              quantity_consumed,
              unit_cost_txn,
              unit_cost_base,
              total_cost_txn,
              total_cost_base,
              currency_code
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tenantId,
            legalEntityId,
            movementId,
            consumption.costLayerId,
            index + 1,
            consumption.quantityConsumed,
            consumption.unitCostTxn,
            consumption.unitCostBase,
            consumption.totalCostTxn,
            consumption.totalCostBase,
            consumption.currencyCode,
          ]
        );
        await tx.query(
          `UPDATE inventory_cost_layers
              SET quantity_remaining = ?,
                  layer_status = ?
            WHERE id = ?`,
          [
            consumption.quantityRemainingAfter,
            consumption.quantityRemainingAfter <= 0 ? "CLOSED" : "OPEN",
            consumption.costLayerId,
          ]
        );
      }
      const movementRow = await fetchInventoryMovementDbRowById({
        movementId,
        runQuery: tx.query,
        forUpdate: true,
      });
      await ensureInventoryIssueJournalPostedTx({
        tx,
        tenantId,
        legalEntityId,
        userId: payload?.userId,
        movementRow,
        itemCard,
        stockLinkRow,
      });
    }

    await tx.query(
      `UPDATE cari_document_line_stock_links
       SET link_status = 'LINKED',
           inventory_document_type = 'INVENTORY_MOVEMENT',
           inventory_document_id = ?,
           inventory_movement_id = ?,
           resolved_at = CURRENT_TIMESTAMP,
           resolution_note = ?
       WHERE tenant_id = ?
         AND legal_entity_id = ?
         AND id = ?`,
      [
        movementId,
        movementId,
        note || `${movementType} movement linked to warehouse ${warehouseRow.code || warehouseId}`,
        tenantId,
        legalEntityId,
        stockLinkId,
      ]
    );

    return fetchMovementById({
      movementId,
      runQuery: async (sql, params = []) => {
        const nextParams = [...params];
        return tx.query(sql, nextParams);
      },
    });
  });
}

export async function reverseInventoryMovementById({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const userId = parsePositiveInt(payload?.userId);
  const movementId = parsePositiveInt(payload?.movementId);
  if (!tenantId || !userId || !movementId) {
    throw badRequest("tenantId, userId, and movementId are required");
  }
  const reversalDate = normalizeDateOnly(
    payload?.reversalDate || todayDateOnly(),
    "reversalDate"
  );
  const reason =
    normalizeText(payload?.reason, 255) || "Manual inventory movement reversal";

  return withTransaction(async (tx) => {
    const movementRow = await fetchInventoryMovementDbRowById({
      movementId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!movementRow || parsePositiveInt(movementRow.tenant_id) !== tenantId) {
      throw badRequest("movementId not found for tenant");
    }

    const legalEntityId = parsePositiveInt(movementRow.legal_entity_id);
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId", {
      runQuery: tx.query,
    });

    const movementType = String(movementRow.movement_type || "").toUpperCase();
    if (!["ISSUE", "RECEIPT"].includes(movementType)) {
      throw badRequest("Only ISSUE and RECEIPT movements can be reversed");
    }
    if (String(movementRow.valuation_status || "").toUpperCase() !== "VALUED") {
      throw badRequest("Only VALUED issue and receipt movements can be reversed");
    }
    const sourceStockLinkId = parsePositiveInt(movementRow.source_stock_link_id);
    const stockLinkRow = sourceStockLinkId
      ? await fetchPendingStockLinkById({
          tenantId,
          legalEntityId,
          stockLinkId: sourceStockLinkId,
          runQuery: tx.query,
          forUpdate: true,
        })
      : null;
    if (
      parsePositiveInt(movementRow.reversal_journal_entry_id) ||
      normalizeText(movementRow.reversed_at)
    ) {
      if (movementType === "ISSUE" && stockLinkRow) {
        await ensureIssueReopenedStockLinkTx({
          tx,
          tenantId,
          legalEntityId,
          originalStockLinkRow: stockLinkRow,
          movementRow,
          reversalDate,
        });
      } else if (movementType === "RECEIPT") {
        const receiptCostLayerRow = await fetchReceiptCostLayerBySourceMovementId({
          tenantId,
          movementId,
          runQuery: tx.query,
          forUpdate: true,
        });
        if (receiptCostLayerRow) {
          await ensureReceiptUndoMovementTx({
            tx,
            tenantId,
            legalEntityId,
            originalMovementRow: movementRow,
            receiptCostLayerRow,
            stockLinkRow,
            reversalDate,
            reason,
          });
        }
      }
      return fetchMovementById({
        movementId,
        runQuery: async (sql, params = []) => tx.query(sql, [...params]),
      });
    }

    if (movementType === "RECEIPT") {
      const receiptCostLayerRow = await fetchReceiptCostLayerBySourceMovementId({
        tenantId,
        movementId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (!receiptCostLayerRow) {
        throw badRequest("Receipt movement has no cost layer to reverse");
      }

      const quantityIn = normalizeAmount(
        receiptCostLayerRow.quantity_in,
        "quantityIn"
      );
      const quantityRemaining = normalizeAmount(
        receiptCostLayerRow.quantity_remaining,
        "quantityRemaining",
        { allowZero: true }
      );
      if (quantityRemaining + BALANCE_EPSILON < quantityIn) {
        throw badRequest(
          "Cannot reverse this receipt while quantity is still consumed by later issue movements"
        );
      }

      await ensureReceiptUndoMovementTx({
        tx,
        tenantId,
        legalEntityId,
        originalMovementRow: movementRow,
        receiptCostLayerRow,
        stockLinkRow,
        reversalDate,
        reason,
      });

      await tx.query(
        `UPDATE inventory_cost_layers
            SET quantity_remaining = 0,
                layer_status = 'CLOSED'
          WHERE tenant_id = ?
            AND id = ?`,
        [tenantId, parsePositiveInt(receiptCostLayerRow.id)]
      );

      await tx.query(
        `UPDATE inventory_movements
            SET reversed_at = COALESCE(reversed_at, CURRENT_TIMESTAMP)
          WHERE id = ?`,
        [movementId]
      );

      return fetchMovementById({
        movementId,
        runQuery: async (sql, params = []) => tx.query(sql, [...params]),
      });
    }

    await assertNoLaterValuedIssueExistsForReverse({
      tenantId,
      movementRow,
      runQuery: tx.query,
    });

    const consumptions = await fetchIssueLayerConsumptionsForUpdate({
      issueMovementId: movementId,
      runQuery: tx.query,
    });
    if (consumptions.length === 0) {
      throw badRequest("Issue movement has no layer consumptions to reverse");
    }

    for (const consumptionRow of consumptions) {
      const quantityIn = normalizeAmount(consumptionRow.quantity_in, "quantityIn");
      const quantityRemaining = normalizeAmount(
        consumptionRow.quantity_remaining,
        "quantityRemaining",
        { allowZero: true }
      );
      const quantityConsumed = normalizeAmount(
        consumptionRow.quantity_consumed,
        "quantityConsumed"
      );
      const restoredQuantity = roundAmount(quantityRemaining + quantityConsumed);
      if (restoredQuantity - quantityIn > BALANCE_EPSILON) {
        throw badRequest("Issue reversal would over-restore a cost layer");
      }
      await tx.query(
        `UPDATE inventory_cost_layers
            SET quantity_remaining = ?,
                layer_status = 'OPEN'
          WHERE id = ?`,
        [restoredQuantity, parsePositiveInt(consumptionRow.cost_layer_id)]
      );
    }

    const originalJournalEntryId = parsePositiveInt(movementRow.posted_journal_entry_id);
    let reversalJournalEntryId = null;

    if (originalJournalEntryId) {
      const originalJournalWithLines = await fetchJournalEntryWithLines({
        tenantId,
        journalEntryId: originalJournalEntryId,
        runQuery: tx.query,
      });
      const originalJournal = originalJournalWithLines.journal;
      const originalJournalLines = originalJournalWithLines.lines || [];
      if (!originalJournal) {
        throw badRequest("Posted inventory journal not found for movement reversal");
      }

      const existingJournalReversalId = parsePositiveInt(
        originalJournal.reversal_journal_entry_id
      );
      if (existingJournalReversalId) {
        reversalJournalEntryId = existingJournalReversalId;
      } else {
        if (String(originalJournal.status || "").toUpperCase() !== "POSTED") {
          throw badRequest("Only POSTED inventory journals can be reversed");
        }
        if (originalJournalLines.length === 0) {
          throw badRequest("Posted inventory journal has no lines to reverse");
        }

        const reversalJournalContext = await resolveBookAndOpenPeriodForDate({
          tenantId,
          legalEntityId,
          targetDate: reversalDate,
          preferredBookId: parsePositiveInt(originalJournal.book_id),
          runQuery: tx.query,
        });

        const reversalLines = originalJournalLines.map((line) => ({
          accountId: parsePositiveInt(line.account_id),
          debitBase: Number(line.credit_base || 0),
          creditBase: Number(line.debit_base || 0),
          amountTxn: Number((Number(line.amount_txn || 0) * -1).toFixed(AMOUNT_SCALE)),
          description: line.description
            ? String(line.description).slice(0, 255)
            : `Reversal of inventory movement ${movementId}`,
          subledgerReferenceNo: `INVENTORY_MOVEMENT_REVERSE:${movementId}`.slice(0, 100),
          currencyCode: normalizeUpperText(
            line.currency_code || movementRow.currency_code,
            3,
            { required: true }
          ),
        }));

        const reversalJournalResult = await insertPostedJournalWithLinesTx(tx, {
          tenantId,
          legalEntityId,
          bookId: reversalJournalContext.bookId,
          fiscalPeriodId: reversalJournalContext.fiscalPeriodId,
          userId,
          journalNo: buildInventoryJournalNo("INV-REV", movementId),
          entryDate: reversalDate,
          documentDate: reversalDate,
          currencyCode: normalizeUpperText(
            originalJournal.currency_code || movementRow.currency_code,
            3,
            { required: true }
          ),
          description: `Reversal of inventory movement ${movementId}`.slice(0, 500),
          referenceNo: `INV-REV:${movementId}`.slice(0, 100),
          lines: reversalLines,
        });
        reversalJournalEntryId = reversalJournalResult.journalEntryId;

        await upsertJournalSourceLinkTx(tx, {
          tenantId,
          legalEntityId,
          journalEntryId: reversalJournalEntryId,
          sourceRefType: "INVENTORY_MOVEMENT",
          sourceRefId: movementId,
          linkRole: "PRIMARY",
        });
        if (sourceStockLinkId) {
          await upsertJournalSourceLinkTx(tx, {
            tenantId,
            legalEntityId,
            journalEntryId: reversalJournalEntryId,
            sourceRefType: "CARI_STOCK_LINK",
            sourceRefId: sourceStockLinkId,
            linkRole: "SUPPORTING",
          });
        }

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
          [userId, reversalJournalEntryId, reason, tenantId, originalJournalEntryId]
        );
        if (Number(reverseJournalUpdateResult.rows?.affectedRows || 0) === 0) {
          throw badRequest("Inventory journal is already reversed");
        }
      }
    }

    await tx.query(
      `UPDATE inventory_movements
          SET reversal_journal_entry_id = COALESCE(?, reversal_journal_entry_id),
              reversed_at = COALESCE(reversed_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      [reversalJournalEntryId, movementId]
    );

    if (stockLinkRow) {
      await ensureIssueReopenedStockLinkTx({
        tx,
        tenantId,
        legalEntityId,
        originalStockLinkRow: stockLinkRow,
        movementRow,
        reversalDate,
      });
    }

    return fetchMovementById({
      movementId,
      runQuery: async (sql, params = []) => tx.query(sql, [...params]),
    });
  });
}
