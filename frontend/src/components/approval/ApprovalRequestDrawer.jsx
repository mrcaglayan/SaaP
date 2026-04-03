import ApprovalExecutionStatusBadge from "./ApprovalExecutionStatusBadge.jsx";
import ApprovalRequestStatusBadge from "./ApprovalRequestStatusBadge.jsx";
import ApprovalTimeline from "./ApprovalTimeline.jsx";

const ACTION_TONE_CLASS_NAMES = {
  approve: "bg-emerald-600 text-white hover:bg-emerald-700",
  reject: "bg-rose-600 text-white hover:bg-rose-700",
  return: "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
  withdraw: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
};

function normalizeSummaryItems(items) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function normalizeActions(actions) {
  return Array.isArray(actions) ? actions.filter(Boolean) : [];
}

/**
 * Show a reusable approval request drawer with distinct review and execution
 * statuses, summary facts, timeline, and action affordances.
 */
export default function ApprovalRequestDrawer({
  open,
  onClose,
  title,
  subtitle,
  requestCode,
  requestStatus,
  executionStatus,
  summaryItems = [],
  timelineItems = [],
  timelineTitle = "Decision History",
  timelineEmptyText = "No approval history available yet.",
  actions = [],
  statusNotice = null,
  children,
}) {
  if (!open) {
    return null;
  }

  const resolvedSummaryItems = normalizeSummaryItems(summaryItems);
  const resolvedActions = normalizeActions(actions);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30">
      <button
        type="button"
        aria-label="Close approval request drawer"
        className="flex-1 cursor-default"
        onClick={onClose}
      />
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
                {requestCode ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-600">
                    {requestCode}
                  </span>
                ) : null}
              </div>
              {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
            >
              Close
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Review
              </span>
              <ApprovalRequestStatusBadge status={requestStatus} />
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Execution
              </span>
              <ApprovalExecutionStatusBadge status={executionStatus} />
            </div>
          </div>

          {statusNotice?.title || statusNotice?.description ? (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                statusNotice?.tone === "attention"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {statusNotice?.title ? (
                <div className="font-semibold">{statusNotice.title}</div>
              ) : null}
              {statusNotice?.description ? (
                <p className={statusNotice?.title ? "mt-1" : ""}>{statusNotice.description}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {resolvedSummaryItems.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {resolvedSummaryItems.map((item) => (
                <div
                  key={item.key}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {item.label}
                  </div>
                  <div className="mt-2 text-sm font-medium text-slate-900">{item.value}</div>
                  {item.helperText ? (
                    <div className="mt-1 text-xs text-slate-500">{item.helperText}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {children}

          <ApprovalTimeline
            title={timelineTitle}
            items={timelineItems}
            emptyText={timelineEmptyText}
          />

          {resolvedActions.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Review Actions
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {resolvedActions.map((action) => (
                  <div key={action.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <button
                      type="button"
                      className={`w-full rounded-xl px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                        ACTION_TONE_CLASS_NAMES[action.tone] || ACTION_TONE_CLASS_NAMES.secondary
                      }`}
                      onClick={action.onClick}
                      disabled={action.disabled || action.busy}
                      title={action.description || ""}
                    >
                      {action.busy ? action.busyLabel || "Working..." : action.label}
                    </button>
                    {action.description ? (
                      <p className="mt-2 text-xs text-slate-500">{action.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
