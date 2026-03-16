import { parsePositiveInt } from "../routes/_utils.js";
import {
  deriveDocumentOwnershipContext,
  deriveWarehouseOwnershipContext,
  sameOwnershipContext,
} from "./ownership.context.policy.service.js";

export const STOCK_LINK_QUEUE_STATE_READY = "READY";
export const STOCK_LINK_QUEUE_STATE_BLOCKED = "BLOCKED";
export const STOCK_LINK_QUEUE_STATE_REPAIR_REQUIRED = "REPAIR_REQUIRED";
export const STOCK_LINK_QUEUE_STATE_TRANSFER_REQUIRED = "TRANSFER_REQUIRED";
export const STOCK_LINK_QUEUE_STATE_COMPLETED = "COMPLETED";
export const STOCK_LINK_QUEUE_STATE_VOID = "VOID";

export const STOCK_LINK_BLOCKED_REASON_BOUND_WAREHOUSE_MISSING =
  "BOUND_WAREHOUSE_MISSING";
export const STOCK_LINK_BLOCKED_REASON_BOUND_WAREHOUSE_INACTIVE =
  "BOUND_WAREHOUSE_INACTIVE";
export const STOCK_LINK_BLOCKED_REASON_BOUND_WAREHOUSE_CONTEXT_MISMATCH =
  "BOUND_WAREHOUSE_CONTEXT_MISMATCH";
export const STOCK_LINK_BLOCKED_REASON_INSUFFICIENT_BOUND_WAREHOUSE_STOCK =
  "INSUFFICIENT_BOUND_WAREHOUSE_STOCK";

export const STOCK_LINK_REPAIR_REASON_LEGACY_UNBOUND_STOCK_LINK =
  "LEGACY_UNBOUND_STOCK_LINK";
export const STOCK_LINK_REPAIR_REASON_SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID =
  "SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID";

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveStockLinkReadState(row) {
  const linkStatus = normalizeUpperText(row?.linkStatus ?? row?.link_status);
  const stockImpactMode = normalizeUpperText(row?.stockImpactMode ?? row?.stock_impact_mode);
  const reopenedFromStockLinkId = parsePositiveInt(
    row?.reopenedFromStockLinkId ?? row?.reopened_from_stock_link_id
  );
  const boundWarehouseId = parsePositiveInt(
    row?.boundWarehouseId ?? row?.bound_warehouse_id ?? row?.warehouse_id
  );
  const boundWarehouseStatus = normalizeUpperText(
    row?.boundWarehouseStatus ?? row?.bound_warehouse_status ?? row?.warehouse_status
  );
  const documentContext = deriveDocumentOwnershipContext(row);
  const warehouseContext = deriveWarehouseOwnershipContext(row, {
    ownershipScopeField: "bound_warehouse_ownership_scope",
    operatingUnitIdField: "bound_warehouse_operating_unit_id",
    operatingUnitCodeField: "bound_warehouse_operating_unit_code",
    operatingUnitNameField: "bound_warehouse_operating_unit_name",
  });
  const requestedQuantity = normalizeAmount(row?.requestedQuantity ?? row?.requested_quantity);
  const boundAvailableQuantity = normalizeAmount(
    row?.boundAvailableQuantity ?? row?.bound_available_quantity
  );
  const crossContextAvailableQuantity = normalizeAmount(
    row?.crossContextAvailableQuantity ?? row?.cross_context_available_quantity
  );
  const isLegacyRow = !boundWarehouseId;
  const isStrictMode = !isLegacyRow;
  const successorInheritanceStatus = reopenedFromStockLinkId
    ? isLegacyRow
      ? "REPAIR_ONLY"
      : "INHERITED"
    : null;

  if (linkStatus === "VOID") {
    return {
      queueState: STOCK_LINK_QUEUE_STATE_VOID,
      blockedReasonCode: null,
      repairReasonCode: null,
      successorInheritanceStatus,
      canMaterialize: false,
      isStrictMode,
      isRepairOnly: false,
      isLegacyRow,
    };
  }

  if (linkStatus === "LINKED") {
    return {
      queueState: STOCK_LINK_QUEUE_STATE_COMPLETED,
      blockedReasonCode: null,
      repairReasonCode: null,
      successorInheritanceStatus,
      canMaterialize: false,
      isStrictMode,
      isRepairOnly: false,
      isLegacyRow,
    };
  }

  if (!boundWarehouseId) {
    return {
      queueState: STOCK_LINK_QUEUE_STATE_REPAIR_REQUIRED,
      blockedReasonCode: null,
      repairReasonCode: reopenedFromStockLinkId
        ? STOCK_LINK_REPAIR_REASON_SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID
        : STOCK_LINK_REPAIR_REASON_LEGACY_UNBOUND_STOCK_LINK,
      successorInheritanceStatus,
      canMaterialize: false,
      isStrictMode: false,
      isRepairOnly: true,
      isLegacyRow: true,
    };
  }

  if (!boundWarehouseStatus) {
    return {
      queueState: STOCK_LINK_QUEUE_STATE_BLOCKED,
      blockedReasonCode: STOCK_LINK_BLOCKED_REASON_BOUND_WAREHOUSE_MISSING,
      repairReasonCode: null,
      successorInheritanceStatus,
      canMaterialize: false,
      isStrictMode,
      isRepairOnly: false,
      isLegacyRow,
    };
  }

  if (boundWarehouseStatus !== "ACTIVE") {
    return {
      queueState: STOCK_LINK_QUEUE_STATE_BLOCKED,
      blockedReasonCode: STOCK_LINK_BLOCKED_REASON_BOUND_WAREHOUSE_INACTIVE,
      repairReasonCode: null,
      successorInheritanceStatus,
      canMaterialize: false,
      isStrictMode,
      isRepairOnly: false,
      isLegacyRow,
    };
  }

  if (!sameOwnershipContext(warehouseContext, documentContext)) {
    return {
      queueState: STOCK_LINK_QUEUE_STATE_BLOCKED,
      blockedReasonCode: STOCK_LINK_BLOCKED_REASON_BOUND_WAREHOUSE_CONTEXT_MISMATCH,
      repairReasonCode: null,
      successorInheritanceStatus,
      canMaterialize: false,
      isStrictMode,
      isRepairOnly: false,
      isLegacyRow,
    };
  }

  if (
    stockImpactMode === "ISSUE_PENDING" &&
    requestedQuantity !== null &&
    boundAvailableQuantity !== null &&
    boundAvailableQuantity + 0.000001 < requestedQuantity
  ) {
    if ((crossContextAvailableQuantity || 0) > 0.000001) {
      return {
        queueState: STOCK_LINK_QUEUE_STATE_TRANSFER_REQUIRED,
        blockedReasonCode: null,
        repairReasonCode: null,
        successorInheritanceStatus,
        canMaterialize: false,
        isStrictMode,
        isRepairOnly: false,
        isLegacyRow,
      };
    }
    return {
      queueState: STOCK_LINK_QUEUE_STATE_BLOCKED,
      blockedReasonCode: STOCK_LINK_BLOCKED_REASON_INSUFFICIENT_BOUND_WAREHOUSE_STOCK,
      repairReasonCode: null,
      successorInheritanceStatus,
      canMaterialize: false,
      isStrictMode,
      isRepairOnly: false,
      isLegacyRow,
    };
  }

  return {
    queueState: STOCK_LINK_QUEUE_STATE_READY,
    blockedReasonCode: null,
    repairReasonCode: null,
    successorInheritanceStatus,
    canMaterialize: true,
    isStrictMode,
    isRepairOnly: false,
    isLegacyRow,
  };
}
