import { query } from "../db.js";
import { badRequest, parsePositiveInt } from "../routes/_utils.js";

const AMOUNT_SCALE = 6;
const BALANCE_EPSILON = 0.000001;

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(AMOUNT_SCALE));
}

function normalizeUpperText(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
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

function ensureTransaction(tx) {
  if (!tx || typeof tx.query !== "function") {
    throw new Error("Transaction query() is required");
  }
}

function normalizeOverlayAvailability(quantity, amount, label) {
  const normalizedQuantity = roundAmount(quantity || 0);
  const normalizedAmount = roundAmount(amount || 0);
  if (normalizedQuantity < 0 || normalizedAmount < 0) {
    throw badRequest(`${label} must not be negative`);
  }
  return {
    quantity: normalizedQuantity,
    amount: normalizedAmount,
  };
}

async function fetchOpenLandedCostAllocationRows({
  tenantId,
  legalEntityId,
  costLayerIds,
  runQuery = query,
}) {
  const normalizedCostLayerIds = uniquePositiveIds(costLayerIds);
  if (normalizedCostLayerIds.length === 0) {
    return [];
  }

  const inClause = makeInClause(normalizedCostLayerIds);
  const result = await runQuery(
    `SELECT
        la.id,
        la.voucher_target_id,
        la.source_anchor_inventory_movement_id,
        la.resolved_inventory_movement_id,
        la.resolved_cost_layer_id,
        la.origin_layer_allocation_id,
        la.allocation_role,
        la.remaining_adjusted_quantity,
        la.remaining_adjusted_amount_base,
        la.open_status
       FROM stock_landed_cost_voucher_layer_allocations la
       JOIN stock_landed_cost_voucher_targets t
         ON t.tenant_id = la.tenant_id
        AND t.legal_entity_id = la.legal_entity_id
        AND t.id = la.voucher_target_id
       JOIN stock_landed_cost_vouchers v
         ON v.tenant_id = t.tenant_id
        AND v.legal_entity_id = t.legal_entity_id
        AND v.id = t.voucher_id
      WHERE la.tenant_id = ?
        AND la.legal_entity_id = ?
        AND la.resolved_cost_layer_id IN (${inClause})
        AND la.allocation_role = 'ON_HAND'
        AND la.open_status = 'OPEN'
        AND la.remaining_adjusted_quantity > 0
        AND v.status = 'POSTED'
      ORDER BY la.id ASC
      FOR UPDATE`,
    [tenantId, legalEntityId, ...normalizedCostLayerIds]
  );

  return result.rows || [];
}

export async function buildLandedCostIssueOverlayPlanTx({
  tx,
  tenantId,
  legalEntityId,
  issueValuationPlan,
}) {
  ensureTransaction(tx);

  const physicalConsumptions = Array.isArray(issueValuationPlan?.consumptions)
    ? issueValuationPlan.consumptions
    : [];
  if (physicalConsumptions.length === 0) {
    return {
      totalCostBase: 0,
      allocationConsumptions: [],
    };
  }

  const openAllocationRows = await fetchOpenLandedCostAllocationRows({
    tenantId,
    legalEntityId,
    costLayerIds: physicalConsumptions.map((row) => row.costLayerId),
    runQuery: tx.query,
  });

  const allocationsByCostLayerId = new Map();
  for (const row of openAllocationRows) {
    const costLayerId = parsePositiveInt(row?.resolved_cost_layer_id);
    if (!costLayerId) {
      continue;
    }
    const bucket = allocationsByCostLayerId.get(costLayerId) || [];
    bucket.push({
      voucherLayerAllocationId: parsePositiveInt(row.id),
      voucherTargetId: parsePositiveInt(row.voucher_target_id),
      sourceAnchorInventoryMovementId: parsePositiveInt(row.source_anchor_inventory_movement_id),
      resolvedInventoryMovementId: parsePositiveInt(row.resolved_inventory_movement_id),
      resolvedCostLayerId: costLayerId,
      originLayerAllocationId: parsePositiveInt(row.origin_layer_allocation_id),
      remainingAdjustedQuantity: roundAmount(row.remaining_adjusted_quantity || 0),
      remainingAdjustedAmountBase: roundAmount(row.remaining_adjusted_amount_base || 0),
      openStatus: normalizeUpperText(row.open_status || "OPEN"),
    });
    allocationsByCostLayerId.set(costLayerId, bucket);
  }

  const allocationConsumptions = [];
  let totalCostBase = 0;

  for (const consumption of physicalConsumptions) {
    const costLayerId = parsePositiveInt(consumption?.costLayerId);
    const quantityConsumed = roundAmount(consumption?.quantityConsumed || 0);
    if (!costLayerId || quantityConsumed <= BALANCE_EPSILON) {
      continue;
    }

    for (const row of allocationsByCostLayerId.get(costLayerId) || []) {
      const availability = normalizeOverlayAvailability(
        row.remainingAdjustedQuantity,
        row.remainingAdjustedAmountBase,
        `landed-cost allocation ${row.voucherLayerAllocationId}`
      );
      if (availability.quantity <= BALANCE_EPSILON) {
        continue;
      }

      const allocationQuantityConsumed = roundAmount(
        Math.min(quantityConsumed, availability.quantity)
      );
      if (allocationQuantityConsumed <= BALANCE_EPSILON) {
        continue;
      }

      const allocationAmountConsumed = roundAmount(
        availability.amount <= BALANCE_EPSILON
          ? 0
          : (availability.amount * allocationQuantityConsumed) / availability.quantity
      );
      const remainingAdjustedQuantityAfter = roundAmount(
        availability.quantity - allocationQuantityConsumed
      );
      const remainingAdjustedAmountBaseAfter = roundAmount(
        availability.amount - allocationAmountConsumed
      );

      allocationConsumptions.push({
        voucherLayerAllocationId: row.voucherLayerAllocationId,
        voucherTargetId: row.voucherTargetId,
        sourceAnchorInventoryMovementId: row.sourceAnchorInventoryMovementId,
        resolvedInventoryMovementId: row.resolvedInventoryMovementId,
        resolvedCostLayerId: row.resolvedCostLayerId,
        originLayerAllocationId: row.originLayerAllocationId,
        quantityConsumed: allocationQuantityConsumed,
        allocatedAmountBaseConsumed: allocationAmountConsumed,
        remainingAdjustedQuantityAfter: remainingAdjustedQuantityAfter > BALANCE_EPSILON
          ? remainingAdjustedQuantityAfter
          : 0,
        remainingAdjustedAmountBaseAfter: remainingAdjustedAmountBaseAfter > BALANCE_EPSILON
          ? remainingAdjustedAmountBaseAfter
          : 0,
      });
      totalCostBase = roundAmount(totalCostBase + allocationAmountConsumed);
    }
  }

  return {
    totalCostBase,
    allocationConsumptions,
  };
}

export function mergeIssueValuationPlanWithLandedCostOverlay({
  issueValuationPlan,
  overlayPlan,
  quantity,
  baseCurrencyCode,
}) {
  const overlayTotalCostBase = roundAmount(overlayPlan?.totalCostBase || 0);
  if (overlayTotalCostBase <= BALANCE_EPSILON) {
    return {
      ...issueValuationPlan,
      landedCostOverlay: {
        totalCostBase: 0,
        allocationConsumptions: [],
      },
      physicalTotalCostTxn: roundAmount(issueValuationPlan?.totalCostTxn || 0),
      physicalTotalCostBase: roundAmount(issueValuationPlan?.totalCostBase || 0),
      physicalUnitCostTxn: roundAmount(issueValuationPlan?.unitCostTxn || 0),
      physicalUnitCostBase: roundAmount(issueValuationPlan?.unitCostBase || 0),
    };
  }

  const requestedQuantity = roundAmount(
    quantity ||
      (Array.isArray(issueValuationPlan?.consumptions)
        ? issueValuationPlan.consumptions.reduce(
            (sum, row) => sum + Number(row?.quantityConsumed || 0),
            0
          )
        : 0)
  );
  if (requestedQuantity <= BALANCE_EPSILON) {
    throw badRequest("Issue quantity is required to merge landed-cost overlay");
  }

  const adjustedTotalCostBase = roundAmount(
    Number(issueValuationPlan?.totalCostBase || 0) + overlayTotalCostBase
  );
  const adjustedUnitCostBase = roundAmount(adjustedTotalCostBase / requestedQuantity);
  const normalizedBaseCurrencyCode = normalizeUpperText(baseCurrencyCode);
  if (!normalizedBaseCurrencyCode) {
    throw badRequest("baseCurrencyCode is required for landed-cost overlay");
  }

  return {
    ...issueValuationPlan,
    currencyCode: normalizedBaseCurrencyCode,
    totalCostTxn: adjustedTotalCostBase,
    totalCostBase: adjustedTotalCostBase,
    unitCostTxn: adjustedUnitCostBase,
    unitCostBase: adjustedUnitCostBase,
    landedCostOverlay: {
      totalCostBase: overlayTotalCostBase,
      allocationConsumptions: Array.isArray(overlayPlan?.allocationConsumptions)
        ? overlayPlan.allocationConsumptions
        : [],
    },
    physicalTotalCostTxn: roundAmount(issueValuationPlan?.totalCostTxn || 0),
    physicalTotalCostBase: roundAmount(issueValuationPlan?.totalCostBase || 0),
    physicalUnitCostTxn: roundAmount(issueValuationPlan?.unitCostTxn || 0),
    physicalUnitCostBase: roundAmount(issueValuationPlan?.unitCostBase || 0),
  };
}

export async function applyLandedCostIssueOverlayPlanTx({
  tx,
  tenantId,
  legalEntityId,
  consumingInventoryMovementId,
  consumingInventoryTransferId = null,
  overlayPlan,
}) {
  ensureTransaction(tx);

  const normalizedMovementId = parsePositiveInt(consumingInventoryMovementId);
  if (!normalizedMovementId) {
    throw badRequest("consumingInventoryMovementId is required");
  }

  const normalizedTransferId = parsePositiveInt(consumingInventoryTransferId) || null;
  const allocationConsumptions = Array.isArray(overlayPlan?.allocationConsumptions)
    ? overlayPlan.allocationConsumptions
    : [];

  for (const allocation of allocationConsumptions) {
    const voucherLayerAllocationId = parsePositiveInt(allocation?.voucherLayerAllocationId);
    if (!voucherLayerAllocationId) {
      continue;
    }

    const quantityConsumed = roundAmount(allocation?.quantityConsumed || 0);
    const allocatedAmountBaseConsumed = roundAmount(
      allocation?.allocatedAmountBaseConsumed || 0
    );

    await tx.query(
      `INSERT INTO stock_landed_cost_layer_consumptions (
          tenant_id,
          legal_entity_id,
          voucher_layer_allocation_id,
          consuming_inventory_movement_id,
          consuming_inventory_transfer_id,
          quantity_consumed,
          allocated_amount_base_consumed
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         consuming_inventory_transfer_id = VALUES(consuming_inventory_transfer_id),
         quantity_consumed = VALUES(quantity_consumed),
         allocated_amount_base_consumed = VALUES(allocated_amount_base_consumed)`,
      [
        tenantId,
        legalEntityId,
        voucherLayerAllocationId,
        normalizedMovementId,
        normalizedTransferId,
        quantityConsumed,
        allocatedAmountBaseConsumed,
      ]
    );

    const remainingAdjustedQuantityAfter = roundAmount(
      allocation?.remainingAdjustedQuantityAfter || 0
    );
    const remainingAdjustedAmountBaseAfter = roundAmount(
      allocation?.remainingAdjustedAmountBaseAfter || 0
    );

    await tx.query(
      `UPDATE stock_landed_cost_voucher_layer_allocations
          SET remaining_adjusted_quantity = ?,
              remaining_adjusted_amount_base = ?,
              open_status = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id = ?`,
      [
        remainingAdjustedQuantityAfter,
        remainingAdjustedAmountBaseAfter,
        remainingAdjustedQuantityAfter > BALANCE_EPSILON
          && remainingAdjustedAmountBaseAfter > BALANCE_EPSILON
          ? "OPEN"
          : "CLOSED",
        tenantId,
        legalEntityId,
        voucherLayerAllocationId,
      ]
    );
  }
}

async function fetchPendingCarryForwardRows({
  tenantId,
  legalEntityId,
  consumingInventoryMovementId,
  runQuery = query,
}) {
  const normalizedMovementId = parsePositiveInt(consumingInventoryMovementId);
  if (!normalizedMovementId) {
    return [];
  }

  const result = await runQuery(
    `SELECT
        c.id AS consumption_id,
        c.quantity_consumed,
        c.allocated_amount_base_consumed,
        c.voucher_layer_allocation_id,
        la.voucher_target_id,
        la.source_anchor_inventory_movement_id,
        la.id AS source_layer_allocation_id
       FROM stock_landed_cost_layer_consumptions c
       JOIN stock_landed_cost_voucher_layer_allocations la
         ON la.tenant_id = c.tenant_id
        AND la.legal_entity_id = c.legal_entity_id
        AND la.id = c.voucher_layer_allocation_id
       JOIN stock_landed_cost_voucher_targets t
         ON t.tenant_id = la.tenant_id
        AND t.legal_entity_id = la.legal_entity_id
        AND t.id = la.voucher_target_id
       JOIN stock_landed_cost_vouchers v
         ON v.tenant_id = t.tenant_id
        AND v.legal_entity_id = t.legal_entity_id
        AND v.id = t.voucher_id
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.consuming_inventory_movement_id = ?
        AND c.restored_by_inventory_movement_id IS NULL
        AND c.carry_forward_layer_allocation_id IS NULL
        AND v.status = 'POSTED'
      ORDER BY c.id ASC
      FOR UPDATE`,
    [tenantId, legalEntityId, normalizedMovementId]
  );

  return result.rows || [];
}

async function upsertCarryForwardLayerAllocationTx(tx, payload) {
  const existing = await tx.query(
    `SELECT id,
            quantity_snapshot,
            allocated_amount_base,
            remaining_adjusted_quantity,
            remaining_adjusted_amount_base,
            open_status,
            origin_layer_allocation_id
       FROM stock_landed_cost_voucher_layer_allocations
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND voucher_target_id = ?
        AND resolved_cost_layer_id = ?
        AND allocation_role = 'ON_HAND'
      LIMIT 1
      FOR UPDATE`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.voucherTargetId,
      payload.destinationCostLayerId,
    ]
  );
  const existingRow = existing.rows?.[0] || null;
  if (existingRow) {
    const nextQuantitySnapshot = roundAmount(
      Number(existingRow.quantity_snapshot || 0) + Number(payload.quantitySnapshot || 0)
    );
    const nextAllocatedAmountBase = roundAmount(
      Number(existingRow.allocated_amount_base || 0) + Number(payload.allocatedAmountBase || 0)
    );
    const nextRemainingAdjustedQuantity = roundAmount(
      Number(existingRow.remaining_adjusted_quantity || 0) + Number(payload.quantitySnapshot || 0)
    );
    const nextRemainingAdjustedAmountBase = roundAmount(
      Number(existingRow.remaining_adjusted_amount_base || 0)
        + Number(payload.allocatedAmountBase || 0)
    );

    await tx.query(
      `UPDATE stock_landed_cost_voucher_layer_allocations
          SET resolved_inventory_movement_id = ?,
              origin_layer_allocation_id = COALESCE(origin_layer_allocation_id, ?),
              quantity_snapshot = ?,
              allocated_amount_base = ?,
              remaining_adjusted_quantity = ?,
              remaining_adjusted_amount_base = ?,
              open_status = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id = ?`,
      [
        payload.destinationReceiptMovementId,
        payload.originLayerAllocationId,
        nextQuantitySnapshot,
        nextAllocatedAmountBase,
        nextRemainingAdjustedQuantity,
        nextRemainingAdjustedAmountBase,
        nextRemainingAdjustedQuantity > BALANCE_EPSILON
          && nextRemainingAdjustedAmountBase > BALANCE_EPSILON
          ? "OPEN"
          : "CLOSED",
        payload.tenantId,
        payload.legalEntityId,
        parsePositiveInt(existingRow.id),
      ]
    );

    return parsePositiveInt(existingRow.id);
  }

  const insertResult = await tx.query(
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ON_HAND', ?, ?, ?, ?, ?, NULL)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.voucherTargetId,
      payload.sourceAnchorInventoryMovementId,
      payload.destinationReceiptMovementId,
      payload.destinationCostLayerId,
      payload.originLayerAllocationId,
      payload.quantitySnapshot,
      payload.allocatedAmountBase,
      payload.quantitySnapshot,
      payload.allocatedAmountBase,
      payload.quantitySnapshot > BALANCE_EPSILON && payload.allocatedAmountBase > BALANCE_EPSILON
        ? "OPEN"
        : "CLOSED",
    ]
  );

  return parsePositiveInt(insertResult.rows?.insertId) || null;
}

export async function recreateTransferReceiptLandedCostCarryForwardTx({
  tx,
  tenantId,
  legalEntityId,
  sourceIssueMovementId,
  destinationReceiptMovementId,
  destinationCostLayerId,
}) {
  ensureTransaction(tx);

  const normalizedReceiptMovementId = parsePositiveInt(destinationReceiptMovementId);
  const normalizedDestinationCostLayerId = parsePositiveInt(destinationCostLayerId);
  if (!normalizedReceiptMovementId || !normalizedDestinationCostLayerId) {
    throw badRequest(
      "destinationReceiptMovementId and destinationCostLayerId are required for carry-forward"
    );
  }

  const rows = await fetchPendingCarryForwardRows({
    tenantId,
    legalEntityId,
    consumingInventoryMovementId: sourceIssueMovementId,
    runQuery: tx.query,
  });
  if (rows.length === 0) {
    return {
      carryForwardCount: 0,
    };
  }

  const rowsByVoucherTargetId = new Map();
  for (const row of rows) {
    const voucherTargetId = parsePositiveInt(row?.voucher_target_id);
    if (!voucherTargetId) {
      continue;
    }
    const bucket = rowsByVoucherTargetId.get(voucherTargetId) || [];
    bucket.push({
      consumptionId: parsePositiveInt(row.consumption_id),
      voucherLayerAllocationId: parsePositiveInt(row.voucher_layer_allocation_id),
      sourceLayerAllocationId: parsePositiveInt(row.source_layer_allocation_id),
      voucherTargetId,
      sourceAnchorInventoryMovementId: parsePositiveInt(row.source_anchor_inventory_movement_id),
      quantityConsumed: roundAmount(row.quantity_consumed || 0),
      allocatedAmountBaseConsumed: roundAmount(row.allocated_amount_base_consumed || 0),
    });
    rowsByVoucherTargetId.set(voucherTargetId, bucket);
  }

  let carryForwardCount = 0;

  for (const [voucherTargetId, groupRows] of rowsByVoucherTargetId.entries()) {
    const quantitySnapshot = roundAmount(
      groupRows.reduce((sum, row) => sum + Number(row.quantityConsumed || 0), 0)
    );
    const allocatedAmountBase = roundAmount(
      groupRows.reduce((sum, row) => sum + Number(row.allocatedAmountBaseConsumed || 0), 0)
    );
    const originLayerAllocationId =
      uniquePositiveIds(groupRows.map((row) => row.sourceLayerAllocationId))[0] || null;
    const sourceAnchorInventoryMovementId =
      parsePositiveInt(groupRows[0]?.sourceAnchorInventoryMovementId) || null;

    const carryForwardLayerAllocationId = await upsertCarryForwardLayerAllocationTx(tx, {
      tenantId,
      legalEntityId,
      voucherTargetId,
      sourceAnchorInventoryMovementId,
      destinationReceiptMovementId: normalizedReceiptMovementId,
      destinationCostLayerId: normalizedDestinationCostLayerId,
      originLayerAllocationId,
      quantitySnapshot,
      allocatedAmountBase,
    });

    if (!carryForwardLayerAllocationId) {
      continue;
    }

    carryForwardCount += 1;
    const consumptionIds = uniquePositiveIds(groupRows.map((row) => row.consumptionId));
    if (consumptionIds.length === 0) {
      continue;
    }

    const inClause = makeInClause(consumptionIds);
    await tx.query(
      `UPDATE stock_landed_cost_layer_consumptions
          SET carry_forward_receipt_movement_id = ?,
              carry_forward_cost_layer_id = ?,
              carry_forward_layer_allocation_id = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id IN (${inClause})`,
      [
        normalizedReceiptMovementId,
        normalizedDestinationCostLayerId,
        carryForwardLayerAllocationId,
        tenantId,
        legalEntityId,
        ...consumptionIds,
      ]
    );
  }

  return {
    carryForwardCount,
  };
}

export async function restoreLandedCostConsumptionForMovementReversalTx({
  tx,
  tenantId,
  legalEntityId,
  consumingInventoryMovementId,
  restoredByInventoryMovementId,
}) {
  ensureTransaction(tx);

  const normalizedConsumingMovementId = parsePositiveInt(consumingInventoryMovementId);
  const normalizedRestoredByMovementId = parsePositiveInt(restoredByInventoryMovementId);
  if (!normalizedConsumingMovementId || !normalizedRestoredByMovementId) {
    throw badRequest(
      "consumingInventoryMovementId and restoredByInventoryMovementId are required"
    );
  }

  const result = await tx.query(
    `SELECT
        c.id,
        c.voucher_layer_allocation_id,
        c.quantity_consumed,
        c.allocated_amount_base_consumed,
        c.restored_by_inventory_movement_id
       FROM stock_landed_cost_layer_consumptions c
      WHERE c.tenant_id = ?
        AND c.legal_entity_id = ?
        AND c.consuming_inventory_movement_id = ?
      ORDER BY c.id ASC
      FOR UPDATE`,
    [tenantId, legalEntityId, normalizedConsumingMovementId]
  );

  let restoredCount = 0;
  for (const row of result.rows || []) {
    if (parsePositiveInt(row?.restored_by_inventory_movement_id)) {
      continue;
    }

    const voucherLayerAllocationId = parsePositiveInt(row?.voucher_layer_allocation_id);
    if (!voucherLayerAllocationId) {
      continue;
    }
    const quantityConsumed = roundAmount(row?.quantity_consumed || 0);
    const amountConsumed = roundAmount(row?.allocated_amount_base_consumed || 0);

    const allocationResult = await tx.query(
      `SELECT
          remaining_adjusted_quantity,
          remaining_adjusted_amount_base
         FROM stock_landed_cost_voucher_layer_allocations
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id = ?
        LIMIT 1
        FOR UPDATE`,
      [tenantId, legalEntityId, voucherLayerAllocationId]
    );
    const allocationRow = allocationResult.rows?.[0] || null;
    if (!allocationRow) {
      continue;
    }

    const nextRemainingQuantity = roundAmount(
      Number(allocationRow.remaining_adjusted_quantity || 0) + quantityConsumed
    );
    const nextRemainingAmount = roundAmount(
      Number(allocationRow.remaining_adjusted_amount_base || 0) + amountConsumed
    );

    await tx.query(
      `UPDATE stock_landed_cost_voucher_layer_allocations
          SET remaining_adjusted_quantity = ?,
              remaining_adjusted_amount_base = ?,
              open_status = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id = ?`,
      [
        nextRemainingQuantity,
        nextRemainingAmount,
        nextRemainingQuantity > BALANCE_EPSILON && nextRemainingAmount > BALANCE_EPSILON
          ? "OPEN"
          : "CLOSED",
        tenantId,
        legalEntityId,
        voucherLayerAllocationId,
      ]
    );

    await tx.query(
      `UPDATE stock_landed_cost_layer_consumptions
          SET restored_by_inventory_movement_id = ?,
              restored_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id = ?`,
      [normalizedRestoredByMovementId, tenantId, legalEntityId, parsePositiveInt(row.id)]
    );
    restoredCount += 1;
  }

  return {
    restoredCount,
  };
}

export async function unwindTransferReceiptLandedCostCarryForwardTx({
  tx,
  tenantId,
  legalEntityId,
  receiptMovementId,
}) {
  ensureTransaction(tx);

  const normalizedReceiptMovementId = parsePositiveInt(receiptMovementId);
  if (!normalizedReceiptMovementId) {
    throw badRequest("receiptMovementId is required");
  }

  const result = await tx.query(
    `SELECT
        id,
        carry_forward_layer_allocation_id
       FROM stock_landed_cost_layer_consumptions
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND carry_forward_receipt_movement_id = ?
      ORDER BY id ASC
      FOR UPDATE`,
    [tenantId, legalEntityId, normalizedReceiptMovementId]
  );

  const carryForwardAllocationIds = uniquePositiveIds(
    (result.rows || []).map((row) => row.carry_forward_layer_allocation_id)
  );
  if (carryForwardAllocationIds.length > 0) {
    const inClause = makeInClause(carryForwardAllocationIds);
    await tx.query(
      `UPDATE stock_landed_cost_voucher_layer_allocations
          SET remaining_adjusted_quantity = 0.000000,
              remaining_adjusted_amount_base = 0.000000,
              open_status = 'CLOSED',
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND legal_entity_id = ?
          AND id IN (${inClause})`,
      [tenantId, legalEntityId, ...carryForwardAllocationIds]
    );
  }

  return {
    carryForwardAllocationCount: carryForwardAllocationIds.length,
  };
}

export async function listVoucherReversalDependenciesTx({
  tx,
  tenantId,
  legalEntityId,
  voucherId,
}) {
  ensureTransaction(tx);

  const normalizedVoucherId = parsePositiveInt(voucherId);
  if (!normalizedVoucherId) {
    throw badRequest("voucherId is required");
  }

  const result = await tx.query(
    `SELECT
        c.id AS consumption_id,
        la.id AS voucher_layer_allocation_id,
        la.resolved_cost_layer_id,
        la.resolved_inventory_movement_id,
        cm.id AS dependent_movement_id,
        cm.movement_type AS dependent_movement_type,
        cm.movement_date AS dependent_movement_date,
        c.consuming_inventory_transfer_id,
        it.transfer_no
       FROM stock_landed_cost_voucher_targets t
       JOIN stock_landed_cost_voucher_layer_allocations la
         ON la.tenant_id = t.tenant_id
        AND la.legal_entity_id = t.legal_entity_id
        AND la.voucher_target_id = t.id
       JOIN stock_landed_cost_layer_consumptions c
         ON c.tenant_id = la.tenant_id
        AND c.legal_entity_id = la.legal_entity_id
        AND c.voucher_layer_allocation_id = la.id
       JOIN inventory_movements cm
         ON cm.id = c.consuming_inventory_movement_id
       LEFT JOIN inventory_transfers it
         ON it.id = c.consuming_inventory_transfer_id
      WHERE t.tenant_id = ?
        AND t.legal_entity_id = ?
        AND t.voucher_id = ?
        AND la.allocation_role = 'ON_HAND'
        AND c.restored_by_inventory_movement_id IS NULL
      ORDER BY c.id ASC
      FOR UPDATE`,
    [tenantId, legalEntityId, normalizedVoucherId]
  );

  return (result.rows || []).map((row) => ({
    consumptionId: parsePositiveInt(row.consumption_id),
    voucherLayerAllocationId: parsePositiveInt(row.voucher_layer_allocation_id),
    resolvedCostLayerId: parsePositiveInt(row.resolved_cost_layer_id),
    resolvedInventoryMovementId: parsePositiveInt(row.resolved_inventory_movement_id),
    dependentMovementId: parsePositiveInt(row.dependent_movement_id),
    dependentMovementType: row.dependent_movement_type || null,
    dependencyType: parsePositiveInt(row.consuming_inventory_transfer_id)
      ? "TRANSFER"
      : "ISSUE",
    dependentMovementDate: row.dependent_movement_date || null,
    transferId: parsePositiveInt(row.consuming_inventory_transfer_id),
    transferNo: row.transfer_no || null,
  }));
}
