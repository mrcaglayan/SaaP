import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthLayout from "../layouts/AuthLayout";
import LanguageSwitcher from "../i18n/LanguageSwitcher.jsx";
import { useI18n } from "../i18n/useI18n.js";
import { acceptInvite, getInvitePreview } from "../api/auth.js";

export default function AcceptInvitePage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const token = String(searchParams.get("token") || "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadInvite() {
      if (!token) {
        setError(t("inviteAccept.errors.missingToken"));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setMessage("");
      try {
        const response = await getInvitePreview(token);
        if (!active) return;
        const inviteRow = response?.invite || null;
        setInvite(inviteRow);
        setName(String(inviteRow?.name || ""));
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.message || t("inviteAccept.errors.loadFailed"));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadInvite();
    return () => {
      active = false;
    };
  }, [token, t]);

  const inviteStatus = useMemo(
    () => String(invite?.status || "").toUpperCase(),
    [invite?.status]
  );
  const canSubmit = inviteStatus === "PENDING";

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    if (password !== passwordConfirm) {
      setError(t("inviteAccept.errors.passwordMismatch"));
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      await acceptInvite(token, { name: name.trim(), password });
      setMessage(t("inviteAccept.messages.accepted"));
      setPassword("");
      setPasswordConfirm("");
      setInvite((prev) => ({ ...(prev || {}), status: "ACCEPTED" }));
    } catch (err) {
      setError(err?.response?.data?.message || t("inviteAccept.errors.acceptFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-slate-900">{t("inviteAccept.title")}</h2>
        <LanguageSwitcher />
      </div>

      {loading ? (
        <div className="text-sm text-slate-600">{t("inviteAccept.loading")}</div>
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <div>
              <span className="font-semibold">{t("inviteAccept.emailLabel")}:</span>{" "}
              {invite?.email || "-"}
            </div>
            <div>
              <span className="font-semibold">{t("inviteAccept.statusLabel")}:</span>{" "}
              {inviteStatus || "-"}
            </div>
          </div>

          <label className="grid gap-1">
            <span>{t("inviteAccept.nameLabel")}</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              disabled={!canSubmit || busy}
              required
            />
          </label>

          <label className="grid gap-1">
            <span>{t("inviteAccept.passwordLabel")}</span>
            <input
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              disabled={!canSubmit || busy}
              required
            />
          </label>

          <label className="grid gap-1">
            <span>{t("inviteAccept.passwordConfirmLabel")}</span>
            <input
              type="password"
              minLength={8}
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              disabled={!canSubmit || busy}
              required
            />
          </label>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {message ? <div className="text-sm text-emerald-700">{message}</div> : null}

          <button
            type="submit"
            disabled={!canSubmit || busy}
            className="mt-2 rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t("inviteAccept.actions.submitting") : t("inviteAccept.actions.submit")}
          </button>

          <Link className="text-sm text-sky-700 hover:underline" to="/login">
            {t("inviteAccept.actions.goToLogin")}
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
