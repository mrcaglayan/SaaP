import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth.js";
import { useTenantReadiness } from "./useTenantReadiness.js";

export default function TenantReadinessChecklist() {
  const { hasPermission } = useAuth();
  const {
    loading,
    error,
    readiness,
    missingChecks,
    refresh,
    bootstrapping,
    bootstrapError,
    bootstrapResult,
    runBaselineBootstrap,
  } = useTenantReadiness();

  const canBootstrap = hasPermission("onboarding.company.setup");

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">
          Tenant Readiness Checklist
        </h2>
        <p className="mt-2 text-sm text-slate-500">Loading readiness...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">
          Tenant Readiness Checklist
        </h2>
        <p className="mt-2 text-sm text-amber-800">{error}</p>
        <button
          type="button"
          onClick={() => refresh()}
          className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!readiness) {
    return null;
  }

  return (
    <section
      className={`rounded-xl border p-4 ${
        readiness.ready
          ? "border-emerald-200 bg-emerald-50"
          : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          className={`text-sm font-semibold ${
            readiness.ready ? "text-emerald-900" : "text-amber-900"
          }`}
        >
          Tenant Readiness Checklist
        </h2>
        <span
          className={`rounded-full px-2 py-1 text-xs font-semibold ${
            readiness.ready
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {readiness.ready ? "Ready" : "Setup Required"}
        </span>
      </div>

      {!readiness.ready && (
        <p className="mt-2 text-sm text-amber-900">
          Complete company, organization, and GL setup before using operational
          modules.
        </p>
      )}

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {(readiness.checks || []).map((check) => (
          <div
            key={check.key}
            className="rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{check.label}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  check.ready
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-rose-100 text-rose-700"
                }`}
              >
                {check.ready ? "OK" : "Missing"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {check.count} / minimum {check.minimum}
            </p>
          </div>
        ))}
      </div>

      {!readiness.ready && (
        <div className="mt-3 text-xs text-amber-900">
          Missing:{" "}
          <span className="font-semibold">
            {missingChecks.map((check) => check.label).join(", ")}
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Link
          to="/app/ayarlar/sirket-ayarlari"
          className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700"
        >
          Company Setup
        </Link>
        <Link
          to="/app/ayarlar/organizasyon-yonetimi"
          className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700"
        >
          Org Setup
        </Link>
        <Link
          to="/app/ayarlar/hesap-plani-ayarlari"
          className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700"
        >
          GL Setup
        </Link>
      </div>

      {!readiness.ready && (
        <div className="mt-3 rounded-lg border border-white/60 bg-white/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">
              One-click baseline bootstrap
            </p>
            <button
              type="button"
              onClick={() => runBaselineBootstrap()}
              disabled={!canBootstrap || bootstrapping}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {bootstrapping ? "Running..." : "Run Baseline Bootstrap"}
            </button>
          </div>
          {!canBootstrap && (
            <p className="mt-1 text-xs text-amber-900">
              Missing permission: onboarding.company.setup
            </p>
          )}
          {bootstrapError && (
            <p className="mt-1 text-xs text-rose-700">{bootstrapError}</p>
          )}
          {bootstrapResult?.ok && (
            <p className="mt-1 text-xs text-emerald-700">
              Baseline bootstrap completed.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
