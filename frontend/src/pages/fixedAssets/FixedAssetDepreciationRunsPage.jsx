import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { getFixedAssetRun, listFixedAssetRuns } from "../../api/fixedAssets.js";
import FixedAssetModulePage from "./FixedAssetModulePage.jsx";

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

  // When no deep-link runId, show the scaffold + run list
  if (!queryRunId) {
    return (
      <div className="space-y-6">
        <FixedAssetModulePage
          route="/app/demirbas-amortisman-islemleri"
          description={l(
            "Depreciation run preview, post, and reverse surface aligned to FA07 and FA08.",
            "FA07 ve FA08 ile uyumlu amortisman run onizleme, post ve reverse yuzeyi."
          )}
          currentScope={[
            l(
              "Keep schedule generation separate from run execution, but make both visible from the same route family.",
              "Plan uretimini run calistirmadan ayir, ancak ikisini ayni rota ailesi icinde gorunur tut."
            ),
            l(
              "Reserve run detail space for skipped assets, per-run errors, totals, and posted journals.",
              "Run detayi icinde atlanan varliklar, run-hatalari, toplamlar ve olusan fisler icin alan ayir."
            ),
            l(
              "Prepare transaction-level traceability so one asset and one period cannot be posted twice.",
              "Bir varlik ve bir donem icin cift posting olmasin diye hareket seviyesinde izlenebilirlik hazirla."
            ),
          ]}
          nextSteps={[
            l(
              "Back the UI with run, run-line, schedule, preview, post, and reverse endpoints.",
              "UI'yi run, run-line, plan, onizleme, post ve reverse endpointleri ile destekle."
            ),
            l(
              "Enforce one-asset-per-period posting with DB constraints, not only service checks.",
              "Bir-varlik-bir-donem posting kuralini sadece servis degil DB constraint ile de uygula."
            ),
            l(
              "Validate fiscal period openness for preview-to-post transitions and reversals.",
              "Onizleme-post gecisi ve reversaller icin mali donem aciklik kontrolu yap."
            ),
          ]}
          decisionItems={[
            l(
              "The run schema needs a dedicated run-lines table for auditability and totals.",
              "Run semasi denetim izi ve toplamlar icin ayri bir run-lines tablosu gerektiriyor."
            ),
            l(
              "Transaction-level and run-level evidence are in scope, not asset-level only.",
              "Sadece varlik seviyesi degil, hareket ve run seviyesi kanit da kapsam icinde."
            ),
          ]}
        />
        {runs.length > 0 ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              {l("Depreciation Runs", "Amortisman Run Listesi")}
            </h2>
            <div className="mt-3 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">{l("ID", "ID")}</th>
                    <th className="px-2 py-2">{l("Period", "Donem")}</th>
                    <th className="px-2 py-2">{l("Status", "Durum")}</th>
                    <th className="px-2 py-2">{l("Created At", "Olusturma")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-mono text-xs">{run.id}</td>
                      <td className="px-2 py-1.5">{run.periodKey || run.period_key || "-"}</td>
                      <td className="px-2 py-1.5">{run.status || "-"}</td>
                      <td className="px-2 py-1.5">{formatDate(run.createdAt || run.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
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

  return (
    <div className="space-y-4">
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
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l("Legal Entity", "Tüzel Kisilik")}</dt>
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
    </div>
  );
}
