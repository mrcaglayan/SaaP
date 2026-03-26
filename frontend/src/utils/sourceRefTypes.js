/**
 * Frontend-consumable source-ref type constants.
 *
 * Mirrors backend/src/utils/source-ref-types.js so that UI components
 * performing journal drillback, evidence display, or reverse-block
 * rendering use the same canonical strings as the API layer.
 */

// ── existing repo source-ref types ──────────────────────────────────
export const CASH_TRANSACTION = "CASH_TRANSACTION";
export const CARI_DOCUMENT = "CARI_DOCUMENT";
export const CARI_SETTLEMENT_BATCH = "CARI_SETTLEMENT_BATCH";
export const PAYMENT_BATCH = "PAYMENT_BATCH";
export const PAYROLL_RUN = "PAYROLL_RUN";
export const INVENTORY_MOVEMENT = "INVENTORY_MOVEMENT";
export const INVENTORY_TRANSFER = "INVENTORY_TRANSFER";
export const STOCK_LANDED_COST_VOUCHER = "STOCK_LANDED_COST_VOUCHER";

// ── fixed-assets source-ref types ───────────────────────────────────
export const FIXED_ASSET = "FIXED_ASSET";
export const FIXED_ASSET_TRANSACTION = "FIXED_ASSET_TRANSACTION";
export const FIXED_ASSET_DEPRECIATION_RUN = "FIXED_ASSET_DEPRECIATION_RUN";

/**
 * Frozen lookup set of all registered source-ref types.
 */
export const SOURCE_REF_TYPES = Object.freeze(
  new Set([
    CASH_TRANSACTION,
    CARI_DOCUMENT,
    CARI_SETTLEMENT_BATCH,
    PAYMENT_BATCH,
    PAYROLL_RUN,
    INVENTORY_MOVEMENT,
    INVENTORY_TRANSFER,
    STOCK_LANDED_COST_VOUCHER,
    FIXED_ASSET,
    FIXED_ASSET_TRANSACTION,
    FIXED_ASSET_DEPRECIATION_RUN,
  ])
);
