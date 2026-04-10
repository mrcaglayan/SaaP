import { useEffect, useMemo, useState } from "react";
import {
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listRoleAssignments,
  listUsers,
  runRbacAccessCheck,
} from "../../api/rbacAdmin.js";
import { useAuth } from "../../auth/useAuth.js";
import AccessDebuggerResults from "../../components/security/AccessDebuggerResults.jsx";
import { useI18n } from "../../i18n/useI18n.js";
import { getWorkflowFamilyLabel } from "./roleCatalog.js";
import { buildAccessDiagnosticsSummary } from "./accessDiagnosticsSummary.js";

const SCOPE_TYPES = ["", "TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const WORKFLOW_FAMILY_CODES = [
  "",
  "AP_DOCUMENT_POSTING",
  "LOCAL_CLOSE_PACK",
  "PERIOD_CLOSE",
  "CONSOLIDATION_RUN",
  "CROSS_WORKFLOW",
];

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function getScopeOptions(scopeType, lookups, tenantScopeId) {
  if (scopeType === "TENANT") {
    return tenantScopeId
      ? [{ id: tenantScopeId, label: `Tenant #${tenantScopeId}` }]
      : [];
  }
  if (scopeType === "GROUP") {
    return lookups.groups.map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  if (scopeType === "COUNTRY") {
    return lookups.countries.map((row) => ({
      id: Number(row.id),
      label: `${row.iso2 || row.iso3 || row.id} - ${row.name}`,
    }));
  }
  if (scopeType === "LEGAL_ENTITY") {
    return lookups.legalEntities.map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  if (scopeType === "OPERATING_UNIT") {
    return lookups.operatingUnits.map((row) => ({
      id: Number(row.id),
      label: `${row.code} - ${row.name}`,
    }));
  }
  return [];
}

function getSummaryToneClasses(tone) {
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  if (tone === "rose") {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }
  return "border-slate-200 bg-slate-50 text-slate-900";
}

function getCoverageBadgeClasses(status) {
  if (status === "EXACT") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "INHERITED") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function CoverageBadge({ status, l }) {
  const label =
    status === "EXACT"
      ? l("Exact scope", "Tam kapsam")
      : status === "INHERITED"
        ? l("Inherited scope", "Devralinan kapsam")
        : l("Other scope", "Diger kapsam");

  return (
    <span
      className={joinClassNames(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide",
        getCoverageBadgeClasses(status)
      )}
    >
      {label}
    </span>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function ScopeList({ values, emptyLabel }) {
  if (!Array.isArray(values) || values.length === 0) {
    return <div className="text-sm text-slate-500">{emptyLabel}</div>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

/**
 * Admin-facing page for UI-5A business diagnostics plus the existing layered
 * access checker. It explains label/package/scope coverage first, then lets
 * admins drill down into the lower-level access chain when needed.
 */
export default function AccessDebuggerPage() {
  const { hasPermission, user } = useAuth();
  const { t, l } = useI18n();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [users, setUsers] = useState([]);
  const [selectedUserAssignments, setSelectedUserAssignments] = useState([]);
  const [lookups, setLookups] = useState({
    groups: [],
    countries: [],
    legalEntities: [],
    operatingUnits: [],
  });
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    targetUserId: "",
    workflowFamily: "",
    permissionCode: "",
    scopeType: "",
    scopeId: "",
    moduleCode: "",
    objectType: "",
    fieldName: "",
    actionCode: "",
    recordType: "",
    recordId: "",
    workflowRequestId: "",
  });

  const tenantScopeId = Number(user?.tenant_id || 0);
  const canReadOrgTree = hasPermission("org.tree.read");
  const scopeOptions = useMemo(
    () => getScopeOptions(form.scopeType, lookups, tenantScopeId),
    [form.scopeType, lookups, tenantScopeId]
  );
  const workflowFamilyOptions = useMemo(
    () =>
      WORKFLOW_FAMILY_CODES.map((code) => ({
        code,
        label: code ? getWorkflowFamilyLabel(code) : l("Choose workflow family", "Workflow ailesi secin"),
      })),
    [l]
  );
  const selectedUser = useMemo(
    () => users.find((row) => Number(row.id) === Number(form.targetUserId || 0)) || null,
    [form.targetUserId, users]
  );
  const diagnosticsSummary = useMemo(
    () =>
      buildAccessDiagnosticsSummary({
        assignments: selectedUserAssignments,
        workflowFamily: form.workflowFamily,
        scopeType: form.scopeType,
        scopeId: form.scopeId,
        lookups,
        tenantScopeId,
        l,
      }),
    [
      form.scopeId,
      form.scopeType,
      form.workflowFamily,
      l,
      lookups,
      selectedUserAssignments,
      tenantScopeId,
    ]
  );

  async function loadLookups() {
    setLoading(true);
    setError("");
    try {
      const [usersRes, groupsRes, countriesRes, entitiesRes, unitsRes] =
        await Promise.all([
          listUsers(),
          canReadOrgTree ? listGroupCompanies() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listCountries() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listLegalEntities() : Promise.resolve({ rows: [] }),
          canReadOrgTree ? listOperatingUnits() : Promise.resolve({ rows: [] }),
        ]);

      const nextUsers = usersRes?.rows || [];
      setUsers(nextUsers);
      setLookups({
        groups: groupsRes?.rows || [],
        countries: countriesRes?.rows || [],
        legalEntities: entitiesRes?.rows || [],
        operatingUnits: unitsRes?.rows || [],
      });
      setForm((prev) => ({
        ...prev,
        targetUserId: prev.targetUserId || String(user?.id || nextUsers[0]?.id || ""),
      }));
    } catch (err) {
      setError(err?.response?.data?.message || t("accessDebugger.errors.loadLookupsFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm((prev) => {
      if (!prev.scopeType) {
        return prev.scopeId ? { ...prev, scopeId: "" } : prev;
      }

      const currentScopeId = Number(prev.scopeId || 0);
      if (
        currentScopeId &&
        scopeOptions.some((option) => Number(option.id) === currentScopeId)
      ) {
        return prev;
      }

      return {
        ...prev,
        scopeId: String(scopeOptions[0]?.id || ""),
      };
    });
  }, [scopeOptions]);

  useEffect(() => {
    let ignore = false;

    async function loadAssignments() {
      if (!form.targetUserId) {
        setSelectedUserAssignments([]);
        setAssignmentError("");
        return;
      }

      setAssignmentLoading(true);
      setAssignmentError("");
      try {
        const response = await listRoleAssignments({
          userId: Number(form.targetUserId),
        });
        if (ignore) {
          return;
        }
        setSelectedUserAssignments(response?.rows || []);
      } catch (err) {
        if (ignore) {
          return;
        }
        setSelectedUserAssignments([]);
        setAssignmentError(
          err?.response?.data?.message ||
            l(
              "The selected user's role assignments could not be loaded.",
              "Secili kullanicinin rol atamalari yuklenemedi."
            )
        );
      } finally {
        if (!ignore) {
          setAssignmentLoading(false);
        }
      }
    }

    loadAssignments();
    return () => {
      ignore = true;
    };
  }, [form.targetUserId, l]);

  useEffect(() => {
    setResult(null);
  }, [form.targetUserId, form.scopeType, form.scopeId]);

  async function handleRun(event) {
    event.preventDefault();
    if (!form.targetUserId) {
      setError(t("accessDebugger.errors.targetUserRequired"));
      return;
    }

    setRunning(true);
    setError("");
    try {
      const payload = {
        targetUserId: Number(form.targetUserId),
        permissionCode: form.permissionCode.trim() || undefined,
        scopeType: form.scopeType || undefined,
        scopeId: form.scopeId ? Number(form.scopeId) : undefined,
        moduleCode: form.moduleCode.trim() || undefined,
        objectType: form.objectType.trim() || undefined,
        fieldName: form.fieldName.trim() || undefined,
        actionCode: form.actionCode.trim() || undefined,
        recordType: form.recordType.trim() || undefined,
        recordId: form.recordId ? Number(form.recordId) : undefined,
        workflowRequestId: form.workflowRequestId ? Number(form.workflowRequestId) : undefined,
      };
      const response = await runRbacAccessCheck(payload);
      setResult(response || null);
    } catch (err) {
      setError(err?.response?.data?.message || t("accessDebugger.errors.runFailed"));
    } finally {
      setRunning(false);
    }
  }

  function handleReset() {
    setForm({
      targetUserId: String(user?.id || users[0]?.id || ""),
      workflowFamily: "",
      permissionCode: "",
      scopeType: "",
      scopeId: "",
      moduleCode: "",
      objectType: "",
      fieldName: "",
      actionCode: "",
      recordType: "",
      recordId: "",
      workflowRequestId: "",
    });
    setResult(null);
    setError("");
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {t("accessDebugger.page.title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          {t("accessDebugger.page.subtitle")}
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {l("UI-5A access diagnostics", "UI-5A erisim tanilari")}
            </div>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">
              {l("Business-facing diagnosis", "Is-odakli tani")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              {l(
                "Explain whether this user can view or act at the selected workflow family and target scope before dropping down into the lower-level access chain.",
                "Alt seviyedeki erisim zincirine inmeden once, bu kullanicinin secili workflow ailesi ve hedef kapsamda goruntuleyip aksiyon alip alamayacagini aciklayin."
              )}
            </p>
          </div>
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            <div className="font-semibold">{t("accessDebugger.page.noteTitle")}</div>
            <div className="mt-1">{t("accessDebugger.page.noteBody")}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <select
            value={form.targetUserId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, targetUserId: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{t("accessDebugger.form.userPlaceholder")}</option>
            {users.map((userRow) => (
              <option key={userRow.id} value={userRow.id}>
                {userRow.name} ({userRow.email})
              </option>
            ))}
          </select>

          <select
            value={form.workflowFamily}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, workflowFamily: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {workflowFamilyOptions.map((option) => (
              <option key={option.code || "NONE"} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={form.scopeType}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                scopeType: event.target.value,
                scopeId: "",
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {SCOPE_TYPES.map((scopeType) => (
              <option key={scopeType || "NONE"} value={scopeType}>
                {scopeType || t("accessDebugger.form.noScope")}
              </option>
            ))}
          </select>

          {scopeOptions.length > 0 ? (
            <select
              value={form.scopeId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, scopeId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{t("accessDebugger.form.scopePlaceholder")}</option>
              {scopeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={1}
              value={form.scopeId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, scopeId: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("accessDebugger.form.scopeId")}
            />
          )}
        </div>

        <div className="mt-5 space-y-4">
          {assignmentError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {assignmentError}
            </div>
          ) : null}

          {assignmentLoading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
              {l(
                "Loading role labels, workflow packages, and runtime mappings for the selected user...",
                "Secili kullanici icin rol etiketleri, workflow paketleri ve runtime eslesmeleri yukleniyor..."
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <section
                className={joinClassNames(
                  "rounded-2xl border px-4 py-4",
                  getSummaryToneClasses(diagnosticsSummary.finalResult.tone)
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">
                      {diagnosticsSummary.finalResult.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6">
                      {diagnosticsSummary.finalResult.text}
                    </p>
                  </div>
                  {diagnosticsSummary.workflowFamilyLabel ? (
                    <span className="inline-flex rounded-full border border-white/70 bg-white/60 px-3 py-1 text-xs font-semibold text-slate-700">
                      {diagnosticsSummary.workflowFamilyLabel}
                    </span>
                  ) : null}
                </div>
              </section>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MiniStat
                  label={l("Matching scopes", "Eslesen kapsamlar")}
                  value={diagnosticsSummary.matchingScopeLabels.length}
                />
                <MiniStat
                  label={l("Role labels at target", "Hedefte rol etiketleri")}
                  value={diagnosticsSummary.matchingBusinessRoles.length}
                />
                <MiniStat
                  label={l("Packages at target", "Hedefte paketler")}
                  value={diagnosticsSummary.matchingWorkflowPackages.length}
                />
                <MiniStat
                  label={l("Visible blockers", "Gorunur engeller")}
                  value={diagnosticsSummary.blockerTexts.length}
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {l("Business role labels", "Is-rolu etiketleri")}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {l(
                          "These stay non-authoritative. Use them to explain the user's title posture at the selected or inherited scope.",
                          "Bunlar yetki vermez. Kullanicinin secili veya devralinan kapsamdaki unvan durusunu aciklamak icin kullanin."
                        )}
                      </p>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {diagnosticsSummary.businessRoleAssignments.length}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {diagnosticsSummary.businessRoleAssignments.length === 0 ? (
                      <div className="text-sm text-slate-500">
                        {l(
                          "No business-role labels are assigned for this user.",
                          "Bu kullaniciya atanmis bir is-rolu etiketi yok."
                        )}
                      </div>
                    ) : (
                      diagnosticsSummary.businessRoleAssignments.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-medium text-slate-900">{item.label}</div>
                              <div className="mt-1 text-sm text-slate-600">{item.scopeLabel}</div>
                            </div>
                            <CoverageBadge status={item.coverageStatus} l={l} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {l("Workflow package coverage", "Workflow paket kapsami")}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {l(
                          "Active package authority is explained from direct package assignments and runtime role sources so scope mismatches stay explicit.",
                          "Kapsam uyusmazliklari acik kalsin diye etkin paket yetkisi dogrudan paket atamalari ve runtime rol kaynaklari uzerinden aciklanir."
                        )}
                      </p>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {diagnosticsSummary.workflowPackages.length}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {diagnosticsSummary.workflowPackages.length === 0 ? (
                      <div className="text-sm text-slate-500">
                        {diagnosticsSummary.ready
                          ? l(
                              "No workflow packages were found for the selected family.",
                              "Secili aile icin workflow paketi bulunamadi."
                            )
                          : l(
                              "Choose a workflow family and target scope to compare packages.",
                              "Paketleri karsilastirmak icin bir workflow ailesi ve hedef kapsam secin."
                            )}
                      </div>
                    ) : (
                      diagnosticsSummary.workflowPackages.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-slate-900">{item.packageLabel}</div>
                              <div className="mt-1 text-sm text-slate-600">{item.scopeLabel}</div>
                            </div>
                            <CoverageBadge status={item.coverageStatus} l={l} />
                          </div>
                          <p className="mt-2 text-sm text-slate-600">{item.packageSummary}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.sourceLabels.map((label) => (
                              <span
                                key={`${item.id}-${label}`}
                                className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                          {item.sourceRoleLabels.length > 0 ? (
                            <div className="mt-2 text-xs text-slate-500">
                              {l("Source roles", "Kaynak roller")}: {item.sourceRoleLabels.join(", ")}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  {l("Matching scopes and blockers", "Eslesen kapsamlar ve engeller")}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {l(
                    "This is the business-facing answer for why the user can act, can only view, or misses the selected scope entirely.",
                    "Bu, kullanicinin neden aksiyon alabildigi, yalnizca goruntuleyebildigi veya secili kapsami tamamen kacirdigi sorusuna is-odakli cevaptir."
                  )}
                </p>

                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {l("Matching scopes", "Eslesen kapsamlar")}
                    </div>
                    <ScopeList
                      values={diagnosticsSummary.matchingScopeLabels}
                      emptyLabel={l(
                        "No role label or package currently covers the selected scope.",
                        "Secili kapsami su anda kapsayan bir rol etiketi veya paket yok."
                      )}
                    />
                  </div>

                  {diagnosticsSummary.missingScopeText ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                      {diagnosticsSummary.missingScopeText}
                    </div>
                  ) : null}

                  {diagnosticsSummary.missingPackageText ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {diagnosticsSummary.missingPackageText}
                    </div>
                  ) : null}

                  {diagnosticsSummary.blockerTexts.length === 0 ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                      {l(
                        "No package or scope blocker is currently visible in the business-facing diagnosis.",
                        "Is-odakli tanida su anda gorunur bir paket veya kapsam engeli yok."
                      )}
                    </div>
                  ) : null}
                </div>
              </section>

              {diagnosticsSummary.noteTexts.length > 0 ? (
                <section className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
                  <div className="font-semibold">
                    {l("Diagnostic notes", "Tani notlari")}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {diagnosticsSummary.noteTexts.map((noteText) => (
                      <li key={noteText}>- {noteText}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              {l("Technical access chain", "Teknik erisim zinciri")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              {l(
                "Use the lower-level checker when you need the exact permission, workflow, SoD, field masking, or business-state blocker behind the business-facing diagnosis.",
                "Is-odakli taninin arkasindaki tam yetki, workflow, SoD, alan maskeleme veya is durumu engelini gormek istediginizde alt seviyedeki denetleyiciyi kullanin."
              )}
            </p>
          </div>
        </div>

        <form onSubmit={handleRun} className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("accessDebugger.summary.targetUser")}
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {selectedUser
                  ? `${selectedUser.name} (${selectedUser.email})`
                  : t("accessDebugger.summary.notProvided")}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("accessDebugger.summary.scope")}
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {diagnosticsSummary.targetScope.scopeLabel || t("accessDebugger.summary.notProvided")}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Workflow family", "Workflow ailesi")}
              </div>
              <div className="mt-1 font-medium text-slate-900">
                {diagnosticsSummary.workflowFamilyLabel || t("accessDebugger.summary.notProvided")}
              </div>
            </div>

            <input
              value={form.permissionCode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, permissionCode: event.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t("accessDebugger.form.permissionPlaceholder")}
            />
          </div>

          <details className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              {t("accessDebugger.form.advanced")}
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input
                value={form.moduleCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, moduleCode: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.moduleCode")}
              />
              <input
                value={form.objectType}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, objectType: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.objectType")}
              />
              <input
                value={form.fieldName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, fieldName: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.fieldName")}
              />
              <input
                value={form.workflowRequestId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, workflowRequestId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.workflowRequestId")}
              />
              <input
                value={form.actionCode}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, actionCode: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.actionCode")}
              />
              <input
                value={form.recordType}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, recordType: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.recordType")}
              />
              <input
                type="number"
                min={1}
                value={form.recordId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, recordId: event.target.value }))
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={t("accessDebugger.form.recordId")}
              />
            </div>
          </details>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading || running}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {running
                ? t("accessDebugger.actions.running")
                : l("Run technical access check", "Teknik erisim kontrolunu calistir")}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={running}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {t("accessDebugger.actions.reset")}
            </button>
          </div>
        </form>
      </section>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          {t("accessDebugger.loading")}
        </div>
      ) : result ? (
        <AccessDebuggerResults
          result={result}
          targetUserLabel={
            selectedUser ? `${selectedUser.name} (${selectedUser.email})` : ""
          }
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          {l(
            "Run the technical access check if you need the lower-level permission and workflow layers behind this diagnosis.",
            "Bu taninin arkasindaki alt seviyedeki yetki ve workflow katmanlarini gormek icin teknik erisim kontrolunu calistirin."
          )}
        </div>
      )}
    </div>
  );
}
