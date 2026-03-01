import { useEffect, useMemo, useState } from "react";
import {
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
} from "../../api/orgAdmin.js";
import {
  createWorkflowAssignment,
  createWorkflowDefinition,
  listWorkflowAssignments,
  listWorkflowDefinitions,
  listWorkflowDefinitionSteps,
  replaceWorkflowDefinitionSteps,
  updateWorkflowAssignment,
} from "../../api/workflows.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";

const PROCESS_TYPES = ["PERIOD_CLOSE", "CONSOLIDATION_RUN"];
const ASSIGNMENT_SCOPE_TYPES = ["TENANT", "GROUP", "LEGAL_ENTITY", "OPERATING_UNIT"];

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildDefaultSteps(processType) {
  const normalized = String(processType || "").toUpperCase();
  const permissionCode =
    normalized === "CONSOLIDATION_RUN"
      ? "consolidation.run.finalize"
      : "gl.period.close";
  return [
    {
      stepNo: 1,
      stageScopeType: "OPERATING_UNIT",
      requiredPermissionCode: permissionCode,
      minApproverCount: 1,
      allowSelfApprove: false,
    },
    {
      stepNo: 2,
      stageScopeType: "LEGAL_ENTITY",
      requiredPermissionCode: permissionCode,
      minApproverCount: 1,
      allowSelfApprove: false,
    },
    {
      stepNo: 3,
      stageScopeType: "GROUP",
      requiredPermissionCode: permissionCode,
      minApproverCount: 1,
      allowSelfApprove: false,
    },
  ];
}

function safeParseJsonArray(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export default function WorkflowSetupPage() {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const { getModuleRows, refresh: refreshModuleReadiness } = useModuleReadiness();

  const canRead = hasPermission("org.tree.read");
  const canSetup = hasPermission("onboarding.company.setup");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [definitions, setDefinitions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [groupCompanies, setGroupCompanies] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);

  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [stepsJson, setStepsJson] = useState("[]");

  const [definitionForm, setDefinitionForm] = useState({
    code: "",
    name: "",
    processType: "PERIOD_CLOSE",
    isActive: true,
    versionNo: "1",
  });

  const [assignmentForm, setAssignmentForm] = useState({
    processType: "PERIOD_CLOSE",
    workflowDefinitionId: "",
    scopeType: "TENANT",
    groupCompanyId: "",
    legalEntityId: "",
    operatingUnitId: "",
    effectiveFrom: todayIsoDate(),
    status: "ACTIVE",
  });

  const l = (en, tr) => (language === "tr" ? tr : en);

  const selectedDefinition = useMemo(
    () =>
      definitions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(selectedDefinitionId)
      ) || null,
    [definitions, selectedDefinitionId]
  );

  const filteredDefinitionOptions = useMemo(
    () =>
      definitions.filter(
        (row) =>
          String(row?.processType || "").toUpperCase() ===
          String(assignmentForm.processType || "").toUpperCase()
      ),
    [definitions, assignmentForm.processType]
  );

  const workflowReadinessRows = getModuleRows("closeConsolidationWorkflow");
  const workflowReadyCount = workflowReadinessRows.filter((row) => Boolean(row?.ready)).length;
  const workflowTotalCount = workflowReadinessRows.length;

  async function loadData() {
    if (!canRead) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [definitionsRes, assignmentsRes, groupsRes, entitiesRes, unitsRes] =
        await Promise.all([
          listWorkflowDefinitions({ limit: 200 }),
          listWorkflowAssignments({ limit: 300 }),
          listGroupCompanies(),
          listLegalEntities(),
          listOperatingUnits(),
        ]);

      const nextDefinitions = Array.isArray(definitionsRes?.rows) ? definitionsRes.rows : [];
      setDefinitions(nextDefinitions);
      setAssignments(Array.isArray(assignmentsRes?.rows) ? assignmentsRes.rows : []);
      setGroupCompanies(Array.isArray(groupsRes?.rows) ? groupsRes.rows : []);
      setLegalEntities(Array.isArray(entitiesRes?.rows) ? entitiesRes.rows : []);
      setOperatingUnits(Array.isArray(unitsRes?.rows) ? unitsRes.rows : []);

      setSelectedDefinitionId((prev) => {
        const current = toPositiveInt(prev);
        if (current && nextDefinitions.some((row) => toPositiveInt(row?.id) === current)) {
          return prev;
        }
        return String(nextDefinitions[0]?.id || "");
      });
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to load workflow setup.", "Workflow kurulumu yuklenemedi.")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  useEffect(() => {
    const definitionId = toPositiveInt(selectedDefinitionId);
    if (!definitionId || !canRead) {
      setStepsJson(JSON.stringify(buildDefaultSteps(selectedDefinition?.processType), null, 2));
      return;
    }

    (async () => {
      try {
        const response = await listWorkflowDefinitionSteps(definitionId);
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        const normalized =
          rows.length > 0
            ? rows.map((row) => ({
                stepNo: Number(row?.stepNo || 0) || 1,
                stageScopeType: String(row?.stageScopeType || "LEGAL_ENTITY"),
                requiredPermissionCode: String(row?.requiredPermissionCode || ""),
                minApproverCount: Number(row?.minApproverCount || 1) || 1,
                allowSelfApprove: Boolean(row?.allowSelfApprove),
              }))
            : buildDefaultSteps(selectedDefinition?.processType);
        setStepsJson(JSON.stringify(normalized, null, 2));
      } catch (err) {
        setError(
          err?.response?.data?.message ||
            l("Failed to load workflow steps.", "Workflow adimlari yuklenemedi.")
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDefinitionId]);

  useEffect(() => {
    if (
      filteredDefinitionOptions.length > 0 &&
      !filteredDefinitionOptions.some(
        (row) =>
          toPositiveInt(row?.id) === toPositiveInt(assignmentForm.workflowDefinitionId)
      )
    ) {
      setAssignmentForm((prev) => ({
        ...prev,
        workflowDefinitionId: String(filteredDefinitionOptions[0]?.id || ""),
      }));
    }
  }, [assignmentForm.workflowDefinitionId, filteredDefinitionOptions]);

  async function onCreateDefinition(event) {
    event.preventDefault();
    if (!canSetup) {
      setError(l("Missing permission: onboarding.company.setup", "Eksik yetki: onboarding.company.setup"));
      return;
    }

    setSaving("definition");
    setError("");
    setMessage("");
    try {
      const response = await createWorkflowDefinition({
        code: definitionForm.code,
        name: definitionForm.name,
        processType: definitionForm.processType,
        isActive: Boolean(definitionForm.isActive),
        versionNo: Number(definitionForm.versionNo || 1),
      });
      await loadData();
      if (toPositiveInt(response?.row?.id)) {
        setSelectedDefinitionId(String(response.row.id));
      }
      setMessage(l("Workflow definition saved.", "Workflow tanimi kaydedildi."));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to save workflow definition.", "Workflow tanimi kaydedilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onSaveSteps(event) {
    event.preventDefault();
    if (!canSetup) {
      setError(l("Missing permission: onboarding.company.setup", "Eksik yetki: onboarding.company.setup"));
      return;
    }

    const definitionId = toPositiveInt(selectedDefinitionId);
    if (!definitionId) {
      setError(l("Select a workflow definition first.", "Once workflow tanimi secin."));
      return;
    }

    const parsedSteps = safeParseJsonArray(stepsJson);
    if (!parsedSteps || parsedSteps.length === 0) {
      setError(l("Steps JSON must be a non-empty array.", "Adim JSON bos olmayan bir dizi olmali."));
      return;
    }

    setSaving("steps");
    setError("");
    setMessage("");
    try {
      await replaceWorkflowDefinitionSteps(definitionId, { steps: parsedSteps });
      await refreshModuleReadiness();
      setMessage(l("Workflow steps saved.", "Workflow adimlari kaydedildi."));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to save workflow steps.", "Workflow adimlari kaydedilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onCreateAssignment(event) {
    event.preventDefault();
    if (!canSetup) {
      setError(l("Missing permission: onboarding.company.setup", "Eksik yetki: onboarding.company.setup"));
      return;
    }

    const workflowDefinitionId = toPositiveInt(assignmentForm.workflowDefinitionId);
    if (!workflowDefinitionId) {
      setError(l("workflowDefinitionId is required.", "workflowDefinitionId zorunludur."));
      return;
    }

    const payload = {
      processType: assignmentForm.processType,
      workflowDefinitionId,
      effectiveFrom: assignmentForm.effectiveFrom,
      status: assignmentForm.status,
    };
    if (assignmentForm.scopeType === "GROUP") {
      payload.groupCompanyId = toPositiveInt(assignmentForm.groupCompanyId) || undefined;
    }
    if (assignmentForm.scopeType === "LEGAL_ENTITY") {
      payload.legalEntityId = toPositiveInt(assignmentForm.legalEntityId) || undefined;
    }
    if (assignmentForm.scopeType === "OPERATING_UNIT") {
      payload.operatingUnitId = toPositiveInt(assignmentForm.operatingUnitId) || undefined;
    }

    setSaving("assignment");
    setError("");
    setMessage("");
    try {
      await createWorkflowAssignment(payload);
      await loadData();
      await refreshModuleReadiness();
      setMessage(l("Workflow assignment saved.", "Workflow atamasi kaydedildi."));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to save workflow assignment.", "Workflow atamasi kaydedilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  async function onToggleAssignmentStatus(row) {
    const assignmentId = toPositiveInt(row?.id);
    if (!assignmentId || !canSetup) {
      return;
    }
    const nextStatus = String(row?.status || "").toUpperCase() === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setSaving(`assignment-status-${assignmentId}`);
    setError("");
    setMessage("");
    try {
      await updateWorkflowAssignment(assignmentId, { status: nextStatus });
      await loadData();
      await refreshModuleReadiness();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to update assignment status.", "Atama durumu guncellenemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {l("Workflow Setup", "Workflow Kurulumu")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Configure close/consolidation workflow definitions, steps, and assignments.",
            "Kapanis/konsolidasyon workflow tanimlari, adimlari ve atamalarini yonetin."
          )}
        </p>
      </div>

      <TenantReadinessChecklist />

      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {l("Workflow readiness", "Workflow hazirligi")}: {workflowReadyCount}/{workflowTotalCount}
          </div>
          <button
            type="button"
            onClick={() => refreshModuleReadiness()}
            className="rounded border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold"
          >
            {l("Refresh readiness", "Hazirligi yenile")}
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>
      ) : null}

      {!canRead ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {l("Missing permission: org.tree.read", "Eksik yetki: org.tree.read")}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Definitions", "Tanimlar")}</h2>
          <form onSubmit={onCreateDefinition} className="grid gap-2 md:grid-cols-2">
            <input value={definitionForm.code} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, code: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Code", "Kod")} required />
            <input value={definitionForm.name} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, name: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Name", "Ad")} required />
            <select value={definitionForm.processType} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, processType: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm">
              {PROCESS_TYPES.map((row) => <option key={row} value={row}>{row}</option>)}
            </select>
            <input type="number" min={1} value={definitionForm.versionNo} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, versionNo: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Version", "Versiyon")} />
            <label className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(definitionForm.isActive)} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, isActive: event.target.checked }))} />{l("Active", "Aktif")}</label>
            <button type="submit" disabled={saving === "definition" || !canSetup} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "definition" ? l("Saving...", "Kaydediliyor...") : l("Save definition", "Tanimi kaydet")}</button>
          </form>

          <div className="mt-3 max-h-64 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-2">ID</th><th className="px-2 py-2">{l("Code", "Kod")}</th><th className="px-2 py-2">{l("Process", "Surec")}</th><th className="px-2 py-2">{l("Steps", "Adim")}</th></tr></thead>
              <tbody>
                {definitions.map((row) => (
                  <tr key={row.id} className={`cursor-pointer border-t border-slate-100 ${toPositiveInt(row?.id) === toPositiveInt(selectedDefinitionId) ? "bg-cyan-50" : ""}`} onClick={() => setSelectedDefinitionId(String(row.id))}>
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.code}</td>
                    <td className="px-2 py-2">{row.processType}</td>
                    <td className="px-2 py-2">{Number(row.stepCount || 0)}</td>
                  </tr>
                ))}
                {definitions.length === 0 && !loading ? (<tr><td colSpan={4} className="px-2 py-3 text-slate-500">{l("No definitions.", "Tanim yok.")}</td></tr>) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Steps (JSON)", "Adimlar (JSON)")}</h2>
          <p className="mb-2 text-xs text-slate-500">{selectedDefinition ? `${selectedDefinition.code} (${selectedDefinition.processType})` : l("Select a definition to edit steps.", "Adim duzenlemek icin tanim secin.")}</p>
          <form onSubmit={onSaveSteps} className="space-y-2">
            <textarea value={stepsJson} onChange={(event) => setStepsJson(event.target.value)} className="min-h-[260px] w-full rounded border border-slate-300 p-2 font-mono text-xs" />
            <button type="submit" disabled={saving === "steps" || !canSetup || !toPositiveInt(selectedDefinitionId)} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "steps" ? l("Saving...", "Kaydediliyor...") : l("Save steps", "Adimlari kaydet")}</button>
          </form>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Assignments", "Atamalar")}</h2>
        <form onSubmit={onCreateAssignment} className="grid gap-2 md:grid-cols-4">
          <select value={assignmentForm.processType} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, processType: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm">{PROCESS_TYPES.map((row) => <option key={row} value={row}>{row}</option>)}</select>
          <select value={assignmentForm.workflowDefinitionId} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, workflowDefinitionId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required>
            <option value="">{l("Select definition", "Tanim secin")}</option>
            {filteredDefinitionOptions.map((row) => <option key={row.id} value={row.id}>{row.code} - {row.name}</option>)}
          </select>
          <select value={assignmentForm.scopeType} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, scopeType: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm">{ASSIGNMENT_SCOPE_TYPES.map((row) => <option key={row} value={row}>{row}</option>)}</select>
          <input type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required />

          {assignmentForm.scopeType === "GROUP" ? (
            <select value={assignmentForm.groupCompanyId} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, groupCompanyId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required>
              <option value="">{l("Select group", "Grup secin")}</option>
              {groupCompanies.map((row) => <option key={row.id} value={row.id}>{row.code} - {row.name}</option>)}
            </select>
          ) : null}
          {assignmentForm.scopeType === "LEGAL_ENTITY" ? (
            <select value={assignmentForm.legalEntityId} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, legalEntityId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required>
              <option value="">{l("Select legal entity", "Legal entity secin")}</option>
              {legalEntities.map((row) => <option key={row.id} value={row.id}>{row.code} - {row.name}</option>)}
            </select>
          ) : null}
          {assignmentForm.scopeType === "OPERATING_UNIT" ? (
            <select value={assignmentForm.operatingUnitId} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required>
              <option value="">{l("Select operating unit", "Operating unit secin")}</option>
              {operatingUnits.map((row) => <option key={row.id} value={row.id}>{row.code} - {row.name}</option>)}
            </select>
          ) : null}

          <select value={assignmentForm.status} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, status: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm"><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select>
          <button type="submit" disabled={saving === "assignment" || !canSetup} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "assignment" ? l("Saving...", "Kaydediliyor...") : l("Save assignment", "Atamayi kaydet")}</button>
        </form>

        <div className="mt-3 max-h-72 overflow-auto rounded border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-2">ID</th><th className="px-2 py-2">{l("Process", "Surec")}</th><th className="px-2 py-2">{l("Definition", "Tanim")}</th><th className="px-2 py-2">{l("Status", "Durum")}</th><th className="px-2 py-2">{l("Action", "Islem")}</th></tr></thead>
            <tbody>
              {assignments.map((row) => {
                const assignmentId = toPositiveInt(row?.id);
                const rowSaving = saving === `assignment-status-${assignmentId}`;
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.processType}</td>
                    <td className="px-2 py-2">{row.workflowDefinitionCode} - {row.workflowDefinitionName}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onToggleAssignmentStatus(row)} disabled={rowSaving || !canSetup} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60">{rowSaving ? l("Saving...", "Kaydediliyor...") : row.status === "ACTIVE" ? l("Set INACTIVE", "PASIF yap") : l("Set ACTIVE", "AKTIF yap")}</button>
                    </td>
                  </tr>
                );
              })}
              {assignments.length === 0 && !loading ? (<tr><td colSpan={5} className="px-2 py-3 text-slate-500">{l("No assignments.", "Atama yok.")}</td></tr>) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
