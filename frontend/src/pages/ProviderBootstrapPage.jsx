import { Link } from "react-router-dom";
import { useState } from "react";
import { bootstrapTenant } from "../api/providerAdmin.js";
import { useI18n } from "../i18n/useI18n.js";

function createInitialForm() {
  return {
    providerKey: import.meta.env.VITE_PROVIDER_API_KEY || "",
    tenantCode: "",
    tenantName: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  };
}

export default function ProviderBootstrapPage() {
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = (en, tr) => (isTr ? tr : en);
  const [form, setForm] = useState(createInitialForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setResult(null);

    const payload = {
      tenantCode: form.tenantCode.trim().toUpperCase(),
      tenantName: form.tenantName.trim(),
      adminName: form.adminName.trim(),
      adminEmail: form.adminEmail.trim(),
      adminPassword: form.adminPassword,
    };

    setSaving(true);
    try {
      const response = await bootstrapTenant(payload, form.providerKey.trim());
      setResult(response || null);
      setMessage(
        l(
          "Tenant and first admin were created successfully.",
          "Kiraci ve ilk admin basariyla olusturuldu."
        )
      );
      setForm((prev) => ({
        ...prev,
        tenantCode: "",
        tenantName: "",
        adminName: "",
        adminEmail: "",
        adminPassword: "",
      }));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Provisioning failed.", "Provisyon islemi basarisiz.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-dvh bg-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-semibold text-slate-900">
            {l("Provider Tenant Bootstrap", "Provider Kiraci Baslatma")}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {l(
              "Create a new tenant and first administrator user from the UI.",
              "Arayuzden yeni kiraci ve ilk yonetici kullaniciyi olusturun."
            )}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {l(
              "This screen requires a valid provider key (X-Provider-Key).",
              "Bu ekran gecerli bir provider anahtari gerektirir (X-Provider-Key)."
            )}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-2"
        >
          <input
            value={form.providerKey}
            onChange={(event) => setField("providerKey", event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            placeholder={l("Provider key", "Provider anahtari")}
            required
          />
          <input
            value={form.tenantCode}
            onChange={(event) => setField("tenantCode", event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Tenant code (e.g. ACME)", "Kiraci kodu (orn. ACME)")}
            required
          />
          <input
            value={form.tenantName}
            onChange={(event) => setField("tenantName", event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Tenant name", "Kiraci adi")}
            required
          />
          <input
            value={form.adminName}
            onChange={(event) => setField("adminName", event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Admin full name", "Admin tam adi")}
            required
          />
          <input
            type="email"
            value={form.adminEmail}
            onChange={(event) => setField("adminEmail", event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={l("Admin email", "Admin e-posta")}
            required
          />
          <input
            type="password"
            value={form.adminPassword}
            onChange={(event) => setField("adminPassword", event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            placeholder={l("Admin password (min 8 chars)", "Admin sifresi (en az 8 karakter)")}
            required
            minLength={8}
          />
          <div className="flex items-center justify-between gap-2 md:col-span-2">
            <Link
              to="/login"
              className="text-sm font-semibold text-slate-600 hover:text-slate-800"
            >
              {l("Back to login", "Girise don")}
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving
                ? l("Provisioning...", "Olusturuluyor...")
                : l("Create tenant", "Kiraci olustur")}
            </button>
          </div>
        </form>

        {result && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 text-sm text-emerald-900">
            <h2 className="font-semibold">
              {l("Provision Result", "Provisyon Sonucu")}
            </h2>
            <div className="mt-2 grid gap-1">
              <div>
                {l("Tenant:", "Kiraci:")} #{result.tenantId} ({result.tenantCode})
              </div>
              <div>
                {l("Admin:", "Admin:")} #{result.adminUserId} ({result.adminEmail})
              </div>
              <div>
                {l("Role ID:", "Rol ID:")} {result.adminRoleId}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
