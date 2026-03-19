/**
 * Canonical source-ref type constants.
 *
 * Every module that writes journal source links or evidence references
 * should import its source-ref type from here instead of using ad-hoc
 * string literals.  This registry is the single source of truth that
 * journal drillback, evidence resolution, and reverse-block logic
 * depend on.
 */

// ── existing repo source-ref types (registry canonical form) ────────
export const CASH_TRANSACTION = "CASH_TRANSACTION";
export const CARI_DOCUMENT = "CARI_DOCUMENT";
export const CARI_SETTLEMENT_BATCH = "CARI_SETTLEMENT_BATCH";
export const INVENTORY_TRANSFER = "INVENTORY_TRANSFER";

// ── fixed-assets source-ref types ───────────────────────────────────
export const FIXED_ASSET = "FIXED_ASSET";
export const FIXED_ASSET_TRANSACTION = "FIXED_ASSET_TRANSACTION";
export const FIXED_ASSET_DEPRECIATION_RUN = "FIXED_ASSET_DEPRECIATION_RUN";

/**
 * Frozen lookup set of all registered source-ref types.
 * Useful for validation without importing individual constants.
 */
export const SOURCE_REF_TYPES = Object.freeze(
  new Set([
    CASH_TRANSACTION,
    CARI_DOCUMENT,
    CARI_SETTLEMENT_BATCH,
    INVENTORY_TRANSFER,
    FIXED_ASSET,
    FIXED_ASSET_TRANSACTION,
    FIXED_ASSET_DEPRECIATION_RUN,
  ])
);
