import { useEffect, useState } from "react";
import { exportRowsAsCsv } from "../utils/csvExport.js";
import { createReportFingerprint } from "../utils/reportFingerprint.js";

/**
 * Render one reusable RP13 frontend-only audit panel for loaded report
 * surfaces. Each spec provides the current export rows plus the loaded report
 * snapshot needed to derive a stable client-side fingerprint.
 */
export default function ReportAuditPanel({
  specs = [],
  title,
  subtitle,
  l,
}) {
  const [fingerprintState, setFingerprintState] = useState({
    loading: false,
    error: "",
    rows: {},
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!Array.isArray(specs) || specs.length === 0) {
      return undefined;
    }

    let cancelled = false;

    async function loadFingerprints() {
      setFingerprintState({
        loading: true,
        error: "",
        rows: {},
      });
      try {
        const entries = await Promise.all(
          specs.map(async (spec) => {
            const fingerprint = await createReportFingerprint({
              reportKey: spec.key,
              routePath: spec.routePath,
              parameters: spec.fingerprintParameters,
              context: spec.fingerprintContext,
              reportSnapshot: spec.fingerprintSnapshot,
            });
            return [spec.key, fingerprint];
          }),
        );
        if (!cancelled) {
          setFingerprintState({
            loading: false,
            error: "",
            rows: Object.fromEntries(entries),
          });
        }
      } catch (err) {
        if (!cancelled) {
          setFingerprintState({
            loading: false,
            error:
              err?.message ||
              l(
                "Failed to build report fingerprints.",
                "Rapor fingerprint'leri olusturulamadi.",
              ),
            rows: {},
          });
        }
      }
    }

    void loadFingerprints();
    return () => {
      cancelled = true;
    };
  }, [l, specs]);

  if (!Array.isArray(specs) || specs.length === 0) {
    return null;
  }

  function handleExport(spec) {
    setError("");
    setMessage("");
    const exported = exportRowsAsCsv({
      rows: spec.exportRows,
      columns: spec.exportColumns,
      fileName: spec.fileName,
    });
    if (!exported) {
      setError(
        l(
          "CSV export is only available in browser sessions.",
          "CSV disa aktarimi yalnizca tarayici oturumlarinda kullanilabilir.",
        ),
      );
      return;
    }
    setMessage(
      l(
        `Audit CSV ready for ${spec.label} (${spec.exportRows.length} rows).`,
        `${spec.label} icin audit CSV hazir (${spec.exportRows.length} satir).`,
      ),
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
      </div>
      {message ? (
        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {fingerprintState.error ? (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {fingerprintState.error}
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {specs.map((spec) => {
          const fingerprintRow = fingerprintState.rows?.[spec.key];
          return (
            <div
              key={spec.key}
              className="rounded border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {spec.label}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {l("Rows loaded", "Yuklenen satir")} {spec.rowCount}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleExport(spec)}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {l("Export CSV", "CSV disa aktar")}
                </button>
              </div>
              <div className="mt-3 font-mono text-[11px] break-all text-slate-700">
                {fingerprintRow?.fingerprintSha256 ||
                  (fingerprintState.loading
                    ? l(
                        "Building fingerprint...",
                        "Fingerprint olusturuluyor...",
                      )
                    : "-")}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                {l(
                  "Fingerprint basis includes the active route, current parameters, and the loaded report snapshot for this surface.",
                  "Fingerprint bazasi bu yuzey icin aktif route'u, mevcut parametreleri ve yuklu rapor snapshot'ini icerir.",
                )}
              </div>
              {fingerprintRow?.basisJson ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] font-semibold text-cyan-700">
                    {l("Show fingerprint basis", "Fingerprint bazasini goster")}
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-700">
                    {fingerprintRow.basisJson}
                  </pre>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
