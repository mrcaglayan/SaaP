function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Format fixed-asset transaction labels so retro-correction child rows render
 * with explicit true-up vs owner-move wording across detail, disposals, and
 * report surfaces.
 */
export function formatFixedAssetTransactionDisplayLabel(
  transactionType,
  sourceRefType,
  fallbackDisplayLabel = ""
) {
  const normalizedTransactionType = normalizeUpperText(transactionType);
  const normalizedSourceRefType = normalizeUpperText(sourceRefType);
  const normalizedFallback = String(fallbackDisplayLabel || "").trim();

  if (normalizedTransactionType === "RETRO_OWNERSHIP_CORRECTION") {
    if (normalizedSourceRefType === "RETRO_CORRECTION_TRUE_UP") {
      return "Retro Ownership Correction - True-up";
    }
    if (normalizedSourceRefType === "RETRO_CORRECTION_OWNER_MOVE") {
      return "Retro Ownership Correction - Owner Move";
    }
  }

  return normalizedFallback || String(transactionType || "").trim() || "-";
}

/**
 * Identify Track 43 retro-correction transaction rows so frontend tables can
 * add grouped visual treatment without inferring from labels alone.
 */
export function isRetroOwnershipCorrectionTransaction(transactionType) {
  return normalizeUpperText(transactionType) === "RETRO_OWNERSHIP_CORRECTION";
}
