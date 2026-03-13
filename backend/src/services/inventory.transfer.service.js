import { badRequest, parsePositiveInt } from "../routes/_utils.js";
import { query, withTransaction } from "../db.js";
import { assertLegalEntityBelongsToTenant } from "../tenantGuards.js";
import { getItemCardByIdForTenant } from "./item.card.service.js";
import {
  buildIssueValuationPlan,
  fetchLegalEntityBaseCurrencyCode,
  fetchOpenCostLayersForIssue,
  insertPostedJournalWithLinesTx,
  resolveBookAndOpenPeriodForDate,
  resolveInventoryPostingAccount,
} from "./inventory.service.js";
import { upsertJournalSourceLinkTx } from "./journal.source-link.service.js";
import { resolveOuSelfBalancingAccountsTx } from "./ou.self-balancing.service.js";

const TRANSFER_STATUS_VALUES = new Set([
  "INITIATED",
  "APPROVED",
  "IN_TRANSIT",
  "RECEIVED",
  "CANCELED",
  "REVERSED",
]);
const AMOUNT_SCALE = 6;

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

function normalizeUpperText(value, maxLength, { required = false } = {}) {
  return normalizeText(value, maxLength, {
    required,
    upper: true,
  });
}

function normalizeAmount(value, fieldName, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${fieldName} must be numeric`);
  }
  if (allowZero ? parsed < 0 : parsed <= 0) {
    throw badRequest(allowZero ? `${fieldName} must be >= 0` : `${fieldName} must be > 0`);
  }
  return Number(parsed.toFixed(AMOUNT_SCALE));
}

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(AMOUNT_SCALE));
}

function describeTransferItem(itemCard, transferLineRow) {
  return (
    normalizeText(itemCard?.code || "", 80) ||
    normalizeText(itemCard?.name || "", 200) ||
    normalizeText(transferLineRow?.itemCardCode || "", 80) ||
    normalizeText(transferLineRow?.itemCardName || "", 200) ||
    `item #${parsePositiveInt(transferLineRow?.itemCardId) || "?"}`
  );
}

function resolveContextOperatingUnitId(context) {
  return String(context?.type || "").trim().toUpperCase() === "OPERATING_UNIT"
    ? parsePositiveInt(context?.operatingUnitId) || null
    : null;
}

function addGroupedJournalLine(lineMap, line) {
  const accountId = parsePositiveInt(line?.accountId);
  if (!accountId) {
    throw badRequest("Shipment journal line accountId is required");
  }

  const normalized = {
    accountId,
    operatingUnitId: parsePositiveInt(line?.operatingUnitId) || null,
    counterpartyLegalEntityId: parsePositiveInt(line?.counterpartyLegalEntityId) || null,
    description: normalizeText(line?.description, 255) || null,
    subledgerReferenceNo: normalizeText(line?.subledgerReferenceNo, 100) || null,
    currencyCode: normalizeUpperText(line?.currencyCode, 3, { required: true }),
    amountTxn: roundAmount(line?.amountTxn),
    debitBase: roundAmount(line?.debitBase),
    creditBase: roundAmount(line?.creditBase),
    taxCode: normalizeText(line?.taxCode, 40) || null,
  };
  if (normalized.debitBase <= 0 && normalized.creditBase <= 0) {
    return;
  }

  const key = [
    normalized.accountId,
    normalized.operatingUnitId || "",
    normalized.counterpartyLegalEntityId || "",
    normalized.description || "",
    normalized.subledgerReferenceNo || "",
    normalized.currencyCode,
    normalized.taxCode || "",
  ].join("|");

  const existing = lineMap.get(key);
  if (existing) {
    existing.amountTxn = roundAmount(existing.amountTxn + normalized.amountTxn);
    existing.debitBase = roundAmount(existing.debitBase + normalized.debitBase);
    existing.creditBase = roundAmount(existing.creditBase + normalized.creditBase);
    return;
  }
  lineMap.set(key, normalized);
}

async function createTransferShipmentIssueMovementTx(tx, payload) {
  const quantity = normalizeAmount(payload?.quantity, "shipmentQuantity");
  const issueValuationPlan = payload?.issueValuationPlan || null;
  const currencyCode = normalizeUpperText(issueValuationPlan?.currencyCode, 3, {
    required: true,
  });
  const note = normalizeText(payload?.note, 255) || null;

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
        movement_date,
        quantity,
        unit_cost_txn,
        unit_cost_base,
        total_cost_txn,
        total_cost_base,
        currency_code,
        valuation_status,
        note
     ) VALUES (?, ?, ?, ?, 'ISSUE', 'INVENTORY_TRANSFER', NULL, 'INVENTORY_TRANSFER', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.warehouseId,
      payload.itemCardId,
      payload.transferId,
      payload.transferLineId,
      payload.movementDate,
      quantity,
      issueValuationPlan.unitCostTxn,
      issueValuationPlan.unitCostBase,
      issueValuationPlan.totalCostTxn,
      issueValuationPlan.totalCostBase,
      currencyCode,
      note,
    ]
  );
  const movementId = parsePositiveInt(insertResult.rows?.insertId);
  if (!movementId) {
    throw new Error("Transfer shipment issue movement create failed");
  }

  for (const [index, consumption] of (issueValuationPlan?.consumptions || []).entries()) {
    // eslint-disable-next-line no-await-in-loop
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
        payload.tenantId,
        payload.legalEntityId,
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
    // eslint-disable-next-line no-await-in-loop
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

  return movementId;
}

async function consumeTransferShipmentCostLayersTx(tx, payload) {
  const sourceWarehouseRow = {
    id: payload.transferRow.sourceWarehouseId,
    code: payload.transferRow.sourceWarehouseCode,
    name: payload.transferRow.sourceWarehouseName,
  };
  const baseCurrencyCode = await fetchLegalEntityBaseCurrencyCode({
    tenantId: payload.tenantId,
    legalEntityId: payload.legalEntityId,
    runQuery: tx.query,
  });

  const lineResults = [];
  let totalCostBase = 0;

  for (const transferLineRow of payload.transferLineRows || []) {
    const lineNo = Number(transferLineRow?.lineNo || 0);
    if (parsePositiveInt(transferLineRow?.sourceIssueMovementId)) {
      throw conflict(`Transfer line ${lineNo || "?"} has already been shipped`);
    }
    if (normalizeAmount(transferLineRow?.quantityShipped || 0, "quantityShipped", { allowZero: true }) > 0) {
      throw conflict(`Transfer line ${lineNo || "?"} has already been shipped`);
    }

    const itemCard = await assertItemCardAllowedForTransfer({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      itemCardId: transferLineRow.itemCardId,
      fieldName: `lines[${lineNo || "?"}].itemCardId`,
      runQuery: tx.query,
    });
    const itemLabel = describeTransferItem(itemCard, transferLineRow);
    if (normalizeUpperText(itemCard?.itemType, 30) !== "STOCK_ITEM") {
      throw badRequest(
        `Transfer shipment requires STOCK_ITEM item cards; ${itemLabel} is not stock-managed`
      );
    }
    if (!parsePositiveInt(itemCard?.inventoryTransitAccountId)) {
      throw badRequest(
        `Transfer shipment requires inventoryTransitAccountId on item card ${itemLabel}`
      );
    }

    const openLayerRows = await fetchOpenCostLayersForIssue({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      warehouseId: payload.transferRow.sourceWarehouseId,
      itemCardId: transferLineRow.itemCardId,
      runQuery: tx.query,
    });
    const issueValuationPlan = buildIssueValuationPlan({
      openLayerRows,
      quantity: transferLineRow.quantityRequested,
      itemCard,
      warehouseRow: sourceWarehouseRow,
      baseCurrencyCode,
    });
    const inventoryAssetAccount = await resolveInventoryPostingAccount({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      accountId: itemCard?.inventoryAssetAccountId,
      fieldLabel: `inventoryAssetAccountId for ${itemLabel}`,
      runQuery: tx.query,
    });
    const transitAccount = await resolveInventoryPostingAccount({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      accountId: itemCard?.inventoryTransitAccountId,
      fieldLabel: `inventoryTransitAccountId for ${itemLabel}`,
      runQuery: tx.query,
    });
    const quantityRequested = normalizeAmount(
      transferLineRow.quantityRequested,
      `lines[${lineNo || "?"}].quantityRequested`
    );

    const movementId = await createTransferShipmentIssueMovementTx(tx, {
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      warehouseId: payload.transferRow.sourceWarehouseId,
      itemCardId: transferLineRow.itemCardId,
      transferId: payload.transferRow.id,
      transferLineId: transferLineRow.id,
      movementDate: payload.transferRow.transferDate,
      quantity: quantityRequested,
      issueValuationPlan,
      note: `Transfer shipment ${payload.transferRow.transferNo || payload.transferRow.id} line ${
        lineNo || "?"
      }`.slice(0, 255),
    });

    await tx.query(
      `UPDATE inventory_transfer_lines
          SET quantity_shipped = ?,
              shipped_currency_code = ?,
              shipped_unit_cost_txn = ?,
              shipped_unit_cost_base = ?,
              shipped_total_cost_txn = ?,
              shipped_total_cost_base = ?,
              source_issue_movement_id = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND id = ?`,
      [
        quantityRequested,
        issueValuationPlan.currencyCode,
        issueValuationPlan.unitCostTxn,
        issueValuationPlan.unitCostBase,
        issueValuationPlan.totalCostTxn,
        issueValuationPlan.totalCostBase,
        movementId,
        payload.tenantId,
        transferLineRow.id,
      ]
    );

    totalCostBase = roundAmount(totalCostBase + issueValuationPlan.totalCostBase);
    lineResults.push({
      transferLineId: transferLineRow.id,
      lineNo,
      itemCardId: transferLineRow.itemCardId,
      itemLabel,
      quantityShipped: quantityRequested,
      shippedCurrencyCode: issueValuationPlan.currencyCode,
      shippedUnitCostTxn: issueValuationPlan.unitCostTxn,
      shippedUnitCostBase: issueValuationPlan.unitCostBase,
      shippedTotalCostTxn: issueValuationPlan.totalCostTxn,
      shippedTotalCostBase: issueValuationPlan.totalCostBase,
      sourceIssueMovementId: movementId,
      inventoryAssetAccount,
      transitAccount,
      consumptions: issueValuationPlan.consumptions || [],
    });
  }

  return {
    baseCurrencyCode,
    totalCostBase,
    lineResults,
  };
}

async function createTransferShipmentJournalTx(tx, payload) {
  const totalCostBase = roundAmount(payload?.shipmentResult?.totalCostBase);
  if (!(totalCostBase > 0)) {
    throw badRequest("Transfer shipment cost must be greater than zero to post");
  }

  const selfBalancingAccounts = await resolveOuSelfBalancingAccountsTx(tx, {
    tenantId: payload.tenantId,
    legalEntityId: payload.transferRow.legalEntityId,
    sourceOperatingUnitId:
      normalizeUpperText(payload.transferRow.sourceOwnershipScope, 30) === "OPERATING_UNIT"
        ? payload.transferRow.sourceOperatingUnitId
        : null,
    targetOperatingUnitId:
      normalizeUpperText(payload.transferRow.targetOwnershipScope, 30) === "OPERATING_UNIT"
        ? payload.transferRow.targetOperatingUnitId
        : null,
    cache: {
      operatingUnitById: new Map(),
      partnerPairById: new Map(),
    },
  });
  const journalContext = await resolveBookAndOpenPeriodForDate({
    tenantId: payload.tenantId,
    legalEntityId: payload.transferRow.legalEntityId,
    targetDate: payload.transferRow.transferDate,
    runQuery: tx.query,
  });
  const journalCurrencyCode = normalizeUpperText(
    journalContext.baseCurrencyCode || payload.shipmentResult.baseCurrencyCode,
    3,
    { required: true }
  );
  const subledgerReferenceNo = `INVENTORY_TRANSFER:${payload.transferRow.id}`.slice(0, 100);
  const transferRef = payload.transferRow.transferNo || `Transfer #${payload.transferRow.id}`;
  const sourceOperatingUnitId = resolveContextOperatingUnitId(selfBalancingAccounts.sourceContext);
  const targetOperatingUnitId = resolveContextOperatingUnitId(selfBalancingAccounts.targetContext);
  const groupedLines = new Map();

  for (const lineResult of payload.shipmentResult.lineResults || []) {
    const amountBase = roundAmount(lineResult.shippedTotalCostBase);
    if (!(amountBase > 0)) {
      continue;
    }

    addGroupedJournalLine(groupedLines, {
      accountId: lineResult.transitAccount.id,
      operatingUnitId: targetOperatingUnitId,
      description: `Inventory transfer shipment ${transferRef} | DR transit`.slice(0, 255),
      subledgerReferenceNo,
      currencyCode: journalCurrencyCode,
      amountTxn: amountBase,
      debitBase: amountBase,
      creditBase: 0,
    });
    addGroupedJournalLine(groupedLines, {
      accountId: lineResult.inventoryAssetAccount.id,
      operatingUnitId: sourceOperatingUnitId,
      description: `Inventory transfer shipment ${transferRef} | CR inventory`.slice(0, 255),
      subledgerReferenceNo,
      currencyCode: journalCurrencyCode,
      amountTxn: amountBase * -1,
      debitBase: 0,
      creditBase: amountBase,
    });
  }

  addGroupedJournalLine(groupedLines, {
    accountId: selfBalancingAccounts.sourceDueFromAccount.id,
    operatingUnitId: sourceOperatingUnitId,
    description: `Inventory transfer shipment ${transferRef} | DR due from`.slice(0, 255),
    subledgerReferenceNo,
    currencyCode: journalCurrencyCode,
    amountTxn: totalCostBase,
    debitBase: totalCostBase,
    creditBase: 0,
  });
  addGroupedJournalLine(groupedLines, {
    accountId: selfBalancingAccounts.targetDueToAccount.id,
    operatingUnitId: targetOperatingUnitId,
    description: `Inventory transfer shipment ${transferRef} | CR due to`.slice(0, 255),
    subledgerReferenceNo,
    currencyCode: journalCurrencyCode,
    amountTxn: totalCostBase * -1,
    debitBase: 0,
    creditBase: totalCostBase,
  });

  const lines = Array.from(groupedLines.values()).map((line, index) => ({
    ...line,
    lineNo: index + 1,
  }));
  const journalResult = await insertPostedJournalWithLinesTx(tx, {
    tenantId: payload.tenantId,
    legalEntityId: payload.transferRow.legalEntityId,
    bookId: journalContext.bookId,
    fiscalPeriodId: journalContext.fiscalPeriodId,
    journalNo: `INVTSHP-${payload.transferRow.id}`.slice(0, 40),
    entryDate: payload.transferRow.transferDate,
    documentDate: payload.transferRow.transferDate,
    currencyCode: journalCurrencyCode,
    description: `Inventory transfer shipment ${transferRef}`.slice(0, 500),
    referenceNo: `INVENTORY_TRANSFER:${payload.transferRow.id}:SHIP`.slice(0, 100),
    userId: payload.userId,
    lines,
  });

  await upsertJournalSourceLinkTx(tx, {
    tenantId: payload.tenantId,
    legalEntityId: payload.transferRow.legalEntityId,
    journalEntryId: journalResult.journalEntryId,
    sourceRefType: "INVENTORY_TRANSFER",
    sourceRefId: payload.transferRow.id,
    linkRole: "PRIMARY",
  });

  return journalResult;
}

async function createTransferReceiptMovementTx(tx, payload) {
  const quantity = normalizeAmount(payload?.quantity, "receiptQuantity");
  const currencyCode = normalizeUpperText(payload?.currencyCode, 3, {
    required: true,
  });
  const unitCostTxn = normalizeAmount(payload?.unitCostTxn, "receiptUnitCostTxn", {
    allowZero: true,
  });
  const unitCostBase = normalizeAmount(payload?.unitCostBase, "receiptUnitCostBase", {
    allowZero: true,
  });
  const totalCostTxn = normalizeAmount(payload?.totalCostTxn, "receiptTotalCostTxn", {
    allowZero: true,
  });
  const totalCostBase = normalizeAmount(payload?.totalCostBase, "receiptTotalCostBase", {
    allowZero: true,
  });
  const note = normalizeText(payload?.note, 255) || null;

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
        movement_date,
        quantity,
        unit_cost_txn,
        unit_cost_base,
        total_cost_txn,
        total_cost_base,
        currency_code,
        valuation_status,
        note
     ) VALUES (?, ?, ?, ?, 'RECEIPT', 'INVENTORY_TRANSFER', NULL, 'INVENTORY_TRANSFER', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALUED', ?)`,
    [
      payload.tenantId,
      payload.legalEntityId,
      payload.warehouseId,
      payload.itemCardId,
      payload.transferId,
      payload.transferLineId,
      payload.movementDate,
      quantity,
      unitCostTxn,
      unitCostBase,
      totalCostTxn,
      totalCostBase,
      currencyCode,
      note,
    ]
  );
  const movementId = parsePositiveInt(insertResult.rows?.insertId);
  if (!movementId) {
    throw new Error("Transfer receipt movement create failed");
  }

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
      payload.tenantId,
      payload.legalEntityId,
      payload.warehouseId,
      payload.itemCardId,
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

  return movementId;
}

async function materializeTransferReceiptTx(tx, payload) {
  const lineResults = [];
  let totalCostBase = 0;

  for (const transferLineRow of payload.transferLineRows || []) {
    const lineNo = Number(transferLineRow?.lineNo || 0);
    if (parsePositiveInt(transferLineRow?.targetReceiptMovementId)) {
      throw conflict(`Transfer line ${lineNo || "?"} has already been received`);
    }
    if (
      normalizeAmount(transferLineRow?.quantityReceived || 0, "quantityReceived", {
        allowZero: true,
      }) > 0
    ) {
      throw conflict(`Transfer line ${lineNo || "?"} has already been received`);
    }

    const quantityRequested = normalizeAmount(
      transferLineRow.quantityRequested,
      `lines[${lineNo || "?"}].quantityRequested`
    );
    const quantityShipped = normalizeAmount(
      transferLineRow.quantityShipped,
      `lines[${lineNo || "?"}].quantityShipped`
    );
    if (Math.abs(quantityRequested - quantityShipped) > 0.000001) {
      throw conflict(`Transfer line ${lineNo || "?"} is not fully shipped for receipt`);
    }
    if (!parsePositiveInt(transferLineRow?.sourceIssueMovementId)) {
      throw conflict(`Transfer line ${lineNo || "?"} has no source shipment movement`);
    }

    const itemCard = await assertItemCardAllowedForTransfer({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      itemCardId: transferLineRow.itemCardId,
      fieldName: `lines[${lineNo || "?"}].itemCardId`,
      runQuery: tx.query,
    });
    const itemLabel = describeTransferItem(itemCard, transferLineRow);
    if (normalizeUpperText(itemCard?.itemType, 30) !== "STOCK_ITEM") {
      throw badRequest(
        `Transfer receipt requires STOCK_ITEM item cards; ${itemLabel} is not stock-managed`
      );
    }

    const shippedCurrencyCode = normalizeUpperText(
      transferLineRow.shippedCurrencyCode,
      3,
      { required: true }
    );
    const shippedUnitCostTxn = normalizeAmount(
      transferLineRow.shippedUnitCostTxn,
      `lines[${lineNo || "?"}].shippedUnitCostTxn`,
      { allowZero: true }
    );
    const shippedUnitCostBase = normalizeAmount(
      transferLineRow.shippedUnitCostBase,
      `lines[${lineNo || "?"}].shippedUnitCostBase`,
      { allowZero: true }
    );
    const shippedTotalCostTxn = normalizeAmount(
      transferLineRow.shippedTotalCostTxn,
      `lines[${lineNo || "?"}].shippedTotalCostTxn`,
      { allowZero: true }
    );
    const shippedTotalCostBase = normalizeAmount(
      transferLineRow.shippedTotalCostBase,
      `lines[${lineNo || "?"}].shippedTotalCostBase`,
      { allowZero: true }
    );

    const inventoryAssetAccount = await resolveInventoryPostingAccount({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      accountId: itemCard?.inventoryAssetAccountId,
      fieldLabel: `inventoryAssetAccountId for ${itemLabel}`,
      runQuery: tx.query,
    });
    const transitAccount = await resolveInventoryPostingAccount({
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      accountId: itemCard?.inventoryTransitAccountId,
      fieldLabel: `inventoryTransitAccountId for ${itemLabel}`,
      runQuery: tx.query,
    });

    const movementId = await createTransferReceiptMovementTx(tx, {
      tenantId: payload.tenantId,
      legalEntityId: payload.legalEntityId,
      warehouseId: payload.transferRow.targetWarehouseId,
      itemCardId: transferLineRow.itemCardId,
      transferId: payload.transferRow.id,
      transferLineId: transferLineRow.id,
      movementDate: payload.transferRow.transferDate,
      quantity: quantityShipped,
      currencyCode: shippedCurrencyCode,
      unitCostTxn: shippedUnitCostTxn,
      unitCostBase: shippedUnitCostBase,
      totalCostTxn: shippedTotalCostTxn,
      totalCostBase: shippedTotalCostBase,
      note: `Transfer receipt ${payload.transferRow.transferNo || payload.transferRow.id} line ${
        lineNo || "?"
      }`.slice(0, 255),
    });

    await tx.query(
      `UPDATE inventory_transfer_lines
          SET quantity_received = ?,
              target_receipt_movement_id = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND id = ?`,
      [quantityShipped, movementId, payload.tenantId, transferLineRow.id]
    );

    totalCostBase = roundAmount(totalCostBase + shippedTotalCostBase);
    lineResults.push({
      transferLineId: transferLineRow.id,
      lineNo,
      itemCardId: transferLineRow.itemCardId,
      itemLabel,
      quantityReceived: quantityShipped,
      receiptCurrencyCode: shippedCurrencyCode,
      receiptUnitCostTxn: shippedUnitCostTxn,
      receiptUnitCostBase: shippedUnitCostBase,
      receiptTotalCostTxn: shippedTotalCostTxn,
      receiptTotalCostBase: shippedTotalCostBase,
      targetReceiptMovementId: movementId,
      inventoryAssetAccount,
      transitAccount,
    });
  }

  return {
    totalCostBase,
    lineResults,
  };
}

async function createTransferReceiptJournalTx(tx, payload) {
  const totalCostBase = roundAmount(payload?.receiptResult?.totalCostBase);
  if (!(totalCostBase > 0)) {
    throw badRequest("Transfer receipt cost must be greater than zero to post");
  }

  const journalContext = await resolveBookAndOpenPeriodForDate({
    tenantId: payload.tenantId,
    legalEntityId: payload.transferRow.legalEntityId,
    targetDate: payload.transferRow.transferDate,
    runQuery: tx.query,
  });
  const journalCurrencyCode = normalizeUpperText(journalContext.baseCurrencyCode, 3, {
    required: true,
  });
  const targetOperatingUnitId =
    normalizeUpperText(payload.transferRow.targetOwnershipScope, 30) === "OPERATING_UNIT"
      ? parsePositiveInt(payload.transferRow.targetOperatingUnitId)
      : null;
  const subledgerReferenceNo = `INVENTORY_TRANSFER:${payload.transferRow.id}`.slice(0, 100);
  const transferRef = payload.transferRow.transferNo || `Transfer #${payload.transferRow.id}`;
  const groupedLines = new Map();

  for (const lineResult of payload.receiptResult.lineResults || []) {
    const amountBase = roundAmount(lineResult.receiptTotalCostBase);
    if (!(amountBase > 0)) {
      continue;
    }

    addGroupedJournalLine(groupedLines, {
      accountId: lineResult.inventoryAssetAccount.id,
      operatingUnitId: targetOperatingUnitId,
      description: `Inventory transfer receipt ${transferRef} | DR inventory`.slice(0, 255),
      subledgerReferenceNo,
      currencyCode: journalCurrencyCode,
      amountTxn: amountBase,
      debitBase: amountBase,
      creditBase: 0,
    });
    addGroupedJournalLine(groupedLines, {
      accountId: lineResult.transitAccount.id,
      operatingUnitId: targetOperatingUnitId,
      description: `Inventory transfer receipt ${transferRef} | CR transit`.slice(0, 255),
      subledgerReferenceNo,
      currencyCode: journalCurrencyCode,
      amountTxn: amountBase * -1,
      debitBase: 0,
      creditBase: amountBase,
    });
  }

  const lines = Array.from(groupedLines.values()).map((line, index) => ({
    ...line,
    lineNo: index + 1,
  }));
  const journalResult = await insertPostedJournalWithLinesTx(tx, {
    tenantId: payload.tenantId,
    legalEntityId: payload.transferRow.legalEntityId,
    bookId: journalContext.bookId,
    fiscalPeriodId: journalContext.fiscalPeriodId,
    journalNo: `INVTRCV-${payload.transferRow.id}`.slice(0, 40),
    entryDate: payload.transferRow.transferDate,
    documentDate: payload.transferRow.transferDate,
    currencyCode: journalCurrencyCode,
    description: `Inventory transfer receipt ${transferRef}`.slice(0, 500),
    referenceNo: `INVENTORY_TRANSFER:${payload.transferRow.id}:RECEIPT`.slice(0, 100),
    userId: payload.userId,
    lines,
  });

  await upsertJournalSourceLinkTx(tx, {
    tenantId: payload.tenantId,
    legalEntityId: payload.transferRow.legalEntityId,
    journalEntryId: journalResult.journalEntryId,
    sourceRefType: "INVENTORY_TRANSFER",
    sourceRefId: payload.transferRow.id,
    linkRole: "PRIMARY",
  });

  return journalResult;
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
  forUpdate = false,
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
      LIMIT 1${forUpdate ? "\n      FOR UPDATE" : ""}`,
    [tenantId, transferId]
  );
  return Array.isArray(result?.rows) ? result.rows[0] || null : null;
}

async function fetchTransferLinesByTransferId({
  tenantId,
  transferId,
  runQuery,
  forUpdate = false,
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
      ORDER BY tl.line_no ASC, tl.id ASC${forUpdate ? "\n      FOR UPDATE" : ""}`,
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
    forUpdate: true,
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
  const userId = parsePositiveInt(payload?.userId);
  if (!tenantId || !transferId || !userId) {
    throw badRequest("tenantId, transferId, and userId are required");
  }

  return withTransaction(async (tx) => {
    const lockedHeaderRow = await fetchTransferRowById({
      tenantId,
      transferId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!lockedHeaderRow) {
      throw badRequest("Inventory transfer not found");
    }
    const transferRow = mapTransferRow(lockedHeaderRow);
    const status = normalizeTransferStatus(transferRow?.status);
    if (status !== "APPROVED") {
      throw conflict(`Transfer must be APPROVED before shipment (current status: ${status})`);
    }
    if (transferRow.shipmentJournalEntryId || transferRow.inTransitAt || transferRow.shippedByUserId) {
      throw conflict("Transfer shipment is already posted or in progress");
    }

    const transferLineRows = await fetchTransferLinesByTransferId({
      tenantId,
      transferId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (transferLineRows.length === 0) {
      throw badRequest("Inventory transfer must contain at least one line before shipment");
    }

    const shipmentResult = await consumeTransferShipmentCostLayersTx(tx, {
      tenantId,
      legalEntityId: transferRow.legalEntityId,
      transferRow,
      transferLineRows,
    });
    const shipmentJournal = await createTransferShipmentJournalTx(tx, {
      tenantId,
      userId,
      transferRow,
      shipmentResult,
    });

    await tx.query(
      `UPDATE inventory_transfers
          SET shipment_journal_entry_id = ?,
              status = 'IN_TRANSIT',
              shipped_by_user_id = ?,
              in_transit_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND id = ?`,
      [shipmentJournal.journalEntryId, userId, tenantId, transferId]
    );

    return getTransferDetailRow({
      tenantId,
      transferId,
      runQuery: tx.query,
    });
  });
}

export async function receiveInventoryTransferById({
  payload,
}) {
  const tenantId = parsePositiveInt(payload?.tenantId);
  const transferId = parsePositiveInt(payload?.transferId);
  const userId = parsePositiveInt(payload?.userId);
  if (!tenantId || !transferId || !userId) {
    throw badRequest("tenantId, transferId, and userId are required");
  }

  return withTransaction(async (tx) => {
    const lockedHeaderRow = await fetchTransferRowById({
      tenantId,
      transferId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (!lockedHeaderRow) {
      throw badRequest("Inventory transfer not found");
    }
    const transferRow = mapTransferRow(lockedHeaderRow);
    const status = normalizeTransferStatus(transferRow?.status);
    if (status !== "IN_TRANSIT") {
      throw conflict(`Transfer must be IN_TRANSIT before receipt (current status: ${status})`);
    }
    if (transferRow.receiptJournalEntryId || transferRow.receivedAt || transferRow.receivedByUserId) {
      throw conflict("Transfer receipt is already posted or in progress");
    }
    if (!parsePositiveInt(transferRow.shipmentJournalEntryId)) {
      throw conflict("Transfer receipt requires a posted shipment journal");
    }

    const transferLineRows = await fetchTransferLinesByTransferId({
      tenantId,
      transferId,
      runQuery: tx.query,
      forUpdate: true,
    });
    if (transferLineRows.length === 0) {
      throw badRequest("Inventory transfer must contain at least one line before receipt");
    }

    const receiptResult = await materializeTransferReceiptTx(tx, {
      tenantId,
      legalEntityId: transferRow.legalEntityId,
      transferRow,
      transferLineRows,
    });
    const receiptJournal = await createTransferReceiptJournalTx(tx, {
      tenantId,
      userId,
      transferRow,
      receiptResult,
    });

    await tx.query(
      `UPDATE inventory_transfers
          SET receipt_journal_entry_id = ?,
              status = 'RECEIVED',
              received_by_user_id = ?,
              received_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
          AND id = ?`,
      [receiptJournal.journalEntryId, userId, tenantId, transferId]
    );

    return getTransferDetailRow({
      tenantId,
      transferId,
      runQuery: tx.query,
    });
  });
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
