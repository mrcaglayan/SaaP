/**
 * Canonical lifecycle status values shared across modules that previously used
 * mixed cancelled spellings in active runtime paths.
 */

export const LIFECYCLE_STATUS_CANCELLED = "CANCELLED";

export const CASH_TRANSIT_TRANSFER_STATUS_VALUES = Object.freeze([
  "INITIATED",
  "IN_TRANSIT",
  "RECEIVED",
  LIFECYCLE_STATUS_CANCELLED,
  "REVERSED",
]);

export const INVENTORY_TRANSFER_STATUS_VALUES = Object.freeze([
  "INITIATED",
  "APPROVED",
  "IN_TRANSIT",
  "RECEIVED",
  LIFECYCLE_STATUS_CANCELLED,
  "REVERSED",
]);

export const STOCK_LANDED_COST_VOUCHER_STATUS_VALUES = Object.freeze([
  "DRAFT",
  "POSTED",
  "REVERSED",
  LIFECYCLE_STATUS_CANCELLED,
]);

export const STOCK_LANDED_COST_VOUCHER_UI_STATUS_VALUES = Object.freeze([
  ...STOCK_LANDED_COST_VOUCHER_STATUS_VALUES,
  "REVERSAL_BLOCKED",
]);

/**
 * Returns true when the provided lifecycle status is the canonical CANCELLED value.
 *
 * @param {unknown} value lifecycle status candidate
 * @returns {boolean} whether the lifecycle status is CANCELLED
 */
export function isCancelledLifecycleStatus(value) {
  return String(value || "").trim().toUpperCase() === LIFECYCLE_STATUS_CANCELLED;
}
