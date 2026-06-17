import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Pencil, Plus, RefreshCw, Save, Search } from "lucide-react";
import {
  createCloseTaskTemplate,
  disableCloseTaskTemplate,
  listCloseTaskTemplates,
  updateCloseTaskTemplate,
} from "../api/closeTasks.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";

const TEMPLATE_STATUSES = Object.freeze(["", "ACTIVE", "PAUSED", "DISABLED"]);
const TASK_FAMILIES = Object.freeze([
  "",
  "RECONCILIATION",
  "SUBLEDGER",
  "PAYROLL",
  "INVENTORY",
  "FIXED_ASSET",
  "TAX",
  "FX",
  "INTERCOMPANY",
  "REPORTING",
  "CERTIFICATION",
  "MANUAL",
]);
const CYCLE_SCOPE_KINDS = Object.freeze(["ANY", "LEGAL_ENTITY", "CONSOLIDATION_GROUP"]);
const RBAC_SCOPE_TYPES = Object.freeze(["OPERATING_UNIT", "LEGAL_ENTITY", "COUNTRY", "GROUP"]);
const WORK_SCOPE_TYPES = Object.freeze([
  "CYCLE",
  "BOOK",
  "CENTRAL",
  "OPERATING_UNIT",
  "LOCAL_CLOSE_PACK",
  "PERIOD_CLOSE_RUN",
  "CONSOLIDATION_GROUP",
]);
const ANCHOR_ITEM_TYPES = Object.freeze(["ANY", "LOCAL_CLOSE_PACK", "PERIOD_CLOSE_RUN", "CONSOLIDATION_RUN"]);
const MATERIALIZATION_MODES = Object.freeze(["CYCLE", "ITEM", "MANUAL_ONLY"]);
const COMPLETION_MODES = Object.freeze([
  "MANUAL",
  "MANUAL_WITH_EVIDENCE",
  "SYSTEM_CHECK",
  "SOURCE_STATUS",
  "HYBRID_REVIEW",
]);
const OWNER_STRATEGIES = Object.freeze(["CYCLE_OWNER", "ITEM_OWNER", "LOCAL_CLOSE_PACK_OWNER", "MANUAL"]);
const REVIEWER_STRATEGIES = Object.freeze(["CYCLE_OWNER", "LOCAL_CLOSE_PACK_REVIEWER", "MANUAL"]);

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toDisplayText(value, fallback = "-") {
  const text = String(value || "").trim();
  return text ? text.replaceAll("_", " ") : fallback;
}

function getApiErrorMessage(error, fallback) {
  return (
    error?.normalizedError?.message ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

function getTemplateStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "ACTIVE":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "PAUSED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "DISABLED":
      return "border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

function emptyTemplateForm() {
  return {
    id: "",
    tenantId: "",
    taskCode: "",
    taskName: "",
    taskDescription: "",
    taskFamily: "MANUAL",
    cycleScopeKind: "ANY",
    defaultRbacScopeType: "LEGAL_ENTITY",
    defaultWorkScopeType: "CYCLE",
    anchorItemType: "ANY",
    materializationMode: "MANUAL_ONLY",
    completionMode: "MANUAL",
    sourceCheckCode: "",
    sourceRefType: "",
    sourceRefIdStrategy: "",
    autoCompleteAllowed: false,
    defaultDueOffsetDays: "0",
    evidenceRequired: false,
    requiredForCycleLock: false,
    defaultOwnerStrategy: "MANUAL",
    defaultReviewerStrategy: "MANUAL",
    blockerClass: "",
    sortOrder: "1000",
    status: "ACTIVE",
  };
}

function buildFormFromTemplate(row = {}) {
  return {
    ...emptyTemplateForm(),
    id: row.id ? String(row.id) : "",
    tenantId: row.tenantId ? String(row.tenantId) : "",
    taskCode: row.taskCode || "",
    taskName: row.taskName || "",
    taskDescription: row.taskDescription || "",
    taskFamily: row.taskFamily || "MANUAL",
    cycleScopeKind: row.cycleScopeKind || "ANY",
    defaultRbacScopeType: row.defaultRbacScopeType || "LEGAL_ENTITY",
    defaultWorkScopeType: row.defaultWorkScopeType || "CYCLE",
    anchorItemType: row.anchorItemType || "ANY",
    materializationMode: row.materializationMode || "MANUAL_ONLY",
    completionMode: row.completionMode || "MANUAL",
    sourceCheckCode: row.sourceCheckCode || "",
    sourceRefType: row.sourceRefType || "",
    sourceRefIdStrategy: row.sourceRefIdStrategy || "",
    autoCompleteAllowed: Boolean(row.autoCompleteAllowed),
    defaultDueOffsetDays: String(row.defaultDueOffsetDays ?? 0),
    evidenceRequired: Boolean(row.evidenceRequired),
    requiredForCycleLock: Boolean(row.requiredForCycleLock),
    defaultOwnerStrategy: row.defaultOwnerStrategy || "MANUAL",
    defaultReviewerStrategy: row.defaultReviewerStrategy || "MANUAL",
    blockerClass: row.blockerClass || "",
    sortOrder: String(row.sortOrder ?? 1000),
    status: row.status || "ACTIVE",
  };
}

function buildTemplatePayload(form) {
  return {
    taskCode: form.taskCode,
    taskName: form.taskName,
    taskDescription: form.taskDescription || null,
    taskFamily: form.taskFamily,
    cycleScopeKind: form.cycleScopeKind,
    defaultRbacScopeType: form.defaultRbacScopeType,
    defaultWorkScopeType: form.defaultWorkScopeType,
    anchorItemType: form.anchorItemType,
    materializationMode: form.materializationMode,
    completionMode: form.completionMode,
    sourceCheckCode: form.sourceCheckCode || null,
    sourceRefType: form.sourceRefType || null,
    sourceRefIdStrategy: form.sourceRefIdStrategy || null,
    autoCompleteAllowed: Boolean(form.autoCompleteAllowed),
    defaultDueOffsetDays: Number(form.defaultDueOffsetDays || 0),
    evidenceRequired: Boolean(form.evidenceRequired),
    requiredForCycleLock: Boolean(form.requiredForCycleLock),
    defaultOwnerStrategy: form.defaultOwnerStrategy,
    defaultReviewerStrategy: form.defaultReviewerStrategy,
    blockerClass: form.blockerClass || null,
    sortOrder: Number(form.sortOrder || 1000),
    status: form.status,
  };
}

function IconButton({ icon: Icon, children, disabled, title, className = "", ...props }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

function FieldLabel({ children }) {
  return <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</label>;
}

function SelectField({ label, value, options, onChange }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option || "ALL"} value={option}>
            {option ? toDisplayText(option) : "All"}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Render tenant template catalog management for close checklist tasks.
 */
export default function CloseTaskTemplateAdminPage() {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const canReadTemplates = hasPermission("close.task.template.read");
  const canWriteTemplates = hasPermission("close.task.template.write");

  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [filters, setFilters] = useState({ status: "", taskFamily: "", q: "" });
  const [form, setForm] = useState(() => emptyTemplateForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  const selectedTemplate = useMemo(
    () => templates.find((row) => String(row?.id || "") === String(selectedTemplateId || "")) || null,
    [selectedTemplateId, templates],
  );
  const selectedIsTenantTemplate = Boolean(toPositiveInt(selectedTemplate?.tenantId));
  const saveMode = selectedTemplate && !selectedIsTenantTemplate ? "override" : selectedTemplate ? "update" : "create";

  useEffect(() => {
    if (!canReadTemplates) {
      return;
    }
    let cancelled = false;
    async function loadTemplates() {
      setLoading(true);
      setError("");
      try {
        const response = await listCloseTaskTemplates({
          includeGlobal: true,
          status: filters.status || undefined,
          taskFamily: filters.taskFamily || undefined,
          q: filters.q || undefined,
          limit: 500,
        });
        if (!cancelled) {
          const rows = response?.rows || [];
          setTemplates(rows);
          if (selectedTemplateId && !rows.some((row) => String(row.id) === String(selectedTemplateId))) {
            setSelectedTemplateId("");
            setForm(emptyTemplateForm());
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(getApiErrorMessage(err, l("Templates could not be loaded.", "Sablonlar yuklenemedi.")));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [canReadTemplates, filters.q, filters.status, filters.taskFamily, l, reloadNonce, selectedTemplateId]);

  function selectTemplate(row) {
    setSelectedTemplateId(row?.id ? String(row.id) : "");
    setForm(row ? buildFormFromTemplate(row) : emptyTemplateForm());
    setError("");
    setMessage("");
  }

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!form.taskCode.trim() || !form.taskName.trim()) {
      setError(l("Task code and task name are required.", "Gorev kodu ve gorev adi gerekli."));
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = buildTemplatePayload(form);
      let response;
      if (saveMode === "update") {
        response = await updateCloseTaskTemplate(form.id, payload);
        setMessage(l("Template updated.", "Sablon guncellendi."));
      } else {
        response = await createCloseTaskTemplate(payload);
        setMessage(
          saveMode === "override"
            ? l("Tenant override created.", "Tenant override olusturuldu.")
            : l("Template created.", "Sablon olusturuldu."),
        );
      }
      const row = response?.row || null;
      if (row?.id) {
        setSelectedTemplateId(String(row.id));
        setForm(buildFormFromTemplate(row));
      }
      setReloadNonce((value) => value + 1);
    } catch (err) {
      setError(getApiErrorMessage(err, l("Template could not be saved.", "Sablon kaydedilemedi.")));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable() {
    if (!form.taskCode.trim()) {
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      let response;
      if (selectedTemplate && selectedIsTenantTemplate) {
        response = await disableCloseTaskTemplate(selectedTemplate.id);
      } else {
        response = await createCloseTaskTemplate({
          ...buildTemplatePayload(form),
          status: "DISABLED",
        });
      }
      const row = response?.row || null;
      if (row?.id) {
        setSelectedTemplateId(String(row.id));
        setForm(buildFormFromTemplate(row));
      }
      setMessage(l("Template disabled.", "Sablon devre disi birakildi."));
      setReloadNonce((value) => value + 1);
    } catch (err) {
      setError(getApiErrorMessage(err, l("Template could not be disabled.", "Sablon devre disi birakilamadi.")));
    } finally {
      setSaving(false);
    }
  }

  if (!canReadTemplates) {
    return (
      <div className="p-8">
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          {l("Close task template access is missing.", "Kapanis gorev sablonu erisimi eksik.")}
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {l("Year-end close", "Yilsonu kapanis")}
            </p>
            <h1 className="text-3xl font-semibold text-slate-950">
              {l("Close Task Templates", "Kapanis Gorev Sablonlari")}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/app/donem-sonu-islemler/yillik/kapanis-gorevleri"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              <span>{l("Task board", "Gorev panosu")}</span>
            </Link>
            <IconButton
              icon={RefreshCw}
              onClick={() => setReloadNonce((value) => value + 1)}
              className="border-slate-300 bg-white text-slate-700 shadow-sm"
            >
              {l("Refresh", "Yenile")}
            </IconButton>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),minmax(460px,0.75fr)]">
          <main className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <SelectField
                  label={l("Status", "Durum")}
                  value={filters.status}
                  options={TEMPLATE_STATUSES}
                  onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
                />
                <SelectField
                  label={l("Family", "Aile")}
                  value={filters.taskFamily}
                  options={TASK_FAMILIES}
                  onChange={(value) => setFilters((prev) => ({ ...prev, taskFamily: value }))}
                />
                <div>
                  <FieldLabel>{l("Search", "Arama")}</FieldLabel>
                  <div className="mt-1 flex rounded-lg border border-slate-300 bg-white">
                    <Search className="ml-3 mt-2.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <input
                      value={filters.q}
                      onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
                      className="min-w-0 flex-1 rounded-lg px-2 py-2 text-sm outline-none"
                      placeholder={l("Task code or name", "Gorev kodu veya adi")}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{l("Template catalog", "Sablon katalogu")}</h2>
                  <p className="text-sm text-slate-500">
                    {loading ? l("Loading templates...", "Sablonlar yukleniyor...") : `${templates.length} ${l("templates", "sablon")}`}
                  </p>
                </div>
                <IconButton
                  icon={Plus}
                  onClick={() => selectTemplate(null)}
                  className="border-cyan-700 bg-cyan-700 text-white"
                >
                  {l("New", "Yeni")}
                </IconButton>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="w-[260px] px-4 py-3">{l("Template", "Sablon")}</th>
                      <th className="w-[130px] px-4 py-3">{l("Family", "Aile")}</th>
                      <th className="w-[150px] px-4 py-3">{l("Cycle scope", "Dongu kapsami")}</th>
                      <th className="w-[140px] px-4 py-3">{l("RBAC scope", "RBAC kapsam")}</th>
                      <th className="w-[155px] px-4 py-3">{l("Completion", "Tamamlama")}</th>
                      <th className="w-[110px] px-4 py-3">{l("Evidence", "Kanit")}</th>
                      <th className="w-[110px] px-4 py-3">{l("Lock", "Kilit")}</th>
                      <th className="w-[105px] px-4 py-3">{l("Status", "Durum")}</th>
                      <th className="w-[95px] px-4 py-3">{l("Actions", "Aksiyon")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((row) => {
                      const selected = String(row.id) === String(selectedTemplateId);
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-slate-100 align-top ${selected ? "bg-cyan-50/60" : "bg-white"}`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{row.taskName || "-"}</div>
                            <div className="mt-1 truncate text-xs text-slate-500">{row.taskCode || "-"}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {row.tenantId ? l("Tenant", "Tenant") : l("Global", "Global")}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{toDisplayText(row.taskFamily)}</td>
                          <td className="px-4 py-3 text-slate-700">{toDisplayText(row.cycleScopeKind)}</td>
                          <td className="px-4 py-3 text-slate-700">{row.defaultRbacScopeType || "-"}</td>
                          <td className="px-4 py-3 text-slate-700">{toDisplayText(row.completionMode)}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {row.evidenceRequired ? l("Required", "Gerekli") : l("Optional", "Opsiyonel")}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {row.requiredForCycleLock ? l("Required", "Gerekli") : l("No", "Hayir")}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getTemplateStatusTone(
                                row.status,
                              )}`}
                            >
                              <span className="truncate">{toDisplayText(row.status)}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <IconButton
                              icon={Pencil}
                              onClick={() => selectTemplate(row)}
                              className="w-full border-slate-300 bg-white text-slate-700"
                            >
                              {l("Edit", "Duzenle")}
                            </IconButton>
                          </td>
                        </tr>
                      );
                    })}
                    {!loading && templates.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                          {l("No templates match the filters.", "Filtrelere uyan sablon yok.")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </main>

          <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {selectedTemplate ? l("Template detail", "Sablon detayi") : l("New template", "Yeni sablon")}
                </h2>
                <p className="text-sm text-slate-500">
                  {saveMode === "override"
                    ? l("Saving creates a tenant override.", "Kaydetme tenant override olusturur.")
                    : saveMode === "update"
                      ? l("Tenant template", "Tenant sablonu")
                      : l("Tenant catalog row", "Tenant katalog satiri")}
                </p>
              </div>
              {selectedTemplate ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  #{selectedTemplate.id}
                </span>
              ) : null}
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel>{l("Task code", "Gorev kodu")}</FieldLabel>
                  <input
                    value={form.taskCode}
                    onChange={(event) => updateForm("taskCode", event.target.value)}
                    disabled={saveMode === "update"}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                  />
                </div>
                <SelectField
                  label={l("Status", "Durum")}
                  value={form.status}
                  options={TEMPLATE_STATUSES.filter(Boolean)}
                  onChange={(value) => updateForm("status", value)}
                />
                <div className="sm:col-span-2">
                  <FieldLabel>{l("Task name", "Gorev adi")}</FieldLabel>
                  <input
                    value={form.taskName}
                    onChange={(event) => updateForm("taskName", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel>{l("Description", "Aciklama")}</FieldLabel>
                  <textarea
                    value={form.taskDescription}
                    onChange={(event) => updateForm("taskDescription", event.target.value)}
                    className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <SelectField
                  label={l("Family", "Aile")}
                  value={form.taskFamily}
                  options={TASK_FAMILIES.filter(Boolean)}
                  onChange={(value) => updateForm("taskFamily", value)}
                />
                <SelectField
                  label={l("Cycle scope kind", "Dongu kapsam tipi")}
                  value={form.cycleScopeKind}
                  options={CYCLE_SCOPE_KINDS}
                  onChange={(value) => updateForm("cycleScopeKind", value)}
                />
                <SelectField
                  label={l("Default RBAC scope", "Varsayilan RBAC kapsam")}
                  value={form.defaultRbacScopeType}
                  options={RBAC_SCOPE_TYPES}
                  onChange={(value) => updateForm("defaultRbacScopeType", value)}
                />
                <SelectField
                  label={l("Default work scope", "Varsayilan is kapsami")}
                  value={form.defaultWorkScopeType}
                  options={WORK_SCOPE_TYPES}
                  onChange={(value) => updateForm("defaultWorkScopeType", value)}
                />
                <SelectField
                  label={l("Anchor item", "Ankraj oge")}
                  value={form.anchorItemType}
                  options={ANCHOR_ITEM_TYPES}
                  onChange={(value) => updateForm("anchorItemType", value)}
                />
                <SelectField
                  label={l("Materialization", "Materializasyon")}
                  value={form.materializationMode}
                  options={MATERIALIZATION_MODES}
                  onChange={(value) => updateForm("materializationMode", value)}
                />
                <SelectField
                  label={l("Completion mode", "Tamamlama modu")}
                  value={form.completionMode}
                  options={COMPLETION_MODES}
                  onChange={(value) => updateForm("completionMode", value)}
                />
                <div>
                  <FieldLabel>{l("Source check code", "Kaynak kontrol kodu")}</FieldLabel>
                  <input
                    value={form.sourceCheckCode}
                    onChange={(event) => updateForm("sourceCheckCode", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Source ref type", "Kaynak ref tipi")}</FieldLabel>
                  <input
                    value={form.sourceRefType}
                    onChange={(event) => updateForm("sourceRefType", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Source id strategy", "Kaynak id stratejisi")}</FieldLabel>
                  <input
                    value={form.sourceRefIdStrategy}
                    onChange={(event) => updateForm("sourceRefIdStrategy", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Due offset days", "Vade offset gun")}</FieldLabel>
                  <input
                    value={form.defaultDueOffsetDays}
                    onChange={(event) => updateForm("defaultDueOffsetDays", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    inputMode="numeric"
                  />
                </div>
                <SelectField
                  label={l("Owner strategy", "Sahip stratejisi")}
                  value={form.defaultOwnerStrategy}
                  options={OWNER_STRATEGIES}
                  onChange={(value) => updateForm("defaultOwnerStrategy", value)}
                />
                <SelectField
                  label={l("Reviewer strategy", "Inceleyen stratejisi")}
                  value={form.defaultReviewerStrategy}
                  options={REVIEWER_STRATEGIES}
                  onChange={(value) => updateForm("defaultReviewerStrategy", value)}
                />
                <div>
                  <FieldLabel>{l("Blocker class", "Blokaj sinifi")}</FieldLabel>
                  <input
                    value={form.blockerClass}
                    onChange={(event) => updateForm("blockerClass", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>{l("Sort order", "Siralama")}</FieldLabel>
                  <input
                    value={form.sortOrder}
                    onChange={(event) => updateForm("sortOrder", event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    inputMode="numeric"
                  />
                </div>
                <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.evidenceRequired}
                    onChange={(event) => updateForm("evidenceRequired", event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>{l("Evidence required", "Kanit gerekli")}</span>
                </label>
                <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.requiredForCycleLock}
                    onChange={(event) => updateForm("requiredForCycleLock", event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>{l("Lock-required", "Kilit icin gerekli")}</span>
                </label>
                <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.autoCompleteAllowed}
                    onChange={(event) => updateForm("autoCompleteAllowed", event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>{l("Auto-complete", "Otomatik tamamlama")}</span>
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <IconButton
                  type="submit"
                  icon={Save}
                  disabled={!canWriteTemplates || saving}
                  title={!canWriteTemplates ? l("Missing close.task.template.write", "Eksik close.task.template.write") : ""}
                  className="border-slate-900 bg-slate-900 text-white"
                >
                  {saveMode === "override"
                    ? l("Save override", "Override kaydet")
                    : saveMode === "update"
                      ? l("Save", "Kaydet")
                      : l("Create", "Olustur")}
                </IconButton>
                <IconButton
                  icon={Ban}
                  disabled={!canWriteTemplates || saving || !form.taskCode.trim()}
                  onClick={handleDisable}
                  className="border-slate-300 bg-slate-100 text-slate-700"
                >
                  {l("Disable", "Devre disi")}
                </IconButton>
              </div>
            </form>
          </aside>
        </div>
      </div>
    </div>
  );
}
