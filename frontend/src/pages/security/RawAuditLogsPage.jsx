import { useEffect, useState } from "react";
import { listRawAuditLogs } from "../../api/rbacAdmin.js";
import { useI18n } from "../../i18n/useI18n.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
import SecurityDiagnosticsWorkbenchTabs from "./components/diagnostics/SecurityDiagnosticsWorkbenchTabs.jsx";

const SCOPE_TYPES = ["", "TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];

const EMPTY_FILTERS = {
  scopeType: "",
  scopeId: "",
  userId: "",
  action: "",
  resourceType: "",
  resourceId: "",
  requestId: "",
  createdFrom: "",
  createdTo: "",
};

function toDayStart(value) {
  const normalized = String(value || "").trim();
  return normalized ? `${normalized} 00:00:00` : undefined;
}

function toDayEnd(value) {
  const normalized = String(value || "").trim();
  return normalized ? `${normalized} 23:59:59` : undefined;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function stringifyPayload(payload) {
  if (payload === undefined || payload === null) {
    return "";
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function buildResourceLabel(row) {
  const type = String(row?.resource_type || "").trim();
  const id = String(row?.resource_id || "").trim();
  if (!type && !id) {
    return "-";
  }
  return id ? `${type}:${id}` : type;
}

function countActiveFilters(filters) {
  return Object.values(filters).filter((value) => String(value || "").trim()).length;
}

/**
 * Exposes low-level audit evidence inside the shared diagnostics workbench so
 * request-level payloads remain one click away from explainability and RBAC logs.
 */
export default function RawAuditLogsPage() {
  const { t, l } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
  });
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  async function loadLogs(nextPage = 1, activeFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const result = await listRawAuditLogs({
        page: nextPage,
        pageSize: pagination.pageSize,
        scopeType: activeFilters.scopeType || undefined,
        scopeId: activeFilters.scopeId || undefined,
        userId: activeFilters.userId || undefined,
        action: activeFilters.action || undefined,
        resourceType: activeFilters.resourceType || undefined,
        resourceId: activeFilters.resourceId || undefined,
        requestId: activeFilters.requestId || undefined,
        createdFrom: toDayStart(activeFilters.createdFrom),
        createdTo: toDayEnd(activeFilters.createdTo),
      });
      setRows(result?.rows || []);
      setPagination((prev) => ({
        ...prev,
        ...(result?.pagination || {}),
      }));
    } catch (err) {
      setError(err?.response?.data?.message || t("rawAuditLogs.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changePage(delta) {
    const nextPage = pagination.page + delta;
    if (nextPage < 1 || (pagination.totalPages && nextPage > pagination.totalPages)) {
      return;
    }
    loadLogs(nextPage);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    loadLogs(1, EMPTY_FILTERS);
  }

  const workspaceStats = [
    {
      title: l("Visible rows", "Gorunen satirlar"),
      value: rows.length,
      description: l(
        "Raw audit entries visible on the current page after the active filters.",
        "Etkin filtrelerden sonra mevcut sayfada gorunen ham denetim satirlari."
      ),
      tone: "blue",
    },
    {
      title: l("Total evidence", "Toplam kanit"),
      value: pagination.total,
      description: l(
        "Total raw audit records matching the current evidence query.",
        "Mevcut kanit sorgusuyla eslesen toplam ham denetim kayitlari."
      ),
      tone: "violet",
    },
    {
      title: l("Active filters", "Etkin filtreler"),
      value: countActiveFilters(filters),
      description: l(
        "User, scope, resource, request, and date filters currently narrowing the evidence trail.",
        "Kanit izini daraltan mevcut kullanici, kapsam, kaynak, istek ve tarih filtreleri."
      ),
      tone: "amber",
    },
    {
      title: l("Current page", "Mevcut sayfa"),
      value: pagination.page,
      description: l(
        "Pagination position inside the raw evidence stream.",
        "Ham kanit akisindaki sayfalama konumu."
      ),
      tone: "green",
    },
  ];
  const workspaceActions = [
    {
      label: l("RBAC audit logs", "RBAC denetim loglari"),
      to: "/app/ayarlar/security-admin/diagnostics?tab=audit",
    },
    {
      label: l("Sensitive data audit", "Hassas veri denetimi"),
      to: "/app/ayarlar/security-admin/diagnostics?tab=sensitive-data",
      tone: "primary",
    },
  ];

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="diagnostics"
      sectionKey="diagnostics-audit"
      eyebrow={l("Diagnostics & Audit", "Tanilama ve Denetim")}
      title={l("Raw audit logs", "Ham denetim loglari")}
      description={l(
        "Use the raw evidence stream when explainability or structured RBAC logs are not enough and you need request-level payloads, IPs, or user agents.",
        "Aciklanabilirlik veya yapilandirilmis RBAC loglari yeterli olmadiginda; istek seviyesinde payload, IP veya user-agent ayrintilarina inmek icin ham kanit akisini kullanin."
      )}
      actions={workspaceActions}
      stats={workspaceStats}
      toolbar={<SecurityDiagnosticsWorkbenchTabs activeTab="raw-audit" />}
    >
      <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {t("rawAuditLogs.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("rawAuditLogs.subtitle")}
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-5">
        <select
          value={filters.scopeType}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, scopeType: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {SCOPE_TYPES.map((scopeType) => (
            <option key={scopeType || "ALL"} value={scopeType}>
              {scopeType || t("rawAuditLogs.filters.allScopeTypes")}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          value={filters.scopeId}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, scopeId: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder={t("rawAuditLogs.filters.scopeId")}
        />
        <input
          type="number"
          min={1}
          value={filters.userId}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, userId: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder={t("rawAuditLogs.filters.userId")}
        />
        <input
          value={filters.action}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, action: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder={t("rawAuditLogs.filters.action")}
        />
        <input
          value={filters.resourceType}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, resourceType: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder={t("rawAuditLogs.filters.resourceType")}
        />
        <input
          value={filters.resourceId}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, resourceId: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder={t("rawAuditLogs.filters.resourceId")}
        />
        <input
          value={filters.requestId}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, requestId: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder={t("rawAuditLogs.filters.requestId")}
        />
        <input
          type="date"
          value={filters.createdFrom}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, createdFrom: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={filters.createdTo}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, createdTo: event.target.value }))
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => loadLogs(1)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            {t("rawAuditLogs.filters.apply")}
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            {t("rawAuditLogs.filters.reset")}
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
          {t("rawAuditLogs.recordsTitle")}
        </div>
        {loading ? (
          <p className="px-4 py-3 text-sm text-slate-500">{t("rawAuditLogs.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">{t("rawAuditLogs.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-2">{t("rawAuditLogs.columns.time")}</th>
                  <th className="px-4 py-2">{t("rawAuditLogs.columns.action")}</th>
                  <th className="px-4 py-2">{t("rawAuditLogs.columns.resource")}</th>
                  <th className="px-4 py-2">{t("rawAuditLogs.columns.user")}</th>
                  <th className="px-4 py-2">{t("rawAuditLogs.columns.scope")}</th>
                  <th className="px-4 py-2">{t("rawAuditLogs.columns.requestId")}</th>
                  <th className="px-4 py-2">{t("rawAuditLogs.columns.details")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const payloadText = stringifyPayload(row?.payload_json);
                  const hasExtraDetail = Boolean(
                    payloadText || row?.ip_address || row?.user_agent
                  );
                  return (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap px-4 py-2">
                        {formatDateTime(row.created_at)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{row.action || "-"}</div>
                        <div className="text-xs text-slate-500">#{row.id}</div>
                      </td>
                      <td className="px-4 py-2">{buildResourceLabel(row)}</td>
                      <td className="px-4 py-2 text-xs">
                        <div>{row.user_name || "-"}</div>
                        <div className="text-slate-500">{row.user_email || ""}</div>
                        <div className="text-slate-400">
                          {row.user_id ? `ID: ${row.user_id}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {row.scope_type ? `${row.scope_type}:${row.scope_id || "-"}` : "-"}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-slate-700">
                        {row.request_id || "-"}
                      </td>
                      <td className="px-4 py-2">
                        {hasExtraDetail ? (
                          <details className="max-w-[480px]">
                            <summary className="cursor-pointer text-xs font-semibold text-cyan-700">
                              {t("rawAuditLogs.actions.viewDetails")}
                            </summary>
                            <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                              {row.ip_address ? (
                                <div>
                                  <span className="font-semibold">
                                    {t("rawAuditLogs.columns.ipAddress")}:
                                  </span>{" "}
                                  {row.ip_address}
                                </div>
                              ) : null}
                              {row.user_agent ? (
                                <div>
                                  <span className="font-semibold">
                                    {t("rawAuditLogs.columns.userAgent")}:
                                  </span>{" "}
                                  {row.user_agent}
                                </div>
                              ) : null}
                              {payloadText ? (
                                <pre className="overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-slate-800">
                                  {payloadText}
                                </pre>
                              ) : null}
                            </div>
                          </details>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <div>
          {t("rawAuditLogs.pagination.summary", {
            page: pagination.page,
            totalPages: pagination.totalPages || 1,
            total: pagination.total,
          })}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => changePage(-1)}
            disabled={pagination.page <= 1 || loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            {t("rawAuditLogs.pagination.previous")}
          </button>
          <button
            type="button"
            onClick={() => changePage(1)}
            disabled={
              loading ||
              (pagination.totalPages > 0 && pagination.page >= pagination.totalPages)
            }
            className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            {t("rawAuditLogs.pagination.next")}
          </button>
        </div>
      </div>
      </div>
    </SecurityAdminWorkspaceShell>
  );
}
