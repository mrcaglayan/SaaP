/**
 * Shared journal source-link destination helpers.
 *
 * Implements the prefer-backend / fallback-local contract for:
 *   1. Drillback routing  (source link → clickable path)
 *   2. Reverse-block eval (which journals block direct GL reversal)
 *
 * Backend enrichment (FA06) adds `destination` to each source link and
 * `reverseBlock` to journal detail responses.  When present these are
 * authoritative.  When absent (bulk list endpoints, older API versions)
 * the helpers fall back to a local static registry that mirrors the
 * backend DESTINATION_REGISTRY.
 */

import {
  CASH_TRANSACTION,
  CARI_DOCUMENT,
  CARI_SETTLEMENT_BATCH,
  FIXED_ASSET_TRANSACTION,
  FIXED_ASSET_DEPRECIATION_RUN,
  PAYMENT_BATCH,
  PAYROLL_RUN,
} from "./sourceRefTypes.js";

// ── local fallback registry (mirrors backend DESTINATION_REGISTRY) ───
// Fixed-assets types have fallback routes but prefer backend-owned
// dynamic destinations that include query parameters.
const LOCAL_DESTINATION_REGISTRY = Object.freeze({
  [CARI_DOCUMENT]: "/app/cari-belgeler",
  [CARI_SETTLEMENT_BATCH]: "/app/cari-settlements",
  [CASH_TRANSACTION]: "/app/kasa-islemleri",
  [PAYMENT_BATCH]: "/app/odeme-batchleri",
  [PAYROLL_RUN]: "/app/payroll-runs",
  [FIXED_ASSET_TRANSACTION]: "/app/demirbas",
  [FIXED_ASSET_DEPRECIATION_RUN]: "/app/demirbas-amortisman-islemleri",
});

const LOCAL_REVERSE_BLOCK_SOURCE_TYPES = Object.freeze(
  new Set(Object.keys(LOCAL_DESTINATION_REGISTRY))
);

// Fixed-assets types provide fully-formed URLs from the backend
// (including query params like ?transactionId=...&assetId=...).
// When backend destination.route is present for these types,
// use it directly without further type-specific URL construction.
const BACKEND_OWNED_DESTINATION_TYPES = Object.freeze(
  new Set([FIXED_ASSET_TRANSACTION, FIXED_ASSET_DEPRECIATION_RUN])
);

// ── internal helpers ─────────────────────────────────────────────────

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function parsePositiveIntOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// ── Drillback routing ────────────────────────────────────────────────

/**
 * Resolve the full drillback path for a source link.
 *
 * Prefers backend-provided `destination.route` (from FA06 enrichment);
 * falls back to LOCAL_DESTINATION_REGISTRY when not present.
 *
 * Type-specific URL construction (query params, path segments) is
 * applied on top of the resolved base route.
 */
export function resolveSourceLinkDestination(
  sourceLink,
  settlementDrilldowns = []
) {
  const sourceRefType = normalizeUpperText(
    sourceLink?.source_ref_type || sourceLink?.sourceRefType
  );
  const sourceRefId = parsePositiveIntOrNull(
    sourceLink?.source_ref_id || sourceLink?.sourceRefId
  );
  if (!sourceRefType || !sourceRefId) {
    return null;
  }

  // Resolve base route: prefer backend, fall back to local
  const backendRoute = sourceLink?.destination?.route;
  const baseRoute =
    backendRoute || LOCAL_DESTINATION_REGISTRY[sourceRefType] || null;
  if (!baseRoute) {
    return null;
  }

  // Backend-owned destination types provide fully-formed URLs
  // (e.g. /app/demirbas-karti-detayi/42?tab=transactions&transactionId=123).
  // Use as-is when backend route is present.
  if (backendRoute && BACKEND_OWNED_DESTINATION_TYPES.has(sourceRefType)) {
    return backendRoute;
  }

  // Type-specific URL construction
  if (sourceRefType === "CARI_DOCUMENT") {
    return `${baseRoute}?documentId=${sourceRefId}`;
  }

  if (sourceRefType === "CARI_SETTLEMENT_BATCH") {
    const drilldowns = Array.isArray(settlementDrilldowns)
      ? settlementDrilldowns
      : [];
    const settlement =
      drilldowns.find(
        (row) => parsePositiveIntOrNull(row?.settlementBatchId) === sourceRefId
      ) || null;
    const params = new URLSearchParams({
      settlementBatchId: String(sourceRefId),
    });
    const legalEntityId = parsePositiveIntOrNull(settlement?.legalEntityId);
    const counterpartyId = parsePositiveIntOrNull(settlement?.counterpartyId);
    if (legalEntityId) {
      params.set("legalEntityId", String(legalEntityId));
    }
    if (counterpartyId) {
      params.set("counterpartyId", String(counterpartyId));
    }
    return `${baseRoute}?${params.toString()}`;
  }

  if (sourceRefType === "PAYMENT_BATCH") {
    return `${baseRoute}/${sourceRefId}`;
  }

  // Generic: base route only (e.g. CASH_TRANSACTION, PAYROLL_RUN)
  return baseRoute;
}

// ── Reverse-block evaluation ─────────────────────────────────────────

/**
 * Resolve reverse-block status for a journal.
 *
 * Prefers the backend-provided `reverseBlock` shape (from FA06 enrichment);
 * falls back to local computation from `source_links` when not present.
 *
 * Returns: { isBlocked, blockingSourceLinks, primaryDestination, resolvedDestinations }
 */
export function resolveReverseBlockStatus(journal) {
  // Prefer backend
  if (journal?.reverseBlock) {
    return journal.reverseBlock;
  }

  // Fallback: compute locally from source_links
  const sourceLinks = Array.isArray(journal?.source_links)
    ? journal.source_links
    : [];

  const blockingSourceLinks = sourceLinks
    .map((row) => ({
      sourceRefType: normalizeUpperText(
        row?.source_ref_type || row?.sourceRefType
      ),
      sourceRefId: parsePositiveIntOrNull(
        row?.source_ref_id || row?.sourceRefId
      ),
    }))
    .filter(
      (row) =>
        row.sourceRefType &&
        row.sourceRefId &&
        LOCAL_REVERSE_BLOCK_SOURCE_TYPES.has(row.sourceRefType)
    );

  const isBlocked = blockingSourceLinks.length > 0;

  const primaryLink = blockingSourceLinks[0] || null;
  const primaryDestination = primaryLink
    ? {
        sourceRefType: primaryLink.sourceRefType,
        sourceRefId: primaryLink.sourceRefId,
        route: LOCAL_DESTINATION_REGISTRY[primaryLink.sourceRefType] || null,
      }
    : null;

  const seenRoutes = new Set();
  const resolvedDestinations = [];
  for (const link of blockingSourceLinks) {
    const route = LOCAL_DESTINATION_REGISTRY[link.sourceRefType];
    if (route && !seenRoutes.has(route)) {
      seenRoutes.add(route);
      resolvedDestinations.push({
        sourceRefType: link.sourceRefType,
        route,
      });
    }
  }

  return {
    isBlocked,
    blockingSourceLinks,
    primaryDestination,
    resolvedDestinations,
  };
}

/**
 * Build a localized reverse-block warning message from structured data.
 */
export function formatReverseBlockMessage(reverseBlock, l) {
  if (!reverseBlock?.isBlocked) {
    return "";
  }

  const { blockingSourceLinks = [], resolvedDestinations = [] } = reverseBlock;

  const linkTokens = blockingSourceLinks.map(
    (row) => `${row.sourceRefType}:${row.sourceRefId}`
  );

  const destinationPaths = resolvedDestinations
    .map((d) => d.route)
    .filter(Boolean);

  const destinationSuffix =
    destinationPaths.length > 0
      ? l(
          ` Open from: ${destinationPaths.join(", ")}.`,
          ` Su ekranlardan tersleyin: ${destinationPaths.join(", ")}.`
        )
      : "";

  return l(
    `This journal is linked to subledger record(s) [${linkTokens.join(", ")}]. Reverse from source module, not from Journal Workbench.${destinationSuffix}`,
    `Bu fis alt-defter kayit(lar)ina bagli [${linkTokens.join(", ")}]. Ters kaydi Mahsup ekranindan degil, ilgili kaynak modulden yapin.${destinationSuffix}`
  );
}

/**
 * Extract structured reverseBlock metadata from an API error response.
 * Returns the reverseBlock object or null if not present.
 */
export function extractReverseBlockFromError(err) {
  return err?.response?.data?.details?.reverseBlock || null;
}
