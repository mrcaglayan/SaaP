import { useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../layouts/AuthLayout";
import LanguageSwitcher from "../i18n/LanguageSwitcher.jsx";
import { useI18n } from "../i18n/useI18n.js";
import { requestPasswordReset } from "../api/auth.js";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resetLink, setResetLink] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setResetLink("");
    try {
      const response = await requestPasswordReset({ email: email.trim() });
      setMessage(t("passwordResetRequest.messages.requested"));
      setResetLink(String(response?.reset?.resetUrl || ""));
    } catch (err) {
      setError(err?.response?.data?.message || t("passwordResetRequest.errors.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-slate-900">
          {t("passwordResetRequest.title")}
        </h2>
        <LanguageSwitcher />
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3">
        <label className="grid gap-1">
          <span>{t("passwordResetRequest.emailLabel")}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            required
          />
        </label>

        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {message ? <div className="text-sm text-emerald-700">{message}</div> : null}

        <button
          disabled={busy}
          type="submit"
          className="mt-2 rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy
            ? t("passwordResetRequest.actions.submitting")
            : t("passwordResetRequest.actions.submit")}
        </button>

        {resetLink ? (
          <div className="grid gap-2 rounded-md border border-sky-200 bg-sky-50 p-3">
            <div className="text-xs font-semibold text-sky-800">
              {t("passwordResetRequest.resetLinkReady")}
            </div>
            <div className="break-all rounded-md border border-sky-200 bg-white px-2 py-1 text-xs text-slate-700">
              {resetLink}
            </div>
            <button
              type="button"
              className="w-fit rounded-md border border-sky-300 px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resetLink);
                  setMessage(t("passwordResetRequest.messages.linkCopied"));
                } catch {
                  setError(t("passwordResetRequest.errors.copyFailed"));
                }
              }}
            >
              {t("passwordResetRequest.actions.copyLink")}
            </button>
          </div>
        ) : null}

        <Link className="text-sm text-sky-700 hover:underline" to="/login">
          {t("passwordResetRequest.actions.backToLogin")}
        </Link>
      </form>
    </AuthLayout>
  );
}
