import { useEffect, useState } from "react";
import {
  createProviderCurrency,
  createProviderCountry,
  createProviderTenant,
  listProviderCountries,
  listProviderCurrencies,
  listProviderTenants,
  updateProviderCurrency,
  updateProviderCountry,
  updateProviderTenantStatus,
} from "../api/providerControl.js";
import { useI18n } from "../i18n/useI18n.js";
import { useProviderAuth } from "../provider/useProviderAuth.js";

function createInitialForm() {
  return {
    tenantCode: "",
    tenantName: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  };
}

function createInitialCountryForm() {
  return {
    iso2: "",
    iso3: "",
    name: "",
    defaultCurrencyCode: "",
  };
}

function createInitialCurrencyForm() {
  return {
    code: "",
    name: "",
    minorUnits: "2",
  };
}

function toTenantStatusLabel(t, status) {
  return t(
    ["providerBootstrap", "statuses", String(status || "").toUpperCase()],
    status || "-"
  );
}

export default function ProviderBootstrapPage() {
  const { token, providerAdmin, logout, clearSession } = useProviderAuth();
  const { t } = useI18n();
  const [form, setForm] = useState(createInitialForm());
  const [currencyForm, setCurrencyForm] = useState(createInitialCurrencyForm());
  const [countryForm, setCountryForm] = useState(createInitialCountryForm());
  const [query, setQuery] = useState("");
  const [currencyQuery, setCurrencyQuery] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [savingCountry, setSavingCountry] = useState(false);
  const [updatingTenantId, setUpdatingTenantId] = useState(null);
  const [updatingCurrencyCode, setUpdatingCurrencyCode] = useState(null);
  const [updatingCountryId, setUpdatingCountryId] = useState(null);
  const [editingCurrencyCode, setEditingCurrencyCode] = useState(null);
  const [editingCurrencyName, setEditingCurrencyName] = useState("");
  const [editingCurrencyMinorUnits, setEditingCurrencyMinorUnits] = useState("2");
  const [editingCountryId, setEditingCountryId] = useState(null);
  const [editingCountryName, setEditingCountryName] = useState("");
  const [editingCountryCurrencyCode, setEditingCountryCurrencyCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [countries, setCountries] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function setCurrencyField(field, value) {
    setCurrencyForm((prev) => ({ ...prev, [field]: value }));
  }

  function setCountryField(field, value) {
    setCountryForm((prev) => ({ ...prev, [field]: value }));
  }

  async function loadTenants(search = query) {
    if (!token) {
      return;
    }

    setLoadingTenants(true);
    setError("");
    try {
      const response = await listProviderTenants(token, {
        q: search || undefined,
        limit: 100,
        offset: 0,
      });
      setTenants(response?.rows || []);
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(err?.response?.data?.message || t("providerBootstrap.errors.loadTenants"));
    } finally {
      setLoadingTenants(false);
    }
  }

  async function loadCurrencies() {
    if (!token) {
      return;
    }

    setLoadingCurrencies(true);
    setError("");
    try {
      const response = await listProviderCurrencies(token);
      setCurrencies(response?.rows || []);
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(err?.response?.data?.message || t("providerBootstrap.errors.loadCurrencies"));
    } finally {
      setLoadingCurrencies(false);
    }
  }

  async function loadCountries(search = countryQuery) {
    if (!token) {
      return;
    }

    setLoadingCountries(true);
    setError("");
    try {
      const response = await listProviderCountries(token, {
        q: search || undefined,
        limit: 300,
        offset: 0,
      });
      setCountries(response?.rows || []);
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(err?.response?.data?.message || t("providerBootstrap.errors.loadCountries"));
    } finally {
      setLoadingCountries(false);
    }
  }

  useEffect(() => {
    loadTenants();
    loadCountries();
    loadCurrencies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCreateTenant(event) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setResult(null);
    try {
      const response = await createProviderTenant(token, {
        tenantCode: form.tenantCode.trim().toUpperCase(),
        tenantName: form.tenantName.trim(),
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim(),
        adminPassword: form.adminPassword,
      });
      setResult(response || null);
      setMessage(t("providerBootstrap.messages.created"));
      setForm(createInitialForm());
      await loadTenants();
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(err?.response?.data?.message || t("providerBootstrap.errors.provisionFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetTenantStatus(tenantId, status) {
    if (!token) {
      return;
    }

    setUpdatingTenantId(tenantId);
    setError("");
    setMessage("");
    try {
      await updateProviderTenantStatus(token, tenantId, status);
      setMessage(
        t("providerBootstrap.messages.statusUpdated", {
          id: tenantId,
          status: toTenantStatusLabel(t, status),
        })
      );
      await loadTenants();
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(
        err?.response?.data?.message || t("providerBootstrap.errors.updateStatus")
      );
    } finally {
      setUpdatingTenantId(null);
    }
  }

  async function handleCreateCurrency(event) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSavingCurrency(true);
    setError("");
    setMessage("");
    try {
      await createProviderCurrency(token, {
        code: currencyForm.code.trim().toUpperCase(),
        name: currencyForm.name.trim(),
        minorUnits: Number(currencyForm.minorUnits),
      });
      setCurrencyForm(createInitialCurrencyForm());
      setMessage(t("providerBootstrap.messages.currencyCreated"));
      await loadCurrencies();
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(err?.response?.data?.message || t("providerBootstrap.errors.createCurrency"));
    } finally {
      setSavingCurrency(false);
    }
  }

  function handleStartEditCurrency(currency) {
    setEditingCurrencyCode(currency.code);
    setEditingCurrencyName(currency.name || "");
    setEditingCurrencyMinorUnits(String(currency.minorUnits ?? 2));
  }

  function handleCancelEditCurrency() {
    setEditingCurrencyCode(null);
    setEditingCurrencyName("");
    setEditingCurrencyMinorUnits("2");
  }

  async function handleSaveCurrency(currencyCode) {
    if (!token) {
      return;
    }

    setUpdatingCurrencyCode(currencyCode);
    setError("");
    setMessage("");
    try {
      await updateProviderCurrency(token, currencyCode, {
        name: editingCurrencyName.trim(),
        minorUnits: Number(editingCurrencyMinorUnits),
      });
      setMessage(t("providerBootstrap.messages.currencyUpdated", { code: currencyCode }));
      handleCancelEditCurrency();
      await loadCurrencies();
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(err?.response?.data?.message || t("providerBootstrap.errors.updateCurrency"));
    } finally {
      setUpdatingCurrencyCode(null);
    }
  }

  async function handleCreateCountry(event) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSavingCountry(true);
    setError("");
    setMessage("");
    try {
      await createProviderCountry(token, {
        iso2: countryForm.iso2.trim().toUpperCase(),
        iso3: countryForm.iso3.trim().toUpperCase(),
        name: countryForm.name.trim(),
        defaultCurrencyCode: countryForm.defaultCurrencyCode.trim().toUpperCase(),
      });
      setCountryForm(createInitialCountryForm());
      setMessage(t("providerBootstrap.messages.countryCreated"));
      await loadCountries();
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(err?.response?.data?.message || t("providerBootstrap.errors.createCountry"));
    } finally {
      setSavingCountry(false);
    }
  }

  function handleStartEditCountry(country) {
    setEditingCountryId(country.id);
    setEditingCountryName(country.name || "");
    setEditingCountryCurrencyCode(country.defaultCurrencyCode || "");
  }

  function handleCancelEditCountry() {
    setEditingCountryId(null);
    setEditingCountryName("");
    setEditingCountryCurrencyCode("");
  }

  async function handleSaveCountry(countryId) {
    if (!token) {
      return;
    }

    setUpdatingCountryId(countryId);
    setError("");
    setMessage("");
    try {
      await updateProviderCountry(token, countryId, {
        name: editingCountryName.trim(),
        defaultCurrencyCode: editingCountryCurrencyCode.trim().toUpperCase(),
      });
      setMessage(t("providerBootstrap.messages.countryUpdated", { id: countryId }));
      handleCancelEditCountry();
      await loadCountries();
    } catch (err) {
      if (err?.response?.status === 401) {
        clearSession();
      }
      setError(err?.response?.data?.message || t("providerBootstrap.errors.updateCountry"));
    } finally {
      setUpdatingCountryId(null);
    }
  }

  const normalizedCurrencyQuery = currencyQuery.trim().toUpperCase();
  const filteredCurrencies = normalizedCurrencyQuery
    ? currencies.filter((currency) => {
        const code = String(currency.code || "").toUpperCase();
        const name = String(currency.name || "").toUpperCase();
        return (
          code.includes(normalizedCurrencyQuery) ||
          name.includes(normalizedCurrencyQuery)
        );
      })
    : currencies;

  return (
    <main className="min-h-dvh bg-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">
                {t("providerBootstrap.title")}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {t("providerBootstrap.subtitle")}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {t("providerBootstrap.signedInAs")}{" "}
                <span className="font-semibold text-slate-700">
                  {providerAdmin?.name || providerAdmin?.email || t("providerBootstrap.providerAdminFallback")}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("providerBootstrap.logout")}
            </button>
          </div>
        </section>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700">
              {t("providerBootstrap.createTenant.title")}
            </h2>
            <form onSubmit={handleCreateTenant} className="mt-3 grid gap-3">
              <input
                value={form.tenantCode}
                onChange={(event) => setField("tenantCode", event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("providerBootstrap.createTenant.placeholders.tenantCode")}
                required
              />
              <input
                value={form.tenantName}
                onChange={(event) => setField("tenantName", event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("providerBootstrap.createTenant.placeholders.tenantName")}
                required
              />
              <input
                value={form.adminName}
                onChange={(event) => setField("adminName", event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("providerBootstrap.createTenant.placeholders.adminName")}
                required
              />
              <input
                type="email"
                value={form.adminEmail}
                onChange={(event) => setField("adminEmail", event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("providerBootstrap.createTenant.placeholders.adminEmail")}
                required
              />
              <input
                type="password"
                value={form.adminPassword}
                onChange={(event) => setField("adminPassword", event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t(
                  "providerBootstrap.createTenant.placeholders.adminPassword"
                )}
                required
                minLength={8}
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving
                  ? t("providerBootstrap.createTenant.actions.provisioning")
                  : t("providerBootstrap.createTenant.actions.create")}
              </button>
            </form>

            {result ? (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-sm text-emerald-900">
                <h3 className="font-semibold">
                  {t("providerBootstrap.createTenant.result.title")}
                </h3>
                <div className="mt-2 grid gap-1 text-xs">
                  <div>
                    {t("providerBootstrap.createTenant.result.tenant", {
                      id: result.tenantId,
                      code: result.tenantCode,
                    })}
                  </div>
                  <div>
                    {t("providerBootstrap.createTenant.result.admin", {
                      id: result.adminUserId,
                      email: result.adminEmail,
                    })}
                  </div>
                  <div>
                    {t("providerBootstrap.createTenant.result.roleId", {
                      id: result.adminRoleId,
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">
                {t("providerBootstrap.directory.title")}
              </h2>
              <button
                type="button"
                onClick={() => loadTenants()}
                disabled={loadingTenants}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              >
                {loadingTenants
                  ? t("providerBootstrap.directory.loading")
                  : t("providerBootstrap.directory.refresh")}
              </button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                loadTenants(query);
              }}
              className="mt-3 flex gap-2"
            >
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("providerBootstrap.directory.searchPlaceholder")}
              />
              <button
                type="submit"
                disabled={loadingTenants}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {t("providerBootstrap.directory.search")}
              </button>
            </form>

            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">{t("providerBootstrap.directory.columns.code")}</th>
                    <th className="px-3 py-2">{t("providerBootstrap.directory.columns.name")}</th>
                    <th className="px-3 py-2">{t("providerBootstrap.directory.columns.status")}</th>
                    <th className="px-3 py-2">{t("providerBootstrap.directory.columns.users")}</th>
                    <th className="px-3 py-2">{t("providerBootstrap.directory.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <tr key={tenant.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{tenant.id}</td>
                      <td className="px-3 py-2">{tenant.code}</td>
                      <td className="px-3 py-2">{tenant.name}</td>
                      <td className="px-3 py-2">
                        {toTenantStatusLabel(t, tenant.status)}
                      </td>
                      <td className="px-3 py-2">
                        {tenant.activeUserCount}/{tenant.userCount}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSetTenantStatus(tenant.id, "ACTIVE")}
                            disabled={
                              updatingTenantId === tenant.id || tenant.status === "ACTIVE"
                            }
                            className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                          >
                            {t("providerBootstrap.directory.actions.activate")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetTenantStatus(tenant.id, "SUSPENDED")}
                            disabled={
                              updatingTenantId === tenant.id ||
                              tenant.status === "SUSPENDED"
                            }
                            className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-700 disabled:opacity-60"
                          >
                            {t("providerBootstrap.directory.actions.suspend")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {tenants.length === 0 && !loadingTenants ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-slate-500">
                        {t("providerBootstrap.directory.empty")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("providerBootstrap.currencies.title")}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {t("providerBootstrap.currencies.subtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadCurrencies()}
              disabled={loadingCurrencies}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {loadingCurrencies
                ? t("providerBootstrap.currencies.loading")
                : t("providerBootstrap.currencies.refresh")}
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.5fr]">
            <section className="rounded-lg border border-slate-200 bg-slate-50/40 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t("providerBootstrap.currencies.create.title")}
              </h3>
              <form onSubmit={handleCreateCurrency} className="mt-3 grid gap-3">
                <input
                  value={currencyForm.code}
                  onChange={(event) => setCurrencyField("code", event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
                  placeholder={t("providerBootstrap.currencies.create.placeholders.code")}
                  maxLength={3}
                  required
                />
                <input
                  value={currencyForm.name}
                  onChange={(event) => setCurrencyField("name", event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("providerBootstrap.currencies.create.placeholders.name")}
                  required
                />
                <input
                  type="number"
                  min={0}
                  max={9}
                  step={1}
                  value={currencyForm.minorUnits}
                  onChange={(event) =>
                    setCurrencyField("minorUnits", event.target.value)
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("providerBootstrap.currencies.create.placeholders.minorUnits")}
                />
                <button
                  type="submit"
                  disabled={savingCurrency}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {savingCurrency
                    ? t("providerBootstrap.currencies.create.actions.creating")
                    : t("providerBootstrap.currencies.create.actions.create")}
                </button>
              </form>
              <p className="mt-3 text-xs text-slate-500">
                {t("providerBootstrap.currencies.immutableCodeNote")}
              </p>
            </section>

            <section>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                }}
                className="flex gap-2"
              >
                <input
                  value={currencyQuery}
                  onChange={(event) => setCurrencyQuery(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("providerBootstrap.currencies.searchPlaceholder")}
                />
              </form>

              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2">
                        {t("providerBootstrap.currencies.columns.code")}
                      </th>
                      <th className="px-3 py-2">
                        {t("providerBootstrap.currencies.columns.name")}
                      </th>
                      <th className="px-3 py-2">
                        {t("providerBootstrap.currencies.columns.minorUnits")}
                      </th>
                      <th className="px-3 py-2">
                        {t("providerBootstrap.currencies.columns.actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCurrencies.map((currency) => {
                      const isEditing = editingCurrencyCode === currency.code;
                      return (
                        <tr key={currency.code} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono">{currency.code}</td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <input
                                value={editingCurrencyName}
                                onChange={(event) =>
                                  setEditingCurrencyName(event.target.value)
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            ) : (
                              currency.name
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <input
                                type="number"
                                min={0}
                                max={9}
                                step={1}
                                value={editingCurrencyMinorUnits}
                                onChange={(event) =>
                                  setEditingCurrencyMinorUnits(event.target.value)
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            ) : (
                              <span className="font-mono">{currency.minorUnits}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSaveCurrency(currency.code)}
                                  disabled={updatingCurrencyCode === currency.code}
                                  className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                                >
                                  {t("providerBootstrap.currencies.actions.save")}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEditCurrency}
                                  disabled={updatingCurrencyCode === currency.code}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
                                >
                                  {t("providerBootstrap.currencies.actions.cancel")}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleStartEditCurrency(currency)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                              >
                                {t("providerBootstrap.currencies.actions.edit")}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredCurrencies.length === 0 && !loadingCurrencies ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-slate-500">
                          {t("providerBootstrap.currencies.empty")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {t("providerBootstrap.countries.title")}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {t("providerBootstrap.countries.subtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                loadCountries();
                loadCurrencies();
              }}
              disabled={loadingCountries || loadingCurrencies}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {loadingCountries || loadingCurrencies
                ? t("providerBootstrap.countries.loading")
                : t("providerBootstrap.countries.refresh")}
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.5fr]">
            <section className="rounded-lg border border-slate-200 bg-slate-50/40 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {t("providerBootstrap.countries.create.title")}
              </h3>
              <form onSubmit={handleCreateCountry} className="mt-3 grid gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={countryForm.iso2}
                    onChange={(event) => setCountryField("iso2", event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
                    placeholder={t("providerBootstrap.countries.create.placeholders.iso2")}
                    maxLength={2}
                    required
                  />
                  <input
                    value={countryForm.iso3}
                    onChange={(event) => setCountryField("iso3", event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
                    placeholder={t("providerBootstrap.countries.create.placeholders.iso3")}
                    maxLength={3}
                    required
                  />
                </div>
                <input
                  value={countryForm.name}
                  onChange={(event) => setCountryField("name", event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("providerBootstrap.countries.create.placeholders.name")}
                  required
                />
                <select
                  value={countryForm.defaultCurrencyCode}
                  onChange={(event) =>
                    setCountryField("defaultCurrencyCode", event.target.value)
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">
                    {t("providerBootstrap.countries.create.placeholders.defaultCurrencyCode")}
                  </option>
                  {currencies.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code} - {currency.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={savingCountry}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {savingCountry
                    ? t("providerBootstrap.countries.create.actions.creating")
                    : t("providerBootstrap.countries.create.actions.create")}
                </button>
              </form>
              <p className="mt-3 text-xs text-slate-500">
                {t("providerBootstrap.countries.immutableCodesNote")}
              </p>
            </section>

            <section>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  loadCountries(countryQuery);
                }}
                className="flex gap-2"
              >
                <input
                  value={countryQuery}
                  onChange={(event) => setCountryQuery(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t("providerBootstrap.countries.searchPlaceholder")}
                />
                <button
                  type="submit"
                  disabled={loadingCountries}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {t("providerBootstrap.countries.search")}
                </button>
              </form>

              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">{t("providerBootstrap.countries.columns.iso2")}</th>
                      <th className="px-3 py-2">{t("providerBootstrap.countries.columns.iso3")}</th>
                      <th className="px-3 py-2">{t("providerBootstrap.countries.columns.name")}</th>
                      <th className="px-3 py-2">
                        {t("providerBootstrap.countries.columns.defaultCurrencyCode")}
                      </th>
                      <th className="px-3 py-2">{t("providerBootstrap.countries.columns.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countries.map((country) => {
                      const isEditing = editingCountryId === country.id;
                      return (
                        <tr key={country.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">{country.id}</td>
                          <td className="px-3 py-2 font-mono">{country.iso2}</td>
                          <td className="px-3 py-2 font-mono">{country.iso3}</td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <input
                                value={editingCountryName}
                                onChange={(event) =>
                                  setEditingCountryName(event.target.value)
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            ) : (
                              country.name
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <select
                                value={editingCountryCurrencyCode}
                                onChange={(event) =>
                                  setEditingCountryCurrencyCode(event.target.value)
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              >
                                <option value="">
                                  {t("providerBootstrap.countries.create.placeholders.defaultCurrencyCode")}
                                </option>
                                {currencies.map((currency) => (
                                  <option key={currency.code} value={currency.code}>
                                    {currency.code}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="font-mono">{country.defaultCurrencyCode}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSaveCountry(country.id)}
                                  disabled={updatingCountryId === country.id}
                                  className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                                >
                                  {t("providerBootstrap.countries.actions.save")}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEditCountry}
                                  disabled={updatingCountryId === country.id}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
                                >
                                  {t("providerBootstrap.countries.actions.cancel")}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleStartEditCountry(country)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                              >
                                {t("providerBootstrap.countries.actions.edit")}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {countries.length === 0 && !loadingCountries ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-3 text-slate-500">
                          {t("providerBootstrap.countries.empty")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
