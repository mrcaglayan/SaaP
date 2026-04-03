import { useEffect, useState } from "react";
import { runRbacAccessCheck } from "../../api/rbacAdmin.js";
import { useI18n } from "../../i18n/useI18n.js";
import AccessDebuggerResults from "./AccessDebuggerResults.jsx";

/**
 * Runs one self-service access check inside a reusable modal so denied or
 * narrowed UI states can explain themselves without sending users to a separate
 * admin screen.
 */
export default function AccessDebuggerModal({
  open = false,
  onClose,
  requestPayload = null,
  title = "",
  subtitle = "",
  targetUserLabel = "",
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const requestKey = JSON.stringify(requestPayload || null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let active = true;

    async function loadResult() {
      if (!requestPayload || typeof requestPayload !== "object") {
        setResult(null);
        setError("");
        return;
      }

      setLoading(true);
      setError("");
      try {
        const response = await runRbacAccessCheck(requestPayload);
        if (active) {
          setResult(response || null);
        }
      } catch (err) {
        if (active) {
          setError(err?.response?.data?.message || t("accessDebugger.errors.runFailed"));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadResult();

    return () => {
      active = false;
    };
  }, [open, requestKey, requestPayload, t]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {title || t("accessDebugger.modal.title")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {subtitle || t("accessDebugger.modal.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t("accessDebugger.actions.close")}
          </button>
        </div>

        <div className="max-h-[calc(90vh-88px)] overflow-y-auto px-5 py-4">
          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              {t("accessDebugger.actions.running")}
            </div>
          ) : null}

          {!loading && !error && result ? (
            <AccessDebuggerResults
              result={result}
              targetUserLabel={targetUserLabel}
            />
          ) : null}

          {!loading && !error && !result ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              {t("accessDebugger.empty")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
