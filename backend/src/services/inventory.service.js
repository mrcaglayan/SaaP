import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertAccountBelongsToTenant,
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
  assertCurrencyExists,
} from "../tenantGuards.js";
import { getItemCardByIdForTenant } from "./item.card.service.js";
import {
  assertWarehouseBelongsToOwnershipContext,
  buildInsufficientAvailableStockInBoundWarehouseMessage,
  buildNoActiveWarehouseForOwnershipContextMessage,
  buildOwnershipContext,
  buildTransferRequiredMessage,
  deriveDocumentOwnershipContext,
  deriveOwnershipContextFromOperatingUnitId,
  deriveWarehouseOwnershipContext,
  isStockAffectingLine,
  normalizeOwnershipContextInput,
  sameOwnershipContext,
} from "./ownership.context.policy.service.js";
import {
  STOCK_LINK_REPAIR_REASON_SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID,
  deriveStockLinkReadState,
} from "./stock.link.read-state.service.js";
import { assertLocalClosePackPostingAllowedForLines } from "./local.close-enforcement.service.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";
import {
  applyLandedCostIssueOverlayPlanTx,
  buildLandedCostIssueOverlayPlanTx,
  mergeIssueValuationPlanWithLandedCostOverlay,
  restoreLandedCostConsumptionForMovementReversalTx,
  unwindTransferReceiptLandedCostCarryForwardTx,
} from "./inventory.landed-cost.runtime.service.js";

const AMOUNT_SCALE = 6;
const BALANCE_EPSILON = 0.000001;
const CROSS_CONTEXT_TRANSFER_WORKFLOW_MESSAGE =
  "Cross-context stock movement must use inventory transfer workflow";

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

function amountsAreEqual(left, right, epsilon = BALANCE_EPSILON) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function calculateDateAgeInDays(value, asOfDate = new Date()) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  const targetDate = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(targetDate.getTime())) {
    return null;
  }
  const asOfUtcDate = new Date(
    Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), asOfDate.getUTCDate())
  );
  const targetUtcDate = new Date(
    Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate())
  );
  const diffMs = asOfUtcDate.getTime() - targetUtcDate.getTime();
  return Math.max(0, Math.floor(diffMs / 86400000));
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
    ownershipScope: row.ownership_scope || "CENTRAL",
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
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
  const readState = deriveStockLinkReadState(row);
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    documentId: parsePositiveInt(row.cari_document_id),
    documentLineId: parsePositiveInt(row.cari_document_line_id),
    documentNo: row.document_no || null,
    documentDate: row.document_date || null,
    documentOperatingUnitId: parsePositiveInt(row.document_operating_unit_id),
    documentOperatingUnitCode: row.document_operating_unit_code || null,
    documentOperatingUnitName: row.document_operating_unit_name || null,
    direction: row.direction || null,
    stockImpactMode: row.stock_impact_mode || null,
    linkStatus: row.link_status || null,
    requestedQuantity: toDecimalNumber(row.requested_quantity),
    materializedQuantity: toDecimalNumber(row.materialized_quantity),
    remainingQuantity: toDecimalNumber(row.remaining_quantity),
    postedNetAmountTxn: toDecimalNumber(row.posted_net_amount_txn),
    postedNetAmountBase: toDecimalNumber(row.posted_net_amount_base),
    sourceLineNetAmountTxn: toDecimalNumber(row.source_line_net_amount_txn),
    sourceLineNetAmountBase: toDecimalNumber(row.source_line_net_amount_base),
    currencyCode: row.currency_code || null,
    boundWarehouseId: parsePositiveInt(row.bound_warehouse_id),
    boundWarehouseCode: row.bound_warehouse_code || null,
    boundWarehouseName: row.bound_warehouse_name || null,
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
    boundAvailableQuantity: toDecimalNumber(row.bound_available_quantity),
    crossContextAvailableQuantity: toDecimalNumber(row.cross_context_available_quantity),
    transferSourceWarehouseId: parsePositiveInt(row.transfer_source_warehouse_id),
    transferSourceWarehouseCode: row.transfer_source_warehouse_code || null,
    transferSourceWarehouseName: row.transfer_source_warehouse_name || null,
    transferSourceOwnershipScope: row.transfer_source_ownership_scope || null,
    transferSourceOperatingUnitId: parsePositiveInt(row.transfer_source_operating_unit_id),
    transferSourceOperatingUnitCode: row.transfer_source_operating_unit_code || null,
    transferSourceOperatingUnitName: row.transfer_source_operating_unit_name || null,
    transferSourceAvailableQuantity: toDecimalNumber(row.transfer_source_available_quantity),
    queueState: readState.queueState,
    blockedReasonCode: readState.blockedReasonCode,
    repairReasonCode: readState.repairReasonCode,
    successorInheritanceStatus: readState.successorInheritanceStatus,
    canMaterialize: readState.canMaterialize,
    isStrictMode: readState.isStrictMode,
    isRepairOnly: readState.isRepairOnly,
    isLegacyRow: readState.isLegacyRow,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function attachCrossContextTransferAvailabilityToStockLinkRows({
  stockLinkRows,
  runQuery = query,
}) {
  const rows = Array.isArray(stockLinkRows) ? stockLinkRows : [];
  if (rows.length === 0) {
    return rows;
  }

  const probeCache = new Map();
  for (const row of rows) {
    if (
      normalizeUpperText(row?.link_status ?? row?.linkStatus) !== "PENDING" ||
      normalizeUpperText(row?.stock_impact_mode ?? row?.stockImpactMode) !== "ISSUE_PENDING"
    ) {
      continue;
    }

    const tenantId = parsePositiveInt(row?.tenant_id ?? row?.tenantId);
    const legalEntityId = parsePositiveInt(row?.legal_entity_id ?? row?.legalEntityId);
    const itemCardId = parsePositiveInt(row?.item_card_id ?? row?.itemCardId);
    const boundWarehouseId = parsePositiveInt(
      row?.bound_warehouse_id ?? row?.warehouse_id ?? row?.boundWarehouseId ?? row?.warehouseId
    );
    const requestedQuantityValue = row?.requested_quantity ?? row?.requestedQuantity;
    const requestedQuantity =
      requestedQuantityValue === null || requestedQuantityValue === undefined
        ? null
        : roundAmount(requestedQuantityValue);
    if (!tenantId || !legalEntityId || !itemCardId || !boundWarehouseId || requestedQuantity === null) {
      continue;
    }

    const ownershipContext = deriveDocumentOwnershipContext(row);
    const cacheKey = [
      tenantId,
      legalEntityId,
      ownershipContext.ownershipScope || "CENTRAL",
      ownershipContext.operatingUnitId || 0,
      itemCardId,
      boundWarehouseId,
      requestedQuantity,
    ].join(":");
    let availability = probeCache.get(cacheKey);
    if (!availability) {
      availability = await probeCrossContextAvailabilityForIssue({
        tenantId,
        legalEntityId,
        ownershipContext,
        itemCardId,
        boundWarehouseId,
        requestedQuantity,
        runQuery,
      });
      probeCache.set(cacheKey, availability);
    }

    row.bound_available_quantity = roundAmount(availability.boundAvailableQuantity || 0);
    row.cross_context_available_quantity = roundAmount(
      availability.crossContextAvailableQuantity || 0
    );
    row.transfer_source_warehouse_id = parsePositiveInt(
      availability.primaryCandidate?.warehouseId
    );
    row.transfer_source_warehouse_code = availability.primaryCandidate?.warehouseCode || null;
    row.transfer_source_warehouse_name = availability.primaryCandidate?.warehouseName || null;
    row.transfer_source_ownership_scope =
      availability.primaryCandidate?.ownershipScope || null;
    row.transfer_source_operating_unit_id = parsePositiveInt(
      availability.primaryCandidate?.operatingUnitId
    );
    row.transfer_source_operating_unit_code =
      availability.primaryCandidate?.operatingUnitCode || null;
    row.transfer_source_operating_unit_name =
      availability.primaryCandidate?.operatingUnitName || null;
    row.transfer_source_available_quantity = roundAmount(
      availability.primaryCandidate?.availableQuantity || 0
    );
  }
  return rows;
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
    sourceTransferNo: row.source_transfer_no || null,
    sourceTransferStatus: row.source_transfer_status || null,
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

function assertInventoryWarehouseBelongsToOwnershipContext({
  warehouseRow,
  ownershipContext,
  ownershipContextRow,
  ownerLabel = "document",
} = {}) {
  try {
    assertWarehouseBelongsToOwnershipContext({
      warehouseRow,
      ownershipContext,
      ownershipContextRow,
      ownerLabel,
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes(CROSS_CONTEXT_TRANSFER_WORKFLOW_MESSAGE)) {
      throw badRequest(message);
    }
    throw error;
  }
}

async function fetchWarehouseById({
  tenantId,
  legalEntityId,
  warehouseId,
  runQuery = query,
}) {
  const result = await runQuery(
    `SELECT
        w.*,
        le.code AS legal_entity_code,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
       FROM inventory_warehouses w
       JOIN legal_entities le
         ON le.tenant_id = w.tenant_id
        AND le.id = w.legal_entity_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = w.tenant_id
        AND ou.id = w.operating_unit_id
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
        d.operating_unit_id AS document_operating_unit_id,
        dou.code AS document_operating_unit_code,
        dou.name AS document_operating_unit_name,
        d.direction,
        d.currency_code,
        l.line_no,
        l.description AS line_description,
        l.line_net_amount_txn AS source_line_net_amount_txn,
        l.line_net_amount_base AS source_line_net_amount_base,
        sl.warehouse_id AS bound_warehouse_id,
        bw.code AS bound_warehouse_code,
        bw.name AS bound_warehouse_name,
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
      LEFT JOIN operating_units dou
        ON dou.tenant_id = d.tenant_id
       AND dou.id = d.operating_unit_id
      JOIN cari_document_lines l
        ON l.tenant_id = sl.tenant_id
       AND l.legal_entity_id = sl.legal_entity_id
       AND l.cari_document_id = sl.cari_document_id
       AND l.id = sl.cari_document_line_id
      JOIN item_cards ic
        ON ic.tenant_id = sl.tenant_id
       AND ic.id = sl.item_card_id
      LEFT JOIN inventory_warehouses bw
        ON bw.id = sl.warehouse_id
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
        d.operating_unit_id AS document_operating_unit_id,
        dou.code AS document_operating_unit_code,
        dou.name AS document_operating_unit_name,
        d.direction,
        d.currency_code,
        l.line_no,
        l.description AS line_description,
        l.line_net_amount_txn AS source_line_net_amount_txn,
        l.line_net_amount_base AS source_line_net_amount_base,
        sl.warehouse_id AS bound_warehouse_id,
        bw.code AS bound_warehouse_code,
        bw.name AS bound_warehouse_name,
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
      LEFT JOIN operating_units dou
        ON dou.tenant_id = d.tenant_id
       AND dou.id = d.operating_unit_id
      JOIN cari_document_lines l
        ON l.tenant_id = sl.tenant_id
       AND l.legal_entity_id = sl.legal_entity_id
       AND l.cari_document_id = sl.cari_document_id
       AND l.id = sl.cari_document_line_id
      JOIN item_cards ic
        ON ic.tenant_id = sl.tenant_id
       AND ic.id = sl.item_card_id
      LEFT JOIN inventory_warehouses bw
        ON bw.id = sl.warehouse_id
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

async function fetchReversalMovementByOriginalId({
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

export async function fetchLegalEntityBaseCurrencyCode({
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

export async function fetchOpenCostLayersForIssue({
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

function buildTransferRequiredAvailabilityError({
  warehouseRow,
  itemCard,
  requestedQuantity,
  boundAvailableQuantity,
  crossContextAvailableQuantity,
  ownershipContext,
  primaryCandidate = null,
} = {}) {
  const err = badRequest(
    buildTransferRequiredMessage({
      warehouseCode: warehouseRow?.code || null,
      warehouseName: warehouseRow?.name || null,
      warehouseId: parsePositiveInt(warehouseRow?.id),
      itemCardCode: itemCard?.code || null,
      itemCardName: itemCard?.name || null,
      itemCardId: parsePositiveInt(itemCard?.id),
      ownershipContext,
    })
  );
  err.code = "TRANSFER_REQUIRED";
  err.details = {
    reason: "TRANSFER_REQUIRED",
    warehouseId: parsePositiveInt(warehouseRow?.id),
    warehouseCode: warehouseRow?.code || null,
    warehouseName: warehouseRow?.name || null,
    itemCardId: parsePositiveInt(itemCard?.id),
    itemCardCode: itemCard?.code || null,
    itemCardName: itemCard?.name || null,
    requestedQuantity: normalizeAmount(requestedQuantity, "requestedQuantity"),
    boundAvailableQuantity: roundAmount(boundAvailableQuantity || 0),
    crossContextAvailableQuantity: roundAmount(crossContextAvailableQuantity || 0),
    transferSourceWarehouseId: parsePositiveInt(primaryCandidate?.warehouseId),
    transferSourceWarehouseCode: primaryCandidate?.warehouseCode || null,
    transferSourceWarehouseName: primaryCandidate?.warehouseName || null,
    transferSourceOwnershipScope: primaryCandidate?.ownershipScope || null,
    transferSourceOperatingUnitId: parsePositiveInt(primaryCandidate?.operatingUnitId),
    transferSourceOperatingUnitCode: primaryCandidate?.operatingUnitCode || null,
    transferSourceOperatingUnitName: primaryCandidate?.operatingUnitName || null,
    transferSourceAvailableQuantity: roundAmount(primaryCandidate?.availableQuantity || 0),
  };
  return err;
}

export async function probeCrossContextAvailabilityForIssue({
  tenantId,
  legalEntityId,
  ownershipContext,
  itemCardId,
  boundWarehouseId,
  requestedQuantity = null,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const normalizedItemCardId = parsePositiveInt(itemCardId);
  const normalizedBoundWarehouseId = parsePositiveInt(boundWarehouseId);
  const normalizedOwnershipContext = buildOwnershipContext(ownershipContext);
  const normalizedRequestedQuantity = requestedQuantity === null
    ? null
    : normalizeAmount(requestedQuantity, "requestedQuantity");
  if (
    !normalizedTenantId ||
    !normalizedLegalEntityId ||
    !normalizedItemCardId ||
    !normalizedBoundWarehouseId
  ) {
    return {
      requestedQuantity: normalizedRequestedQuantity,
      boundAvailableQuantity: 0,
      hasSufficientBoundStock: false,
      hasCrossContextAvailability: false,
      crossContextAvailableQuantity: 0,
      candidateWarehouseCount: 0,
      primaryCandidate: null,
      candidates: [],
    };
  }

  const result = await runQuery(
    `SELECT
        w.id AS warehouse_id,
        w.code AS warehouse_code,
        w.name AS warehouse_name,
        w.ownership_scope,
        w.operating_unit_id,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        SUM(cl.quantity_remaining) AS available_quantity
       FROM inventory_cost_layers cl
       JOIN inventory_warehouses w
         ON w.tenant_id = cl.tenant_id
        AND w.id = cl.warehouse_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = w.tenant_id
        AND ou.id = w.operating_unit_id
      WHERE cl.tenant_id = ?
        AND cl.legal_entity_id = ?
        AND cl.item_card_id = ?
        AND cl.layer_status = 'OPEN'
        AND cl.quantity_remaining > 0
        AND w.legal_entity_id = cl.legal_entity_id
        AND w.status = 'ACTIVE'
      GROUP BY
        w.id,
        w.code,
        w.name,
        w.ownership_scope,
        w.operating_unit_id,
        ou.code,
        ou.name
      HAVING SUM(cl.quantity_remaining) > 0
      ORDER BY
        CASE WHEN w.id = ? THEN 0 ELSE 1 END ASC,
        SUM(cl.quantity_remaining) DESC,
        w.id ASC`,
    [
      normalizedTenantId,
      normalizedLegalEntityId,
      normalizedItemCardId,
      normalizedBoundWarehouseId,
    ]
  );

  const candidates = [];
  let boundAvailableQuantity = 0;
  for (const row of result.rows || []) {
    const availableQuantity = roundAmount(row?.available_quantity || 0);
    const candidate = {
      warehouseId: parsePositiveInt(row?.warehouse_id),
      warehouseCode: row?.warehouse_code || null,
      warehouseName: row?.warehouse_name || null,
      ownershipScope: row?.ownership_scope || "CENTRAL",
      operatingUnitId: parsePositiveInt(row?.operating_unit_id),
      operatingUnitCode: row?.operating_unit_code || null,
      operatingUnitName: row?.operating_unit_name || null,
      availableQuantity,
    };
    if (candidate.warehouseId === normalizedBoundWarehouseId) {
      boundAvailableQuantity = availableQuantity;
      continue;
    }
    if (
      !sameOwnershipContext(
        deriveWarehouseOwnershipContext({
          ownership_scope: candidate.ownershipScope,
          operating_unit_id: candidate.operatingUnitId,
          operating_unit_code: candidate.operatingUnitCode,
          operating_unit_name: candidate.operatingUnitName,
        }),
        normalizedOwnershipContext
      )
    ) {
      candidates.push(candidate);
    }
  }

  const crossContextAvailableQuantity = roundAmount(
    candidates.reduce((sum, candidate) => sum + Number(candidate.availableQuantity || 0), 0)
  );
  const sortedCandidates = candidates.sort((left, right) => {
    const leftEnough =
      normalizedRequestedQuantity !== null && left.availableQuantity + 0.000001 >= normalizedRequestedQuantity
        ? 1
        : 0;
    const rightEnough =
      normalizedRequestedQuantity !== null && right.availableQuantity + 0.000001 >= normalizedRequestedQuantity
        ? 1
        : 0;
    if (leftEnough !== rightEnough) {
      return rightEnough - leftEnough;
    }
    if (right.availableQuantity !== left.availableQuantity) {
      return right.availableQuantity - left.availableQuantity;
    }
    return (left.warehouseId || 0) - (right.warehouseId || 0);
  });

  return {
    requestedQuantity: normalizedRequestedQuantity,
    boundAvailableQuantity,
    hasSufficientBoundStock:
      normalizedRequestedQuantity === null ||
      boundAvailableQuantity + 0.000001 >= normalizedRequestedQuantity,
    hasCrossContextAvailability: crossContextAvailableQuantity > 0.000001,
    crossContextAvailableQuantity,
    candidateWarehouseCount: sortedCandidates.length,
    primaryCandidate: sortedCandidates[0] || null,
    candidates: sortedCandidates,
  };
}

export function buildIssueValuationPlan({
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
    const err = badRequest(
      buildInsufficientAvailableStockInBoundWarehouseMessage({
        warehouseCode: warehouseRow?.code || null,
        warehouseName: warehouseRow?.name || null,
        warehouseId: parsePositiveInt(warehouseRow?.id),
        itemCardCode: itemCard?.code || null,
        itemCardName: itemCard?.name || null,
        itemCardId: parsePositiveInt(itemCard?.id),
        requestedQuantity,
        availableQuantity,
      })
    );
    err.code = "INSUFFICIENT_AVAILABLE_STOCK_IN_BOUND_WAREHOUSE";
    err.details = {
      reason: "INSUFFICIENT_AVAILABLE_STOCK_IN_BOUND_WAREHOUSE",
      warehouseId: parsePositiveInt(warehouseRow?.id),
      warehouseCode: warehouseRow?.code || null,
      warehouseName: warehouseRow?.name || null,
      itemCardId: parsePositiveInt(itemCard?.id),
      itemCardCode: itemCard?.code || null,
      itemCardName: itemCard?.name || null,
      requestedQuantity,
      availableQuantity,
    };
    throw err;
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

export function applyIssueValuationPlanToOpenLayerRows({
  openLayerRows,
  issueValuationPlan,
}) {
  const openRows = Array.isArray(openLayerRows) ? openLayerRows : [];
  const consumptions = Array.isArray(issueValuationPlan?.consumptions)
    ? issueValuationPlan.consumptions
    : [];
  const openRowsById = new Map(
    openRows
      .map((row) => [parsePositiveInt(row?.id), row])
      .filter(([id]) => id)
  );

  for (const consumption of consumptions) {
    const costLayerId = parsePositiveInt(consumption?.costLayerId);
    const openRow = openRowsById.get(costLayerId);
    if (!openRow) {
      continue;
    }
    const quantityRemainingAfter = roundAmount(consumption?.quantityRemainingAfter || 0);
    openRow.quantity_remaining = quantityRemainingAfter;
    openRow.layer_status = quantityRemainingAfter > BALANCE_EPSILON ? "OPEN" : "CLOSED";
  }

  return openRows;
}

export async function assertActiveWarehouseForOwnershipContext({
  tenantId,
  legalEntityId,
  ownershipContext,
  runQuery = query,
}) {
  const normalizedContext = buildOwnershipContext(ownershipContext);
  const params = [
    tenantId,
    legalEntityId,
    normalizedContext.ownershipScope,
  ];
  let whereSql = `
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND status = 'ACTIVE'
        AND ownership_scope = ?`;
  if (normalizedContext.ownershipScope === "OPERATING_UNIT") {
    whereSql += " AND operating_unit_id = ?";
    params.push(normalizedContext.operatingUnitId);
  } else {
    whereSql += " AND operating_unit_id IS NULL";
  }

  const result = await runQuery(
    `SELECT id
       FROM inventory_warehouses
      ${whereSql}
      LIMIT 1`,
    params
  );
  if (parsePositiveInt(result.rows?.[0]?.id)) {
    return true;
  }
  throw badRequest(
    buildNoActiveWarehouseForOwnershipContextMessage(normalizedContext)
  );
}

export async function listActiveWarehousesForOwnershipContext({
  tenantId,
  legalEntityId,
  ownershipContext,
  q = null,
  limit = 200,
  offset = 0,
  runQuery = query,
}) {
  const normalizedContext = buildOwnershipContext(ownershipContext);
  return listInventoryWarehouses({
    tenantId,
    filters: {
      legalEntityId,
      ownershipScope: normalizedContext.ownershipScope,
      operatingUnitId: normalizedContext.operatingUnitId,
      status: "ACTIVE",
      q: normalizeText(q, 120),
      limit,
      offset,
    },
    runQuery,
  });
}

export async function resolveWarehouseForOwnershipContext({
  tenantId,
  legalEntityId,
  warehouseId,
  ownershipContext = null,
  ownershipContextRow = null,
  ownerLabel = "document",
  warehouseFieldLabel = "warehouseId",
  requireActive = true,
  runQuery = query,
}) {
  const warehouseRow = await fetchWarehouseById({
    tenantId,
    legalEntityId,
    warehouseId,
    runQuery,
  });
  if (!warehouseRow) {
    throw badRequest(`${warehouseFieldLabel} must belong to legalEntityId`);
  }
  if (
    requireActive &&
    String(warehouseRow.status || "").toUpperCase() !== "ACTIVE"
  ) {
    throw badRequest(`${warehouseFieldLabel} must reference an ACTIVE warehouse`);
  }
  assertInventoryWarehouseBelongsToOwnershipContext({
    warehouseRow,
    ownershipContext,
    ownershipContextRow,
    ownerLabel,
  });
  return warehouseRow;
}

export async function resolveIssueValuationPlanForWarehouse({
  tenantId,
  legalEntityId,
  warehouseId,
  itemCard,
  quantity,
  warehouseRow = null,
  ownershipContext = null,
  runQuery = query,
}) {
  const resolvedWarehouseRow =
    warehouseRow ||
    (await fetchWarehouseById({
      tenantId,
      legalEntityId,
      warehouseId,
      runQuery,
    }));
  if (!resolvedWarehouseRow) {
    throw badRequest("warehouseId must belong to legalEntityId");
  }
  const baseCurrencyCode = await fetchLegalEntityBaseCurrencyCode({
    tenantId,
    legalEntityId,
    runQuery,
  });
  try {
    return buildIssueValuationPlan({
      openLayerRows: await fetchOpenCostLayersForIssue({
        tenantId,
        legalEntityId,
        warehouseId,
        itemCardId: parsePositiveInt(itemCard?.id),
        runQuery,
      }),
      quantity,
      itemCard,
      warehouseRow: resolvedWarehouseRow,
      baseCurrencyCode,
    });
  } catch (error) {
    if (
      String(error?.code || "").trim().toUpperCase() ===
        "INSUFFICIENT_AVAILABLE_STOCK_IN_BOUND_WAREHOUSE" &&
      ownershipContext
    ) {
      const availability = await probeCrossContextAvailabilityForIssue({
        tenantId,
        legalEntityId,
        ownershipContext,
        itemCardId: parsePositiveInt(itemCard?.id),
        boundWarehouseId: warehouseId,
        requestedQuantity: quantity,
        runQuery,
      });
      if (availability.hasCrossContextAvailability) {
        throw buildTransferRequiredAvailabilityError({
          warehouseRow: resolvedWarehouseRow,
          itemCard,
          requestedQuantity: quantity,
          boundAvailableQuantity: availability.boundAvailableQuantity,
          crossContextAvailableQuantity: availability.crossContextAvailableQuantity,
          ownershipContext,
          primaryCandidate: availability.primaryCandidate,
        });
      }
    }
    throw error;
  }
}

export async function assertStrictStockDocumentPostingReadiness({
  tenantId,
  legalEntityId,
  documentOperatingUnitId = null,
  documentLines,
  fieldCollectionLabel = "storedLines",
  ownerLabel = "document",
  runQuery = query,
}) {
  const stockLines = [];
  for (let index = 0; index < (Array.isArray(documentLines) ? documentLines : []).length; index += 1) {
    const line = documentLines[index] || {};
    if (!isStockAffectingLine(line)) {
      continue;
    }
    stockLines.push({
      index,
      fieldPrefix: `${fieldCollectionLabel}[${index + 1}]`,
      lineNo: Number(line?.lineNo || index + 1),
      stockImpactMode: String(line?.stockImpactMode || line?.stock_impact_mode || "")
        .trim()
        .toUpperCase(),
      itemCardId: parsePositiveInt(line?.itemCardId ?? line?.item_card_id),
      warehouseId: parsePositiveInt(line?.warehouseId ?? line?.warehouse_id),
      quantity: normalizeAmount(line?.quantity ?? 0, `${fieldCollectionLabel}[${index + 1}].quantity`, {
        allowZero: true,
      }),
    });
  }
  if (stockLines.length === 0) {
    return {
      ownershipContext: deriveOwnershipContextFromOperatingUnitId(documentOperatingUnitId),
      stockLineCount: 0,
      issueGroupCount: 0,
    };
  }

  const ownershipContext = deriveOwnershipContextFromOperatingUnitId(
    documentOperatingUnitId
  );
  await assertActiveWarehouseForOwnershipContext({
    tenantId,
    legalEntityId,
    ownershipContext,
    runQuery,
  });

  const warehouseCache = new Map();
  const itemCardCache = new Map();
  const issueGroups = new Map();

  for (const stockLine of stockLines) {
    if (!stockLine.warehouseId) {
      throw badRequest(
        `${stockLine.fieldPrefix}.warehouseId is required for stock-affecting lines`
      );
    }
    let warehouseRow = warehouseCache.get(stockLine.warehouseId);
    if (!warehouseRow) {
      warehouseRow = await resolveWarehouseForOwnershipContext({
        tenantId,
        legalEntityId,
        warehouseId: stockLine.warehouseId,
        ownershipContext,
        ownerLabel,
        warehouseFieldLabel: `${stockLine.fieldPrefix}.warehouseId`,
        runQuery,
      });
      warehouseCache.set(stockLine.warehouseId, warehouseRow);
    }

    if (stockLine.stockImpactMode !== "ISSUE_PENDING") {
      continue;
    }
    let itemCard = itemCardCache.get(stockLine.itemCardId);
    if (!itemCard) {
      itemCard = await getItemCardByIdForTenant({
        tenantId,
        itemCardId: stockLine.itemCardId,
        runQuery,
      });
      itemCardCache.set(stockLine.itemCardId, itemCard);
    }
    const groupKey = `${stockLine.warehouseId}:${stockLine.itemCardId}`;
    if (!issueGroups.has(groupKey)) {
      issueGroups.set(groupKey, {
        warehouseId: stockLine.warehouseId,
        warehouseRow,
        itemCardId: stockLine.itemCardId,
        itemCard,
        lines: [],
      });
    }
    issueGroups.get(groupKey).lines.push(stockLine);
  }

  if (issueGroups.size === 0) {
    return {
      ownershipContext,
      stockLineCount: stockLines.length,
      issueGroupCount: 0,
    };
  }

  const baseCurrencyCode = await fetchLegalEntityBaseCurrencyCode({
    tenantId,
    legalEntityId,
    runQuery,
  });
  const lineErrors = [];

  for (const group of issueGroups.values()) {
    const simulatedOpenLayers = (
      await fetchOpenCostLayersForIssue({
        tenantId,
        legalEntityId,
        warehouseId: group.warehouseId,
        itemCardId: group.itemCardId,
        runQuery,
      })
    ).map((row) => ({ ...row }));

    for (const stockLine of group.lines) {
      try {
        const issueValuationPlan = buildIssueValuationPlan({
          openLayerRows: simulatedOpenLayers,
          quantity: stockLine.quantity,
          itemCard: group.itemCard,
          warehouseRow: group.warehouseRow,
          baseCurrencyCode,
        });
        applyIssueValuationPlanToOpenLayerRows({
          openLayerRows: simulatedOpenLayers,
          issueValuationPlan,
        });
      } catch (error) {
        if (
          String(error?.code || "").trim().toUpperCase() ===
          "INSUFFICIENT_AVAILABLE_STOCK_IN_BOUND_WAREHOUSE"
        ) {
          const availability = await probeCrossContextAvailabilityForIssue({
            tenantId,
            legalEntityId,
            ownershipContext,
            itemCardId: group.itemCardId,
            boundWarehouseId: group.warehouseId,
            requestedQuantity: stockLine.quantity,
            runQuery,
          });
          const transferRequired = availability.hasCrossContextAvailability;
          const transferRequiredError = transferRequired
            ? buildTransferRequiredAvailabilityError({
                warehouseRow: group.warehouseRow,
                itemCard: group.itemCard,
                requestedQuantity: stockLine.quantity,
                boundAvailableQuantity: availability.boundAvailableQuantity,
                crossContextAvailableQuantity: availability.crossContextAvailableQuantity,
                ownershipContext,
                primaryCandidate: availability.primaryCandidate,
              })
            : null;
          lineErrors.push({
            lineNo: stockLine.lineNo,
            field: `${stockLine.fieldPrefix}.quantity`,
            stockImpactMode: stockLine.stockImpactMode,
            warehouseId: group.warehouseId,
            warehouseCode: group.warehouseRow?.code || null,
            warehouseName: group.warehouseRow?.name || null,
            itemCardId: group.itemCardId,
            itemCardCode: group.itemCard?.code || null,
            itemCardName: group.itemCard?.name || null,
            requestedQuantity: stockLine.quantity,
            availableQuantity: Number(error?.details?.availableQuantity || 0),
            boundAvailableQuantity: availability.boundAvailableQuantity,
            crossContextAvailableQuantity: availability.crossContextAvailableQuantity,
            transferSourceWarehouseId: parsePositiveInt(
              availability.primaryCandidate?.warehouseId
            ),
            transferSourceWarehouseCode: availability.primaryCandidate?.warehouseCode || null,
            transferSourceWarehouseName: availability.primaryCandidate?.warehouseName || null,
            transferSourceOwnershipScope:
              availability.primaryCandidate?.ownershipScope || null,
            transferSourceOperatingUnitId: parsePositiveInt(
              availability.primaryCandidate?.operatingUnitId
            ),
            transferSourceOperatingUnitCode:
              availability.primaryCandidate?.operatingUnitCode || null,
            transferSourceOperatingUnitName:
              availability.primaryCandidate?.operatingUnitName || null,
            transferSourceAvailableQuantity: roundAmount(
              availability.primaryCandidate?.availableQuantity || 0
            ),
            reason: transferRequired
              ? "TRANSFER_REQUIRED"
              : "INSUFFICIENT_AVAILABLE_STOCK_IN_BOUND_WAREHOUSE",
            message: `${stockLine.fieldPrefix}.quantity: ${
              transferRequiredError?.message || error.message
            }`,
          });
          break;
        }
        throw error;
      }
    }
  }

  if (lineErrors.length > 0) {
    const err = badRequest(lineErrors[0].message);
    err.code = "CARI_DOCUMENT_POST_STOCK_VALIDATION_FAILED";
    err.details = {
      reason:
        lineErrors.find((lineError) => lineError.reason === "TRANSFER_REQUIRED")
          ? "TRANSFER_REQUIRED"
          : "INSUFFICIENT_AVAILABLE_STOCK_IN_BOUND_WAREHOUSE",
      lineErrors,
    };
    throw err;
  }

  return {
    ownershipContext,
    stockLineCount: stockLines.length,
    issueGroupCount: issueGroups.size,
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

async function resolveReopenedSuccessorWarehouseBinding({
  tenantId,
  legalEntityId,
  originalStockLinkRow,
  runQuery = query,
}) {
  const originalWarehouseId = parsePositiveInt(
    originalStockLinkRow?.warehouse_id ?? originalStockLinkRow?.bound_warehouse_id
  );
  if (!originalWarehouseId) {
    return {
      warehouseId: null,
      warehouseRow: null,
      repairReasonCode:
        STOCK_LINK_REPAIR_REASON_SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID,
      auditNote:
        "Cleanup required: successor warehouse inheritance invalid because the original stock link has no bound warehouse.",
    };
  }

  try {
    const warehouseRow = await resolveWarehouseForOwnershipContext({
      tenantId,
      legalEntityId,
      warehouseId: originalWarehouseId,
      ownershipContextRow: originalStockLinkRow,
      ownerLabel: "source document",
      warehouseFieldLabel: "boundWarehouseId",
      runQuery,
    });
    return {
      warehouseId: originalWarehouseId,
      warehouseRow,
      repairReasonCode: null,
      auditNote: `Inherited bound warehouse ${warehouseRow.code || warehouseRow.name || `#${originalWarehouseId}`}.`,
    };
  } catch (error) {
    return {
      warehouseId: null,
      warehouseRow: null,
      repairReasonCode:
        STOCK_LINK_REPAIR_REASON_SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID,
      auditNote: [
        "Cleanup required: successor warehouse inheritance invalid.",
        normalizeText(error?.message, 160),
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 255),
    };
  }
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

  const inheritedWarehouseBinding = await resolveReopenedSuccessorWarehouseBinding({
    tenantId,
    legalEntityId,
    originalStockLinkRow,
    runQuery: tx.query,
  });

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
      inheritedWarehouseBinding.auditNote,
    ]
      .filter(Boolean)
      .join(" | ")
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
          warehouse_id,
          inventory_document_type,
          inventory_document_id,
          inventory_movement_id,
          reopened_from_stock_link_id,
          superseded_by_stock_link_id,
          resolved_at,
          resolution_note
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?)`,
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
        inheritedWarehouseBinding.warehouseId,
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
  } else if (
    String(successorRow.link_status || "").toUpperCase() === "PENDING" &&
    !parsePositiveInt(successorRow.inventory_movement_id)
  ) {
    const successorResolutionNote = [
      normalizeText(successorRow?.resolution_note, 180),
      inheritedWarehouseBinding.auditNote,
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 255);
    await tx.query(
      `UPDATE cari_document_line_stock_links
          SET warehouse_id = ?,
              resolution_note = ?
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id = ?`,
      [
        inheritedWarehouseBinding.warehouseId,
        successorResolutionNote,
        tenantId,
        legalEntityId,
        parsePositiveInt(successorRow.id),
      ]
    );
    successorRow = await fetchPendingStockLinkById({
      tenantId,
      legalEntityId,
      stockLinkId: parsePositiveInt(successorRow.id),
      runQuery: tx.query,
      forUpdate: true,
    });
  }

  const successorStockLinkId = parsePositiveInt(successorRow?.id);
  const originalResolutionNote = [
    normalizeText(originalStockLinkRow?.resolution_note, 255),
    `Successor stock link ${successorStockLinkId || "-"} created after issue reversal on ${reversalDate}`,
    inheritedWarehouseBinding.auditNote,
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

  let reversalMovementRow = await fetchReversalMovementByOriginalId({
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

async function ensureIssueUndoMovementTx({
  tx,
  tenantId,
  legalEntityId,
  originalMovementRow,
  reversalDate,
  reason,
}) {
  const originalMovementId = parsePositiveInt(originalMovementRow?.id);
  if (!originalMovementId) {
    return null;
  }

  let reversalMovementRow = await fetchReversalMovementByOriginalId({
    tenantId,
    originalMovementId,
    runQuery: tx.query,
    forUpdate: true,
  });

  if (!reversalMovementRow) {
    const quantity = normalizeAmount(originalMovementRow?.quantity, "issueQuantity");
    const unitCostTxn = normalizeAmount(originalMovementRow?.unit_cost_txn, "issueUnitCostTxn", {
      allowZero: true,
    });
    const unitCostBase = normalizeAmount(originalMovementRow?.unit_cost_base, "issueUnitCostBase", {
      allowZero: true,
    });
    const totalCostTxn = normalizeAmount(originalMovementRow?.total_cost_txn, "issueTotalCostTxn", {
      allowZero: true,
    });
    const totalCostBase = normalizeAmount(
      originalMovementRow?.total_cost_base,
      "issueTotalCostBase",
      { allowZero: true }
    );
    const reversalNote = [
      "Issue materialization return",
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
       ) VALUES (?, ?, ?, ?, 'ADJUSTMENT_IN', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)`,
      [
        tenantId,
        legalEntityId,
        parsePositiveInt(originalMovementRow?.warehouse_id),
        parsePositiveInt(originalMovementRow?.item_card_id),
        normalizeUpperText(originalMovementRow?.source_type, 40, { required: true }),
        normalizeText(originalMovementRow?.source_document_type, 60),
        parsePositiveInt(originalMovementRow?.source_document_id) || null,
        parsePositiveInt(originalMovementRow?.source_document_line_id) || null,
        originalMovementId,
        reversalDate,
        quantity,
        unitCostTxn,
        unitCostBase,
        totalCostTxn,
        totalCostBase,
        normalizeUpperText(originalMovementRow?.currency_code, 3, { required: true }),
        reversalNote,
      ]
    );
    const reversalMovementId = parsePositiveInt(insertResult.rows?.insertId);
    if (!reversalMovementId) {
      throw new Error("Issue undo movement create failed");
    }
    reversalMovementRow = await fetchInventoryMovementDbRowById({
      movementId: reversalMovementId,
      runQuery: tx.query,
      forUpdate: true,
    });
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
        COALESCE(d.document_no, it.transfer_no) AS source_document_no,
        it.transfer_no AS source_transfer_no,
        it.status AS source_transfer_status,
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
      LEFT JOIN inventory_transfers it
        ON m.source_document_type = 'INVENTORY_TRANSFER'
       AND it.tenant_id = m.tenant_id
       AND it.id = m.source_document_id
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

export async function resolveBookAndOpenPeriodForDate({
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

export async function resolveInventoryPostingAccount({
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

export async function insertPostedJournalWithLinesTx(tx, payload) {
  const totals = ensureBalancedJournalLines(payload.lines);
  await assertLocalClosePackPostingAllowedForLines({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    bookId: payload.bookId,
    fiscalPeriodId: payload.fiscalPeriodId,
    lines: payload.lines,
    actionType: "POST_INVENTORY_JOURNAL",
    runQuery: tx.query.bind(tx),
  });

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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        journalEntryId,
        index + 1,
        parsePositiveInt(line.accountId),
        parsePositiveInt(line.operatingUnitId) || null,
        parsePositiveInt(line.counterpartyLegalEntityId) || null,
        line.description || null,
        line.subledgerReferenceNo || null,
        line.currencyCode,
        Number(line.amountTxn || 0),
        Number(line.debitBase || 0),
        Number(line.creditBase || 0),
        line.taxCode || null,
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
  const ownershipScope = normalizeUpperText(filters?.ownershipScope, 30);
  if (ownershipScope) {
    whereSql += " AND w.ownership_scope = ?";
    params.push(ownershipScope);
  }
  const operatingUnitId = parsePositiveInt(filters?.operatingUnitId);
  if (operatingUnitId) {
    const operatingUnit = await assertOperatingUnitBelongsToTenant(
      tenantId,
      operatingUnitId,
      "operatingUnitId"
    );
    if (
      legalEntityId &&
      parsePositiveInt(operatingUnit?.legal_entity_id) !== legalEntityId
    ) {
      throw badRequest("operatingUnitId must belong to legalEntityId");
    }
    whereSql += " AND w.operating_unit_id = ?";
    params.push(operatingUnitId);
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
        le.code AS legal_entity_code,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
       FROM inventory_warehouses w
       JOIN legal_entities le
         ON le.tenant_id = w.tenant_id
        AND le.id = w.legal_entity_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = w.tenant_id
        AND ou.id = w.operating_unit_id
       ${whereSql}
      ORDER BY le.code ASC, w.ownership_scope ASC, w.code ASC, w.id ASC
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
  const { ownershipScope, operatingUnitId } = normalizeOwnershipContextInput({
    ownershipScope: payload?.ownershipScope,
    operatingUnitId: payload?.operatingUnitId,
  });
  if (operatingUnitId) {
    const operatingUnit = await assertOperatingUnitBelongsToTenant(
      tenantId,
      operatingUnitId,
      "operatingUnitId"
    );
    if (parsePositiveInt(operatingUnit?.legal_entity_id) !== legalEntityId) {
      throw badRequest("operatingUnitId must belong to legalEntityId");
    }
  }

  try {
    const insertResult = await runQuery(
      `INSERT INTO inventory_warehouses (
          tenant_id,
          legal_entity_id,
          ownership_scope,
          operating_unit_id,
          code,
          name,
          status,
          notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        ownershipScope,
        operatingUnitId || null,
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
  const queueScope =
    normalizeUpperText(filters?.queueScope) ||
    (filters?.linkStatus ? null : "ACTIONABLE");
  if (queueScope === "ACTIONABLE") {
    whereSql += " AND sl.link_status = 'PENDING'";
  } else if (queueScope === "COMPLETED") {
    whereSql += " AND sl.link_status = 'LINKED'";
  } else if (queueScope === "VOID") {
    whereSql += " AND sl.link_status = 'VOID'";
  }
  if (filters?.linkStatus) {
    whereSql += " AND sl.link_status = ?";
    params.push(filters.linkStatus);
  }
  if (filters?.stockImpactMode) {
    whereSql += " AND sl.stock_impact_mode = ?";
    params.push(filters.stockImpactMode);
  }
  const warehouseId = parsePositiveInt(filters?.warehouseId);
  if (warehouseId) {
    whereSql += " AND sl.warehouse_id = ?";
    params.push(warehouseId);
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
        d.operating_unit_id AS document_operating_unit_id,
        dou.code AS document_operating_unit_code,
        dou.name AS document_operating_unit_name,
        d.direction,
        d.currency_code,
        l.line_no,
        l.description AS line_description,
        sl.warehouse_id AS bound_warehouse_id,
        bw.id AS bound_warehouse_row_id,
        bw.code AS bound_warehouse_code,
        bw.name AS bound_warehouse_name,
        bw.status AS bound_warehouse_status,
        bw.ownership_scope AS bound_warehouse_ownership_scope,
        bw.operating_unit_id AS bound_warehouse_operating_unit_id,
        CASE
          WHEN sl.link_status = 'LINKED' THEN sl.requested_quantity
          ELSE 0.000000
        END AS materialized_quantity,
        CASE
          WHEN sl.link_status = 'PENDING' THEN sl.requested_quantity
          ELSE 0.000000
        END AS remaining_quantity,
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
      LEFT JOIN operating_units dou
        ON dou.tenant_id = d.tenant_id
       AND dou.id = d.operating_unit_id
       JOIN cari_document_lines l
         ON l.tenant_id = sl.tenant_id
        AND l.legal_entity_id = sl.legal_entity_id
        AND l.cari_document_id = sl.cari_document_id
        AND l.id = sl.cari_document_line_id
       JOIN item_cards ic
         ON ic.tenant_id = sl.tenant_id
        AND ic.id = sl.item_card_id
      LEFT JOIN inventory_warehouses bw
        ON bw.tenant_id = sl.tenant_id
       AND bw.id = sl.warehouse_id
       ${whereSql}
      ORDER BY
        CASE sl.link_status
          WHEN 'PENDING' THEN 0
          WHEN 'LINKED' THEN 1
          WHEN 'VOID' THEN 2
          ELSE 3
        END ASC,
        d.document_date DESC,
        d.document_no DESC,
        l.line_no ASC
      LIMIT ${limit}
      OFFSET ${offset}`,
    params
  );
  const stockLinkRows = await attachCrossContextTransferAvailabilityToStockLinkRows({
    stockLinkRows: result.rows || [],
    runQuery,
  });
  return {
    rows: stockLinkRows.map(mapPendingStockLinkRow),
  };
}

export async function getInventoryWorkQueueSummary({
  tenantId,
  filters = {},
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(filters?.legalEntityId);

  const stockParams = [normalizedTenantId];
  let stockWhereSql = "WHERE sl.tenant_id = ?";
  if (legalEntityId) {
    stockWhereSql += " AND sl.legal_entity_id = ?";
    stockParams.push(legalEntityId);
  }

  const stockSummary = await runQuery(
    `SELECT
        sl.tenant_id,
        sl.legal_entity_id,
        sl.link_status,
        sl.stock_impact_mode,
        sl.item_card_id,
        sl.requested_quantity,
        sl.warehouse_id AS bound_warehouse_id,
        sl.reopened_from_stock_link_id,
        d.document_date,
        d.operating_unit_id AS document_operating_unit_id,
        bw.status AS bound_warehouse_status,
        bw.ownership_scope AS bound_warehouse_ownership_scope,
        bw.operating_unit_id AS bound_warehouse_operating_unit_id
       FROM cari_document_line_stock_links sl
       JOIN cari_documents d
         ON d.tenant_id = sl.tenant_id
        AND d.legal_entity_id = sl.legal_entity_id
        AND d.id = sl.cari_document_id
      LEFT JOIN inventory_warehouses bw
        ON bw.tenant_id = sl.tenant_id
       AND bw.id = sl.warehouse_id
       ${stockWhereSql}`,
    stockParams
  );

  const transferParams = [normalizedTenantId];
  let transferWhereSql =
    "WHERE t.tenant_id = ? AND t.status IN ('INITIATED', 'APPROVED', 'IN_TRANSIT')";
  if (legalEntityId) {
    transferWhereSql += " AND t.legal_entity_id = ?";
    transferParams.push(legalEntityId);
  }

  const transferSummary = await runQuery(
    `SELECT
        COUNT(*) AS total_open,
        SUM(CASE WHEN t.status = 'INITIATED' THEN 1 ELSE 0 END) AS initiated,
        SUM(CASE WHEN t.status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN t.status = 'IN_TRANSIT' THEN 1 ELSE 0 END) AS in_transit,
        SUM(
          CASE
            WHEN t.status = 'IN_TRANSIT'
             AND COALESCE(t.source_operating_unit_id, 0) <> COALESCE(t.target_operating_unit_id, 0)
            THEN 1
            ELSE 0
          END
        ) AS cross_context_in_transit,
        SUM(CASE WHEN t.status = 'INITIATED' AND DATEDIFF(CURDATE(), t.transfer_date) > 1 THEN 1 ELSE 0 END) AS stale_initiated_gt_1d,
        SUM(CASE WHEN t.status = 'APPROVED' AND DATEDIFF(CURDATE(), t.transfer_date) > 1 THEN 1 ELSE 0 END) AS stale_approved_gt_1d,
        SUM(
          CASE
            WHEN t.status = 'IN_TRANSIT'
             AND DATEDIFF(CURDATE(), COALESCE(DATE(t.in_transit_at), t.transfer_date)) > 2
            THEN 1
            ELSE 0
          END
        ) AS stale_in_transit_gt_2d,
        MAX(
          CASE
            WHEN t.status = 'IN_TRANSIT'
            THEN DATEDIFF(CURDATE(), COALESCE(DATE(t.in_transit_at), t.transfer_date))
            ELSE NULL
          END
        ) AS oldest_in_transit_days
       FROM inventory_transfers t
       ${transferWhereSql}`,
    transferParams
  );

  const asOfDate = new Date();
  const asOfDateString = asOfDate.toISOString().slice(0, 10);
  const stockRows = await attachCrossContextTransferAvailabilityToStockLinkRows({
    stockLinkRows: Array.isArray(stockSummary.rows) ? stockSummary.rows : [],
    runQuery,
  });
  const stockLinkSummary = {
    total_pending: 0,
    actionable_total: 0,
    ready_total: 0,
    blocked_total: 0,
    repair_required_total: 0,
    transfer_required_total: 0,
    completed_total: 0,
    void_total: 0,
    ready_receipt_materialization: 0,
    ready_issue_materialization: 0,
    reopened_pending: 0,
    stale_pending_gt_2d: 0,
    oldest_pending_days: 0,
    aging_pending: {
      "0_1d": 0,
      "2_7d": 0,
      "8_plus_d": 0,
    },
  };

  for (const row of stockRows) {
    const readState = deriveStockLinkReadState(row);
    const linkStatus = normalizeUpperText(row?.link_status);
    const stockImpactMode = normalizeUpperText(row?.stock_impact_mode);
    if (linkStatus === "PENDING") {
      stockLinkSummary.total_pending += 1;
      stockLinkSummary.actionable_total += 1;
      if (parsePositiveInt(row?.reopened_from_stock_link_id)) {
        stockLinkSummary.reopened_pending += 1;
      }
      const ageInDays = calculateDateAgeInDays(row?.document_date, asOfDate);
      if (ageInDays !== null) {
        if (ageInDays <= 1) {
          stockLinkSummary.aging_pending["0_1d"] += 1;
        } else if (ageInDays <= 7) {
          stockLinkSummary.aging_pending["2_7d"] += 1;
        } else {
          stockLinkSummary.aging_pending["8_plus_d"] += 1;
        }
        if (ageInDays > 2) {
          stockLinkSummary.stale_pending_gt_2d += 1;
        }
        if (ageInDays > stockLinkSummary.oldest_pending_days) {
          stockLinkSummary.oldest_pending_days = ageInDays;
        }
      }
    }
    switch (readState.queueState) {
      case "READY":
        stockLinkSummary.ready_total += 1;
        if (stockImpactMode === "RECEIPT_PENDING") {
          stockLinkSummary.ready_receipt_materialization += 1;
        }
        if (stockImpactMode === "ISSUE_PENDING") {
          stockLinkSummary.ready_issue_materialization += 1;
        }
        break;
      case "BLOCKED":
        stockLinkSummary.blocked_total += 1;
        break;
      case "REPAIR_REQUIRED":
        stockLinkSummary.repair_required_total += 1;
        break;
      case "TRANSFER_REQUIRED":
        stockLinkSummary.transfer_required_total += 1;
        break;
      case "COMPLETED":
        stockLinkSummary.completed_total += 1;
        break;
      case "VOID":
        stockLinkSummary.void_total += 1;
        break;
      default:
        break;
    }
  }

  const transferRow = transferSummary.rows?.[0] || {};

  return {
    asOfDate: asOfDateString,
    filters: {
      legalEntityId: legalEntityId || null,
    },
    stockLinks: {
      ...stockLinkSummary,
      pending_receipt_materialization: stockLinkSummary.ready_receipt_materialization,
      pending_issue_materialization: stockLinkSummary.ready_issue_materialization,
    },
    transfers: {
      total_open: toInt(transferRow.total_open, 0),
      waiting_approval: toInt(transferRow.initiated, 0),
      ready_to_ship: toInt(transferRow.approved, 0),
      in_transit_waiting_receipt: toInt(transferRow.in_transit, 0),
      cross_context_in_transit: toInt(transferRow.cross_context_in_transit, 0),
      stale_waiting_approval_gt_1d: toInt(transferRow.stale_initiated_gt_1d, 0),
      stale_ready_to_ship_gt_1d: toInt(transferRow.stale_approved_gt_1d, 0),
      stale_in_transit_gt_2d: toInt(transferRow.stale_in_transit_gt_2d, 0),
      oldest_in_transit_days: toInt(transferRow.oldest_in_transit_days, 0),
    },
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
        COALESCE(d.document_no, it.transfer_no) AS source_document_no,
        it.transfer_no AS source_transfer_no,
        it.status AS source_transfer_status,
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
       LEFT JOIN inventory_transfers it
         ON m.source_document_type = 'INVENTORY_TRANSFER'
        AND it.tenant_id = m.tenant_id
        AND it.id = m.source_document_id
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

function strictStockLinkRouteRequiredError(stockLinkId) {
  const err = badRequest(
    `sourceStockLinkId ${stockLinkId} is strict-mode and must be materialized through /api/v1/inventory/cari-stock-links/${stockLinkId}/materialize.`
  );
  err.code = "STRICT_STOCK_LINK_MATERIALIZE_ROUTE_REQUIRED";
  return err;
}

function stockLinkCleanupRequiredError(stockLinkId) {
  const err = badRequest(
    `stockLinkId ${stockLinkId} has no bound warehouse and is invalid for this rollout. Reset or clean up unbound legacy data before continuing strict-mode execution.`
  );
  err.code = "STOCK_LINK_CLEANUP_REQUIRED";
  return err;
}

async function materializeInventoryMovementFromStockLinkInternal({
  payload,
  materializationMode,
}) {
  const isStrictMode = materializationMode === "STRICT";
  const tenantId = parsePositiveInt(payload?.tenantId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  const explicitWarehouseId = parsePositiveInt(payload?.warehouseId);
  const stockLinkId = parsePositiveInt(
    isStrictMode ? payload?.stockLinkId : payload?.sourceStockLinkId
  );
  if (isStrictMode) {
    if (!tenantId || !legalEntityId || !stockLinkId) {
      throw badRequest("tenantId, legalEntityId, and stockLinkId are required");
    }
  } else if (!tenantId || !legalEntityId || !explicitWarehouseId || !stockLinkId) {
    throw badRequest("tenantId, legalEntityId, warehouseId, and sourceStockLinkId are required");
  }
  const movementDate = normalizeDateOnly(payload?.movementDate, "movementDate");
  const note = normalizeText(payload?.note, 255);

  return withTransaction(async (tx) => {
    await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId", {
      runQuery: tx.query,
    });
    const stockLinkRow = await fetchPendingStockLinkById({
      tenantId,
      legalEntityId,
      stockLinkId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!stockLinkRow) {
      throw badRequest(
        `${isStrictMode ? "stockLinkId" : "sourceStockLinkId"} not found for legalEntityId`
      );
    }

    const boundWarehouseId = parsePositiveInt(stockLinkRow.warehouse_id);
    if (isStrictMode && !boundWarehouseId) {
      throw stockLinkCleanupRequiredError(stockLinkId);
    }
    if (!isStrictMode && boundWarehouseId) {
      throw strictStockLinkRouteRequiredError(stockLinkId);
    }

    const warehouseId = isStrictMode ? boundWarehouseId : explicitWarehouseId;
    const warehouseFieldLabel = isStrictMode ? "boundWarehouseId" : "warehouseId";
    const warehouseRow = await resolveWarehouseForOwnershipContext({
      tenantId,
      legalEntityId,
      warehouseId,
      ownershipContextRow: stockLinkRow,
      ownerLabel: "source document",
      warehouseFieldLabel,
      runQuery: tx.query,
    });
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
        throw badRequest(
          `${isStrictMode ? "stockLinkId" : "sourceStockLinkId"} references a missing inventory movement`
        );
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
        runQuery: async (sql, params = []) => tx.query(sql, [...params]),
      });
    }
    if (stockLinkStatus !== "PENDING") {
      throw badRequest(`${isStrictMode ? "stockLinkId" : "sourceStockLinkId"} must be PENDING`);
    }

    const itemCard = await getItemCardByIdForTenant({
      tenantId,
      itemCardId: stockLinkRow.item_card_id,
      runQuery: tx.query,
    });
    if (String(itemCard?.itemType || "").toUpperCase() !== "STOCK_ITEM") {
      throw badRequest(
        `${isStrictMode ? "stockLinkId" : "sourceStockLinkId"} must reference a STOCK_ITEM`
      );
    }

    const quantity = normalizeAmount(stockLinkRow.requested_quantity, "requestedQuantity");
    const postedNetAmountTxn = normalizeAmount(
      stockLinkRow.posted_net_amount_txn,
      "postedNetAmountTxn",
      {
        allowZero: true,
      }
    );
    const postedNetAmountBase = normalizeAmount(
      stockLinkRow.posted_net_amount_base,
      "postedNetAmountBase",
      {
        allowZero: true,
      }
    );
    const sourceLineNetAmountTxn = normalizeAmount(
      stockLinkRow.source_line_net_amount_txn ?? stockLinkRow.sourceLineNetAmountTxn ?? 0,
      "sourceLineNetAmountTxn",
      {
        allowZero: true,
      }
    );
    const sourceLineNetAmountBase = normalizeAmount(
      stockLinkRow.source_line_net_amount_base ?? stockLinkRow.sourceLineNetAmountBase ?? 0,
      "sourceLineNetAmountBase",
      {
        allowZero: true,
      }
    );
    const stockLinkCurrencyCode = normalizeText(stockLinkRow.currency_code, 3, {
      required: true,
    }).toUpperCase();

    const stockImpactMode = String(stockLinkRow.stock_impact_mode || "").trim().toUpperCase();
    if (!["RECEIPT_PENDING", "ISSUE_PENDING"].includes(stockImpactMode)) {
      throw badRequest(
        `${isStrictMode ? "stockLinkId" : "sourceStockLinkId"} must reference a pending stock-impact mode`
      );
    }
    const movementType = stockImpactMode === "RECEIPT_PENDING" ? "RECEIPT" : "ISSUE";
    let currencyCode = stockLinkCurrencyCode;
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
      const ownershipContext = deriveDocumentOwnershipContext(stockLinkRow);
      issueValuationPlan = await resolveIssueValuationPlanForWarehouse({
        tenantId,
        legalEntityId,
        warehouseId,
        itemCard,
        quantity,
        warehouseRow,
        ownershipContext,
        runQuery: tx.query,
      });
      const landedCostOverlayPlan = await buildLandedCostIssueOverlayPlanTx({
        tx,
        tenantId,
        legalEntityId,
        issueValuationPlan,
      });
      issueValuationPlan = mergeIssueValuationPlanWithLandedCostOverlay({
        issueValuationPlan,
        overlayPlan: landedCostOverlayPlan,
        quantity,
        baseCurrencyCode: await fetchLegalEntityBaseCurrencyCode({
          tenantId,
          legalEntityId,
          runQuery: tx.query,
        }),
      });
      currencyCode = issueValuationPlan.currencyCode;
      totalCostTxn = issueValuationPlan.totalCostTxn;
      totalCostBase = issueValuationPlan.totalCostBase;
      unitCostTxn = issueValuationPlan.unitCostTxn;
      unitCostBase = issueValuationPlan.unitCostBase;
    }
    const includesAllocatedCharges =
      movementType === "RECEIPT"
      && (
        !amountsAreEqual(postedNetAmountTxn, sourceLineNetAmountTxn)
        || !amountsAreEqual(postedNetAmountBase, sourceLineNetAmountBase)
      );
    const movementNote = normalizeText(
      [note, includesAllocatedCharges ? "Includes allocated charges from CARI line charges" : null]
        .filter(Boolean)
        .join(" | "),
      255
    );

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
        "VALUED",
        movementNote,
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
      await applyLandedCostIssueOverlayPlanTx({
        tx,
        tenantId,
        legalEntityId,
        consumingInventoryMovementId: movementId,
        overlayPlan: issueValuationPlan?.landedCostOverlay,
      });
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
      runQuery: async (sql, params = []) => tx.query(sql, [...params]),
    });
  });
}

export async function materializeInventoryMovementFromCariStockLink({
  payload,
}) {
  return materializeInventoryMovementFromStockLinkInternal({
    payload,
    materializationMode: "STRICT",
  });
}

export async function createInventoryMovementFromStockLink({
  payload,
}) {
  return materializeInventoryMovementFromStockLinkInternal({
    payload,
    materializationMode: "LEGACY_REPAIR",
  });
}

export async function reverseInventoryMovementTx(
  tx,
  {
    tenantId,
    userId,
    movementId,
    reversalDate = todayDateOnly(),
    reason = "Manual inventory movement reversal",
  } = {}
) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedUserId = parsePositiveInt(userId);
  const normalizedMovementId = parsePositiveInt(movementId);
  if (!tx || typeof tx.query !== "function") {
    throw badRequest("Transaction handle is required");
  }
  if (!normalizedTenantId || !normalizedUserId || !normalizedMovementId) {
    throw badRequest("tenantId, userId, and movementId are required");
  }

  const normalizedReversalDate = normalizeDateOnly(reversalDate, "reversalDate");
  const normalizedReason =
    normalizeText(reason, 255) || "Manual inventory movement reversal";

  const movementRow = await fetchInventoryMovementDbRowById({
    movementId: normalizedMovementId,
    runQuery: tx.query,
    forUpdate: true,
  });
  if (!movementRow || parsePositiveInt(movementRow.tenant_id) !== normalizedTenantId) {
    throw badRequest("movementId not found for tenant");
  }

  const legalEntityId = parsePositiveInt(movementRow.legal_entity_id);
  await assertLegalEntityBelongsToTenant(normalizedTenantId, legalEntityId, "legalEntityId", {
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
        tenantId: normalizedTenantId,
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
        tenantId: normalizedTenantId,
        legalEntityId,
        originalStockLinkRow: stockLinkRow,
        movementRow,
        reversalDate: normalizedReversalDate,
      });
      const reversalMovementRow = await ensureIssueUndoMovementTx({
        tx,
        tenantId: normalizedTenantId,
        legalEntityId,
        originalMovementRow: movementRow,
        reversalDate: normalizedReversalDate,
        reason: normalizedReason,
      });
      await restoreLandedCostConsumptionForMovementReversalTx({
        tx,
        tenantId: normalizedTenantId,
        legalEntityId,
        consumingInventoryMovementId: normalizedMovementId,
        restoredByInventoryMovementId: parsePositiveInt(reversalMovementRow?.id),
      });
    } else if (movementType === "ISSUE") {
      const reversalMovementRow = await ensureIssueUndoMovementTx({
        tx,
        tenantId: normalizedTenantId,
        legalEntityId,
        originalMovementRow: movementRow,
        reversalDate: normalizedReversalDate,
        reason: normalizedReason,
      });
      await restoreLandedCostConsumptionForMovementReversalTx({
        tx,
        tenantId: normalizedTenantId,
        legalEntityId,
        consumingInventoryMovementId: normalizedMovementId,
        restoredByInventoryMovementId: parsePositiveInt(reversalMovementRow?.id),
      });
    } else if (movementType === "RECEIPT") {
      const receiptCostLayerRow = await fetchReceiptCostLayerBySourceMovementId({
        tenantId: normalizedTenantId,
        movementId: normalizedMovementId,
        runQuery: tx.query,
        forUpdate: true,
      });
      if (receiptCostLayerRow) {
        await ensureReceiptUndoMovementTx({
          tx,
          tenantId: normalizedTenantId,
          legalEntityId,
          originalMovementRow: movementRow,
          receiptCostLayerRow,
          stockLinkRow,
          reversalDate: normalizedReversalDate,
          reason: normalizedReason,
        });
        await unwindTransferReceiptLandedCostCarryForwardTx({
          tx,
          tenantId: normalizedTenantId,
          legalEntityId,
          receiptMovementId: normalizedMovementId,
        });
      }
    }
    return fetchMovementById({
      movementId: normalizedMovementId,
      runQuery: async (sql, params = []) => tx.query(sql, [...params]),
    });
  }

  if (movementType === "RECEIPT") {
    const receiptCostLayerRow = await fetchReceiptCostLayerBySourceMovementId({
      tenantId: normalizedTenantId,
      movementId: normalizedMovementId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!receiptCostLayerRow) {
      throw badRequest("Receipt movement has no cost layer to reverse");
    }

    const quantityIn = normalizeAmount(receiptCostLayerRow.quantity_in, "quantityIn");
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
      tenantId: normalizedTenantId,
      legalEntityId,
      originalMovementRow: movementRow,
      receiptCostLayerRow,
      stockLinkRow,
      reversalDate: normalizedReversalDate,
      reason: normalizedReason,
    });
    await unwindTransferReceiptLandedCostCarryForwardTx({
      tx,
      tenantId: normalizedTenantId,
      legalEntityId,
      receiptMovementId: normalizedMovementId,
    });

    await tx.query(
      `UPDATE inventory_cost_layers
          SET quantity_remaining = 0,
              layer_status = 'CLOSED'
        WHERE tenant_id = ?
          AND id = ?`,
      [normalizedTenantId, parsePositiveInt(receiptCostLayerRow.id)]
    );

    await tx.query(
      `UPDATE inventory_movements
          SET reversed_at = COALESCE(reversed_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      [normalizedMovementId]
    );

    return fetchMovementById({
      movementId: normalizedMovementId,
      runQuery: async (sql, params = []) => tx.query(sql, [...params]),
    });
  }

  await assertNoLaterValuedIssueExistsForReverse({
    tenantId: normalizedTenantId,
    movementRow,
    runQuery: tx.query,
  });

  const consumptions = await fetchIssueLayerConsumptionsForUpdate({
    issueMovementId: normalizedMovementId,
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
      tenantId: normalizedTenantId,
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
        tenantId: normalizedTenantId,
        legalEntityId,
        targetDate: normalizedReversalDate,
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
          : `Reversal of inventory movement ${normalizedMovementId}`,
        subledgerReferenceNo: `INVENTORY_MOVEMENT_REVERSE:${normalizedMovementId}`.slice(
          0,
          100
        ),
        currencyCode: normalizeUpperText(line.currency_code || movementRow.currency_code, 3, {
          required: true,
        }),
      }));

      const reversalJournalResult = await insertPostedJournalWithLinesTx(tx, {
        tenantId: normalizedTenantId,
        legalEntityId,
        bookId: reversalJournalContext.bookId,
        fiscalPeriodId: reversalJournalContext.fiscalPeriodId,
        userId: normalizedUserId,
        journalNo: buildInventoryJournalNo("INV-REV", normalizedMovementId),
        entryDate: normalizedReversalDate,
        documentDate: normalizedReversalDate,
        currencyCode: normalizeUpperText(originalJournal.currency_code || movementRow.currency_code, 3, {
          required: true,
        }),
        description: `Reversal of inventory movement ${normalizedMovementId}`.slice(0, 500),
        referenceNo: `INV-REV:${normalizedMovementId}`.slice(0, 100),
        lines: reversalLines,
      });
      reversalJournalEntryId = reversalJournalResult.journalEntryId;

      await upsertJournalSourceLinkTx(tx, {
        tenantId: normalizedTenantId,
        legalEntityId,
        journalEntryId: reversalJournalEntryId,
        sourceRefType: "INVENTORY_MOVEMENT",
        sourceRefId: normalizedMovementId,
        linkRole: "PRIMARY",
      });
      if (sourceStockLinkId) {
        await upsertJournalSourceLinkTx(tx, {
          tenantId: normalizedTenantId,
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
        [
          normalizedUserId,
          reversalJournalEntryId,
          normalizedReason,
          normalizedTenantId,
          originalJournalEntryId,
        ]
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
    [reversalJournalEntryId, normalizedMovementId]
  );

  const reversalMovementRow = await ensureIssueUndoMovementTx({
    tx,
    tenantId: normalizedTenantId,
    legalEntityId,
    originalMovementRow: movementRow,
    reversalDate: normalizedReversalDate,
    reason: normalizedReason,
  });
  await restoreLandedCostConsumptionForMovementReversalTx({
    tx,
    tenantId: normalizedTenantId,
    legalEntityId,
    consumingInventoryMovementId: normalizedMovementId,
    restoredByInventoryMovementId: parsePositiveInt(reversalMovementRow?.id),
  });

  if (stockLinkRow) {
    await ensureIssueReopenedStockLinkTx({
      tx,
      tenantId: normalizedTenantId,
      legalEntityId,
      originalStockLinkRow: stockLinkRow,
      movementRow,
      reversalDate: normalizedReversalDate,
    });
  }

  return fetchMovementById({
    movementId: normalizedMovementId,
    runQuery: async (sql, params = []) => tx.query(sql, [...params]),
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

  return withTransaction((tx) =>
    reverseInventoryMovementTx(tx, {
      tenantId,
      userId,
      movementId,
      reversalDate,
      reason,
    })
  );
}
