/**
 * Reverse-block destination resolver.
 *
 * Single owner of:
 *   1. Source-link → frontend destination mapping (drillback routes).
 *   2. Reverse-block evaluation (which source types block direct GL reversal).
 *   3. Structured reverse-block metadata for API responses.
 *
 * This service replaces the static route-hint constants that were previously
 * embedded in gl.write.journal.routes.js and becomes the extension point for
 * future dynamic resolution (e.g. fixed-assets asset-register drillback).
 */

import {
  CASH_TRANSACTION,
  CARI_DOCUMENT,
  CARI_SETTLEMENT_BATCH,
  FIXED_ASSET_TRANSACTION,
  FIXED_ASSET_DEPRECIATION_RUN,
  PAYMENT_BATCH,
  PAYROLL_RUN,
  STOCK_LANDED_COST_VOUCHER,
} from "../utils/source-ref-types.js";
import { parsePositiveInt } from "../routes/_utils.js";
import { query } from "../db.js";

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

// ── Destination registry ──────────────────────────────────────────────
// Maps source-ref types to their frontend drillback routes.
// Types listed here also block direct GL journal reversal — the journal
// must be reversed through the owning module instead.
//
// Static entries resolve synchronously. Dynamic entries (fixed-assets, CARI)
// require a DB lookup and are resolved via resolveDestinationAsync().
const DESTINATION_REGISTRY = Object.freeze({
  [CASH_TRANSACTION]: { route: "/app/kasa-islemleri" },
  [PAYMENT_BATCH]: { route: "/app/odeme-batchleri" },
  [PAYROLL_RUN]: { route: "/app/payroll-runs" },
});

// Types that require dynamic (async) destination resolution.
const DYNAMIC_DESTINATION_TYPES = Object.freeze(
  new Set([
    CARI_DOCUMENT,
    CARI_SETTLEMENT_BATCH,
    FIXED_ASSET_TRANSACTION,
    FIXED_ASSET_DEPRECIATION_RUN,
    STOCK_LANDED_COST_VOUCHER,
  ])
);

const REVERSE_BLOCK_SOURCE_TYPES = Object.freeze(
  new Set([...Object.keys(DESTINATION_REGISTRY), ...DYNAMIC_DESTINATION_TYPES])
);

// ── Dynamic destination resolvers ────────────────────────────────────

const FA_TRANSACTION_SALE_WRITEOFF_TYPES = new Set(["SALE", "WRITEOFF"]);

function normalizeCariDirection(value) {
  return normalizeUpperText(value) === "AR" ? "AR" : "AP";
}

function buildCariDocumentRoute(direction, sourceRefId) {
  const parsedId = parsePositiveInt(sourceRefId);
  const baseRoute =
    normalizeCariDirection(direction) === "AR"
      ? "/app/satis-faturalari"
      : "/app/alis-faturalari";
  return parsedId ? `${baseRoute}?documentId=${parsedId}` : baseRoute;
}

function buildCariSettlementBatchRoute({
  direction,
  settlementBatchId,
  legalEntityId = null,
  counterpartyId = null,
} = {}) {
  const parsedSettlementBatchId = parsePositiveInt(settlementBatchId);
  const baseRoute =
    normalizeCariDirection(direction) === "AR"
      ? "/app/musteri-tahsilatlar"
      : "/app/tedarikci-odemeler";
  if (!parsedSettlementBatchId) {
    return baseRoute;
  }
  const params = new URLSearchParams({
    settlementBatchId: String(parsedSettlementBatchId),
  });
  const parsedLegalEntityId = parsePositiveInt(legalEntityId);
  const parsedCounterpartyId = parsePositiveInt(counterpartyId);
  if (parsedLegalEntityId) {
    params.set("legalEntityId", String(parsedLegalEntityId));
  }
  if (parsedCounterpartyId) {
    params.set("counterpartyId", String(parsedCounterpartyId));
  }
  return `${baseRoute}?${params.toString()}`;
}

async function resolveCariDocumentDestination(sourceRefId) {
  const id = parsePositiveInt(sourceRefId);
  if (!id) {
    return { route: buildCariDocumentRoute("AP", null), isFallback: true };
  }

  const result = await query(
    `SELECT direction
       FROM cari_documents
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  const row = result.rows?.[0];
  if (!row) {
    return { route: buildCariDocumentRoute("AP", id), isFallback: true };
  }

  return {
    route: buildCariDocumentRoute(row.direction, id),
  };
}

async function resolveCariSettlementBatchDestination(sourceRefId) {
  const id = parsePositiveInt(sourceRefId);
  if (!id) {
    return {
      route: buildCariSettlementBatchRoute({ direction: "AP" }),
      isFallback: true,
    };
  }

  const result = await query(
    `SELECT direction, legal_entity_id, counterparty_id
       FROM cari_settlement_batches
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  const row = result.rows?.[0];
  if (!row) {
    return {
      route: buildCariSettlementBatchRoute({
        direction: "AP",
        settlementBatchId: id,
      }),
      isFallback: true,
    };
  }

  return {
    route: buildCariSettlementBatchRoute({
      direction: row.direction,
      settlementBatchId: id,
      legalEntityId: row.legal_entity_id,
      counterpartyId: row.counterparty_id,
    }),
  };
}

async function resolveFixedAssetTransactionDestination(sourceRefId) {
  const id = parsePositiveInt(sourceRefId);
  if (!id) return { route: "/app/demirbas", isFallback: true };

  const result = await query(
    `SELECT asset_id, transaction_type FROM fixed_asset_transactions WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = result.rows?.[0];
  if (!row) return { route: "/app/demirbas", isFallback: true };

  const assetId = parsePositiveInt(row.asset_id);
  const txType = String(row.transaction_type || "").trim().toUpperCase();

  if (FA_TRANSACTION_SALE_WRITEOFF_TYPES.has(txType)) {
    return {
      route: `/app/demirbas-satis-islemleri?transactionId=${id}&assetId=${assetId}`,
    };
  }
  return {
    route: `/app/demirbas-karti-detayi/${assetId}?tab=transactions&transactionId=${id}`,
  };
}

async function resolveFixedAssetRunDestination(sourceRefId) {
  const id = parsePositiveInt(sourceRefId);
  if (!id) return { route: "/app/demirbas-amortisman-islemleri", isFallback: true };
  return { route: `/app/demirbas-amortisman-islemleri?runId=${id}` };
}

async function resolveStockLandedCostVoucherDestination(sourceRefId) {
  const id = parsePositiveInt(sourceRefId);
  if (!id) {
    return { route: "/app/stok-maliyet-voucherleri", isFallback: true };
  }
  return { route: `/app/stok-maliyet-voucherleri/${id}` };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Resolve the frontend destination for a given source-ref type (sync, static only).
 * Returns `{ route }` or `null` if the type has no registered static destination.
 * For dynamic types (FIXED_ASSET_TRANSACTION, FIXED_ASSET_DEPRECIATION_RUN),
 * use resolveDestinationAsync() instead.
 */
export function resolveDestination(sourceRefType) {
  const normalized = normalizeUpperText(sourceRefType);
  return DESTINATION_REGISTRY[normalized] || null;
}

/**
 * Resolve the frontend destination for a given source-ref type (async).
 * Handles both static registry types and dynamic types that require DB lookup.
 * Returns `{ route, isFallback? }` or `null`.
 */
export async function resolveDestinationAsync(sourceRefType, sourceRefId) {
  const normalized = normalizeUpperText(sourceRefType);

  // Static registry — no DB needed
  const staticEntry = DESTINATION_REGISTRY[normalized];
  if (staticEntry) return staticEntry;

  // Dynamic resolution
  if (normalized === CARI_DOCUMENT) {
    return resolveCariDocumentDestination(sourceRefId);
  }
  if (normalized === CARI_SETTLEMENT_BATCH) {
    return resolveCariSettlementBatchDestination(sourceRefId);
  }
  if (normalized === FIXED_ASSET_TRANSACTION) {
    return resolveFixedAssetTransactionDestination(sourceRefId);
  }
  if (normalized === FIXED_ASSET_DEPRECIATION_RUN) {
    return resolveFixedAssetRunDestination(sourceRefId);
  }
  if (normalized === STOCK_LANDED_COST_VOUCHER) {
    return resolveStockLandedCostVoucherDestination(sourceRefId);
  }

  return null;
}

/**
 * Returns true if the source-ref type blocks direct GL journal reversal.
 */
export function isReverseBlockSourceType(sourceRefType) {
  return REVERSE_BLOCK_SOURCE_TYPES.has(normalizeUpperText(sourceRefType));
}

/**
 * Add `.destination` to each source link in the array (sync, static only).
 * Returns a new array — the original objects are not mutated.
 *
 * Each link gets `destination: { route } | null` based on the static registry.
 * Dynamic types (fixed-assets) will get `null` — use the async variant for full resolution.
 */
export function enrichSourceLinksWithDestinations(sourceLinks) {
  return (Array.isArray(sourceLinks) ? sourceLinks : []).map((link) => {
    const destination = resolveDestination(link?.source_ref_type);
    return { ...link, destination };
  });
}

/**
 * Add `.destination` to each source link in the array (async, full resolution).
 * Resolves both static and dynamic destination types.
 * Returns a new array — the original objects are not mutated.
 */
export async function enrichSourceLinksWithDestinationsAsync(sourceLinks) {
  const links = Array.isArray(sourceLinks) ? sourceLinks : [];
  return Promise.all(
    links.map(async (link) => {
      const destination = await resolveDestinationAsync(
        link?.source_ref_type,
        link?.source_ref_id
      );
      return { ...link, destination };
    })
  );
}

/**
 * Evaluate reverse-block status for a set of source links.
 *
 * Returns:
 *   {
 *     isBlocked: boolean,
 *     blockingSourceLinks: [{ sourceRefType, sourceRefId, linkRole, destination }],
 *     primaryDestination: { sourceRefType, sourceRefId, route } | null,
 *     resolvedDestinations: [{ sourceRefType, route }]
 *   }
 */
export function resolveReverseBlock(sourceLinks) {
  const links = Array.isArray(sourceLinks) ? sourceLinks : [];

  const blockingSourceLinks = links
    .filter((link) => isReverseBlockSourceType(link?.source_ref_type))
    .map((link) => ({
      sourceRefType: normalizeUpperText(link?.source_ref_type),
      sourceRefId: parsePositiveInt(link?.source_ref_id),
      linkRole: normalizeUpperText(link?.link_role || "PRIMARY") || "PRIMARY",
      destination: resolveDestination(link?.source_ref_type),
    }));

  const isBlocked = blockingSourceLinks.length > 0;

  // Primary destination: prefer the blocking link with link_role = 'PRIMARY',
  // fall back to the first blocking link.
  const primaryLink =
    blockingSourceLinks.find((link) => link.linkRole === "PRIMARY") ||
    blockingSourceLinks[0] ||
    null;

  const primaryDestination = primaryLink
    ? {
        sourceRefType: primaryLink.sourceRefType,
        sourceRefId: primaryLink.sourceRefId,
        route: primaryLink.destination?.route || null,
      }
    : null;

  // Resolved destinations: deduplicated by route.
  const seenRoutes = new Set();
  const resolvedDestinations = [];
  for (const link of blockingSourceLinks) {
    const route = link.destination?.route;
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
 * Evaluate reverse-block status with full async destination resolution.
 * Same shape as resolveReverseBlock() but resolves dynamic FA destinations.
 */
export async function resolveReverseBlockAsync(sourceLinks) {
  const links = Array.isArray(sourceLinks) ? sourceLinks : [];

  const blockingSourceLinks = await Promise.all(
    links
      .filter((link) => isReverseBlockSourceType(link?.source_ref_type))
      .map(async (link) => ({
        sourceRefType: normalizeUpperText(link?.source_ref_type),
        sourceRefId: parsePositiveInt(link?.source_ref_id),
        linkRole: normalizeUpperText(link?.link_role || "PRIMARY") || "PRIMARY",
        destination: await resolveDestinationAsync(
          link?.source_ref_type,
          link?.source_ref_id
        ),
      }))
  );

  const isBlocked = blockingSourceLinks.length > 0;

  const primaryLink =
    blockingSourceLinks.find((link) => link.linkRole === "PRIMARY") ||
    blockingSourceLinks[0] ||
    null;

  const primaryDestination = primaryLink
    ? {
        sourceRefType: primaryLink.sourceRefType,
        sourceRefId: primaryLink.sourceRefId,
        route: primaryLink.destination?.route || null,
      }
    : null;

  const seenRoutes = new Set();
  const resolvedDestinations = [];
  for (const link of blockingSourceLinks) {
    const route = link.destination?.route;
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
 * Build the legacy human-readable reverse-block message from a
 * resolveReverseBlock() result.
 *
 * This preserves the existing message style that current clients expect.
 */
export function buildReverseBlockMessage(reverseBlockResult) {
  if (!reverseBlockResult?.isBlocked) {
    return null;
  }

  const { blockingSourceLinks, resolvedDestinations } = reverseBlockResult;

  if (blockingSourceLinks.length === 0) {
    return "Journal is linked to a source module. Reverse from source module.";
  }

  const linkTokens = blockingSourceLinks.map(
    (link) => `${link.sourceRefType}:${link.sourceRefId}`
  );

  const routeHints = resolvedDestinations
    .map((d) => d.route)
    .filter(Boolean);

  const routeHintText =
    routeHints.length > 0 ? ` Open from: ${routeHints.join(", ")}.` : "";

  return `Journal is linked to subledger record(s) [${linkTokens.join(", ")}]. Reverse from source module instead of GL journal reverse.${routeHintText}`;
}
