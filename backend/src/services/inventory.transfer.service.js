import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { query, withTransaction } from "../db.js";
import { assertLegalEntityBelongsToTenant } from "../tenantGuards.js";
import { getItemCardByIdForTenant } from "./item.card.service.js";

const TRANSFER_STATUS_VALUES = new Set([
  "INITIATED",
  "APPROVED",
  "IN_TRANSIT",
  "RECEIVED",
  "CANCELED",
  "REVERSED",
]);
const OWNERSHIP_SCOPE_VALUES = new Set(["CENTRAL", "OPERATING_UNIT"]);

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function normalizeText(value, maxLength, { required = false, upper = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    if (required) {
      throw badRequest("value is required");
    }
    return "";
  }
  if (normalized.length > maxLength) {
    throw badRequest(`value cannot exceed ${maxLength} characters`);
  }
  return upper ? normalized.toUpperCase() : normalized;
}

function normalizeSqlLikeQuery(value) {
  const normalized = String(value || "").trim();
  return normalized ? `%${normalized}%` : "";
}

function toDecimalString(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw badRequest(`${fieldName} is required`);
  }
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw badRequest(`${fieldName} must be a positive decimal with up to 6 decimals`);
  }
  if (Number(normalized) <= 0) {
    throw badRequest(`${fieldName} must be greater than zero`);
  }
  return normalized;
}

function mapTransferRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    legalEntityCode: row.legal_entity_code || null,
    transferNo: row.transfer_no || null,
    transferDate: row.transfer_date || null,
    status: row.status || null,
    sourceWarehouseId: parsePositiveInt(row.source_warehouse_id),
    sourceWarehouseCode: row.source_warehouse_code || null,
    sourceWarehouseName: row.source_warehouse_name || null,
    targetWarehouseId: parsePositiveInt(row.target_warehouse_id),
    targetWarehouseCode: row.target_warehouse_code || null,
    targetWarehouseName: row.target_warehouse_name || null,
    sourceOwnershipScope: row.source_ownership_scope || "CENTRAL",
    sourceOperatingUnitId: parsePositiveInt(row.source_operating_unit_id),
    sourceOperatingUnitCode: row.source_operating_unit_code || null,
    sourceOperatingUnitName: row.source_operating_unit_name || null,
    targetOwnershipScope: row.target_ownership_scope || "CENTRAL",
    targetOperatingUnitId: parsePositiveInt(row.target_operating_unit_id),
    targetOperatingUnitCode: row.target_operating_unit_code || null,
    targetOperatingUnitName: row.target_operating_unit_name || null,
    shipmentJournalEntryId: parsePositiveInt(row.shipment_journal_entry_id),
    receiptJournalEntryId: parsePositiveInt(row.receipt_journal_entry_id),
    reversalJournalEntryId: parsePositiveInt(row.reversal_journal_entry_id),
    initiatedByUserId: parsePositiveInt(row.initiated_by_user_id),
    approvedByUserId: parsePositiveInt(row.approved_by_user_id),
    shippedByUserId: parsePositiveInt(row.shipped_by_user_id),
    receivedByUserId: parsePositiveInt(row.received_by_user_id),
    canceledByUserId: parsePositiveInt(row.canceled_by_user_id),
    reversedByUserId: parsePositiveInt(row.reversed_by_user_id),
    initiatedAt: row.initiated_at || null,
    approvedAt: row.approved_at || null,
    inTransitAt: row.in_transit_at || null,
    receivedAt: row.received_at || null,
    canceledAt: row.canceled_at || null,
    reversedAt: row.reversed_at || null,
    cancelReason: row.cancel_reason || null,
    reverseReason: row.reverse_reason || null,
    idempotencyKey: row.idempotency_key || null,
    integrationEventUid: row.integration_event_uid || null,
    sourceModule: row.source_module || null,
    sourceEntityType: row.source_entity_type || null,
    sourceEntityId: parsePositiveInt(row.source_entity_id),
    note: row.note || null,
    lineCount: Number(row.line_count || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function mapTransferLineRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: parsePositiveInt(row.id),
    tenantId: parsePositiveInt(row.tenant_id),
    legalEntityId: parsePositiveInt(row.legal_entity_id),
    inventoryTransferId: parsePositiveInt(row.inventory_transfer_id),
    lineNo: Number(row.line_no || 0),
    itemCardId: parsePositiveInt(row.item_card_id),
    itemCardCode: row.item_card_code || null,
    itemCardName: row.item_card_name || null,
    quantityRequested: row.quantity_requested === null ? null : Number(row.quantity_requested),
    quantityShipped: row.quantity_shipped === null ? null : Number(row.quantity_shipped),
    quantityReceived: row.quantity_received === null ? null : Number(row.quantity_received),
    shippedCurrencyCode: row.shipped_currency_code || null,
    shippedUnitCostTxn:
      row.shipped_unit_cost_txn === null ? null : Number(row.shipped_unit_cost_txn),
    shippedUnitCostBase:
      row.shipped_unit_cost_base === null ? null : Number(row.shipped_unit_cost_base),
    shippedTotalCostTxn:
      row.shipped_total_cost_txn === null ? null : Number(row.shipped_total_cost_txn),
    shippedTotalCostBase:
      row.shipped_total_cost_base === null ? null : Number(row.shipped_total_cost_base),
    sourceIssueMovementId: parsePositiveInt(row.source_issue_movement_id),
    targetReceiptMovementId: parsePositiveInt(row.target_receipt_movement_id),
    note: row.note || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function fetchWarehouseContextById({
  tenantId,
  legalEntityId,
  warehouseId,
  fieldName,
  runQuery,
}) {
  const result = await runQuery(
    `SELECT
        w.id,
        w.tenant_id,
        w.legal_entity_id,
        w.code,
        w.name,
        w.status,
        w.ownership_scope,
        w.operating_unit_id,
        ou.code AS operating_unit_code,
        ou.name AS operating_unit_name
       FROM inventory_warehouses w
       LEFT JOIN operating_units ou
         ON ou.tenant_id = w.tenant_id
        AND ou.id = w.operating_unit_id
      WHERE w.tenant_id = ?
        AND w.legal_entity_id = ?
        AND w.id = ?
      LIMIT 1`,
    [tenantId, legalEntityId, warehouseId]
  );
  const row = Array.isArray(result?.rows) ? result.rows[0] || null : null;
  if (!row) {
    throw badRequest(`${fieldName} not found for legalEntityId`);
  }
  if (String(row.status || "").toUpperCase() !== "ACTIVE") {
    throw badRequest(`${fieldName} must be ACTIVE`);
  }
  return row;
}

function sameOwnershipContext(sourceWarehouseRow, targetWarehouseRow) {
  const sourceScope = String(sourceWarehouseRow?.ownership_scope || "CENTRAL").toUpperCase();
  const targetScope = String(targetWarehouseRow?.ownership_scope || "CENTRAL").toUpperCase();
  if (sourceScope !== targetScope) {
    return false;
  }
  const sourceOperatingUnitId = parsePositiveInt(sourceWarehouseRow?.operating_unit_id) || null;
  const targetOperatingUnitId = parsePositiveInt(targetWarehouseRow?.operating_unit_id) || null;
  return sourceOperatingUnitId === targetOperatingUnitId;
}

async function assertItemCardAllowedForTransfer({
  tenantId,
  legalEntityId,
  itemCardId,
  fieldName,
  runQuery,
}) {
  const itemCard = await getItemCardByIdForTenant({
    tenantId,
    itemCardId,
    runQuery,
  });
  const itemCardLegalEntityId = parsePositiveInt(itemCard?.legalEntityId);
  if (itemCardLegalEntityId && itemCardLegalEntityId !== legalEntityId) {
    throw badRequest(`${fieldName} must belong to legalEntityId or be global`);
  }
  if (String(itemCard?.status || "").toUpperCase() !== "ACTIVE") {
    throw badRequest(`${fieldName} must be ACTIVE`);
  }
  return itemCard;
}

async function reserveInventoryTransferNoTx({
  tenantId,
  legalEntityId,
  transferDate,
  runQuery,
}) {
  const fiscalYear = Number(String(transferDate || "").slice(0, 4));
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900) {
    throw badRequest("transferDate must include a valid fiscal year");
  }

  const maxResult = await runQuery(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(transfer_no, '-', -1) AS UNSIGNED)), 0) AS current_max
       FROM inventory_transfers
      WHERE tenant_id = ?
        AND legal_entity_id = ?
        AND transfer_no LIKE ?
      FOR UPDATE`,
    [tenantId, legalEntityId, `TRF-${fiscalYear}-%`]
  );
  const currentMax = Number(maxResult.rows?.[0]?.current_max || 0);
  const nextSequenceNo = currentMax + 1;
  return `TRF-${fiscalYear}-${String(nextSequenceNo).padStart(6, "0")}`.slice(0, 60);
}

async function fetchTransferRowById({
  tenantId,
  transferId,
  runQuery,
}) {
  const result = await runQuery(
    `SELECT
        t.*,
        le.code AS legal_entity_code,
        sw.code AS source_warehouse_code,
        sw.name AS source_warehouse_name,
        tw.code AS target_warehouse_code,
        tw.name AS target_warehouse_name,
        sou.code AS source_operating_unit_code,
        sou.name AS source_operating_unit_name,
        tou.code AS target_operating_unit_code,
        tou.name AS target_operating_unit_name,
        (
          SELECT COUNT(*)
            FROM inventory_transfer_lines tl
           WHERE tl.tenant_id = t.tenant_id
             AND tl.inventory_transfer_id = t.id
        ) AS line_count
       FROM inventory_transfers t
       JOIN legal_entities le
         ON le.tenant_id = t.tenant_id
        AND le.id = t.legal_entity_id
       JOIN inventory_warehouses sw
         ON sw.id = t.source_warehouse_id
       JOIN inventory_warehouses tw
         ON tw.id = t.target_warehouse_id
       LEFT JOIN operating_units sou
         ON sou.tenant_id = t.tenant_id
        AND sou.id = t.source_operating_unit_id
       LEFT JOIN operating_units tou
         ON tou.tenant_id = t.tenant_id
        AND tou.id = t.target_operating_unit_id
      WHERE t.tenant_id = ?
        AND t.id = ?
      LIMIT 1`,
    [tenantId, transferId]
  );
  return Array.isArray(result?.rows) ? result.rows[0] || null : null;
}

async function fetchTransferLinesByTransferId({
  tenantId,
  transferId,
  runQuery,
}) {
  const result = await runQuery(
    `SELECT
        tl.*,
        ic.code AS item_card_code,
        ic.name AS item_card_name
       FROM inventory_transfer_lines tl
       JOIN item_cards ic
         ON ic.id = tl.item_card_id
      WHERE tl.tenant_id = ?
        AND tl.inventory_transfer_id = ?
      ORDER BY tl.line_no ASC, tl.id ASC`,
    [tenantId, transferId]
  );
  return (Array.isArray(result?.rows) ? result.rows : []).map(mapTransferLineRow);
}

async function getTransferDetailRow({
  tenantId,
  transferId,
  runQuery = query,
}) {
  const headerRow = await fetchTransferRowById({
    tenantId,
    transferId,
    runQuery,
  });
  if (!headerRow) {
    throw badRequest("Inventory transfer not found");
  }
  const row = mapTransferRow(headerRow);
  row.lines = await fetchTransferLinesByTransferId({
    tenantId,
    transferId,
    runQuery,
  });
  return row;
}

function normalizeTransferStatus(value, fieldName = "status") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return "";
  }
  if (!TRANSFER_STATUS_VALUES.has(normalized)) {
    throw badRequest(`${fieldName} is invalid`);
  }
  return normalized;
}

export async function resolveInventoryTransferScope(transferId, tenantId, runQuery = query) {
  const normalizedTransferId = parsePositiveInt(transferId);
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTransferId || !normalizedTenantId) {
    return null;
  }
  const row = await fetchTransferRowById({
    tenantId: normalizedTenantId,
    transferId: normalizedTransferId,
    runQuery,
  });
  const legalEntityId = parsePositiveInt(row?.legal_entity_id);
  return legalEntityId
    ? { scopeType: "LEGAL_ENTITY", scopeId: legalEntityId }
    : null;
}

export async function listInventoryTransfers({
  tenantId,
  filters,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  if (!normalizedTenantId) {
    throw badRequest("tenantId is required");
  }

  const legalEntityId = parsePositiveInt(filters?.legalEntityId);
  const status = normalizeTransferStatus(filters?.status);
  const sourceWarehouseId = parsePositiveInt(filters?.sourceWarehouseId);
  const targetWarehouseId = parsePositiveInt(filters?.targetWarehouseId);
  const q = normalizeSqlLikeQuery(filters?.q);
  const limit = Number.isInteger(filters?.limit)
    ? Math.max(1, Math.min(filters.limit, 200))
    : 100;
  const offset =
    Number.isInteger(filters?.offset) && filters.offset >= 0 ? filters.offset : 0;

  const params = [normalizedTenantId];
  let whereSql = "WHERE t.tenant_id = ?";
  if (legalEntityId) {
    whereSql += " AND t.legal_entity_id = ?";
    params.push(legalEntityId);
  }
  if (status) {
    whereSql += " AND t.status = ?";
    params.push(status);
  }
  if (sourceWarehouseId) {
    whereSql += " AND t.source_warehouse_id = ?";
    params.push(sourceWarehouseId);
  }
  if (targetWarehouseId) {
    whereSql += " AND t.target_warehouse_id = ?";
    params.push(targetWarehouseId);
  }
  if (q) {
    whereSql +=
      " AND (t.transfer_no LIKE ? OR sw.code LIKE ? OR sw.name LIKE ? OR tw.code LIKE ? OR tw.name LIKE ?)";
    params.push(q, q, q, q, q);
  }

  const totalResult = await runQuery(
    `SELECT COUNT(*) AS total
       FROM inventory_transfers t
       JOIN inventory_warehouses sw
         ON sw.id = t.source_warehouse_id
       JOIN inventory_warehouses tw
         ON tw.id = t.target_warehouse_id
       ${whereSql}`,
    params
  );
  const total = Number(totalResult?.rows?.[0]?.total || 0);

  const rowsResult = await runQuery(
    `SELECT
        t.*,
        le.code AS legal_entity_code,
        sw.code AS source_warehouse_code,
        sw.name AS source_warehouse_name,
        tw.code AS target_warehouse_code,
        tw.name AS target_warehouse_name,
        sou.code AS source_operating_unit_code,
        sou.name AS source_operating_unit_name,
        tou.code AS target_operating_unit_code,
        tou.name AS target_operating_unit_name,
        (
          SELECT COUNT(*)
            FROM inventory_transfer_lines tl
           WHERE tl.tenant_id = t.tenant_id
             AND tl.inventory_transfer_id = t.id
        ) AS line_count
       FROM inventory_transfers t
       JOIN legal_entities le
         ON le.tenant_id = t.tenant_id
        AND le.id = t.legal_entity_id
       JOIN inventory_warehouses sw
         ON sw.id = t.source_warehouse_id
       JOIN inventory_warehouses tw
         ON tw.id = t.target_warehouse_id
       LEFT JOIN operating_units sou
         ON sou.tenant_id = t.tenant_id
        AND sou.id = t.source_operating_unit_id
       LEFT JOIN operating_units tou
         ON tou.tenant_id = t.tenant_id
        AND tou.id = t.target_operating_unit_id
       ${whereSql}
       ORDER BY t.transfer_date DESC, t.id DESC
       LIMIT ${limit}
       OFFSET ${offset}`,
    params
  );

  return {
    total,
    rows: (Array.isArray(rowsResult?.rows) ? rowsResult.rows : []).map(mapTransferRow),
  };
}

export async function getInventoryTransferById({
  tenantId,
  transferId,
  runQuery = query,
}) {
  const normalizedTenantId = parsePositiveInt(tenantId);
  const normalizedTransferId = parsePositiveInt(transferId);
  if (!normalizedTenantId || !normalizedTransferId) {
    throw badRequest("tenantId and transferId are required");
  }
  return getTransferDetailRow({
    tenantId: normalizedTenantId,
    transferId: normalizedTransferId,
    runQuery,
  });
}

export async function createInventoryTransfer({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const legalEntityId = parsePositiveInt(payload?.legalEntityId);
  const sourceWarehouseId = parsePositiveInt(payload?.sourceWarehouseId);
  const targetWarehouseId = parsePositiveInt(payload?.targetWarehouseId);
  const initiatedByUserId = parsePositiveInt(payload?.userId);
  const transferDate = String(payload?.transferDate || "").trim();
  const linePayloads = Array.isArray(payload?.lines) ? payload.lines : [];
  if (!tenantId || !legalEntityId || !sourceWarehouseId || !targetWarehouseId || !initiatedByUserId) {
    throw badRequest("tenantId, legalEntityId, sourceWarehouseId, targetWarehouseId, and userId are required");
  }
  if (!transferDate) {
    throw badRequest("transferDate is required");
  }
  if (!Array.isArray(linePayloads) || linePayloads.length === 0) {
    throw badRequest("lines must contain at least one transfer line");
  }
  await assertLegalEntityBelongsToTenant(tenantId, legalEntityId, "legalEntityId");

  return withTransaction(async (tx) => {
    const sourceWarehouseRow = await fetchWarehouseContextById({
      tenantId,
      legalEntityId,
      warehouseId: sourceWarehouseId,
      fieldName: "sourceWarehouseId",
      runQuery: tx.query,
    });
    const targetWarehouseRow = await fetchWarehouseContextById({
      tenantId,
      legalEntityId,
      warehouseId: targetWarehouseId,
      fieldName: "targetWarehouseId",
      runQuery: tx.query,
    });
    if (sourceWarehouseId === targetWarehouseId) {
      throw badRequest("sourceWarehouseId and targetWarehouseId must differ");
    }
    if (sameOwnershipContext(sourceWarehouseRow, targetWarehouseRow)) {
      throw badRequest(
        "sourceWarehouseId and targetWarehouseId must belong to different ownership contexts"
      );
    }

    const transferNo = await reserveInventoryTransferNoTx({
      tenantId,
      legalEntityId,
      transferDate,
      runQuery: tx.query,
    });
    const note = normalizeText(payload?.note, 500);
    const idempotencyKey = normalizeText(payload?.idempotencyKey, 100);
    const integrationEventUid = normalizeText(payload?.integrationEventUid, 100);
    const sourceModule = normalizeText(payload?.sourceModule || "INVENTORY", 40, {
      upper: true,
    });
    const sourceEntityType = normalizeText(payload?.sourceEntityType, 60);
    const sourceEntityId = parsePositiveInt(payload?.sourceEntityId);

    const insertResult = await tx.query(
      `INSERT INTO inventory_transfers (
          tenant_id,
          legal_entity_id,
          transfer_no,
          transfer_date,
          status,
          source_warehouse_id,
          target_warehouse_id,
          source_ownership_scope,
          source_operating_unit_id,
          target_ownership_scope,
          target_operating_unit_id,
          initiated_by_user_id,
          source_module,
          source_entity_type,
          source_entity_id,
          idempotency_key,
          integration_event_uid,
          note
       ) VALUES (?, ?, ?, ?, 'INITIATED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        legalEntityId,
        transferNo,
        transferDate,
        sourceWarehouseId,
        targetWarehouseId,
        String(sourceWarehouseRow.ownership_scope || "CENTRAL").toUpperCase(),
        parsePositiveInt(sourceWarehouseRow.operating_unit_id),
        String(targetWarehouseRow.ownership_scope || "CENTRAL").toUpperCase(),
        parsePositiveInt(targetWarehouseRow.operating_unit_id),
        initiatedByUserId,
        sourceModule || "INVENTORY",
        sourceEntityType || null,
        sourceEntityId || null,
        idempotencyKey || null,
        integrationEventUid || null,
        note || null,
      ]
    );
    const transferId = parsePositiveInt(insertResult?.rows?.insertId);
    if (!transferId) {
      throw new Error("Failed to create inventory transfer");
    }

    for (let index = 0; index < linePayloads.length; index += 1) {
      const line = linePayloads[index] || {};
      const itemCardId = parsePositiveInt(line.itemCardId);
      if (!itemCardId) {
        throw badRequest(`lines[${index}].itemCardId is required`);
      }
      await assertItemCardAllowedForTransfer({
        tenantId,
        legalEntityId,
        itemCardId,
        fieldName: `lines[${index}].itemCardId`,
        runQuery: tx.query,
      });
      const quantityRequested = toDecimalString(
        line.quantityRequested,
        `lines[${index}].quantityRequested`
      );
      const lineNote = normalizeText(line.note, 255);

      await tx.query(
        `INSERT INTO inventory_transfer_lines (
            tenant_id,
            legal_entity_id,
            inventory_transfer_id,
            line_no,
            item_card_id,
            quantity_requested,
            note
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          legalEntityId,
          transferId,
          index + 1,
          itemCardId,
          quantityRequested,
          lineNote || null,
        ]
      );
    }

    return getTransferDetailRow({
      tenantId,
      transferId,
      runQuery: tx.query,
    });
  });
}

async function updateTransferStatusTx({
  tenantId,
  transferId,
  userId,
  nextStatus,
  allowedStatuses,
  statusFieldAssignmentsSql,
  statusFieldParams = [],
  runQuery,
}) {
  const existingRow = await fetchTransferRowById({
    tenantId,
    transferId,
    runQuery,
  });
  if (!existingRow) {
    throw badRequest("Inventory transfer not found");
  }
  const currentStatus = String(existingRow.status || "").toUpperCase();
  if (!allowedStatuses.includes(currentStatus)) {
    throw conflict(`Transfer cannot move to ${nextStatus} from status ${currentStatus || "UNKNOWN"}`);
  }

  await runQuery(
    `UPDATE inventory_transfers
        SET status = ?,
            updated_at = CURRENT_TIMESTAMP,
            ${statusFieldAssignmentsSql}
      WHERE tenant_id = ?
        AND id = ?`,
    [nextStatus, ...statusFieldParams, tenantId, transferId]
  );

  return getTransferDetailRow({
    tenantId,
    transferId,
    runQuery,
  });
}

export async function approveInventoryTransferById({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const transferId = parsePositiveInt(payload?.transferId);
  const userId = parsePositiveInt(payload?.userId);
  if (!tenantId || !transferId || !userId) {
    throw badRequest("tenantId, transferId, and userId are required");
  }

  return withTransaction((tx) =>
    updateTransferStatusTx({
      tenantId,
      transferId,
      userId,
      nextStatus: "APPROVED",
      allowedStatuses: ["INITIATED"],
      statusFieldAssignmentsSql: "approved_by_user_id = ?, approved_at = CURRENT_TIMESTAMP",
      statusFieldParams: [userId],
      runQuery: tx.query,
    })
  );
}

export async function cancelInventoryTransferById({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const transferId = parsePositiveInt(payload?.transferId);
  const userId = parsePositiveInt(payload?.userId);
  if (!tenantId || !transferId || !userId) {
    throw badRequest("tenantId, transferId, and userId are required");
  }
  const cancelReason = normalizeText(payload?.cancelReason, 255);

  return withTransaction((tx) =>
    updateTransferStatusTx({
      tenantId,
      transferId,
      userId,
      nextStatus: "CANCELED",
      allowedStatuses: ["INITIATED", "APPROVED"],
      statusFieldAssignmentsSql:
        "canceled_by_user_id = ?, canceled_at = CURRENT_TIMESTAMP, cancel_reason = ?",
      statusFieldParams: [userId, cancelReason || null],
      runQuery: tx.query,
    })
  );
}

async function getTransferStatusOrThrow({ tenantId, transferId, runQuery = query }) {
  const row = await fetchTransferRowById({
    tenantId,
    transferId,
    runQuery,
  });
  if (!row) {
    throw badRequest("Inventory transfer not found");
  }
  return String(row.status || "").toUpperCase();
}

export async function shipInventoryTransferById({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const transferId = parsePositiveInt(payload?.transferId);
  if (!tenantId || !transferId) {
    throw badRequest("tenantId and transferId are required");
  }
  const status = await getTransferStatusOrThrow({ tenantId, transferId });
  if (status !== "APPROVED") {
    throw conflict(`Transfer must be APPROVED before shipment (current status: ${status})`);
  }
  throw conflict("Transfer shipment is scaffolded but not implemented yet");
}

export async function receiveInventoryTransferById({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const transferId = parsePositiveInt(payload?.transferId);
  if (!tenantId || !transferId) {
    throw badRequest("tenantId and transferId are required");
  }
  const status = await getTransferStatusOrThrow({ tenantId, transferId });
  if (status !== "IN_TRANSIT") {
    throw conflict(`Transfer must be IN_TRANSIT before receipt (current status: ${status})`);
  }
  throw conflict("Transfer receipt is scaffolded but not implemented yet");
}

export async function reverseInventoryTransferById({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const transferId = parsePositiveInt(payload?.transferId);
  if (!tenantId || !transferId) {
    throw badRequest("tenantId and transferId are required");
  }
  const status = await getTransferStatusOrThrow({ tenantId, transferId });
  if (status === "CANCELED") {
    throw conflict("Canceled transfer cannot be reversed");
  }
  if (!["IN_TRANSIT", "RECEIVED"].includes(status)) {
    throw conflict(`Transfer cannot be reversed from status ${status}`);
  }
  throw conflict("Transfer reversal is scaffolded but not implemented yet");
}
