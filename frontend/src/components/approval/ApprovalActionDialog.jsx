import { useState } from "react";

const TONE_CLASS_NAMES = {
  approve: "bg-emerald-600 text-white hover:bg-emerald-700",
  reject: "bg-rose-600 text-white hover:bg-rose-700",
  neutral: "bg-slate-900 text-white hover:bg-slate-800",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
};

/**
 * Collect an optional approval comment before executing a shared approval
 * action.
 */
export default function ApprovalActionDialog({
  open,
  title,
  description,
  authorityNotice = null,
  commentLabel = "Comment",
  commentPlaceholder = "",
  confirmLabel = "Confirm",
  confirmTone = "neutral",
  confirmBusyLabel = "Saving...",
  cancelLabel = "Cancel",
  initialComment = "",
  requireComment = false,
  submitting = false,
  error = "",
  onClose,
  onConfirm,
}) {
  const [comment, setComment] = useState(initialComment);
  const [validationError, setValidationError] = useState("");

  if (!open) {
    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const normalizedComment = String(comment || "").trim();
    if (requireComment && !normalizedComment) {
      setValidationError("Comment is required for this action.");
      return;
    }
    setValidationError("");
    await onConfirm(normalizedComment);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
      <button
        type="button"
        aria-label="Close approval action dialog"
        className="absolute inset-0"
        onClick={submitting ? undefined : onClose}
      />
      <div className="relative z-10 w-[min(92vw,34rem)] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
          </div>
          <button
            type="button"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900 disabled:opacity-50"
            onClick={onClose}
            disabled={submitting}
          >
            {cancelLabel}
          </button>
        </div>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          {authorityNotice?.title || authorityNotice?.description ? (
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${
                authorityNotice?.tone === "delegated"
                  ? "border-cyan-200 bg-cyan-50 text-cyan-900"
                  : authorityNotice?.tone === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {authorityNotice?.title ? (
                <div className="font-semibold">{authorityNotice.title}</div>
              ) : null}
              {authorityNotice?.description ? (
                <p className={authorityNotice?.title ? "mt-1" : ""}>
                  {authorityNotice.description}
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">{commentLabel}</span>
            <textarea
              rows={4}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={commentPlaceholder}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
              disabled={submitting}
            />
          </label>

          {validationError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {validationError}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={onClose}
              disabled={submitting}
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              className={`rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                TONE_CLASS_NAMES[confirmTone] || TONE_CLASS_NAMES.neutral
              }`}
              disabled={submitting}
            >
              {submitting ? confirmBusyLabel : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
