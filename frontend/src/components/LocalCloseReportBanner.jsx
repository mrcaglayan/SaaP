import { useEffect, useMemo, useState } from "react";
import {
  getLocalClosePack,
  listLocalClosePackReportReviews,
  upsertLocalClosePackReportReview,
} from "../api/localClosePacks.js";
import {
  LOCAL_REPORT_CONTEXT_QUERY_KEYS,
  normalizeLocalReportParams,
} from "../api/glReports.js";

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function formatScopeLabel(pack, l) {
  if (String(pack?.closeScopeType || "").toUpperCase() === "OPERATING_UNIT") {
    const code = String(pack?.operatingUnitCode || "").trim();
    const name = String(pack?.operatingUnitName || "").trim();
    return code && name ? `${code} - ${name}` : code || name || l("Operating unit", "Isletme birimi");
  }
  return l("HQ / Central", "Merkez / HQ");
}

function formatLaunchMode(mode, l) {
  return String(mode || "").toUpperCase() === "ENTITY_STATEMENT_FALLBACK"
    ? l("Entity-level statutory fallback", "Entity duzeyi statutor fallback")
    : l("Exact pack scope", "Paket scope'u birebir");
}

function buildReviewQueryPayload(searchParams) {
  const normalized = normalizeLocalReportParams(
    Object.fromEntries((searchParams || new URLSearchParams()).entries())
  );
  for (const key of LOCAL_REPORT_CONTEXT_QUERY_KEYS) {
    delete normalized[key];
  }
  return normalized;
}

/**
 * Show launched local-close context in report headers and let preparers persist
 * the first-pass reviewed-report fingerprint for the current report instance.
 */
export default function LocalCloseReportBanner({
  searchParams,
  reportKey,
  routePath,
  reportResponse,
  buildResponseSnapshot,
  canReview = false,
  l,
}) {
  const closePackId = toPositiveInt(searchParams?.get("closePackId"));
  const closeLaunchMode = String(searchParams?.get("closeLaunchMode") || "PACK_SCOPE").trim().toUpperCase();
  const [pack, setPack] = useState(null);
  const [reviewRow, setReviewRow] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!closePackId) {
      setPack(null);
      setReviewRow(null);
      return;
    }
    let cancelled = false;
    async function loadContext() {
      try {
        const [packResponse, reviewResponse] = await Promise.all([
          getLocalClosePack(closePackId),
          listLocalClosePackReportReviews(closePackId),
        ]);
        if (cancelled) return;
        setPack(packResponse?.row || null);
        const rows = Array.isArray(reviewResponse?.rows) ? reviewResponse.rows : [];
        setReviewRow(rows.find((row) => row.reportKey === reportKey) || null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
              l("Failed to load close context.", "Kapanis baglami yuklenemedi.")
          );
        }
      }
    }
    void loadContext();
    return () => {
      cancelled = true;
    };
  }, [closePackId, l, reportKey]);

  const reviewPayload = useMemo(() => {
    if (!reportResponse || !closePackId || typeof buildResponseSnapshot !== "function") {
      return null;
    }
    return {
      reportKey,
      routePath,
      launchMode: closeLaunchMode || "PACK_SCOPE",
      query: buildReviewQueryPayload(searchParams),
      responseSnapshot: buildResponseSnapshot(reportResponse),
    };
  }, [buildResponseSnapshot, closeLaunchMode, closePackId, reportKey, reportResponse, routePath, searchParams]);

  if (!closePackId) {
    return null;
  }

  async function handleMarkReviewed() {
    if (!canReview || !reviewPayload) return;
    setReviewing(true);
    setError("");
    setMessage("");
    try {
      const response = await upsertLocalClosePackReportReview(closePackId, reviewPayload);
      setReviewRow(response?.row || null);
      setMessage(l("Reviewed report fingerprint saved.", "Incelenen rapor fingerprint'i kaydedildi."));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to save reviewed report fingerprint.", "Incelenen rapor fingerprint'i kaydedilemedi.")
      );
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">
            {l("Launched from local close pack", "Yerel kapanis paketinden baslatildi")} #{closePackId}
          </div>
          <div className="mt-1 text-xs text-cyan-900/80">
            {pack
              ? `${formatScopeLabel(pack, l)} | ${pack.bookCode || pack.bookName || "-"} | ${pack.periodName || "-"} | ${pack.status || "-"}`
              : l("Loading pack context...", "Paket baglami yukleniyor...")}
          </div>
          <div className="mt-1 text-xs text-cyan-900/80">
            {l("Launch mode", "Baslatma modu")}: {formatLaunchMode(closeLaunchMode, l)}
          </div>
          {reviewRow ? (
            <div className="mt-1 text-xs text-cyan-900/80">
              {l("Last reviewed", "Son inceleme")}: {formatDateTime(reviewRow.reviewedAt)}
            </div>
          ) : null}
        </div>
        {canReview ? (
          <button
            type="button"
            onClick={() => void handleMarkReviewed()}
            disabled={reviewing || !reviewPayload}
            className="rounded-lg border border-cyan-900 bg-cyan-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {reviewing
              ? l("Saving review...", "Inceleme kaydediliyor...")
              : l("Mark reviewed", "Incelendi diye isle")}
          </button>
        ) : null}
      </div>
      {message ? <div className="mt-2 text-xs text-emerald-700">{message}</div> : null}
      {error ? <div className="mt-2 text-xs text-rose-700">{error}</div> : null}
      {reviewRow?.fingerprintSha256 ? (
        <div className="mt-2 font-mono text-[11px] text-cyan-900/80">{reviewRow.fingerprintSha256}</div>
      ) : null}
    </div>
  );
}
