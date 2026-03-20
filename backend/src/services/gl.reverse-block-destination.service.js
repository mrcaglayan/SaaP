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
  PAYMENT_BATCH,
  PAYROLL_RUN,
} from "../utils/source-ref-types.js";
import { parsePositiveInt } from "../routes/_utils.js";

function normalizeUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

// ── Destination registry ──────────────────────────────────────────────
// Maps source-ref types to their frontend drillback routes.
// Types listed here also block direct GL journal reversal — the journal
// must be reversed through the owning module instead.
//
// Future extension: fixed-assets types will be added here once the
// asset register and depreciation UI routes are established.
const DESTINATION_REGISTRY = Object.freeze({
  [CARI_DOCUMENT]: { route: "/app/cari-belgeler" },
  [CARI_SETTLEMENT_BATCH]: { route: "/app/cari-settlements" },
  [CASH_TRANSACTION]: { route: "/app/kasa-islemleri" },
  [PAYMENT_BATCH]: { route: "/app/odeme-batchleri" },
  [PAYROLL_RUN]: { route: "/app/payroll-runs" },
});

const REVERSE_BLOCK_SOURCE_TYPES = Object.freeze(
  new Set(Object.keys(DESTINATION_REGISTRY))
);

// ── Public API ────────────────────────────────────────────────────────

/**
 * Resolve the frontend destination for a given source-ref type.
 * Returns `{ route }` or `null` if the type has no registered destination.
 */
export function resolveDestination(sourceRefType) {
  const normalized = normalizeUpperText(sourceRefType);
  return DESTINATION_REGISTRY[normalized] || null;
}

/**
 * Returns true if the source-ref type blocks direct GL journal reversal.
 */
export function isReverseBlockSourceType(sourceRefType) {
  return REVERSE_BLOCK_SOURCE_TYPES.has(normalizeUpperText(sourceRefType));
}

/**
 * Add `.destination` to each source link in the array.
 * Returns a new array — the original objects are not mutated.
 *
 * Each link gets `destination: { route } | null` based on the registry.
 */
export function enrichSourceLinksWithDestinations(sourceLinks) {
  return (Array.isArray(sourceLinks) ? sourceLinks : []).map((link) => {
    const destination = resolveDestination(link?.source_ref_type);
    return { ...link, destination };
  });
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
