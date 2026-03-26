import { query, withTransaction } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import {
  assertLegalEntityBelongsToTenant,
  assertOperatingUnitBelongsToTenant,
} from "../tenantGuards.js";
import { getItemCardByIdForTenant } from "./item.card.service.js";
import {
  fetchLegalEntityBaseCurrencyCode,
  insertPostedJournalWithLinesTx,
  resolveBookAndOpenPeriodForDate,
  resolveInventoryPostingAccount,
} from "./inventory.service.js";
import { reverseJournalEntryTx } from "./gl.journal-reversal.service.js";
import {
  listJournalSourceLinksByJournalIds,
  upsertJournalSourceLinkTx,
} from "./journal.source-link.service.js";
import {
  buildOwnershipContext,
  sameOwnershipContext,
} from "./ownership.context.policy.service.js";
import { STOCK_LANDED_COST_VOUCHER } from "../utils/source-ref-types.js";
import { listVoucherReversalDependenciesTx } from "./inventory.landed-cost.runtime.service.js";
import {
  enrichSourceLinksWithDestinationsAsync,
  resolveReverseBlockAsync,
} from "./gl.reverse-block-destination.service.js";

const AMOUNT_SCALE = 6;
const BALANCE_EPSILON = 0.000001;
const ACTIVE_SOURCE_VOUCHER_STATUSES = ["DRAFT", "POSTED"];
const ACTIVE_REVERSAL_BLOCK_STATUSES = ["DRAFT", "POSTED", "REVERSED"];
const PREVIEW_ALLOCATION_METHODS = new Set(["EQUAL", "BY_AMOUNT", "BY_QTY", "MANUAL"]);
function conflict(message, details = null) {
  const error = new Error(message);
  error.status = 409;
  if (details !== null && details !== undefined) {
    error.details = details;
  }
  return error;
}
function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}
function roundAmount(value) {
  return Number(Number(value || 0).toFixed(AMOUNT_SCALE));
}
function normalizeAmount(value, label, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${label} must be numeric`);
  }
  if (allowZero ? parsed < 0 : parsed <= 0) {
    throw badRequest(allowZero ? `${label} must be >= 0` : `${label} must be > 0`);
  }
  return roundAmount(parsed);
}
function amountsAreEqual(left, right, epsilon = BALANCE_EPSILON) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}
function makeInClause(values) {
  return values.map(() => "?").join(", ");
}
function uniquePositiveIds(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => parsePositiveInt(value))
        .filter(Boolean)
    )
  );
}
function buildContextLabel(context) {
  const normalized = buildOwnershipContext(context);
  if (normalized.ownershipScope !== "OPERATING_UNIT") {
    return "CENTRAL";
  }
  return `OPERATING_UNIT:${normalized.operatingUnitId || "?"}`;
}
function allocateResidualAmountSplit(totalAmount, partCount) {
  if (!Number.isInteger(partCount) || partCount <= 0) {
    throw badRequest("Allocation requires at least one part");
  }
  const normalizedTotal = roundAmount(totalAmount);
  if (partCount === 1) {
    return [normalizedTotal];
  }
  const scaledTotal = Math.round(normalizedTotal * 1_000_000);
  const baseShare = Math.floor(scaledTotal / partCount);
  const allocations = [];
  let allocatedScaled = 0;
  for (let index = 0; index < partCount; index += 1) {
    if (index === partCount - 1) {
      allocations.push((scaledTotal - allocatedScaled) / 1_000_000);
    } else {
      allocations.push(baseShare / 1_000_000);
      allocatedScaled += baseShare;
    }
  }
  return allocations.map((value) => roundAmount(value));
}
function allocateResidualProportionalSplit(totalAmount, weights, label) {
  const normalizedWeights = (Array.isArray(weights) ? weights : []).map((value) =>
    Number(value || 0)
  );
  if (normalizedWeights.length === 0) {
    throw badRequest("Allocation requires at least one target");
  }
  if (normalizedWeights.length === 1) {
    return [roundAmount(totalAmount)];
  }
  const totalWeight = normalizedWeights.reduce((sum, value) => sum + value, 0);
  if (!(totalWeight > 0)) {
    throw badRequest(`${label} must be greater than 0`);
  }
  const scaledTotal = Math.round(roundAmount(totalAmount) * 1_000_000);
  let allocatedScaled = 0;
  const allocations = [];
  for (let index = 0; index < normalizedWeights.length; index += 1) {
    if (index === normalizedWeights.length - 1) {
      allocations.push((scaledTotal - allocatedScaled) / 1_000_000);
    } else {
      const scaledShare = Math.floor((scaledTotal * normalizedWeights[index]) / totalWeight);
      allocations.push(scaledShare / 1_000_000);
      allocatedScaled += scaledShare;
    }
  }
  return allocations.map((value) => roundAmount(value));
}
function assertUniqueEntries(rows, keyField, label) {
  const seen = new Set();
  for (const row of rows || []) {
    const value = parsePositiveInt(row?.[keyField]);
    if (!value) {
      continue;
    }
    if (seen.has(value)) {
      throw badRequest(`${label} contains duplicate ${keyField}`);
    }
    seen.add(value);
  }
}
function mapSourceLineRow(row) {
  if (!row) {
    return null;
  }
  return {
    sourceCariDocumentId: parsePositiveInt(row.source_cari_document_id),
    sourceCariDocumentLineId: parsePositiveInt(row.source_cari_document_line_id),
    documentNo: row.document_no || null,
    documentDate: row.document_date || null,
    documentOperatingUnitId: parsePositiveInt(row.document_operating_unit_id),
    currencyCode: row.currency_code || null,
    lineNo: Number(row.line_no || 0),
    lineDescription: row.line_description || null,
    postingAccountId: parsePositiveInt(row.posting_account_id),
    lineNetAmountTxn: roundAmount(row.line_net_amount_txn || 0),
    lineNetAmountBase: roundAmount(row.line_net_amount_base || 0),
    alreadyAppliedAmountTxn: roundAmount(row.already_applied_amount_txn || 0),
    alreadyAppliedAmountBase: roundAmount(row.already_applied_amount_base || 0),
  };
}
function mapTargetStockLinkRow(row) {
  if (!row) {
    return null;
  }
  return {
    sourceStockLinkId: parsePositiveInt(row.source_stock_link_id),
    sourceCariDocumentId: parsePositiveInt(row.source_cari_document_id),
    sourceCariDocumentLineId: parsePositiveInt(row.source_cari_document_line_id),
    sourceAnchorInventoryMovementId: parsePositiveInt(row.source_anchor_inventory_movement_id),
    documentNo: row.document_no || null,
    documentDate: row.document_date || null,
    lineNo: Number(row.line_no || 0),
    lineDescription: row.line_description || null,
    itemCardId: parsePositiveInt(row.item_card_id),
    itemCardCode: row.item_card_code || null,
    itemCardName: row.item_card_name || null,
    postedNetAmountTxn: roundAmount(row.posted_net_amount_txn || 0),
    postedNetAmountBase: roundAmount(row.posted_net_amount_base || 0),
    requestedQuantity: roundAmount(row.requested_quantity || 0),
    anchorMovementQuantity: roundAmount(row.anchor_movement_quantity || 0),
  };
}
function mapReceiptLayerRow(row) {
  if (!row) {
    return null;
  }
  return {
    resolvedInventoryMovementId: parsePositiveInt(row.resolved_inventory_movement_id),
    resolvedCostLayerId: parsePositiveInt(row.resolved_cost_layer_id),
    warehouseId: parsePositiveInt(row.warehouse_id),
    warehouseCode: row.warehouse_code || null,
    warehouseName: row.warehouse_name || null,
    ownershipScope: row.ownership_scope || "CENTRAL",
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
    quantityIn: roundAmount(row.quantity_in || 0),
    quantityRemaining: roundAmount(row.quantity_remaining || 0),
    currencyCode: row.currency_code || null,
    sourceMovementDate: row.source_movement_date || null,
  };
}
function mapIssueConsumptionRow(row) {
  if (!row) {
    return null;
  }
  return {
    costLayerId: parsePositiveInt(row.cost_layer_id),
    issueMovementId: parsePositiveInt(row.issue_movement_id),
    quantityConsumed: roundAmount(row.quantity_consumed || 0),
    transferId: parsePositiveInt(row.inventory_transfer_id),
    targetReceiptMovementId: parsePositiveInt(row.target_receipt_movement_id),
  };
}
async function fetchEligibleSourceLineRows({
  tenantId,
  legalEntityId,
  sourceLineIds,
  runQuery = query,
}) {
  const normalizedLineIds = uniquePositiveIds(sourceLineIds);
  if (normalizedLineIds.length === 0) {
    return [];
  }
  const inClause = makeInClause(normalizedLineIds);
  const statusInClause = makeInClause(ACTIVE_SOURCE_VOUCHER_STATUSES);
  const reversalStatusInClause = makeInClause(ACTIVE_REVERSAL_BLOCK_STATUSES);
  const params = [
    tenantId,
    legalEntityId,
    ...ACTIVE_SOURCE_VOUCHER_STATUSES,
    tenantId,
    legalEntityId,
    ...normalizedLineIds,
    tenantId,
    ...ACTIVE_REVERSAL_BLOCK_STATUSES,
  ];
  const result = await runQuery(
    `SELECT
        d.id AS source_cari_document_id,
        l.id AS source_cari_document_line_id,
        d.document_no,
        d.document_date,
        d.operating_unit_id AS document_operating_unit_id,
        d.currency_code,
        l.line_no,
        l.description AS line_description,
        l.posting_account_id,
        l.line_net_amount_txn,
        l.line_net_amount_base,
        COALESCE(sa.applied_amount_txn, 0.000000) AS already_applied_amount_txn,
        COALESCE(sa.applied_amount_base, 0.000000) AS already_applied_amount_base
       FROM cari_document_lines l
       JOIN cari_documents d
         ON d.tenant_id = l.tenant_id
        AND d.legal_entity_id = l.legal_entity_id
        AND d.id = l.cari_document_id
       LEFT JOIN (
         SELECT
           s.tenant_id,
           s.legal_entity_id,
           s.source_cari_document_line_id,
           SUM(s.applied_amount_txn) AS applied_amount_txn,
           SUM(s.applied_amount_base) AS applied_amount_base
          FROM stock_landed_cost_voucher_sources s
          JOIN stock_landed_cost_vouchers v
            ON v.tenant_id = s.tenant_id
           AND v.legal_entity_id = s.legal_entity_id
           AND v.id = s.voucher_id
         WHERE s.tenant_id = ?
           AND s.legal_entity_id = ?
           AND v.status IN (${statusInClause})
         GROUP BY
           s.tenant_id,
           s.legal_entity_id,
           s.source_cari_document_line_id
       ) sa
         ON sa.tenant_id = l.tenant_id
        AND sa.legal_entity_id = l.legal_entity_id
        AND sa.source_cari_document_line_id = l.id
      WHERE l.tenant_id = ?
        AND l.legal_entity_id = ?
        AND l.id IN (${inClause})
        AND d.direction = 'AP'
        AND d.status = 'POSTED'
        AND l.line_kind = 'STANDARD'
        AND l.charge_allocation_method = 'NONE'
        AND l.subledger_type = 'NONE'
        AND l.stock_impact_mode = 'NONE'
        AND l.line_net_amount_base > 0
        AND l.posting_account_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
            FROM cari_documents rd
           WHERE rd.tenant_id = ?
             AND rd.reversal_of_document_id = d.id
             AND rd.status IN (${reversalStatusInClause})
        )`,
    params
  );
  return (result.rows || []).map(mapSourceLineRow);
}
async function fetchEligibleTargetRows({
  tenantId,
  legalEntityId,
  stockLinkIds,
  runQuery = query,
}) {
  const normalizedStockLinkIds = uniquePositiveIds(stockLinkIds);
  if (normalizedStockLinkIds.length === 0) {
    return [];
  }
  const inClause = makeInClause(normalizedStockLinkIds);
  const params = [tenantId, legalEntityId, ...normalizedStockLinkIds];
  const result = await runQuery(
    `SELECT
        sl.id AS source_stock_link_id,
        sl.cari_document_id AS source_cari_document_id,
        sl.cari_document_line_id AS source_cari_document_line_id,
        sl.inventory_movement_id AS source_anchor_inventory_movement_id,
        d.document_no,
        d.document_date,
        l.line_no,
        l.description AS line_description,
        sl.item_card_id,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        sl.posted_net_amount_txn,
        sl.posted_net_amount_base,
        sl.requested_quantity,
        anchor.quantity AS anchor_movement_quantity
       FROM cari_document_line_stock_links sl
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
       JOIN inventory_movements anchor
         ON anchor.id = sl.inventory_movement_id
        AND anchor.tenant_id = sl.tenant_id
        AND anchor.legal_entity_id = sl.legal_entity_id
        AND anchor.movement_type = 'RECEIPT'
       LEFT JOIN inventory_movements anchor_reversal
         ON anchor_reversal.tenant_id = anchor.tenant_id
        AND anchor_reversal.reversal_of_movement_id = anchor.id
      WHERE sl.tenant_id = ?
        AND sl.legal_entity_id = ?
        AND sl.id IN (${inClause})
        AND d.direction = 'AP'
        AND d.status = 'POSTED'
        AND sl.stock_impact_mode = 'RECEIPT_PENDING'
        AND sl.link_status = 'LINKED'
        AND sl.inventory_movement_id IS NOT NULL
        AND anchor.reversal_of_movement_id IS NULL
        AND anchor_reversal.id IS NULL`,
    params
  );
  return (result.rows || []).map(mapTargetStockLinkRow);
}
async function fetchReceiptLayerRows({
  tenantId,
  legalEntityId,
  receiptMovementIds,
  forUpdate = false,
  runQuery = query,
}) {
  const normalizedIds = uniquePositiveIds(receiptMovementIds);
  if (normalizedIds.length === 0) {
    return [];
  }
  const inClause = makeInClause(normalizedIds);
  const params = [tenantId, legalEntityId, ...normalizedIds];
  const result = await runQuery(
    `SELECT
        cl.id AS resolved_cost_layer_id,
        cl.source_movement_id AS resolved_inventory_movement_id,
        cl.warehouse_id,
        w.code AS warehouse_code,
        w.name AS warehouse_name,
        w.ownership_scope,
        w.operating_unit_id,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        cl.quantity_in,
        cl.quantity_remaining,
        cl.currency_code,
        m.movement_date AS source_movement_date
       FROM inventory_cost_layers cl
       JOIN inventory_movements m
         ON m.id = cl.source_movement_id
       JOIN inventory_warehouses w
         ON w.tenant_id = cl.tenant_id
        AND w.id = cl.warehouse_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = w.tenant_id
        AND ou.id = w.operating_unit_id
       LEFT JOIN inventory_movements receipt_reversal
         ON receipt_reversal.tenant_id = m.tenant_id
        AND receipt_reversal.reversal_of_movement_id = m.id
      WHERE cl.tenant_id = ?
        AND cl.legal_entity_id = ?
        AND cl.source_movement_id IN (${inClause})
        AND m.reversal_of_movement_id IS NULL
        AND receipt_reversal.id IS NULL
      ${forUpdate ? "FOR UPDATE" : ""}`,
    params
  );
  return (result.rows || []).map(mapReceiptLayerRow);
}
async function fetchActiveIssueConsumptionRows({
  tenantId,
  legalEntityId,
  costLayerIds,
  runQuery = query,
}) {
  const normalizedIds = uniquePositiveIds(costLayerIds);
  if (normalizedIds.length === 0) {
    return [];
  }
  const inClause = makeInClause(normalizedIds);
  const params = [tenantId, legalEntityId, ...normalizedIds];
  const result = await runQuery(
    `SELECT
        c.cost_layer_id,
        c.issue_movement_id,
        c.quantity_consumed,
        tl.inventory_transfer_id,
        tl.target_receipt_movement_id
       FROM inventory_issue_layer_consumptions c
       JOIN inventory_movements issue_m
         ON issue_m.id = c.issue_movement_id
       LEFT JOIN inventory_transfer_lines tl
         ON tl.source_issue_movement_id = c.issue_movement_id
       LEFT JOIN inventory_movements issue_reversal
         ON issue_reversal.tenant_id = issue_m.tenant_id
        AND issue_reversal.reversal_of_movement_id = issue_m.id
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.cost_layer_id IN (${inClause})
        AND issue_m.reversal_of_movement_id IS NULL
        AND issue_reversal.id IS NULL`,
    params
  );
  return (result.rows || []).map(mapIssueConsumptionRow);
}
async function resolveTargetLineageState({
  tenantId,
  legalEntityId,
  sourceAnchorInventoryMovementId,
  ownershipContext,
  forUpdate = false,
  runQuery = query,
}) {
  const selectedContext = buildOwnershipContext(ownershipContext);
  const queue = [sourceAnchorInventoryMovementId];
  const visitedReceiptMovementIds = new Set();
  const receiptLayersByCostLayerId = new Map();
  const sameContextRows = [];
  const blockedReasons = new Set();
  while (queue.length > 0) {
    const batchIds = uniquePositiveIds(queue.splice(0, queue.length)).filter(
      (id) => !visitedReceiptMovementIds.has(id)
    );
    if (batchIds.length === 0) {
      continue;
    }
    batchIds.forEach((id) => visitedReceiptMovementIds.add(id));
    const receiptLayers = await fetchReceiptLayerRows({
      tenantId,
      legalEntityId,
      receiptMovementIds: batchIds,
      forUpdate,
      runQuery,
    });
    const costLayerIds = receiptLayers.map((row) => row.resolvedCostLayerId).filter(Boolean);
    const consumptions = await fetchActiveIssueConsumptionRows({
      tenantId,
      legalEntityId,
      costLayerIds,
      runQuery,
    });
    const consumptionsByLayerId = new Map();
    for (const row of consumptions) {
      const layerId = parsePositiveInt(row?.costLayerId);
      if (!layerId) {
        continue;
      }
      const bucket = consumptionsByLayerId.get(layerId) || [];
      bucket.push(row);
      consumptionsByLayerId.set(layerId, bucket);
    }
    for (const layer of receiptLayers) {
      receiptLayersByCostLayerId.set(layer.resolvedCostLayerId, layer);
      const layerContext = buildOwnershipContext({
        ownershipScope: layer.ownershipScope,
        operatingUnitId: layer.operatingUnitId,
      });
      const contextMatches = sameOwnershipContext(layerContext, selectedContext);
      const layerConsumptions = consumptionsByLayerId.get(layer.resolvedCostLayerId) || [];
      let finalConsumedQuantity = 0;
      for (const consumption of layerConsumptions) {
        if (consumption.targetReceiptMovementId) {
          queue.push(consumption.targetReceiptMovementId);
          if (!contextMatches) {
            blockedReasons.add("CROSS_CONTEXT_DESCENDANT");
          }
          continue;
        }
        if (contextMatches) {
          finalConsumedQuantity = roundAmount(
            finalConsumedQuantity + Number(consumption.quantityConsumed || 0)
          );
        } else {
          blockedReasons.add("OUT_OF_SCOPE_CONSUMPTION");
        }
      }
      if (contextMatches) {
        if (layer.quantityRemaining > BALANCE_EPSILON) {
          sameContextRows.push({
            allocationRole: "ON_HAND",
            resolvedInventoryMovementId: layer.resolvedInventoryMovementId,
            resolvedCostLayerId: layer.resolvedCostLayerId,
            warehouseId: layer.warehouseId,
            warehouseCode: layer.warehouseCode,
            warehouseName: layer.warehouseName,
            ownershipScope: layer.ownershipScope,
            operatingUnitId: layer.operatingUnitId,
            operatingUnitCode: layer.operatingUnitCode,
            operatingUnitName: layer.operatingUnitName,
            quantitySnapshot: roundAmount(layer.quantityRemaining),
            sourceMovementDate: layer.sourceMovementDate,
          });
        }
        if (finalConsumedQuantity > BALANCE_EPSILON) {
          sameContextRows.push({
            allocationRole: "CONSUMED",
            resolvedInventoryMovementId: layer.resolvedInventoryMovementId,
            resolvedCostLayerId: layer.resolvedCostLayerId,
            warehouseId: layer.warehouseId,
            warehouseCode: layer.warehouseCode,
            warehouseName: layer.warehouseName,
            ownershipScope: layer.ownershipScope,
            operatingUnitId: layer.operatingUnitId,
            operatingUnitCode: layer.operatingUnitCode,
            operatingUnitName: layer.operatingUnitName,
            quantitySnapshot: finalConsumedQuantity,
            sourceMovementDate: layer.sourceMovementDate,
          });
        }
      }
    }
  }
  const onHandQuantity = roundAmount(
    sameContextRows
      .filter((row) => row.allocationRole === "ON_HAND")
      .reduce((sum, row) => sum + Number(row.quantitySnapshot || 0), 0)
  );
  const consumedQuantity = roundAmount(
    sameContextRows
      .filter((row) => row.allocationRole === "CONSUMED")
      .reduce((sum, row) => sum + Number(row.quantitySnapshot || 0), 0)
  );
  return {
    onHandQuantity,
    consumedQuantity,
    descendantLayerPreviewRows: sameContextRows.sort((left, right) => {
      const roleOrder =
        String(left.allocationRole || "").localeCompare(String(right.allocationRole || ""));
      if (roleOrder !== 0) {
        return roleOrder;
      }
      return (left.resolvedCostLayerId || 0) - (right.resolvedCostLayerId || 0);
    }),
    blockedReasonCodes: Array.from(blockedReasons.values()),
  };
}
function buildSourceApplications({
  requestedSourceLines,
  eligibleSourceRows,
}) {
  const sourceRowsById = new Map(
    (eligibleSourceRows || []).map((row) => [row.sourceCariDocumentLineId, row])
  );
  const applications = [];
  for (const inputRow of requestedSourceLines || []) {
    const sourceLineId = parsePositiveInt(inputRow?.sourceCariDocumentLineId);
    const sourceRow = sourceRowsById.get(sourceLineId);
    if (!sourceRow) {
      throw badRequest(
        `sourceLines sourceCariDocumentLineId ${sourceLineId || "?"} is not an eligible posted AP source line`
      );
    }
    const remainingAvailableBase = roundAmount(
      Number(sourceRow.lineNetAmountBase || 0) - Number(sourceRow.alreadyAppliedAmountBase || 0)
    );
    if (remainingAvailableBase <= BALANCE_EPSILON) {
      throw badRequest(
        `sourceLines sourceCariDocumentLineId ${sourceLineId} has no remaining unapplied base amount`
      );
    }
    const requestedAppliedBase =
      inputRow?.appliedAmountBase === null || inputRow?.appliedAmountBase === undefined
        ? remainingAvailableBase
        : normalizeAmount(
            inputRow.appliedAmountBase,
            `sourceLines sourceCariDocumentLineId ${sourceLineId} appliedAmountBase`
          );
    if (requestedAppliedBase - remainingAvailableBase > BALANCE_EPSILON) {
      throw badRequest(
        `sourceLines sourceCariDocumentLineId ${sourceLineId} exceeds remaining unapplied base amount`
      );
    }
    const lineNetBase = normalizeAmount(
      sourceRow.lineNetAmountBase,
      `source line ${sourceLineId} lineNetAmountBase`
    );
    const lineNetTxn = normalizeAmount(
      sourceRow.lineNetAmountTxn,
      `source line ${sourceLineId} lineNetAmountTxn`,
      { allowZero: true }
    );
    const appliedAmountTxn =
      lineNetBase <= BALANCE_EPSILON
        ? 0
        : roundAmount((lineNetTxn * requestedAppliedBase) / lineNetBase);
    applications.push({
      ...sourceRow,
      remainingAvailableBase,
      appliedAmountBase: requestedAppliedBase,
      appliedAmountTxn,
      remainingAvailableAfterBase: roundAmount(remainingAvailableBase - requestedAppliedBase),
    });
  }
  return applications;
}
function buildTargetBaseAllocations({
  allocationMethod,
  totalAppliedAmountBase,
  requestedTargets,
  targetRows,
}) {
  const targetRowsById = new Map((targetRows || []).map((row) => [row.sourceStockLinkId, row]));
  const resolvedTargets = (requestedTargets || []).map((target) => {
    const sourceStockLinkId = parsePositiveInt(target?.sourceStockLinkId);
    const targetRow = targetRowsById.get(sourceStockLinkId);
    if (!targetRow) {
      throw badRequest(
        `targets sourceStockLinkId ${sourceStockLinkId || "?"} is not an eligible posted receipt target`
      );
    }
    return {
      ...targetRow,
      manualAllocatedAmountBase:
        target?.allocatedAmountBase === null || target?.allocatedAmountBase === undefined
          ? null
          : normalizeAmount(
              target.allocatedAmountBase,
              `targets sourceStockLinkId ${sourceStockLinkId} allocatedAmountBase`,
              { allowZero: true }
            ),
      quantityBasis:
        roundAmount(targetRow.requestedQuantity || 0) > BALANCE_EPSILON
          ? roundAmount(targetRow.requestedQuantity || 0)
          : roundAmount(targetRow.anchorMovementQuantity || 0),
    };
  });
  let allocations = [];
  if (allocationMethod === "MANUAL") {
    allocations = resolvedTargets.map((target) => {
      if (target.manualAllocatedAmountBase === null) {
        throw badRequest(
          `targets sourceStockLinkId ${target.sourceStockLinkId} allocatedAmountBase is required for MANUAL allocation`
        );
      }
      return target.manualAllocatedAmountBase;
    });
    const totalManual = roundAmount(allocations.reduce((sum, value) => sum + value, 0));
    if (!amountsAreEqual(totalManual, totalAppliedAmountBase, 0.01)) {
      throw badRequest(
        "targets manual allocatedAmountBase total must equal total applied source amount within tolerance 0.01"
      );
    }
  } else if (allocationMethod === "EQUAL") {
    allocations = allocateResidualAmountSplit(totalAppliedAmountBase, resolvedTargets.length);
  } else if (allocationMethod === "BY_AMOUNT") {
    allocations = allocateResidualProportionalSplit(
      totalAppliedAmountBase,
      resolvedTargets.map((target) => Number(target.postedNetAmountBase || 0)),
      "Target posted net amount base"
    );
  } else if (allocationMethod === "BY_QTY") {
    allocations = allocateResidualProportionalSplit(
      totalAppliedAmountBase,
      resolvedTargets.map((target) => Number(target.quantityBasis || 0)),
      "Target quantity basis"
    );
  } else {
    throw badRequest("allocationMethod is invalid");
  }
  return resolvedTargets.map((target, index) => ({
    ...target,
    allocatedAmountBase: allocations[index],
  }));
}
function allocateTargetStateAmounts({
  allocatedAmountBase,
  quantityBasis,
  onHandQuantity,
  consumedQuantity,
}) {
  const normalizedAllocated = roundAmount(allocatedAmountBase || 0);
  const normalizedQuantityBasis = normalizeAmount(quantityBasis, "target quantity basis");
  const normalizedOnHandQuantity = roundAmount(onHandQuantity || 0);
  const normalizedConsumedQuantity = roundAmount(consumedQuantity || 0);
  const eligibleQuantity = roundAmount(normalizedOnHandQuantity + normalizedConsumedQuantity);
  if (eligibleQuantity > normalizedQuantityBasis + BALANCE_EPSILON) {
    throw badRequest("Resolved target state exceeds original quantity basis");
  }
  if (eligibleQuantity <= BALANCE_EPSILON) {
    return {
      onHandAllocatedAmountBase: 0,
      consumedAllocatedAmountBase: 0,
      blockedAllocatedAmountBase: normalizedAllocated,
      blockedQuantity: normalizedQuantityBasis,
    };
  }
  const [eligibleAllocatedAmountBase, blockedAllocatedAmountBase] =
    allocateResidualProportionalSplit(
      normalizedAllocated,
      [eligibleQuantity, normalizedQuantityBasis - eligibleQuantity],
      "Eligible target quantity basis"
    );
  const [onHandAllocatedAmountBase, consumedAllocatedAmountBase] =
    allocateResidualProportionalSplit(
      eligibleAllocatedAmountBase,
      [normalizedOnHandQuantity, normalizedConsumedQuantity],
      "Eligible on-hand / consumed quantity"
    );
  return {
    onHandAllocatedAmountBase,
    consumedAllocatedAmountBase,
    blockedAllocatedAmountBase,
    blockedQuantity: roundAmount(normalizedQuantityBasis - eligibleQuantity),
  };
}
function allocateAmountAcrossPreviewRows(totalAmountBase, rows, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  const allocations = allocateResidualProportionalSplit(
    totalAmountBase,
    rows.map((row) => Number(row.quantitySnapshot || 0)),
    label
  );
  return rows.map((row, index) => ({
    ...row,
    allocatedAmountBase: allocations[index],
  }));
}
export async function previewInventoryLandedCostVoucher({
  payload,
  options = {},
  runQuery = query,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  const allocationMethod = normalizeUpperText(payload?.allocationMethod);
  const ownershipContext = buildOwnershipContext({
    ownershipScope: payload?.ownershipScope,
    operatingUnitId: payload?.operatingUnitId,
  });
  if (!tenantId || !legalEntityId) {
    throw badRequest("tenantId and legalEntityId are required");
  }
  if (!PREVIEW_ALLOCATION_METHODS.has(allocationMethod)) {
    throw badRequest("allocationMethod is invalid");
  }
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId", {
    runQuery,
  });
  if (ownershipContext.ownershipScope === "OPERATING_UNIT") {
    const operatingUnitRow = await assertOperatingUnitBelongsToTenant(
      tenantId,
      ownershipContext.operatingUnitId,
      "operatingUnitId",
      { runQuery }
    );
    if (parsePositiveInt(operatingUnitRow?.legal_entity_id) !== legalEntityId) {
      throw badRequest("operatingUnitId must belong to legalEntityId");
    }
  }
  assertUniqueEntries(payload?.sourceLines, "sourceCariDocumentLineId", "sourceLines");
  assertUniqueEntries(payload?.targets, "sourceStockLinkId", "targets");
  const eligibleSourceRows = await fetchEligibleSourceLineRows({
    tenantId,
    legalEntityId,
    sourceLineIds: (payload?.sourceLines || []).map((row) => row.sourceCariDocumentLineId),
    runQuery,
  });
  const sourceApplications = buildSourceApplications({
    requestedSourceLines: payload?.sourceLines || [],
    eligibleSourceRows,
  });
  const totalAppliedAmountBase = roundAmount(
    sourceApplications.reduce((sum, row) => sum + Number(row.appliedAmountBase || 0), 0)
  );
  if (totalAppliedAmountBase <= BALANCE_EPSILON) {
    throw badRequest("At least one source application amount is required");
  }
  const eligibleTargetRows = await fetchEligibleTargetRows({
    tenantId,
    legalEntityId,
    stockLinkIds: (payload?.targets || []).map((row) => row.sourceStockLinkId),
    runQuery,
  });
  const targetBaseAllocations = buildTargetBaseAllocations({
    allocationMethod,
    totalAppliedAmountBase,
    requestedTargets: payload?.targets || [],
    targetRows: eligibleTargetRows,
  });
  const targetPreviewRows = [];
  let totalCapitalizationAmountBase = 0;
  let totalConsumedAmountBase = 0;
  let totalBlockedAmountBase = 0;
  for (const target of targetBaseAllocations) {
    // eslint-disable-next-line no-await-in-loop
    const lineageState = await resolveTargetLineageState({
      tenantId,
      legalEntityId,
      sourceAnchorInventoryMovementId: target.sourceAnchorInventoryMovementId,
      ownershipContext,
      forUpdate: options?.lockTargetState === true,
      runQuery,
    });
    const stateAmounts = allocateTargetStateAmounts({
      allocatedAmountBase: target.allocatedAmountBase,
      quantityBasis: target.quantityBasis,
      onHandQuantity: lineageState.onHandQuantity,
      consumedQuantity: lineageState.consumedQuantity,
    });
    const onHandRows = lineageState.descendantLayerPreviewRows.filter(
      (row) => row.allocationRole === "ON_HAND"
    );
    const consumedRows = lineageState.descendantLayerPreviewRows.filter(
      (row) => row.allocationRole === "CONSUMED"
    );
    const descendantLayerAllocations = [
      ...allocateAmountAcrossPreviewRows(
        stateAmounts.onHandAllocatedAmountBase,
        onHandRows,
        `Target ${target.sourceStockLinkId} ON_HAND quantity`
      ),
      ...allocateAmountAcrossPreviewRows(
        stateAmounts.consumedAllocatedAmountBase,
        consumedRows,
        `Target ${target.sourceStockLinkId} CONSUMED quantity`
      ),
    ];
    totalCapitalizationAmountBase = roundAmount(
      totalCapitalizationAmountBase + stateAmounts.onHandAllocatedAmountBase
    );
    totalConsumedAmountBase = roundAmount(
      totalConsumedAmountBase + stateAmounts.consumedAllocatedAmountBase
    );
    totalBlockedAmountBase = roundAmount(
      totalBlockedAmountBase + stateAmounts.blockedAllocatedAmountBase
    );
    targetPreviewRows.push({
      sourceStockLinkId: target.sourceStockLinkId,
      sourceCariDocumentId: target.sourceCariDocumentId,
      sourceCariDocumentLineId: target.sourceCariDocumentLineId,
      sourceAnchorInventoryMovementId: target.sourceAnchorInventoryMovementId,
      documentNo: target.documentNo,
      documentDate: target.documentDate,
      lineNo: target.lineNo,
      lineDescription: target.lineDescription,
      itemCardId: target.itemCardId,
      itemCardCode: target.itemCardCode,
      itemCardName: target.itemCardName,
      allocationMethod,
      quantityBasis: target.quantityBasis,
      allocatedAmountBase: target.allocatedAmountBase,
      onHandQuantity: lineageState.onHandQuantity,
      consumedQuantity: lineageState.consumedQuantity,
      blockedQuantity: stateAmounts.blockedQuantity,
      onHandAllocatedAmountBase: stateAmounts.onHandAllocatedAmountBase,
      consumedAllocatedAmountBase: stateAmounts.consumedAllocatedAmountBase,
      blockedAllocatedAmountBase: stateAmounts.blockedAllocatedAmountBase,
      blockedReasonCodes: lineageState.blockedReasonCodes,
      descendantLayerAllocations,
    });
  }
  return {
    tenantId,
    legalEntityId,
    postingDate: payload?.postingDate || null,
    allocationMethod,
    ownershipContext: {
      ownershipScope: ownershipContext.ownershipScope,
      operatingUnitId: ownershipContext.operatingUnitId,
      label: buildContextLabel(ownershipContext),
    },
    sourceSummary: {
      lineCount: sourceApplications.length,
      totalAppliedAmountBase,
      totalAppliedAmountTxn: roundAmount(
        sourceApplications.reduce((sum, row) => sum + Number(row.appliedAmountTxn || 0), 0)
      ),
      lines: sourceApplications,
    },
    targetSummary: {
      targetCount: targetPreviewRows.length,
      totalAllocatedAmountBase: roundAmount(
        targetPreviewRows.reduce((sum, row) => sum + Number(row.allocatedAmountBase || 0), 0)
      ),
      totalCapitalizationAmountBase,
      totalExpenseAdjustmentAmountBase: totalConsumedAmountBase,
      totalBlockedAmountBase,
    },
    targets: targetPreviewRows,
  };
}

function normalizeOptionalText(value, maxLength) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeDateOnly(value, fieldLabel = "date") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw badRequest(`${fieldLabel} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw badRequest(`${fieldLabel} must be YYYY-MM-DD`);
  }
  return normalized;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function buildTemporaryVoucherNo(tenantId, legalEntityId) {
  return `LCV-TMP-${tenantId}-${legalEntityId}-${Date.now()}-${Math.floor(
    Math.random() * 1000000
  )}`.slice(0, 60);
}

function buildPostedVoucherNo(voucherId) {
  return `LCV-${String(parsePositiveInt(voucherId) || 0).padStart(6, "0")}`.slice(0, 60);
}

function buildReversalVoucherJournalNo(voucherId) {
  return `SLCV-REV-${parsePositiveInt(voucherId) || 0}`.slice(0, 40);
}

function mapVoucherHeaderRow(row) {
  if (!row) {
    return null;
  }
  return {
    voucherId: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    voucherNo: row.voucher_no || null,
    status: normalizeUpperText(row.status || "DRAFT"),
    postingDate: row.posting_date || null,
    ownershipScope: row.ownership_scope || "CENTRAL",
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    currencyCode: row.currency_code || null,
    note: row.note || null,
    postedJournalEntryId: parsePositiveInt(row.posted_journal_entry_id),
    reversalJournalEntryId: parsePositiveInt(row.reversal_journal_entry_id),
    reversalOfVoucherId: parsePositiveInt(row.reversal_of_voucher_id),
    reversedByVoucherId: parsePositiveInt(row.reversed_by_voucher_id),
    postedBookId: parsePositiveInt(row.posted_book_id),
    postedAt: row.posted_at || null,
    reversedAt: row.reversed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function fetchInventoryLandedCostVoucherHeader({
  tenantId,
  voucherId,
  runQuery = query,
  forUpdate = false,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedVoucherId = parsePositiveInt(voucherId);
  if (!normalizedTenantId || !normalizedVoucherId) {
    return null;
  }
  const result = await runQuery(
    `SELECT
        v.*,
        j.book_id AS posted_book_id
       FROM stock_landed_cost_vouchers v
       LEFT JOIN journal_entries j
         ON j.id = v.posted_journal_entry_id
      WHERE v.tenant_id = ?
        AND v.id = ?
      LIMIT 1
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [normalizedTenantId, normalizedVoucherId]
  );
  return mapVoucherHeaderRow(result.rows?.[0] || null);
}

function makeLikeParam(value) {
  const normalized = String(value || "").trim();
  return normalized ? `%${normalized}%` : null;
}

function normalizeQueryLimit(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function mapVoucherListRow(row) {
  if (!row) {
    return null;
  }
  const status = normalizeUpperText(row.status || "DRAFT");
  const hasReversalDependencies = Number(row.reversal_dependency_count || 0) > 0;
  return {
    voucherId: parsePositiveInt(row.id),
    voucherNo: row.voucher_no || null,
    status,
    postingDate: row.posting_date || null,
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    legalEntityName: row.legal_entity_name || null,
    ownershipScope: row.ownership_scope || "CENTRAL",
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
    sourceAmountBase: roundAmount(row.source_amount_base || 0),
    capitalizedAmountBase: roundAmount(row.capitalized_amount_base || 0),
    consumedAmountBase: roundAmount(row.consumed_amount_base || 0),
    sourceBillCount: Number(row.source_bill_count || 0),
    targetCount: Number(row.target_count || 0),
    createdByUserId: parsePositiveInt(row.created_by_user_id),
    createdByName: row.created_by_name || null,
    postedJournalEntryId: parsePositiveInt(row.posted_journal_entry_id),
    reversalJournalEntryId: parsePositiveInt(row.reversal_journal_entry_id),
    hasReversalDependencies,
    uiStatus: status === "POSTED" && hasReversalDependencies ? "REVERSAL_BLOCKED" : status,
  };
}

function mapVoucherSourceDetailRow(row) {
  if (!row) {
    return null;
  }
  return {
    voucherSourceId: parsePositiveInt(row.id),
    sourceCariDocumentId: parsePositiveInt(row.source_cari_document_id),
    sourceCariDocumentLineId: parsePositiveInt(row.source_cari_document_line_id),
    billNo: row.document_no || null,
    billDate: row.document_date || null,
    vendorCode: row.counterparty_code_snapshot || null,
    vendorName: row.counterparty_name_snapshot || null,
    currencyCode: row.source_currency_code_snapshot || row.document_currency_code || null,
    lineNo: Number(row.line_no || 0),
    lineDescription: row.line_description || null,
    postingAccountId: parsePositiveInt(row.source_posting_account_id_snapshot),
    postingAccountCode: row.posting_account_code || null,
    postingAccountName: row.posting_account_name || null,
    appliedAmountTxn: roundAmount(row.applied_amount_txn || 0),
    appliedAmountBase: roundAmount(row.applied_amount_base || 0),
    remainingUnappliedAmountBase: roundAmount(row.remaining_unapplied_amount_base || 0),
  };
}

function mapVoucherTargetDetailRow(row) {
  if (!row) {
    return null;
  }
  return {
    voucherTargetId: parsePositiveInt(row.id),
    sourceStockLinkId: parsePositiveInt(row.source_stock_link_id),
    sourceCariDocumentId: parsePositiveInt(row.source_cari_document_id),
    sourceCariDocumentLineId: parsePositiveInt(row.source_cari_document_line_id),
    sourceAnchorInventoryMovementId: parsePositiveInt(row.source_anchor_inventory_movement_id),
    receiptRef: row.document_no || null,
    receiptDate: row.document_date || null,
    lineNo: Number(row.line_no || 0),
    itemCardId: parsePositiveInt(row.item_card_id),
    itemCode: row.item_card_code || null,
    itemName: row.item_card_name || null,
    warehouseId: parsePositiveInt(row.anchor_warehouse_id),
    warehouseCode: row.anchor_warehouse_code || null,
    warehouseName: row.anchor_warehouse_name || null,
    ownershipScope: row.ownership_scope_snapshot || "CENTRAL",
    operatingUnitId: parsePositiveInt(row.operating_unit_id_snapshot),
    operatingUnitCode: row.operating_unit_code_snapshot || null,
    operatingUnitName: row.operating_unit_name_snapshot || null,
    allocationMethod: row.allocation_method_snapshot || null,
    quantityBasis: roundAmount(row.quantity_basis_snapshot || 0),
    allocatedAmountBase: roundAmount(row.allocated_amount_base || 0),
    onHandAllocatedAmountBase: roundAmount(row.on_hand_allocated_amount_base || 0),
    consumedAllocatedAmountBase: roundAmount(row.consumed_allocated_amount_base || 0),
  };
}

function buildMovementReferenceFromRow(row, prefix) {
  const documentNo = row?.[`${prefix}_document_no`] || null;
  const transferNo = row?.[`${prefix}_transfer_no`] || null;
  const movementType = row?.[`${prefix}_movement_type`] || null;
  const movementId = parsePositiveInt(row?.[`${prefix}_movement_id`]);
  return documentNo || transferNo || (movementType && movementId ? `${movementType} #${movementId}` : null);
}

function mapVoucherLayerAllocationDetailRow(row) {
  if (!row) {
    return null;
  }
  const sourceAnchorInventoryMovementId = parsePositiveInt(row.source_anchor_inventory_movement_id);
  const resolvedInventoryMovementId = parsePositiveInt(row.resolved_inventory_movement_id);
  const sourceAnchorRef = buildMovementReferenceFromRow(row, "source_anchor");
  const resolvedMovementRef = buildMovementReferenceFromRow(row, "resolved");
  const descendantKind =
    sourceAnchorInventoryMovementId && sourceAnchorInventoryMovementId === resolvedInventoryMovementId
      ? "ANCHOR"
      : "TRANSFER_DESCENDANT";

  return {
    voucherLayerAllocationId: parsePositiveInt(row.id),
    voucherTargetId: parsePositiveInt(row.voucher_target_id),
    sourceStockLinkId: parsePositiveInt(row.source_stock_link_id),
    sourceAnchorInventoryMovementId,
    sourceAnchorMovementType: row.source_anchor_movement_type || null,
    sourceAnchorMovementDate: row.source_anchor_movement_date || null,
    sourceAnchorMovementRef: sourceAnchorRef,
    sourceAnchorWarehouseCode: row.source_anchor_warehouse_code || null,
    sourceAnchorWarehouseName: row.source_anchor_warehouse_name || null,
    resolvedInventoryMovementId,
    resolvedMovementType: row.resolved_movement_type || null,
    resolvedMovementDate: row.resolved_movement_date || null,
    resolvedMovementRef,
    resolvedWarehouseCode: row.resolved_warehouse_code || null,
    resolvedWarehouseName: row.resolved_warehouse_name || null,
    resolvedCostLayerId: parsePositiveInt(row.resolved_cost_layer_id),
    originLayerAllocationId: parsePositiveInt(row.origin_layer_allocation_id),
    allocationRole: normalizeUpperText(row.allocation_role || "ON_HAND"),
    quantitySnapshot: roundAmount(row.quantity_snapshot || 0),
    allocatedAmountBase: roundAmount(row.allocated_amount_base || 0),
    remainingAdjustedQuantity: roundAmount(row.remaining_adjusted_quantity || 0),
    remainingAdjustedAmountBase: roundAmount(row.remaining_adjusted_amount_base || 0),
    openStatus: normalizeUpperText(row.open_status || "CLOSED"),
    descendantKind,
    descendantPath:
      sourceAnchorRef && resolvedMovementRef && sourceAnchorRef !== resolvedMovementRef
        ? `${sourceAnchorRef} -> ${resolvedMovementRef}`
        : resolvedMovementRef || sourceAnchorRef || null,
    itemCode: row.item_card_code || null,
    itemName: row.item_card_name || null,
    linkedConsumptionCount: Number(row.linked_consumption_count || 0),
  };
}

function mapLandedCostConsumptionDetailRow(row) {
  if (!row) {
    return null;
  }
  const restoredByInventoryMovementId = parsePositiveInt(row.restored_by_inventory_movement_id);
  const carryForwardReceiptMovementId = parsePositiveInt(row.carry_forward_receipt_movement_id);
  return {
    landedCostConsumptionId: parsePositiveInt(row.id),
    voucherLayerAllocationId: parsePositiveInt(row.voucher_layer_allocation_id),
    voucherTargetId: parsePositiveInt(row.voucher_target_id),
    allocationRole: normalizeUpperText(row.allocation_role || "ON_HAND"),
    sourceAnchorInventoryMovementId: parsePositiveInt(row.source_anchor_inventory_movement_id),
    resolvedInventoryMovementId: parsePositiveInt(row.resolved_inventory_movement_id),
    resolvedCostLayerId: parsePositiveInt(row.resolved_cost_layer_id),
    consumingInventoryMovementId: parsePositiveInt(row.consuming_inventory_movement_id),
    consumingMovementType: row.consuming_movement_type || null,
    consumingMovementDate: row.consuming_movement_date || null,
    consumingMovementRef: buildMovementReferenceFromRow(row, "consuming"),
    consumingInventoryTransferId: parsePositiveInt(row.consuming_inventory_transfer_id),
    transferNo: row.transfer_no || null,
    quantityConsumed: roundAmount(row.quantity_consumed || 0),
    allocatedAmountBaseConsumed: roundAmount(row.allocated_amount_base_consumed || 0),
    carryForwardReceiptMovementId,
    carryForwardReceiptMovementRef: buildMovementReferenceFromRow(row, "carry_forward"),
    carryForwardCostLayerId: parsePositiveInt(row.carry_forward_cost_layer_id),
    carryForwardLayerAllocationId: parsePositiveInt(row.carry_forward_layer_allocation_id),
    restoredByInventoryMovementId,
    restoredByMovementRef: buildMovementReferenceFromRow(row, "restored_by"),
    status: restoredByInventoryMovementId
      ? "RESTORED"
      : carryForwardReceiptMovementId
        ? "CARRY_FORWARDED"
        : "ACTIVE",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapVoucherJournalRow(row) {
  if (!row) {
    return null;
  }
  return {
    journalEntryId: parsePositiveInt(row.id),
    journalNo: row.journal_no || null,
    status: normalizeUpperText(row.status || "POSTED"),
    entryDate: row.entry_date || null,
    documentDate: row.document_date || null,
    description: row.description || null,
    referenceNo: row.reference_no || null,
    totalDebitBase: roundAmount(row.total_debit_base || 0),
    totalCreditBase: roundAmount(row.total_credit_base || 0),
    bookId: parsePositiveInt(row.book_id),
    bookCode: row.book_code || null,
    bookName: row.book_name || null,
    actorUserId: parsePositiveInt(row.actor_user_id),
    actorName: row.actor_name || null,
    postedAt: row.posted_at || null,
    reversedAt: row.reversed_at || null,
  };
}

function mapVoucherJournalLineRow(row) {
  if (!row) {
    return null;
  }
  return {
    journalLineId: parsePositiveInt(row.id),
    journalEntryId: parsePositiveInt(row.journal_entry_id),
    lineNo: Number(row.line_no || 0),
    accountId: parsePositiveInt(row.account_id),
    accountCode: row.account_code || null,
    accountName: row.account_name || null,
    operatingUnitId: parsePositiveInt(row.operating_unit_id),
    operatingUnitCode: row.operating_unit_code || null,
    operatingUnitName: row.operating_unit_name || null,
    counterpartyLegalEntityId: parsePositiveInt(row.counterparty_legal_entity_id),
    counterpartyLegalEntityCode: row.counterparty_legal_entity_code || null,
    counterpartyLegalEntityName: row.counterparty_legal_entity_name || null,
    description: row.description || null,
    subledgerReferenceNo: row.subledger_reference_no || null,
    currencyCode: row.currency_code || null,
    amountTxn: roundAmount(row.amount_txn || 0),
    debitBase: roundAmount(row.debit_base || 0),
    creditBase: roundAmount(row.credit_base || 0),
    taxCode: row.tax_code || null,
    createdAt: row.created_at || null,
  };
}

function mapSourceLookupRow(row) {
  if (!row) {
    return null;
  }
  const disabledReasonCode = row.disabled_reason_code || null;
  const operatingUnitId = parsePositiveInt(row.document_operating_unit_id);
  return {
    sourceCariDocumentId: parsePositiveInt(row.source_cari_document_id),
    sourceCariDocumentLineId: parsePositiveInt(row.source_cari_document_line_id),
    billNo: row.document_no || null,
    billDate: row.document_date || null,
    vendorCode: row.counterparty_code_snapshot || null,
    vendorName: row.counterparty_name_snapshot || null,
    currencyCode: row.currency_code || null,
    lineNo: Number(row.line_no || 0),
    lineDescription: row.line_description || null,
    lineNetAmountTxn: roundAmount(row.line_net_amount_txn || 0),
    lineNetAmountBase: roundAmount(row.line_net_amount_base || 0),
    appliedAmountTxn: roundAmount(row.already_applied_amount_txn || 0),
    appliedAmountBase: roundAmount(row.already_applied_amount_base || 0),
    remainingUnappliedAmountBase: roundAmount(row.remaining_unapplied_amount_base || 0),
    ownershipScope: operatingUnitId ? "OPERATING_UNIT" : "CENTRAL",
    operatingUnitId,
    operatingUnitCode: row.document_operating_unit_code || null,
    operatingUnitName: row.document_operating_unit_name || null,
    status: row.document_status || null,
    eligible: !disabledReasonCode,
    disabledReasonCode,
  };
}

function mapTargetLookupBaseRow(row) {
  if (!row) {
    return null;
  }
  return {
    sourceStockLinkId: parsePositiveInt(row.source_stock_link_id),
    sourceCariDocumentId: parsePositiveInt(row.source_cari_document_id),
    sourceCariDocumentLineId: parsePositiveInt(row.source_cari_document_line_id),
    sourceAnchorInventoryMovementId: parsePositiveInt(row.source_anchor_inventory_movement_id),
    receiptRef: row.document_no || null,
    receiptDate: row.document_date || null,
    lineNo: Number(row.line_no || 0),
    lineDescription: row.line_description || null,
    itemCardId: parsePositiveInt(row.item_card_id),
    itemCode: row.item_card_code || null,
    itemName: row.item_card_name || null,
    warehouseId: parsePositiveInt(row.anchor_warehouse_id),
    warehouseCode: row.anchor_warehouse_code || null,
    warehouseName: row.anchor_warehouse_name || null,
    anchorOwnershipScope: row.anchor_ownership_scope || "CENTRAL",
    anchorOperatingUnitId: parsePositiveInt(row.anchor_operating_unit_id),
    anchorOperatingUnitCode: row.anchor_operating_unit_code || null,
    anchorOperatingUnitName: row.anchor_operating_unit_name || null,
    qtyReceived: roundAmount(row.requested_quantity || row.anchor_movement_quantity || 0),
    originalReceiptValueBase: roundAmount(row.posted_net_amount_base || 0),
  };
}

function buildVoucherListSearchConditions(filters, conditions, params) {
  const vendorLike = makeLikeParam(filters?.vendor);
  if (vendorLike) {
    conditions.push(
      `EXISTS (
         SELECT 1
           FROM stock_landed_cost_voucher_sources svs
           JOIN cari_documents sd
             ON sd.tenant_id = svs.tenant_id
            AND sd.legal_entity_id = svs.legal_entity_id
            AND sd.id = svs.source_cari_document_id
          WHERE svs.tenant_id = v.tenant_id
            AND svs.legal_entity_id = v.legal_entity_id
            AND svs.voucher_id = v.id
            AND (
              sd.counterparty_name_snapshot LIKE ?
              OR sd.counterparty_code_snapshot LIKE ?
            )
       )`
    );
    params.push(vendorLike, vendorLike);
  }

  const searchLike = makeLikeParam(filters?.search);
  if (searchLike) {
    conditions.push(
      `(v.voucher_no LIKE ?
        OR EXISTS (
          SELECT 1
            FROM stock_landed_cost_voucher_sources svs
            JOIN cari_documents sd
              ON sd.tenant_id = svs.tenant_id
             AND sd.legal_entity_id = svs.legal_entity_id
             AND sd.id = svs.source_cari_document_id
            JOIN cari_document_lines sl
              ON sl.tenant_id = svs.tenant_id
             AND sl.legal_entity_id = svs.legal_entity_id
             AND sl.cari_document_id = svs.source_cari_document_id
             AND sl.id = svs.source_cari_document_line_id
           WHERE svs.tenant_id = v.tenant_id
             AND svs.legal_entity_id = v.legal_entity_id
             AND svs.voucher_id = v.id
             AND (
               sd.document_no LIKE ?
               OR sd.counterparty_name_snapshot LIKE ?
               OR sl.description LIKE ?
             )
        )
        OR EXISTS (
          SELECT 1
            FROM stock_landed_cost_voucher_targets svt
            JOIN cari_document_line_stock_links slk
              ON slk.tenant_id = svt.tenant_id
             AND slk.id = svt.source_stock_link_id
            JOIN cari_documents td
              ON td.tenant_id = slk.tenant_id
             AND td.legal_entity_id = slk.legal_entity_id
             AND td.id = slk.cari_document_id
           WHERE svt.tenant_id = v.tenant_id
             AND svt.legal_entity_id = v.legal_entity_id
             AND svt.voucher_id = v.id
             AND td.document_no LIKE ?
        ))`
    );
    params.push(searchLike, searchLike, searchLike, searchLike, searchLike);
  }
}

export async function listInventoryLandedCostVouchers({
  tenantId,
  filters = {},
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const limit = normalizeQueryLimit(filters.limit, 100, 500);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const conditions = ["v.tenant_id = ?"];
  const params = [normalizedTenantId];

  if (filters.legalEntityId) {
    conditions.push("v.legal_entity_id = ?");
    params.push(filters.legalEntityId);
  }
  if (filters.ownershipScope) {
    conditions.push("v.ownership_scope = ?");
    params.push(filters.ownershipScope);
  }
  if (filters.operatingUnitId) {
    conditions.push("v.operating_unit_id = ?");
    params.push(filters.operatingUnitId);
  }
  if (filters.status) {
    conditions.push("v.status = ?");
    params.push(filters.status);
  }
  if (filters.postingDateFrom) {
    conditions.push("v.posting_date >= ?");
    params.push(filters.postingDateFrom);
  }
  if (filters.postingDateTo) {
    conditions.push("v.posting_date <= ?");
    params.push(filters.postingDateTo);
  }

  buildVoucherListSearchConditions(filters, conditions, params);

  const result = await runQuery(
    `SELECT
        v.id,
        v.voucher_no,
        v.status,
        v.posting_date,
        v.legal_entity_id,
        v.ownership_scope,
        v.operating_unit_id,
        v.posted_journal_entry_id,
        v.reversal_journal_entry_id,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        COALESCE(src.source_amount_base, 0.000000) AS source_amount_base,
        COALESCE(tgt.capitalized_amount_base, 0.000000) AS capitalized_amount_base,
        COALESCE(tgt.consumed_amount_base, 0.000000) AS consumed_amount_base,
        COALESCE(src.source_bill_count, 0) AS source_bill_count,
        COALESCE(tgt.target_count, 0) AS target_count,
        je.created_by_user_id,
        u.name AS created_by_name,
        COALESCE(dep.reversal_dependency_count, 0) AS reversal_dependency_count
       FROM stock_landed_cost_vouchers v
       JOIN legal_entities le
         ON le.tenant_id = v.tenant_id
        AND le.id = v.legal_entity_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = v.tenant_id
        AND ou.id = v.operating_unit_id
       LEFT JOIN journal_entries je
         ON je.id = v.posted_journal_entry_id
       LEFT JOIN users u
         ON u.id = je.created_by_user_id
       LEFT JOIN (
         SELECT
           s.tenant_id,
           s.legal_entity_id,
           s.voucher_id,
           SUM(s.applied_amount_base) AS source_amount_base,
           COUNT(DISTINCT s.source_cari_document_id) AS source_bill_count
          FROM stock_landed_cost_voucher_sources s
         GROUP BY s.tenant_id, s.legal_entity_id, s.voucher_id
       ) src
         ON src.tenant_id = v.tenant_id
        AND src.legal_entity_id = v.legal_entity_id
        AND src.voucher_id = v.id
       LEFT JOIN (
         SELECT
           t.tenant_id,
           t.legal_entity_id,
           t.voucher_id,
           SUM(t.on_hand_allocated_amount_base) AS capitalized_amount_base,
           SUM(t.consumed_allocated_amount_base) AS consumed_amount_base,
           COUNT(*) AS target_count
          FROM stock_landed_cost_voucher_targets t
         GROUP BY t.tenant_id, t.legal_entity_id, t.voucher_id
       ) tgt
         ON tgt.tenant_id = v.tenant_id
        AND tgt.legal_entity_id = v.legal_entity_id
        AND tgt.voucher_id = v.id
       LEFT JOIN (
         SELECT
           t.tenant_id,
           t.legal_entity_id,
           t.voucher_id,
           COUNT(*) AS reversal_dependency_count
          FROM stock_landed_cost_voucher_targets t
          JOIN stock_landed_cost_voucher_layer_allocations la
            ON la.tenant_id = t.tenant_id
           AND la.legal_entity_id = t.legal_entity_id
           AND la.voucher_target_id = t.id
          JOIN stock_landed_cost_layer_consumptions c
            ON c.tenant_id = la.tenant_id
           AND c.legal_entity_id = la.legal_entity_id
           AND c.voucher_layer_allocation_id = la.id
         WHERE la.allocation_role = 'ON_HAND'
           AND c.restored_by_inventory_movement_id IS NULL
         GROUP BY t.tenant_id, t.legal_entity_id, t.voucher_id
      ) dep
         ON dep.tenant_id = v.tenant_id
        AND dep.legal_entity_id = v.legal_entity_id
        AND dep.voucher_id = v.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY v.posting_date DESC, v.id DESC
      LIMIT ${limit}`,
    params
  );

  return {
    rows: (result.rows || []).map(mapVoucherListRow).filter(Boolean),
  };
}

export async function getInventoryLandedCostVoucherById({
  tenantId,
  voucherId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedVoucherId = parsePositiveInt(voucherId);
  if (!normalizedTenantId || !normalizedVoucherId) {
    return null;
  }

  const headerResult = await runQuery(
    `SELECT
        v.*,
        le.code AS legal_entity_code,
        le.name AS legal_entity_name,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name,
        pj.journal_no AS posted_journal_no,
        rj.journal_no AS reversal_journal_no
       FROM stock_landed_cost_vouchers v
       JOIN legal_entities le
         ON le.tenant_id = v.tenant_id
        AND le.id = v.legal_entity_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = v.tenant_id
        AND ou.id = v.operating_unit_id
       LEFT JOIN journal_entries pj
         ON pj.id = v.posted_journal_entry_id
       LEFT JOIN journal_entries rj
         ON rj.id = v.reversal_journal_entry_id
      WHERE v.tenant_id = ?
        AND v.id = ?
      LIMIT 1`,
    [normalizedTenantId, normalizedVoucherId]
  );
  const headerRow = headerResult.rows?.[0] || null;
  const header = mapVoucherHeaderRow(headerRow);
  if (!header) {
    return null;
  }

  const sourceRowsResult = await runQuery(
    `SELECT
        s.*,
        d.document_no,
        d.document_date,
        d.currency_code AS document_currency_code,
        d.counterparty_code_snapshot,
        d.counterparty_name_snapshot,
        l.line_no,
        l.description AS line_description,
        a.code AS posting_account_code,
        a.name AS posting_account_name,
        GREATEST(
          l.line_net_amount_base - COALESCE(active_source_usage.active_applied_amount_base, 0.000000),
          0.000000
        ) AS remaining_unapplied_amount_base
       FROM stock_landed_cost_voucher_sources s
       JOIN cari_documents d
         ON d.tenant_id = s.tenant_id
        AND d.legal_entity_id = s.legal_entity_id
        AND d.id = s.source_cari_document_id
       JOIN cari_document_lines l
         ON l.tenant_id = s.tenant_id
        AND l.legal_entity_id = s.legal_entity_id
        AND l.cari_document_id = s.source_cari_document_id
        AND l.id = s.source_cari_document_line_id
       LEFT JOIN accounts a
         ON a.id = s.source_posting_account_id_snapshot
       LEFT JOIN (
         SELECT
           svs.tenant_id,
           svs.legal_entity_id,
           svs.source_cari_document_line_id,
           SUM(svs.applied_amount_base) AS active_applied_amount_base
          FROM stock_landed_cost_voucher_sources svs
          JOIN stock_landed_cost_vouchers sv
            ON sv.tenant_id = svs.tenant_id
           AND sv.legal_entity_id = svs.legal_entity_id
           AND sv.id = svs.voucher_id
         WHERE sv.status IN (${makeInClause(ACTIVE_SOURCE_VOUCHER_STATUSES)})
         GROUP BY
           svs.tenant_id,
           svs.legal_entity_id,
           svs.source_cari_document_line_id
       ) active_source_usage
         ON active_source_usage.tenant_id = s.tenant_id
       AND active_source_usage.legal_entity_id = s.legal_entity_id
        AND active_source_usage.source_cari_document_line_id = s.source_cari_document_line_id
      WHERE s.tenant_id = ?
        AND s.legal_entity_id = ?
        AND s.voucher_id = ?
      ORDER BY s.id ASC`,
    [...ACTIVE_SOURCE_VOUCHER_STATUSES, normalizedTenantId, header.legalEntityId, header.voucherId]
  );

  const targetRowsResult = await runQuery(
    `SELECT
        t.*,
        sl.cari_document_id AS source_cari_document_id,
        sl.cari_document_line_id AS source_cari_document_line_id,
        sl.item_card_id,
        d.document_no,
        d.document_date,
        l.line_no,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        m.warehouse_id AS anchor_warehouse_id,
        w.code AS anchor_warehouse_code,
        w.name AS anchor_warehouse_name,
        ou.code AS operating_unit_code_snapshot,
        ou.name AS operating_unit_name_snapshot
       FROM stock_landed_cost_voucher_targets t
       JOIN cari_document_line_stock_links sl
         ON sl.tenant_id = t.tenant_id
        AND sl.id = t.source_stock_link_id
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
       JOIN inventory_movements m
         ON m.id = t.source_anchor_inventory_movement_id
       LEFT JOIN inventory_warehouses w
         ON w.tenant_id = m.tenant_id
        AND w.id = m.warehouse_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = t.tenant_id
        AND ou.id = t.operating_unit_id_snapshot
      WHERE t.tenant_id = ?
        AND t.legal_entity_id = ?
        AND t.voucher_id = ?
      ORDER BY t.id ASC`,
    [normalizedTenantId, header.legalEntityId, header.voucherId]
  );

  const layerAllocationRowsResult = await runQuery(
    `SELECT
        la.id,
        la.voucher_target_id,
        la.source_anchor_inventory_movement_id,
        la.resolved_inventory_movement_id,
        la.resolved_cost_layer_id,
        la.origin_layer_allocation_id,
        la.allocation_role,
        la.quantity_snapshot,
        la.allocated_amount_base,
        la.remaining_adjusted_quantity,
        la.remaining_adjusted_amount_base,
        la.open_status,
        t.source_stock_link_id,
        source_anchor_m.id AS source_anchor_movement_id,
        source_anchor_m.movement_type AS source_anchor_movement_type,
        source_anchor_m.movement_date AS source_anchor_movement_date,
        source_anchor_doc.document_no AS source_anchor_document_no,
        source_anchor_transfer.transfer_no AS source_anchor_transfer_no,
        source_anchor_wh.code AS source_anchor_warehouse_code,
        source_anchor_wh.name AS source_anchor_warehouse_name,
        resolved_m.id AS resolved_movement_id,
        resolved_m.movement_type AS resolved_movement_type,
        resolved_m.movement_date AS resolved_movement_date,
        resolved_doc.document_no AS resolved_document_no,
        resolved_transfer.transfer_no AS resolved_transfer_no,
        resolved_wh.code AS resolved_warehouse_code,
        resolved_wh.name AS resolved_warehouse_name,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        COALESCE(consumption_usage.linked_consumption_count, 0) AS linked_consumption_count
       FROM stock_landed_cost_voucher_layer_allocations la
       JOIN stock_landed_cost_voucher_targets t
         ON t.tenant_id = la.tenant_id
        AND t.legal_entity_id = la.legal_entity_id
        AND t.id = la.voucher_target_id
       JOIN inventory_movements source_anchor_m
         ON source_anchor_m.id = la.source_anchor_inventory_movement_id
       LEFT JOIN cari_documents source_anchor_doc
         ON source_anchor_m.source_document_type = 'CARI_DOCUMENT'
        AND source_anchor_doc.tenant_id = source_anchor_m.tenant_id
        AND source_anchor_doc.legal_entity_id = source_anchor_m.legal_entity_id
        AND source_anchor_doc.id = source_anchor_m.source_document_id
       LEFT JOIN inventory_transfers source_anchor_transfer
         ON source_anchor_m.source_document_type = 'INVENTORY_TRANSFER'
        AND source_anchor_transfer.tenant_id = source_anchor_m.tenant_id
        AND source_anchor_transfer.id = source_anchor_m.source_document_id
       LEFT JOIN inventory_warehouses source_anchor_wh
         ON source_anchor_wh.tenant_id = source_anchor_m.tenant_id
        AND source_anchor_wh.id = source_anchor_m.warehouse_id
       JOIN inventory_movements resolved_m
         ON resolved_m.id = la.resolved_inventory_movement_id
       LEFT JOIN cari_documents resolved_doc
         ON resolved_m.source_document_type = 'CARI_DOCUMENT'
        AND resolved_doc.tenant_id = resolved_m.tenant_id
        AND resolved_doc.legal_entity_id = resolved_m.legal_entity_id
        AND resolved_doc.id = resolved_m.source_document_id
       LEFT JOIN inventory_transfers resolved_transfer
         ON resolved_m.source_document_type = 'INVENTORY_TRANSFER'
        AND resolved_transfer.tenant_id = resolved_m.tenant_id
        AND resolved_transfer.id = resolved_m.source_document_id
       LEFT JOIN inventory_warehouses resolved_wh
         ON resolved_wh.tenant_id = resolved_m.tenant_id
        AND resolved_wh.id = resolved_m.warehouse_id
       LEFT JOIN item_cards ic
         ON ic.tenant_id = resolved_m.tenant_id
        AND ic.id = resolved_m.item_card_id
       LEFT JOIN (
         SELECT
           tenant_id,
           legal_entity_id,
           voucher_layer_allocation_id,
           COUNT(*) AS linked_consumption_count
          FROM stock_landed_cost_layer_consumptions
         GROUP BY tenant_id, legal_entity_id, voucher_layer_allocation_id
       ) consumption_usage
         ON consumption_usage.tenant_id = la.tenant_id
        AND consumption_usage.legal_entity_id = la.legal_entity_id
        AND consumption_usage.voucher_layer_allocation_id = la.id
      WHERE la.tenant_id = ?
        AND la.legal_entity_id = ?
        AND t.voucher_id = ?
      ORDER BY t.id ASC, la.id ASC`,
    [normalizedTenantId, header.legalEntityId, header.voucherId]
  );

  const consumptionRowsResult = await runQuery(
    `SELECT
        c.*,
        la.voucher_target_id,
        la.allocation_role,
        la.source_anchor_inventory_movement_id,
        la.resolved_inventory_movement_id,
        la.resolved_cost_layer_id,
        consuming_m.id AS consuming_movement_id,
        consuming_m.movement_type AS consuming_movement_type,
        consuming_m.movement_date AS consuming_movement_date,
        consuming_doc.document_no AS consuming_document_no,
        consuming_source_transfer.transfer_no AS consuming_transfer_no,
        consuming_transfer.transfer_no,
        carry_forward_m.id AS carry_forward_movement_id,
        carry_forward_m.movement_type AS carry_forward_movement_type,
        carry_forward_m.movement_date AS carry_forward_movement_date,
        carry_forward_doc.document_no AS carry_forward_document_no,
        carry_forward_transfer.transfer_no AS carry_forward_transfer_no,
        restored_by_m.id AS restored_by_movement_id,
        restored_by_m.movement_type AS restored_by_movement_type,
        restored_by_m.movement_date AS restored_by_movement_date,
        restored_by_doc.document_no AS restored_by_document_no,
        restored_by_transfer.transfer_no AS restored_by_transfer_no
       FROM stock_landed_cost_layer_consumptions c
       JOIN stock_landed_cost_voucher_layer_allocations la
         ON la.tenant_id = c.tenant_id
        AND la.legal_entity_id = c.legal_entity_id
        AND la.id = c.voucher_layer_allocation_id
       JOIN stock_landed_cost_voucher_targets t
         ON t.tenant_id = la.tenant_id
        AND t.legal_entity_id = la.legal_entity_id
        AND t.id = la.voucher_target_id
       JOIN inventory_movements consuming_m
         ON consuming_m.id = c.consuming_inventory_movement_id
       LEFT JOIN cari_documents consuming_doc
         ON consuming_m.source_document_type = 'CARI_DOCUMENT'
        AND consuming_doc.tenant_id = consuming_m.tenant_id
        AND consuming_doc.legal_entity_id = consuming_m.legal_entity_id
        AND consuming_doc.id = consuming_m.source_document_id
       LEFT JOIN inventory_transfers consuming_source_transfer
         ON consuming_m.source_document_type = 'INVENTORY_TRANSFER'
        AND consuming_source_transfer.tenant_id = consuming_m.tenant_id
        AND consuming_source_transfer.id = consuming_m.source_document_id
       LEFT JOIN inventory_transfers consuming_transfer
         ON consuming_transfer.id = c.consuming_inventory_transfer_id
       LEFT JOIN inventory_movements carry_forward_m
         ON carry_forward_m.id = c.carry_forward_receipt_movement_id
       LEFT JOIN cari_documents carry_forward_doc
         ON carry_forward_m.source_document_type = 'CARI_DOCUMENT'
        AND carry_forward_doc.tenant_id = carry_forward_m.tenant_id
        AND carry_forward_doc.legal_entity_id = carry_forward_m.legal_entity_id
        AND carry_forward_doc.id = carry_forward_m.source_document_id
       LEFT JOIN inventory_transfers carry_forward_transfer
         ON carry_forward_m.source_document_type = 'INVENTORY_TRANSFER'
        AND carry_forward_transfer.tenant_id = carry_forward_m.tenant_id
        AND carry_forward_transfer.id = carry_forward_m.source_document_id
       LEFT JOIN inventory_movements restored_by_m
         ON restored_by_m.id = c.restored_by_inventory_movement_id
       LEFT JOIN cari_documents restored_by_doc
         ON restored_by_m.source_document_type = 'CARI_DOCUMENT'
        AND restored_by_doc.tenant_id = restored_by_m.tenant_id
        AND restored_by_doc.legal_entity_id = restored_by_m.legal_entity_id
        AND restored_by_doc.id = restored_by_m.source_document_id
       LEFT JOIN inventory_transfers restored_by_transfer
         ON restored_by_m.source_document_type = 'INVENTORY_TRANSFER'
        AND restored_by_transfer.tenant_id = restored_by_m.tenant_id
        AND restored_by_transfer.id = restored_by_m.source_document_id
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND t.voucher_id = ?
      ORDER BY c.id ASC`,
    [normalizedTenantId, header.legalEntityId, header.voucherId]
  );

  const sources = (sourceRowsResult.rows || []).map(mapVoucherSourceDetailRow).filter(Boolean);
  const targets = (targetRowsResult.rows || []).map(mapVoucherTargetDetailRow).filter(Boolean);
  const layerAllocations = (layerAllocationRowsResult.rows || [])
    .map(mapVoucherLayerAllocationDetailRow)
    .filter(Boolean);
  const landedCostConsumptions = (consumptionRowsResult.rows || [])
    .map(mapLandedCostConsumptionDetailRow)
    .filter(Boolean);

  const reversalDependencies = landedCostConsumptions
    .filter(
      (row) =>
        row.allocationRole === "ON_HAND"
        && !parsePositiveInt(row.restoredByInventoryMovementId)
    )
    .map((row) => ({
      voucherLayerAllocationId: row.voucherLayerAllocationId,
      resolvedCostLayerId: row.resolvedCostLayerId,
      resolvedInventoryMovementId: row.resolvedInventoryMovementId,
      dependentMovementId: row.consumingInventoryMovementId,
      dependentMovementType: row.consumingMovementType,
      dependencyType: row.consumingInventoryTransferId ? "TRANSFER" : "ISSUE",
      dependentMovementDate: row.consumingMovementDate || null,
      transferId: row.consumingInventoryTransferId,
      transferNo: row.transferNo || null,
    }));
  const hasReversalDependencies = reversalDependencies.length > 0;

  const journalIds = uniquePositiveIds([
    header.postedJournalEntryId,
    header.reversalJournalEntryId,
  ]);
  const journalsById = new Map();
  if (journalIds.length > 0) {
    const journalInClause = makeInClause(journalIds);
    const journalRowsResult = await runQuery(
      `SELECT
          je.id,
          je.book_id,
          je.journal_no,
          je.status,
          je.entry_date,
          je.document_date,
          je.description,
          je.reference_no,
          je.total_debit_base,
          je.total_credit_base,
          je.created_by_user_id AS actor_user_id,
          je.posted_at,
          je.reversed_at,
          b.code AS book_code,
          b.name AS book_name,
          u.name AS actor_name
         FROM journal_entries je
         JOIN books b
           ON b.id = je.book_id
         LEFT JOIN users u
           ON u.id = je.created_by_user_id
        WHERE je.tenant_id = ?
          AND je.id IN (${journalInClause})
        ORDER BY je.id ASC`,
      [normalizedTenantId, ...journalIds]
    );

    const lineRowsResult = await runQuery(
      `SELECT
          jl.id,
          jl.journal_entry_id,
          jl.line_no,
          jl.account_id,
          jl.operating_unit_id,
          jl.counterparty_legal_entity_id,
          jl.description,
          jl.subledger_reference_no,
          jl.currency_code,
          jl.amount_txn,
          jl.debit_base,
          jl.credit_base,
          jl.tax_code,
          jl.created_at,
          a.code AS account_code,
          a.name AS account_name,
          ou.code AS operating_unit_code,
          ou.name AS operating_unit_name,
          cle.code AS counterparty_legal_entity_code,
          cle.name AS counterparty_legal_entity_name
         FROM journal_lines jl
         JOIN accounts a
           ON a.id = jl.account_id
         LEFT JOIN operating_units ou
           ON ou.id = jl.operating_unit_id
         LEFT JOIN legal_entities cle
           ON cle.id = jl.counterparty_legal_entity_id
        WHERE jl.journal_entry_id IN (${journalInClause})
        ORDER BY jl.journal_entry_id ASC, jl.line_no ASC`,
      journalIds
    );

    const journalSourceLinksById = await listJournalSourceLinksByJournalIds({
      tenantId: normalizedTenantId,
      journalEntryIds: journalIds,
      runQuery,
    });
    const linesByJournalId = new Map();
    for (const row of lineRowsResult.rows || []) {
      const journalEntryId = parsePositiveInt(row.journal_entry_id);
      if (!journalEntryId) {
        continue;
      }
      const bucket = linesByJournalId.get(journalEntryId) || [];
      bucket.push(mapVoucherJournalLineRow(row));
      linesByJournalId.set(journalEntryId, bucket);
    }

    for (const row of journalRowsResult.rows || []) {
      const journalEntryId = parsePositiveInt(row.id);
      if (!journalEntryId) {
        continue;
      }
      const rawSourceLinks = journalSourceLinksById.get(journalEntryId) || [];
      const enrichedSourceLinks = await enrichSourceLinksWithDestinationsAsync(rawSourceLinks);
      const reverseBlock = await resolveReverseBlockAsync(rawSourceLinks);
      journalsById.set(journalEntryId, {
        ...mapVoucherJournalRow(row),
        lines: linesByJournalId.get(journalEntryId) || [],
        sourceLinks: enrichedSourceLinks,
        reverseBlock,
      });
    }
  }

  const uniqueSourceDocumentIds = uniquePositiveIds(
    sources.map((row) => row.sourceCariDocumentId)
  );
  const totalRemainingUnappliedAmountBase = roundAmount(
    sources.reduce(
      (sum, row) => sum + Number(row.remainingUnappliedAmountBase || 0),
      0
    )
  );
  const sourceDocumentBlockerActive =
    ACTIVE_SOURCE_VOUCHER_STATUSES.includes(header.status) && uniqueSourceDocumentIds.length > 0;

  return {
    voucherId: header.voucherId,
    voucherNo: header.voucherNo,
    status: header.status,
    postingDate: header.postingDate,
    legalEntityId: header.legalEntityId,
    legalEntityCode: headerRow.legal_entity_code || null,
    legalEntityName: headerRow.legal_entity_name || null,
    ownershipScope: header.ownershipScope,
    operatingUnitId: header.operatingUnitId,
    operatingUnitCode: headerRow.operating_unit_code || null,
    operatingUnitName: headerRow.operating_unit_name || null,
    currencyCode: header.currencyCode,
    note: header.note,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    postedJournalEntryId: header.postedJournalEntryId,
    postedJournalNo: headerRow.posted_journal_no || null,
    reversalJournalEntryId: header.reversalJournalEntryId,
    reversalJournalNo: headerRow.reversal_journal_no || null,
    postedAt: header.postedAt,
    reversedAt: header.reversedAt,
    createdByUserId: journalsById.get(header.postedJournalEntryId)?.actorUserId || null,
    createdByName: journalsById.get(header.postedJournalEntryId)?.actorName || null,
    reversedByUserId: journalsById.get(header.reversalJournalEntryId)?.actorUserId || null,
    reversedByName: journalsById.get(header.reversalJournalEntryId)?.actorName || null,
    sourceSummary: {
      lineCount: sources.length,
      totalAppliedAmountBase: roundAmount(
        sources.reduce((sum, row) => sum + Number(row.appliedAmountBase || 0), 0)
      ),
      totalRemainingUnappliedAmountBase,
    },
    targetSummary: {
      targetCount: targets.length,
      totalAllocatedAmountBase: roundAmount(
        targets.reduce((sum, row) => sum + Number(row.allocatedAmountBase || 0), 0)
      ),
      totalCapitalizedAmountBase: roundAmount(
        targets.reduce((sum, row) => sum + Number(row.onHandAllocatedAmountBase || 0), 0)
      ),
      totalConsumedAmountBase: roundAmount(
        targets.reduce((sum, row) => sum + Number(row.consumedAllocatedAmountBase || 0), 0)
      ),
    },
    sources,
    targets,
    layerAllocations,
    landedCostConsumptions,
    reversalDependencies,
    hasReversalDependencies,
    journalAudit: {
      sourceLinkType: STOCK_LANDED_COST_VOUCHER,
      postedJournal: journalsById.get(header.postedJournalEntryId) || null,
      reversalJournal: journalsById.get(header.reversalJournalEntryId) || null,
      sourceDocumentBlockerState: {
        isBlocked: sourceDocumentBlockerActive,
        activeVoucherStatus: header.status,
        blockedDocumentCount: sourceDocumentBlockerActive ? uniqueSourceDocumentIds.length : 0,
        blockedSourceLineCount: sourceDocumentBlockerActive ? sources.length : 0,
        blockedSourceDocumentIds: sourceDocumentBlockerActive ? uniqueSourceDocumentIds : [],
      },
      auditTimestamps: {
        createdAt: header.createdAt,
        updatedAt: header.updatedAt,
        postedAt: header.postedAt,
        reversedAt: header.reversedAt,
      },
    },
    uiStatus:
      header.status === "POSTED" && hasReversalDependencies
        ? "REVERSAL_BLOCKED"
        : header.status,
  };
}

export async function listInventoryLandedCostSourceLineLookup({
  tenantId,
  legalEntityId,
  filters = {},
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const limit = normalizeQueryLimit(filters.limit, 100, 500);
  if (!normalizedTenantId || !normalizedLegalEntityId) {
    throw badRequest("tenantId and legalEntityId are required");
  }

  const conditions = [
    "l.tenant_id = ?",
    "l.legal_entity_id = ?",
    "d.direction = 'AP'",
    "d.status = 'POSTED'",
  ];
  const params = [normalizedTenantId, normalizedLegalEntityId];

  if (filters.postingDateFrom) {
    conditions.push("d.document_date >= ?");
    params.push(filters.postingDateFrom);
  }
  if (filters.postingDateTo) {
    conditions.push("d.document_date <= ?");
    params.push(filters.postingDateTo);
  }
  if (filters.vendor) {
    const vendorLike = makeLikeParam(filters.vendor);
    conditions.push("(d.counterparty_name_snapshot LIKE ? OR d.counterparty_code_snapshot LIKE ?)");
    params.push(vendorLike, vendorLike);
  }
  if (filters.currencyCode) {
    conditions.push("d.currency_code = ?");
    params.push(normalizeUpperText(filters.currencyCode).slice(0, 3));
  }
  if (filters.search) {
    const searchLike = makeLikeParam(filters.search);
    conditions.push(
      `(d.document_no LIKE ?
        OR d.counterparty_name_snapshot LIKE ?
        OR d.counterparty_code_snapshot LIKE ?
        OR l.description LIKE ?)`
    );
    params.push(searchLike, searchLike, searchLike, searchLike);
  }
  if (filters.onlyRemainingUnapplied) {
    conditions.push(
      "GREATEST(l.line_net_amount_base - COALESCE(sa.already_applied_amount_base, 0.000000), 0.000000) > 0.000001"
    );
  }

  const result = await runQuery(
    `SELECT
        d.id AS source_cari_document_id,
        l.id AS source_cari_document_line_id,
        d.document_no,
        d.document_date,
        d.status AS document_status,
        d.counterparty_code_snapshot,
        d.counterparty_name_snapshot,
        d.operating_unit_id AS document_operating_unit_id,
        ou.code AS document_operating_unit_code,
        ou.name AS document_operating_unit_name,
        d.currency_code,
        l.line_no,
        l.description AS line_description,
        l.line_kind,
        l.charge_allocation_method,
        l.subledger_type,
        l.stock_impact_mode,
        l.line_net_amount_txn,
        l.line_net_amount_base,
        COALESCE(sa.already_applied_amount_txn, 0.000000) AS already_applied_amount_txn,
        COALESCE(sa.already_applied_amount_base, 0.000000) AS already_applied_amount_base,
        GREATEST(
          l.line_net_amount_base - COALESCE(sa.already_applied_amount_base, 0.000000),
          0.000000
        ) AS remaining_unapplied_amount_base,
        CASE
          WHEN l.charge_allocation_method <> 'NONE' THEN 'TRACK40_CHARGE_LINE'
          WHEN l.line_kind = 'TAX' THEN 'TAX_LINE_NOT_ELIGIBLE'
          WHEN l.line_kind <> 'STANDARD' THEN 'NON_STANDARD_LINE_NOT_ELIGIBLE'
          WHEN l.stock_impact_mode <> 'NONE' THEN 'STOCK_AFFECTING_LINE_NOT_ELIGIBLE'
          WHEN l.subledger_type <> 'NONE' THEN 'FIXED_ASSET_LINE_NOT_ELIGIBLE'
          WHEN GREATEST(
                 l.line_net_amount_base - COALESCE(sa.already_applied_amount_base, 0.000000),
                 0.000000
               ) <= 0.000001 THEN 'NO_REMAINING_UNAPPLIED_AMOUNT'
          WHEN EXISTS (
                 SELECT 1
                   FROM cari_documents rd
                  WHERE rd.tenant_id = d.tenant_id
                    AND rd.reversal_of_document_id = d.id
                    AND rd.status IN (${makeInClause(ACTIVE_REVERSAL_BLOCK_STATUSES)})
               ) THEN 'SOURCE_DOCUMENT_UNDER_REVERSAL'
          ELSE NULL
        END AS disabled_reason_code
       FROM cari_document_lines l
       JOIN cari_documents d
         ON d.tenant_id = l.tenant_id
        AND d.legal_entity_id = l.legal_entity_id
        AND d.id = l.cari_document_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = d.tenant_id
        AND ou.id = d.operating_unit_id
       LEFT JOIN (
         SELECT
           s.tenant_id,
           s.legal_entity_id,
           s.source_cari_document_line_id,
           SUM(s.applied_amount_txn) AS already_applied_amount_txn,
           SUM(s.applied_amount_base) AS already_applied_amount_base
          FROM stock_landed_cost_voucher_sources s
          JOIN stock_landed_cost_vouchers v
            ON v.tenant_id = s.tenant_id
           AND v.legal_entity_id = s.legal_entity_id
           AND v.id = s.voucher_id
         WHERE v.status IN (${makeInClause(ACTIVE_SOURCE_VOUCHER_STATUSES)})
         GROUP BY
           s.tenant_id,
           s.legal_entity_id,
           s.source_cari_document_line_id
      ) sa
         ON sa.tenant_id = l.tenant_id
        AND sa.legal_entity_id = l.legal_entity_id
        AND sa.source_cari_document_line_id = l.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY d.document_date DESC, d.id DESC, l.line_no ASC
      LIMIT ${limit}`,
    [
      ...ACTIVE_REVERSAL_BLOCK_STATUSES,
      ...ACTIVE_SOURCE_VOUCHER_STATUSES,
      ...params,
    ]
  );

  return {
    rows: (result.rows || []).map(mapSourceLookupRow).filter(Boolean),
  };
}

export async function listInventoryLandedCostTargetLookup({
  tenantId,
  legalEntityId,
  filters = {},
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  const limit = normalizeQueryLimit(filters.limit, 100, 500);
  if (!normalizedTenantId || !normalizedLegalEntityId) {
    throw badRequest("tenantId and legalEntityId are required");
  }

  const conditions = [
    "sl.tenant_id = ?",
    "sl.legal_entity_id = ?",
    "d.direction = 'AP'",
    "d.status = 'POSTED'",
    "sl.stock_impact_mode = 'RECEIPT_PENDING'",
    "sl.link_status = 'LINKED'",
    "sl.inventory_movement_id IS NOT NULL",
    "anchor.movement_type = 'RECEIPT'",
    "anchor.reversal_of_movement_id IS NULL",
    "anchor_reversal.id IS NULL",
  ];
  const params = [normalizedTenantId, normalizedLegalEntityId];

  if (filters.receiptDateFrom) {
    conditions.push("d.document_date >= ?");
    params.push(filters.receiptDateFrom);
  }
  if (filters.receiptDateTo) {
    conditions.push("d.document_date <= ?");
    params.push(filters.receiptDateTo);
  }
  if (filters.itemCardId) {
    conditions.push("sl.item_card_id = ?");
    params.push(filters.itemCardId);
  }
  if (filters.warehouseId) {
    conditions.push("anchor.warehouse_id = ?");
    params.push(filters.warehouseId);
  }
  if (filters.search) {
    const searchLike = makeLikeParam(filters.search);
    conditions.push(
      `(d.document_no LIKE ?
        OR l.description LIKE ?
        OR ic.code LIKE ?
        OR ic.name LIKE ?
        OR w.code LIKE ?
        OR w.name LIKE ?)`
    );
    params.push(searchLike, searchLike, searchLike, searchLike, searchLike, searchLike);
  }

  const result = await runQuery(
    `SELECT
        sl.id AS source_stock_link_id,
        sl.cari_document_id AS source_cari_document_id,
        sl.cari_document_line_id AS source_cari_document_line_id,
        sl.inventory_movement_id AS source_anchor_inventory_movement_id,
        d.document_no,
        d.document_date,
        l.line_no,
        l.description AS line_description,
        sl.item_card_id,
        ic.code AS item_card_code,
        ic.name AS item_card_name,
        sl.posted_net_amount_base,
        sl.requested_quantity,
        anchor.quantity AS anchor_movement_quantity,
        anchor.warehouse_id AS anchor_warehouse_id,
        w.code AS anchor_warehouse_code,
        w.name AS anchor_warehouse_name,
        w.ownership_scope AS anchor_ownership_scope,
        w.operating_unit_id AS anchor_operating_unit_id,
        ou.code AS anchor_operating_unit_code,
        ou.name AS anchor_operating_unit_name
       FROM cari_document_line_stock_links sl
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
       JOIN inventory_movements anchor
         ON anchor.id = sl.inventory_movement_id
        AND anchor.tenant_id = sl.tenant_id
        AND anchor.legal_entity_id = sl.legal_entity_id
       LEFT JOIN inventory_movements anchor_reversal
         ON anchor_reversal.tenant_id = anchor.tenant_id
        AND anchor_reversal.reversal_of_movement_id = anchor.id
       LEFT JOIN inventory_warehouses w
         ON w.tenant_id = anchor.tenant_id
        AND w.id = anchor.warehouse_id
       LEFT JOIN operating_units ou
         ON ou.tenant_id = w.tenant_id
        AND ou.id = w.operating_unit_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY d.document_date DESC, d.id DESC, l.line_no ASC
      LIMIT ${limit}`,
    params
  );

  const selectedContext = filters.ownershipScope
    ? buildOwnershipContext({
        ownershipScope: filters.ownershipScope,
        operatingUnitId: filters.operatingUnitId,
      })
    : null;

  const rows = [];
  for (const rawRow of result.rows || []) {
    const mapped = mapTargetLookupBaseRow(rawRow);
    if (!mapped) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const fallbackContext = buildOwnershipContext({
      ownershipScope: mapped.anchorOwnershipScope,
      operatingUnitId: mapped.anchorOperatingUnitId,
    });
    const effectiveContext = selectedContext || fallbackContext;
    // eslint-disable-next-line no-await-in-loop
    const lineageState = await resolveTargetLineageState({
      tenantId: normalizedTenantId,
      legalEntityId: normalizedLegalEntityId,
      sourceAnchorInventoryMovementId: mapped.sourceAnchorInventoryMovementId,
      ownershipContext: effectiveContext,
      runQuery,
    });

    const resolvedContext =
      selectedContext
      && (lineageState.onHandQuantity > BALANCE_EPSILON
        || lineageState.consumedQuantity > BALANCE_EPSILON
        || (lineageState.descendantLayerPreviewRows || []).length > 0)
        ? selectedContext
        : fallbackContext;

    if (
      filters.matchSelectedContextOnly
      && selectedContext
      && !sameOwnershipContext(resolvedContext, selectedContext)
    ) {
      // eslint-disable-next-line no-continue
      continue;
    }

    rows.push({
      ...mapped,
      currentOnHandQuantity: roundAmount(lineageState.onHandQuantity || 0),
      currentConsumedQuantity: roundAmount(lineageState.consumedQuantity || 0),
      ownershipScope: resolvedContext.ownershipScope,
      operatingUnitId: resolvedContext.operatingUnitId,
      blockedReasonCodes: Array.isArray(lineageState.blockedReasonCodes)
        ? lineageState.blockedReasonCodes
        : [],
    });
  }

  return {
    rows,
  };
}

async function lockVoucherLayerAllocationRowsForReversal({
  tx,
  tenantId,
  legalEntityId,
  voucherId,
}) {
  const normalizedVoucherId = parsePositiveInt(voucherId);
  if (!normalizedVoucherId) {
    throw badRequest("voucherId is required");
  }
  await tx.query(
    `SELECT la.id
       FROM stock_landed_cost_voucher_targets t
       JOIN stock_landed_cost_voucher_layer_allocations la
         ON la.tenant_id = t.tenant_id
        AND la.legal_entity_id = t.legal_entity_id
        AND la.voucher_target_id = t.id
      WHERE t.tenant_id = ?
        AND t.legal_entity_id = ?
        AND t.voucher_id = ?
      FOR UPDATE`,
    [tenantId, legalEntityId, normalizedVoucherId]
  );
}

async function lockSourceCariDocumentLinesForPosting({
  tenantId,
  legalEntityId,
  sourceLineIds,
  runQuery = query,
}) {
  const normalizedSourceLineIds = uniquePositiveIds(sourceLineIds);
  if (normalizedSourceLineIds.length === 0) {
    throw badRequest("At least one sourceCariDocumentLineId is required");
  }
  const inClause = makeInClause(normalizedSourceLineIds);
  await runQuery(
    `SELECT id
       FROM cari_document_lines
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND id IN (${inClause})
      FOR UPDATE`,
    [tenantId, legalEntityId, ...normalizedSourceLineIds]
  );
}

async function resolveLandedCostPostingAccountsForItemCard({
  tenantId,
  legalEntityId,
  itemCardId,
  accountCache,
  runQuery = query,
}) {
  const normalizedItemCardId = parsePositiveInt(itemCardId);
  if (!normalizedItemCardId) {
    throw badRequest("itemCardId is required");
  }

  if (accountCache?.has(normalizedItemCardId)) {
    return accountCache.get(normalizedItemCardId);
  }

  const itemCard = await getItemCardByIdForTenant({
    tenantId,
    itemCardId: normalizedItemCardId,
    runQuery,
  });
  const cogsAccountId =
    parsePositiveInt(itemCard?.defaultCogsAccountId)
    || parsePositiveInt(itemCard?.defaultPurchaseAccountId);
  const inventoryAssetAccountId = parsePositiveInt(itemCard?.inventoryAssetAccountId);
  if (!inventoryAssetAccountId) {
    throw badRequest(
      `inventoryAssetAccountId is required for item card ${itemCard?.code || normalizedItemCardId}`
    );
  }
  if (!cogsAccountId) {
    throw badRequest(
      `defaultCogsAccountId or defaultPurchaseAccountId is required for item card ${
        itemCard?.code || normalizedItemCardId
      }`
    );
  }

  const resolved = {
    itemCard,
    inventoryAssetAccount: await resolveInventoryPostingAccount({
      tenantId,
      legalEntityId,
      accountId: inventoryAssetAccountId,
      fieldLabel: `inventoryAssetAccountId for ${itemCard?.code || normalizedItemCardId}`,
      runQuery,
    }),
    consumedAdjustmentAccount: await resolveInventoryPostingAccount({
      tenantId,
      legalEntityId,
      accountId: cogsAccountId,
      fieldLabel: `defaultCogsAccountId for ${itemCard?.code || normalizedItemCardId}`,
      runQuery,
    }),
  };

  accountCache?.set(normalizedItemCardId, resolved);
  return resolved;
}

function addGroupedJournalLine(groupedLines, line) {
  const accountId = parsePositiveInt(line?.accountId);
  if (!accountId) {
    throw badRequest("Journal line accountId is required");
  }

  const normalizedDebitBase = roundAmount(line?.debitBase || 0);
  const normalizedCreditBase = roundAmount(line?.creditBase || 0);
  if (normalizedDebitBase <= BALANCE_EPSILON && normalizedCreditBase <= BALANCE_EPSILON) {
    return;
  }
  const lineSide = normalizedDebitBase > BALANCE_EPSILON ? "DR" : "CR";

  const key = [
    accountId,
    parsePositiveInt(line?.operatingUnitId) || 0,
    parsePositiveInt(line?.counterpartyLegalEntityId) || 0,
    lineSide,
    line?.currencyCode || "",
    line?.subledgerReferenceNo || "",
  ].join(":");

  const existing = groupedLines.get(key);
  if (existing) {
    existing.amountTxn = roundAmount(Number(existing.amountTxn || 0) + Number(line.amountTxn || 0));
    existing.debitBase = roundAmount(normalizedDebitBase + Number(existing.debitBase || 0));
    existing.creditBase = roundAmount(normalizedCreditBase + Number(existing.creditBase || 0));
    return;
  }

  groupedLines.set(key, {
    accountId,
    operatingUnitId: parsePositiveInt(line?.operatingUnitId) || null,
    counterpartyLegalEntityId: parsePositiveInt(line?.counterpartyLegalEntityId) || null,
    description: normalizeOptionalText(line?.description, 255),
    subledgerReferenceNo: normalizeOptionalText(line?.subledgerReferenceNo, 100),
    currencyCode: normalizeUpperText(line?.currencyCode).slice(0, 3),
    amountTxn: roundAmount(line?.amountTxn || 0),
    debitBase: normalizedDebitBase,
    creditBase: normalizedCreditBase,
    taxCode: null,
  });
}

function assertPreviewReadyForPosting(previewResult) {
  if (roundAmount(previewResult?.sourceSummary?.totalAppliedAmountBase || 0) <= BALANCE_EPSILON) {
    throw badRequest("Posting requires a positive landed-cost source amount");
  }
  if (roundAmount(previewResult?.targetSummary?.totalBlockedAmountBase || 0) > BALANCE_EPSILON) {
    throw badRequest(
      "Posting is blocked because part of the selected receipt economics falls outside the voucher context"
    );
  }
}

export async function createInventoryLandedCostVoucher({
  payload,
  runInTransaction = withTransaction,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  const userId = parsePositiveInt(payload?.userId);
  const postingDate = String(payload?.postingDate || "").trim();
  if (!tenantId || !legalEntityId || !userId || !postingDate) {
    throw badRequest("tenantId, legalEntityId, userId, and postingDate are required");
  }

  return runInTransaction(async (tx) => {
    await lockSourceCariDocumentLinesForPosting({
      tenantId,
      legalEntityId,
      sourceLineIds: (payload?.sourceLines || []).map((row) => row.sourceCariDocumentLineId),
      runQuery: tx.query,
    });

    const previewResult = await previewInventoryLandedCostVoucher({
      payload,
      options: {
        lockTargetState: true,
      },
      runQuery: tx.query,
    });
    assertPreviewReadyForPosting(previewResult);

    const baseCurrencyCode = await fetchLegalEntityBaseCurrencyCode({
      tenantId,
      legalEntityId,
      runQuery: tx.query,
    });
    const voucherContext = buildOwnershipContext(previewResult?.ownershipContext);
    const journalContext = await resolveBookAndOpenPeriodForDate({
      tenantId,
      legalEntityId,
      targetDate: postingDate,
      runQuery: tx.query,
    });

    const headerInsertResult = await tx.query(
      `INSERT INTO stock_landed_cost_vouchers (
          tenant_id,
          legal_entity_id,
          voucher_no,
          status,
          posting_date,
          ownership_scope,
          operating_unit_id,
          currency_code,
          note
       ) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        buildTemporaryVoucherNo(tenantId, legalEntityId),
        postingDate,
        voucherContext.ownershipScope,
        voucherContext.operatingUnitId,
        baseCurrencyCode,
        normalizeOptionalText(payload?.note, 500),
      ]
    );
    const voucherId = parsePositiveInt(headerInsertResult.rows?.insertId);
    if (!voucherId) {
      throw new Error("Landed-cost voucher create failed");
    }
    const voucherNo = buildPostedVoucherNo(voucherId);

    const targetIdByStockLinkId = new Map();
    const accountCache = new Map();
    const groupedJournalLines = new Map();
    const subledgerReferenceNo = `${STOCK_LANDED_COST_VOUCHER}:${voucherId}`.slice(0, 100);
    const operatingUnitId = voucherContext.operatingUnitId;

    for (const sourceLine of previewResult?.sourceSummary?.lines || []) {
      await tx.query(
        `INSERT INTO stock_landed_cost_voucher_sources (
            tenant_id,
            legal_entity_id,
            voucher_id,
            source_cari_document_id,
            source_cari_document_line_id,
            source_currency_code_snapshot,
            source_posting_account_id_snapshot,
            applied_amount_txn,
            applied_amount_base
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          voucherId,
          sourceLine.sourceCariDocumentId,
          sourceLine.sourceCariDocumentLineId,
          normalizeUpperText(sourceLine.currencyCode || baseCurrencyCode).slice(0, 3),
          sourceLine.postingAccountId,
          roundAmount(sourceLine.appliedAmountTxn || 0),
          roundAmount(sourceLine.appliedAmountBase || 0),
        ]
      );

      addGroupedJournalLine(groupedJournalLines, {
        accountId: sourceLine.postingAccountId,
        operatingUnitId,
        description: `Stock landed cost voucher ${voucherNo} | CR source AP reclass`.slice(0, 255),
        subledgerReferenceNo,
        currencyCode: baseCurrencyCode,
        amountTxn: Number(roundAmount(sourceLine.appliedAmountBase || 0) * -1),
        debitBase: 0,
        creditBase: roundAmount(sourceLine.appliedAmountBase || 0),
      });
    }

    for (const target of previewResult?.targets || []) {
      const targetInsertResult = await tx.query(
        `INSERT INTO stock_landed_cost_voucher_targets (
            tenant_id,
            legal_entity_id,
            voucher_id,
            source_stock_link_id,
            source_anchor_inventory_movement_id,
            allocation_method_snapshot,
            allocated_amount_txn,
            allocated_amount_base,
            quantity_basis_snapshot,
            on_hand_allocated_amount_base,
            consumed_allocated_amount_base,
            ownership_scope_snapshot,
            operating_unit_id_snapshot
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          voucherId,
          target.sourceStockLinkId,
          target.sourceAnchorInventoryMovementId,
          previewResult.allocationMethod,
          roundAmount(target.allocatedAmountBase || 0),
          roundAmount(target.quantityBasis || 0),
          roundAmount(target.onHandAllocatedAmountBase || 0),
          roundAmount(target.consumedAllocatedAmountBase || 0),
          voucherContext.ownershipScope,
          voucherContext.operatingUnitId,
        ]
      );
      const voucherTargetId = parsePositiveInt(targetInsertResult.rows?.insertId);
      if (!voucherTargetId) {
        throw new Error("Landed-cost voucher target create failed");
      }
      targetIdByStockLinkId.set(target.sourceStockLinkId, voucherTargetId);

      const itemPostingAccounts = await resolveLandedCostPostingAccountsForItemCard({
        tenantId,
        legalEntityId,
        itemCardId: target.itemCardId,
        accountCache,
        runQuery: tx.query,
      });

      if (roundAmount(target.onHandAllocatedAmountBase || 0) > BALANCE_EPSILON) {
        addGroupedJournalLine(groupedJournalLines, {
          accountId: itemPostingAccounts.inventoryAssetAccount.id,
          operatingUnitId,
          description: `Stock landed cost voucher ${voucherNo} | DR inventory`.slice(0, 255),
          subledgerReferenceNo,
          currencyCode: baseCurrencyCode,
          amountTxn: roundAmount(target.onHandAllocatedAmountBase || 0),
          debitBase: roundAmount(target.onHandAllocatedAmountBase || 0),
          creditBase: 0,
        });
      }
      if (roundAmount(target.consumedAllocatedAmountBase || 0) > BALANCE_EPSILON) {
        addGroupedJournalLine(groupedJournalLines, {
          accountId: itemPostingAccounts.consumedAdjustmentAccount.id,
          operatingUnitId,
          description: `Stock landed cost voucher ${voucherNo} | DR consumed adjustment`.slice(
            0,
            255
          ),
          subledgerReferenceNo,
          currencyCode: baseCurrencyCode,
          amountTxn: roundAmount(target.consumedAllocatedAmountBase || 0),
          debitBase: roundAmount(target.consumedAllocatedAmountBase || 0),
          creditBase: 0,
        });
      }

      for (const allocation of target.descendantLayerAllocations || []) {
        const isOnHand = normalizeUpperText(allocation?.allocationRole) === "ON_HAND";
        const quantitySnapshot = roundAmount(allocation?.quantitySnapshot || 0);
        const allocatedAmountBase = roundAmount(allocation?.allocatedAmountBase || 0);
        await tx.query(
          `INSERT INTO stock_landed_cost_voucher_layer_allocations (
              tenant_id,
              legal_entity_id,
              voucher_target_id,
              source_anchor_inventory_movement_id,
              resolved_inventory_movement_id,
              resolved_cost_layer_id,
              origin_layer_allocation_id,
              allocation_role,
              quantity_snapshot,
              allocated_amount_base,
              remaining_adjusted_quantity,
              remaining_adjusted_amount_base,
              open_status,
              allocated_amount_txn
           ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            tenantId,
            legalEntityId,
            voucherTargetId,
            target.sourceAnchorInventoryMovementId,
            allocation.resolvedInventoryMovementId,
            allocation.resolvedCostLayerId,
            isOnHand ? "ON_HAND" : "CONSUMED",
            quantitySnapshot,
            allocatedAmountBase,
            isOnHand ? quantitySnapshot : 0,
            isOnHand ? allocatedAmountBase : 0,
            isOnHand && quantitySnapshot > BALANCE_EPSILON && allocatedAmountBase > BALANCE_EPSILON
              ? "OPEN"
              : "CLOSED",
          ]
        );
      }
    }

    const journalLines = Array.from(groupedJournalLines.values())
      .filter(
        (line) => roundAmount(line.debitBase || 0) > BALANCE_EPSILON
          || roundAmount(line.creditBase || 0) > BALANCE_EPSILON
      )
      .map((line, index) => ({
        ...line,
        lineNo: index + 1,
      }));

    if (journalLines.length === 0) {
      throw badRequest("Landed-cost posting produced no journal lines");
    }

    const journalResult = await insertPostedJournalWithLinesTx(tx, {
      tenantId,
      legalEntityId,
      bookId: journalContext.bookId,
      fiscalPeriodId: journalContext.fiscalPeriodId,
      journalNo: `SLCV-${voucherId}`.slice(0, 40),
      entryDate: postingDate,
      documentDate: postingDate,
      currencyCode: baseCurrencyCode,
      description: `Stock landed cost voucher ${voucherNo}`.slice(0, 500),
      referenceNo: `${STOCK_LANDED_COST_VOUCHER}:${voucherId}`.slice(0, 100),
      userId,
      lines: journalLines,
    });

    await upsertJournalSourceLinkTx(tx, {
      tenantId,
      legalEntityId,
      journalEntryId: journalResult.journalEntryId,
      sourceRefType: STOCK_LANDED_COST_VOUCHER,
      sourceRefId: voucherId,
      linkRole: "PRIMARY",
    });

    await tx.query(
      `UPDATE stock_landed_cost_vouchers
          SET voucher_no = ?,
              status = 'POSTED',
              posted_journal_entry_id = ?,
              posted_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id = ?`,
      [voucherNo, journalResult.journalEntryId, tenantId, legalEntityId, voucherId]
    );

    return {
      voucherId,
      voucherNo,
      status: "POSTED",
      postingDate,
      legalEntityId,
      ownershipScope: voucherContext.ownershipScope,
      operatingUnitId: voucherContext.operatingUnitId,
      postedJournalEntryId: journalResult.journalEntryId,
      sourceSummary: previewResult.sourceSummary,
      targetSummary: previewResult.targetSummary,
      targetIdsByStockLinkId: Object.fromEntries(targetIdByStockLinkId.entries()),
    };
  });
}

export async function resolveInventoryLandedCostVoucherScope(voucherId, tenantId) {
  const voucherRow = await fetchInventoryLandedCostVoucherHeader({
    tenantId,
    voucherId,
  });
  if (!voucherRow) {
    return null;
  }
  if (voucherRow.ownershipScope === "OPERATING_UNIT" && voucherRow.operatingUnitId) {
    return {
      scopeType: "OPERATING_UNIT",
      scopeId: voucherRow.operatingUnitId,
    };
  }
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: voucherRow.legalEntityId,
  };
}

export async function reverseInventoryLandedCostVoucher({
  payload,
  runInTransaction = withTransaction,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const userId = parsePositiveInt(payload?.userId);
  const voucherId = parsePositiveInt(payload?.voucherId);
  if (!tenantId || !userId || !voucherId) {
    throw badRequest("tenantId, userId, and voucherId are required");
  }
  const reversalDate = normalizeDateOnly(
    payload?.reversalDate || todayDateOnly(),
    "reversalDate"
  );
  const reverseReason =
    normalizeOptionalText(payload?.reverseReason, 255)
    || `Reversal of landed-cost voucher ${voucherId}`;

  return runInTransaction(async (tx) => {
    const voucherRow = await fetchInventoryLandedCostVoucherHeader({
      tenantId,
      voucherId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!voucherRow) {
      throw badRequest("voucherId not found for tenant");
    }
    await assertLegalEntityBelongsToTenant(tenantId, voucherRow.legalEntityId, "legalEntityId", {
      runQuery: tx.query,
    });

    if (voucherRow.status === "REVERSED") {
      return {
        voucherId: voucherRow.voucherId,
        voucherNo: voucherRow.voucherNo,
        status: voucherRow.status,
        postingDate: voucherRow.postingDate,
        legalEntityId: voucherRow.legalEntityId,
        ownershipScope: voucherRow.ownershipScope,
        operatingUnitId: voucherRow.operatingUnitId,
        postedJournalEntryId: voucherRow.postedJournalEntryId,
        reversalJournalEntryId: voucherRow.reversalJournalEntryId,
        reversedAt: voucherRow.reversedAt,
      };
    }
    if (voucherRow.status !== "POSTED") {
      throw badRequest("Only POSTED landed-cost vouchers can be reversed");
    }

    await lockVoucherLayerAllocationRowsForReversal({
      tx,
      tenantId,
      legalEntityId: voucherRow.legalEntityId,
      voucherId,
    });

    const reversalDependencies = await listVoucherReversalDependenciesTx({
      tx,
      tenantId,
      legalEntityId: voucherRow.legalEntityId,
      voucherId,
    });
    if (reversalDependencies.length > 0) {
      throw conflict(
        "Blocked because one or more capitalized landed-cost balances were later consumed or transferred",
        {
          voucherId,
          voucherNo: voucherRow.voucherNo,
          dependencies: reversalDependencies,
        }
      );
    }

    let reversalJournalEntryId = parsePositiveInt(voucherRow.reversalJournalEntryId) || null;
    if (voucherRow.postedJournalEntryId && !reversalJournalEntryId) {
      const reversalJournalContext = await resolveBookAndOpenPeriodForDate({
        tenantId,
        legalEntityId: voucherRow.legalEntityId,
        targetDate: reversalDate,
        preferredBookId: voucherRow.postedBookId,
        runQuery: tx.query,
      });
      const reversalJournal = await reverseJournalEntryTx(tx, {
        tenantId,
        journalId: voucherRow.postedJournalEntryId,
        userId,
        reason: reverseReason,
        reversalPeriodId: reversalJournalContext.fiscalPeriodId,
        entryDate: reversalDate,
        documentDate: reversalDate,
        journalNo: buildReversalVoucherJournalNo(voucherId),
        autoPost: true,
        idempotentOnAlreadyReversed: true,
      });
      reversalJournalEntryId = parsePositiveInt(reversalJournal?.reversalJournalId) || null;
      if (reversalJournalEntryId) {
        await upsertJournalSourceLinkTx(tx, {
          tenantId,
          legalEntityId: voucherRow.legalEntityId,
          journalEntryId: reversalJournalEntryId,
          sourceRefType: STOCK_LANDED_COST_VOUCHER,
          sourceRefId: voucherId,
          linkRole: "PRIMARY",
        });
      }
    }

    await tx.query(
      `UPDATE stock_landed_cost_voucher_layer_allocations la
       JOIN stock_landed_cost_voucher_targets t
         ON t.tenant_id = la.tenant_id
        AND t.legal_entity_id = la.legal_entity_id
        AND t.id = la.voucher_target_id
          SET la.remaining_adjusted_quantity = 0.000000,
              la.remaining_adjusted_amount_base = 0.000000,
              la.open_status = 'CLOSED',
              la.updated_at = CURRENT_TIMESTAMP
        WHERE la.tenant_id = ?
          AND la.legal_entity_id = ?
          AND t.voucher_id = ?`,
      [tenantId, voucherRow.legalEntityId, voucherId]
    );

    await tx.query(
      `UPDATE stock_landed_cost_vouchers
          SET status = 'REVERSED',
              reversal_journal_entry_id = COALESCE(?, reversal_journal_entry_id),
              reversed_at = COALESCE(reversed_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id = ?
          AND status = 'POSTED'`,
      [reversalJournalEntryId, tenantId, voucherRow.legalEntityId, voucherId]
    );

    const reversedVoucherRow = await fetchInventoryLandedCostVoucherHeader({
      tenantId,
      voucherId,
      runQuery: tx.query,
      forUpdate: false,
    });

    return {
      voucherId: reversedVoucherRow?.voucherId || voucherId,
      voucherNo: reversedVoucherRow?.voucherNo || voucherRow.voucherNo,
      status: reversedVoucherRow?.status || "REVERSED",
      postingDate: reversedVoucherRow?.postingDate || voucherRow.postingDate,
      legalEntityId: reversedVoucherRow?.legalEntityId || voucherRow.legalEntityId,
      ownershipScope: reversedVoucherRow?.ownershipScope || voucherRow.ownershipScope,
      operatingUnitId:
        reversedVoucherRow?.operatingUnitId ?? voucherRow.operatingUnitId ?? null,
      postedJournalEntryId:
        reversedVoucherRow?.postedJournalEntryId || voucherRow.postedJournalEntryId,
      reversalJournalEntryId:
        reversedVoucherRow?.reversalJournalEntryId || reversalJournalEntryId,
      reversedAt: reversedVoucherRow?.reversedAt || null,
    };
  });
}
