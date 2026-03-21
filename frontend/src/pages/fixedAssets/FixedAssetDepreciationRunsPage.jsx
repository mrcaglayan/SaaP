import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { getFixedAssetRun, listFixedAssetRuns } from "../../api/fixedAssets.js";

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeApiError(error, fallback) {
  const message = String(
    error?.response?.data?.message || error?.message || fallback
  ).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).slice(0, 10) || "-";
}

export default function FixedAssetDepreciationRunsPage() {
  const { l } = useI18n();
  const { hasPermission } = useAuth();
  const { workingContext } = useWorkingContext();
  const [searchParams] = useSearchParams();
  const canRead = hasPermission("fixed_assets.depreciation.run") || hasPermission("fixed_assets.read");
  const canRunDepreciation = hasPermission("fixed_assets.depreciation.run");
  const canReverseDepreciation = hasPermission("fixed_assets.depreciation.reverse");

  const queryRunId = parsePositiveInt(searchParams.get("runId"));

  const [focusedRun, setFocusedRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load focused run detail when runId is present
  useEffect(() => {
    if (!canRead || !queryRunId) { setFocusedRun(null); return; }
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await getFixedAssetRun(queryRunId);
        if (active) setFocusedRun(res.row || res);
      } catch (err) {
        if (active) {
          setFocusedRun(null);
          setError(normalizeApiError(err, l("Failed to load run.", "Run yuklenemedi.")));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, queryRunId, l]);

  // Load run list — only when no deep-link runId (list mode)
  const legalEntityId = workingContext?.legalEntityId || "";
  useEffect(() => {
    if (!canRead || queryRunId) { setRuns([]); return; }
    if (!legalEntityId) { setRuns([]); return; }
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await listFixedAssetRuns({ legalEntityId });
        if (active) setRuns(res.rows || []);
      } catch {
        if (active) setRuns([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canRead, queryRunId, legalEntityId]);

  if (!canRead) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          {l("Missing permission: fixed_assets.depreciation.run", "Eksik yetki: fixed_assets.depreciation.run")}
        </p>
      </div>
    );
  }

  // List mode (no deep-link)
  if (!queryRunId) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            {l("Depreciation Runs", "Amortisman Run Listesi")}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {l(
              "Preview, post, and reverse depreciation runs. Select a run to view its detail.",
              "Amortisman runlarini onizleyin, postalyin ve ters kayit yapin. Detay icin bir run secin."
            )}
          </p>
          {!canRunDepreciation ? (
            <p className="mt-2 text-xs text-amber-700">
              {l(
                "Read-only access — you do not have depreciation run permissions.",
                "Salt okunur erisim — amortisman run yetkiniz yok."
              )}
            </p>
          ) : null}
        </section>

        {/* Run list */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading ? (
            <p className="text-sm text-slate-600">{l("Loading...", "Yukleniyor...")}</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-slate-600">
              {l("No depreciation runs found.", "Amortisman runu bulunamadi.")}
            </p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">{l("ID", "ID")}</th>
                    <th className="px-2 py-2">{l("Period", "Donem")}</th>
                    <th className="px-2 py-2">{l("Status", "Durum")}</th>
                    <th className="px-2 py-2">{l("Created At", "Olusturma")}</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-mono text-xs">{run.id}</td>
                      <td className="px-2 py-1.5">{run.periodKey || run.period_key || "-"}</td>
                      <td className="px-2 py-1.5">{run.status || "-"}</td>
                      <td className="px-2 py-1.5">{formatDate(run.createdAt || run.created_at)}</td>
                      <td className="px-2 py-1.5">
                        <Link
                          to={`/app/demirbas-amortisman-islemleri?runId=${run.id}`}
                          className="text-xs text-cyan-700 hover:underline"
                        >
                          {l("View", "Goruntule")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  // Deep-link: show focused run detail
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">{l("Loading run...", "Run yukleniyor...")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
        <p className="text-sm text-rose-700">{error}</p>
      </div>
    );
  }

  if (!focusedRun) return null;

  const runStatus = String(focusedRun.status || "").toUpperCase();

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link to="/app/demirbas-amortisman-islemleri" className="text-sm text-cyan-700 hover:underline">
        {l("Back to runs", "Run listesine don")}
      </Link>

      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Depreciation Run Detail", "Amortisman Run Detayi")} #{queryRunId}
        </h2>
        <dl className="mt-3 grid gap-x-4 gap-y-3 md:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Run ID", "Run ID")}</dt>
            <dd className="mt-0.5 text-sm text-slate-900 font-mono">{focusedRun.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Period", "Donem")}</dt>
            <dd className="mt-0.5 text-sm text-slate-900">{focusedRun.periodKey || focusedRun.period_key || "-"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Status", "Durum")}</dt>
            <dd className="mt-0.5 text-sm text-slate-900">{focusedRun.status || "-"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Legal Entity", "Tuzel Kisilik")}</dt>
            <dd className="mt-0.5 text-sm text-slate-900">{focusedRun.legalEntityId || focusedRun.legal_entity_id || "-"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Book ID", "Defter ID")}</dt>
            <dd className="mt-0.5 text-sm text-slate-900 font-mono">{focusedRun.bookId || focusedRun.book_id || "-"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Posted At", "Post Tarihi")}</dt>
            <dd className="mt-0.5 text-sm text-slate-900">{formatDate(focusedRun.postedAt || focusedRun.posted_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Created At", "Olusturma")}</dt>
            <dd className="mt-0.5 text-sm text-slate-900">{formatDate(focusedRun.createdAt || focusedRun.created_at)}</dd>
          </div>
        </dl>
      </section>

      {/* Permission-gated action indicators */}
      {canRunDepreciation || canReverseDepreciation ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">{l("Available Actions", "Mevcut Aksiyonlar")}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {canRunDepreciation && runStatus === "DRAFT" ? (
              <span className="rounded-md bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 border border-emerald-200">
                {l("Post", "Postala")}
              </span>
            ) : null}
            {canRunDepreciation && runStatus === "DRAFT" ? (
              <span className="rounded-md bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 border border-rose-200">
                {l("Delete Draft", "Taslagi Sil")}
              </span>
            ) : null}
            {canReverseDepreciation && runStatus === "POSTED" ? (
              <span className="rounded-md bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 border border-amber-200">
                {l("Reverse", "Ters Kayit")}
              </span>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-xs text-amber-700">
          {l(
            "Read-only access — you do not have depreciation run or reverse permissions.",
            "Salt okunur erisim — amortisman run veya ters kayit yetkiniz yok."
          )}
        </p>
      )}
    </div>
  );
}
