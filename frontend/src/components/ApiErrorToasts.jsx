import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeApiError } from "../api/client.js";

const MAX_TOASTS = 5;

function toSignature(payload) {
  return [
    payload?.status ?? "",
    payload?.code ?? "",
    payload?.requestId ?? "",
    payload?.message ?? "",
  ].join("|");
}

function toCopyValue(toast) {
  return JSON.stringify(
    {
      message: toast.message,
      code: toast.code,
      status: toast.status,
      requestId: toast.requestId,
      details: toast.details,
      method: toast.method,
      url: toast.url,
      at: new Date(toast.at).toISOString(),
    },
    null,
    2
  );
}

function isServerError(status) {
  const parsed = Number(status || 0);
  return Number.isInteger(parsed) && parsed >= 500;
}

export default function ApiErrorToasts() {
  const [toasts, setToasts] = useState([]);
  const [copiedToastId, setCopiedToastId] = useState("");
  const timeoutMapRef = useRef(new Map());

  const dismissToast = useCallback((toastId) => {
    setToasts((previous) => previous.filter((item) => item.id !== toastId));
    const timeoutId = timeoutMapRef.current.get(toastId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutMapRef.current.delete(toastId);
    }
  }, []);

  useEffect(() => {
    const timeoutMap = timeoutMapRef.current;
    const unsubscribe = subscribeApiError((payload) => {
      const id = `api-toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const signature = toSignature(payload);
      const nextToast = {
        id,
        at: Date.now(),
        status: payload?.status || null,
        message: String(payload?.message || "Request failed."),
        code: payload?.code || null,
        requestId: payload?.requestId || null,
        details: payload?.details ?? null,
        method: payload?.method || null,
        url: payload?.url || null,
        signature,
      };

      setToasts((previous) => {
        if (previous.some((item) => item.signature === signature)) {
          return previous;
        }
        return [nextToast, ...previous].slice(0, MAX_TOASTS);
      });

      const timeoutMs = isServerError(payload?.status) ? 12000 : 9000;
      const timeoutId = window.setTimeout(() => {
        dismissToast(id);
      }, timeoutMs);
      timeoutMap.set(id, timeoutId);
    });

    return () => {
      unsubscribe();
      for (const timeoutId of timeoutMap.values()) {
        window.clearTimeout(timeoutId);
      }
      timeoutMap.clear();
    };
  }, [dismissToast]);

  async function handleCopy(toast) {
    const value = toCopyValue(toast);
    if (!navigator?.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedToastId(toast.id);
      window.setTimeout(() => setCopiedToastId(""), 1400);
    } catch {
      // Ignore clipboard failures.
    }
  }

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[70] flex w-[min(28rem,92vw)] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto rounded-lg border border-rose-200 bg-white p-3 shadow-lg"
        >
          <p className="text-sm font-semibold text-rose-700">API Error</p>
          <p className="mt-1 text-sm text-slate-800">{toast.message}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
            {toast.status ? <span>Status: {toast.status}</span> : null}
            {toast.code ? <span>Code: {toast.code}</span> : null}
            {toast.requestId ? <span>Request ID: {toast.requestId}</span> : null}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopy(toast)}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {copiedToastId === toast.id ? "Copied" : "Copy details"}
            </button>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
