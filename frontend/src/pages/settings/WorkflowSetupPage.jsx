import { useEffect, useMemo, useState } from "react";
import {
  listCountries,
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
import PermissionAccessNotice from "../../auth/PermissionAccessNotice.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import TenantReadinessChecklist from "../../readiness/TenantReadinessChecklist.jsx";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
} from "../../../../shared/cariDocumentWorkflowGovernance.js";

const PROCESS_TYPES = [
  "PERIOD_CLOSE",
  "CONSOLIDATION_RUN",
  "LOCAL_CLOSE_PACK",
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
];
const ASSIGNMENT_SCOPE_TYPES = ["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"];
const STEP_SCOPE_TYPES = ["OPERATING_UNIT", "LEGAL_ENTITY", "COUNTRY", "GROUP"];

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildDefaultSteps(processType) {
  const normalized = String(processType || "").toUpperCase();
  if (normalized === "LOCAL_CLOSE_PACK") {
    // CENTRAL packs do not have an operating-unit target id, so the default
    // local-close definition must resolve at entity scope. OU-specific flows
    // can still be customized later via the JSON step editor.
    return [
      {
        stepNo: 1,
        stageScopeType: "LEGAL_ENTITY",
        requiredPermissionCode: "ouclose.approve",
        minApproverCount: 1,
        allowSelfApprove: false,
      },
    ];
  }
  if (normalized === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return [
      {
        stepNo: 1,
        stageScopeType: "COUNTRY",
        requiredPermissionCode: null,
        minApproverCount: 1,
        allowSelfApprove: false,
      },
    ];
  }
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

function normalizeStepDraft(rawStep, fallbackStepNo, processType) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  const step = rawStep && typeof rawStep === "object" ? rawStep : {};
  return {
    stepNo: String(
      Number(step.stepNo ?? step.step_no ?? fallbackStepNo) > 0
        ? Number(step.stepNo ?? step.step_no ?? fallbackStepNo)
        : fallbackStepNo
    ),
    stageScopeType: String(
      step.stageScopeType ??
        step.stage_scope_type ??
        (normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
          ? "COUNTRY"
          : "LEGAL_ENTITY")
    ).toUpperCase(),
    requiredPermissionCode:
      normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
        ? ""
        : String(step.requiredPermissionCode ?? step.required_permission_code ?? "").trim(),
    minApproverCount: String(
      Math.max(1, Number(step.minApproverCount ?? step.min_approver_count ?? 1) || 1)
    ),
    allowSelfApprove: Boolean(step.allowSelfApprove ?? step.allow_self_approve),
    escalationAfterHours:
      step.escalationAfterHours === null || step.escalation_after_hours === null
        ? ""
        : String(step.escalationAfterHours ?? step.escalation_after_hours ?? "").trim(),
  };
}

function buildStepDrafts(processType, rows) {
  const sourceRows = Array.isArray(rows) && rows.length > 0 ? rows : buildDefaultSteps(processType);
  return sourceRows.map((row, index) =>
    normalizeStepDraft(row, index + 1, processType)
  );
}

function serializeStepDrafts(stepDrafts, processType) {
  const normalizedProcessType = String(processType || "").toUpperCase();
  return (Array.isArray(stepDrafts) ? stepDrafts : []).map((step, index) => ({
    stepNo: Math.max(1, Number(step?.stepNo || index + 1) || index + 1),
    stageScopeType: String(step?.stageScopeType || "LEGAL_ENTITY").toUpperCase(),
    requiredPermissionCode:
      normalizedProcessType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
        ? null
        : String(step?.requiredPermissionCode || "").trim() || null,
    minApproverCount: Math.max(1, Number(step?.minApproverCount || 1) || 1),
    allowSelfApprove: Boolean(step?.allowSelfApprove),
    escalationAfterHours: String(step?.escalationAfterHours || "").trim()
      ? Math.max(1, Number(step.escalationAfterHours) || 1)
      : null,
  }));
}

/**
 * Manages workflow governance definitions, steps, and scope assignments.
 */
export default function WorkflowSetupPage() {
  const { getPermissionAccess, hasPermission, user } = useAuth();
  const { language } = useI18n();
  const { getModuleRows, refresh: refreshModuleReadiness } = useModuleReadiness();
  const tenantScopeId = toPositiveInt(user?.tenant_id);

  const canReadDefinitions = hasPermission("workflow.definition.read");
  const definitionWriteAccess = getPermissionAccess("workflow.definition.write");
  const canWriteDefinitions = definitionWriteAccess.allowed;
  const canReadAssignments = hasPermission("workflow.assignment.read");
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadWorkflow = canReadDefinitions || canReadAssignments;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [definitions, setDefinitions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [countries, setCountries] = useState([]);
  const [groupCompanies, setGroupCompanies] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);

  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [stepsJson, setStepsJson] = useState("[]");
  const [stepDrafts, setStepDrafts] = useState(() => buildStepDrafts("", []));
  const [stepsJsonError, setStepsJsonError] = useState("");

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
    countryId: "",
    legalEntityId: "",
    operatingUnitId: "",
    effectiveFrom: todayIsoDate(),
    status: "ACTIVE",
  });
  const assignmentScopeId =
    assignmentForm.scopeType === "TENANT"
      ? tenantScopeId
      : assignmentForm.scopeType === "GROUP"
        ? toPositiveInt(assignmentForm.groupCompanyId)
        : assignmentForm.scopeType === "COUNTRY"
          ? toPositiveInt(assignmentForm.countryId)
        : assignmentForm.scopeType === "LEGAL_ENTITY"
          ? toPositiveInt(assignmentForm.legalEntityId)
          : assignmentForm.scopeType === "OPERATING_UNIT"
            ? toPositiveInt(assignmentForm.operatingUnitId)
            : null;
  const assignmentWriteAccess = getPermissionAccess(
    "workflow.assignment.write",
    assignmentScopeId
      ? {
          scope: {
            scopeType: assignmentForm.scopeType,
            scopeId: assignmentScopeId,
          },
        }
      : undefined
  );
  const canWriteAssignments = assignmentWriteAccess.allowed;

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
    if (!canReadWorkflow && !canReadOrgTree) {
      setDefinitions([]);
      setAssignments([]);
      setCountries([]);
      setGroupCompanies([]);
      setLegalEntities([]);
      setOperatingUnits([]);
      setSelectedDefinitionId("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [definitionsRes, assignmentsRes, countriesRes, groupsRes, entitiesRes, unitsRes] =
        await Promise.all([
          canReadDefinitions ? listWorkflowDefinitions({ limit: 200 }) : Promise.resolve(null),
          canReadAssignments ? listWorkflowAssignments({ limit: 300 }) : Promise.resolve(null),
          canReadOrgTree ? listCountries() : Promise.resolve(null),
          canReadOrgTree ? listGroupCompanies() : Promise.resolve(null),
          canReadOrgTree ? listLegalEntities() : Promise.resolve(null),
          canReadOrgTree ? listOperatingUnits() : Promise.resolve(null),
        ]);

      const nextDefinitions = Array.isArray(definitionsRes?.rows) ? definitionsRes.rows : [];
      setDefinitions(nextDefinitions);
      setAssignments(Array.isArray(assignmentsRes?.rows) ? assignmentsRes.rows : []);
      setCountries(Array.isArray(countriesRes?.rows) ? countriesRes.rows : []);
      setGroupCompanies(Array.isArray(groupsRes?.rows) ? groupsRes.rows : []);
      setLegalEntities(Array.isArray(entitiesRes?.rows) ? entitiesRes.rows : []);
      setOperatingUnits(Array.isArray(unitsRes?.rows) ? unitsRes.rows : []);

      setSelectedDefinitionId((prev) => {
        if (nextDefinitions.length === 0) {
          return "";
        }
        const current = toPositiveInt(prev);
        if (current && nextDefinitions.some((row) => toPositiveInt(row?.id) === current)) {
          return prev;
        }
        return String(nextDefinitions[0]?.id || "");
      });
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to load workflow governance.", "Workflow yonetimi yuklenemedi.")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadAssignments, canReadDefinitions, canReadOrgTree]);

  useEffect(() => {
    if (!canReadWorkflow) {
      return;
    }
    refreshModuleReadiness({ global: true });
  }, [canReadWorkflow, refreshModuleReadiness]);

  useEffect(() => {
    const definitionId = toPositiveInt(selectedDefinitionId);
    const selectedProcessType = selectedDefinition?.processType;
    if (!definitionId || !canReadDefinitions) {
      const nextDrafts = buildStepDrafts(selectedProcessType, []);
      setStepDrafts(nextDrafts);
      setStepsJson(
        JSON.stringify(serializeStepDrafts(nextDrafts, selectedProcessType), null, 2)
      );
      setStepsJsonError("");
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
                requiredPermissionCode: row?.requiredPermissionCode ?? null,
                minApproverCount: Number(row?.minApproverCount || 1) || 1,
                allowSelfApprove: Boolean(row?.allowSelfApprove),
                escalationAfterHours: row?.escalationAfterHours ?? null,
              }))
            : buildDefaultSteps(selectedProcessType);
        const nextDrafts = buildStepDrafts(selectedProcessType, normalized);
        setStepDrafts(nextDrafts);
        setStepsJson(
          JSON.stringify(serializeStepDrafts(nextDrafts, selectedProcessType), null, 2)
        );
        setStepsJsonError("");
      } catch (err) {
        setError(
          err?.response?.data?.message ||
            l("Failed to load workflow steps.", "Workflow adimlari yuklenemedi.")
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadDefinitions, selectedDefinition?.processType, selectedDefinitionId]);

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
    if (!canWriteDefinitions) {
      setError(
        l(
          "Missing permission: workflow.definition.write",
          "Eksik yetki: workflow.definition.write"
        )
      );
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
    if (!canWriteDefinitions) {
      setError(
        l(
          "Missing permission: workflow.definition.write",
          "Eksik yetki: workflow.definition.write"
        )
      );
      return;
    }

    const definitionId = toPositiveInt(selectedDefinitionId);
    if (!definitionId) {
      setError(l("Select a workflow definition first.", "Once workflow tanimi secin."));
      return;
    }

    if (stepsJsonError) {
      setError(stepsJsonError);
      return;
    }

    const parsedSteps = serializeStepDrafts(stepDrafts, selectedDefinition?.processType);
    if (!parsedSteps || parsedSteps.length === 0) {
      setError(
        l(
          "Workflow steps must contain at least one step.",
          "Workflow adimlari en az bir adim icermelidir."
        )
      );
      return;
    }

    setSaving("steps");
    setError("");
    setMessage("");
    try {
      await replaceWorkflowDefinitionSteps(definitionId, { steps: parsedSteps });
      await refreshModuleReadiness({ global: true });
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

  function applyStepDrafts(nextDrafts, processType = selectedDefinition?.processType) {
    const normalizedDrafts = buildStepDrafts(processType, nextDrafts);
    setStepDrafts(normalizedDrafts);
    setStepsJson(JSON.stringify(serializeStepDrafts(normalizedDrafts, processType), null, 2));
    setStepsJsonError("");
  }

  function onStepsJsonChange(event) {
    const nextValue = event.target.value;
    setStepsJson(nextValue);
    const parsed = safeParseJsonArray(nextValue);
    if (!parsed) {
      setStepsJsonError(
        l(
          "Advanced JSON must be a valid non-empty array before it can replace the visual steps.",
          "Gelismis JSON, gorsel adimlari degistirmeden once gecerli ve bos olmayan bir dizi olmalidir."
        )
      );
      return;
    }
    const nextDrafts = buildStepDrafts(selectedDefinition?.processType, parsed);
    setStepDrafts(nextDrafts);
    setStepsJsonError("");
  }

  function onStepFieldChange(index, field, value) {
    applyStepDrafts(
      stepDrafts.map((step, stepIndex) =>
        stepIndex === index
          ? {
              ...step,
              [field]: value,
            }
          : step
      )
    );
  }

  function onAddStep() {
    applyStepDrafts([
      ...stepDrafts,
      normalizeStepDraft(
        {},
        (Array.isArray(stepDrafts) ? stepDrafts.length : 0) + 1,
        selectedDefinition?.processType
      ),
    ]);
  }

  function onRemoveStep(index) {
    if (!Array.isArray(stepDrafts) || stepDrafts.length <= 1) {
      return;
    }
    applyStepDrafts(stepDrafts.filter((_, stepIndex) => stepIndex !== index));
  }

  function onResetStepsToDefaults() {
    applyStepDrafts(buildDefaultSteps(selectedDefinition?.processType));
  }

  async function onCreateAssignment(event) {
    event.preventDefault();
    if (!canWriteAssignments) {
      setError(
        l(
          "Missing permission: workflow.assignment.write",
          "Eksik yetki: workflow.assignment.write"
        )
      );
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
    if (assignmentForm.scopeType === "COUNTRY") {
      payload.countryId = toPositiveInt(assignmentForm.countryId) || undefined;
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
      await refreshModuleReadiness({ global: true });
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
    if (!assignmentId) {
      return;
    }
    if (!canWriteAssignments) {
      setError(
        l(
          "Missing permission: workflow.assignment.write",
          "Eksik yetki: workflow.assignment.write"
        )
      );
      return;
    }
    const nextStatus = String(row?.status || "").toUpperCase() === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setSaving(`assignment-status-${assignmentId}`);
    setError("");
    setMessage("");
    try {
      await updateWorkflowAssignment(assignmentId, { status: nextStatus });
      await loadData();
      await refreshModuleReadiness({ global: true });
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
          {l("Workflow Governance", "Workflow Yonetimi")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Manage workflow definitions, review-step permissions, and scope assignments for period close, local close packs, consolidation, and governed AP posting.",
            "Donem kapanisi, yerel kapanis paketleri, konsolidasyon ve yonetime tabi AP kaydi icin workflow tanimlarini, inceleme adimi yetkilerini ve kapsam atamalarini yonetin."
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
            onClick={() => refreshModuleReadiness({ global: true })}
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

      {!canReadWorkflow ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {l(
            "Missing workflow read permission: workflow.definition.read or workflow.assignment.read",
            "Eksik workflow okuma yetkisi: workflow.definition.read veya workflow.assignment.read"
          )}
        </div>
      ) : null}
      {!canReadOrgTree ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {l(
            "org.tree.read is required to load country, group, legal entity, and operating unit scope selectors.",
            "Country, grup, legal entity ve operating unit kapsam secicilerini yuklemek icin org.tree.read gerekir."
          )}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Definitions", "Tanimlar")}</h2>
          <p className="mb-3 text-xs text-slate-500">
            {l(
              "Read definitions with workflow.definition.read. Create or update them with workflow.definition.write.",
              "Tanimlari workflow.definition.read ile goruntuleyin. workflow.definition.write ile olusturun veya guncelleyin."
            )}
          </p>
          <PermissionAccessNotice
            access={definitionWriteAccess}
            permissionCode="workflow.definition.write"
            className="mb-3"
          />
          <form onSubmit={onCreateDefinition} className="grid gap-2 md:grid-cols-2">
            <input value={definitionForm.code} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, code: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Code", "Kod")} required />
            <input value={definitionForm.name} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, name: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Name", "Ad")} required />
            <select value={definitionForm.processType} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, processType: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm">
              {PROCESS_TYPES.map((row) => <option key={row} value={row}>{row}</option>)}
            </select>
            <input type="number" min={1} value={definitionForm.versionNo} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, versionNo: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={l("Version", "Versiyon")} />
            <label className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(definitionForm.isActive)} onChange={(event) => setDefinitionForm((prev) => ({ ...prev, isActive: event.target.checked }))} />{l("Active", "Aktif")}</label>
            <button type="submit" disabled={saving === "definition" || !canWriteDefinitions} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "definition" ? l("Saving...", "Kaydediliyor...") : l("Save definition", "Tanimi kaydet")}</button>
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
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Steps", "Adimlar")}</h2>
          <p className="mb-2 text-xs text-slate-500">{selectedDefinition ? `${selectedDefinition.code} (${selectedDefinition.processType})` : l("Select a definition to edit steps.", "Adim duzenlemek icin tanim secin.")}</p>
          <p className="mb-2 text-xs text-slate-500">
            {l(
              "Valid stageScopeType values: OPERATING_UNIT, LEGAL_ENTITY, COUNTRY, GROUP.",
              "Gecerli stageScopeType degerleri: OPERATING_UNIT, LEGAL_ENTITY, COUNTRY, GROUP."
            )}
          </p>
          <p className="mb-2 text-xs text-slate-500">
            {l(
              "Use the visual builder for normal workflow setup. Advanced JSON remains available for copy/paste or bulk edits.",
              "Normal workflow kurulumu icin gorsel adim olusturucuyu kullanin. Gelismis JSON, kopyala/yapistir veya toplu duzenleme icin acik kalir."
            )}
          </p>
          {selectedDefinition?.processType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE ? (
            <p className="mb-2 text-xs text-slate-500">
              {l(
                "AP_DOCUMENT_POSTING steps must keep requiredPermissionCode as null so reviewer authority comes from workflow assignment scope only.",
                "AP_DOCUMENT_POSTING adimlarinda requiredPermissionCode null kalmalidir; inceleyen yetkisi yalnizca workflow atama kapsamindan gelir."
              )}
            </p>
          ) : null}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResetStepsToDefaults}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              {l("Reset to defaults", "Varsayilanlara don")}
            </button>
            <button
              type="button"
              onClick={onAddStep}
              className="rounded border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800"
            >
              {l("Add step", "Adim ekle")}
            </button>
          </div>
          <div className="mb-4 space-y-3">
            {stepDrafts.map((step, index) => {
              const apProcessType =
                selectedDefinition?.processType === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;
              return (
                <div
                  key={`workflow-step-builder-${index}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800">
                      {l("Step", "Adim")} {index + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveStep(index)}
                      disabled={stepDrafts.length <= 1}
                      className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                    >
                      {l("Remove", "Kaldir")}
                    </button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Step no", "Adim no")}
                      <input
                        type="number"
                        min={1}
                        value={step.stepNo}
                        onChange={(event) =>
                          onStepFieldChange(index, "stepNo", event.target.value)
                        }
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Stage scope", "Adim kapsami")}
                      <select
                        value={step.stageScopeType}
                        onChange={(event) =>
                          onStepFieldChange(index, "stageScopeType", event.target.value)
                        }
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                      >
                        {STEP_SCOPE_TYPES.map((row) => (
                          <option key={row} value={row}>
                            {row}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Required permission code", "Gerekli yetki kodu")}
                      <input
                        type="text"
                        value={step.requiredPermissionCode}
                        onChange={(event) =>
                          onStepFieldChange(index, "requiredPermissionCode", event.target.value)
                        }
                        disabled={apProcessType}
                        placeholder={
                          apProcessType
                            ? l("Must stay empty for AP", "AP icin bos kalmali")
                            : l("permission.code", "permission.code")
                        }
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-normal disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Min approver count", "Minimum onayci sayisi")}
                      <input
                        type="number"
                        min={1}
                        value={step.minApproverCount}
                        onChange={(event) =>
                          onStepFieldChange(index, "minApproverCount", event.target.value)
                        }
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Escalation after hours", "Kac saat sonra escalate")}
                      <input
                        type="number"
                        min={1}
                        value={step.escalationAfterHours}
                        onChange={(event) =>
                          onStepFieldChange(index, "escalationAfterHours", event.target.value)
                        }
                        placeholder={l("Optional", "Opsiyonel")}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                      />
                    </label>
                    <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 md:self-end">
                      <input
                        type="checkbox"
                        checked={Boolean(step.allowSelfApprove)}
                        onChange={(event) =>
                          onStepFieldChange(index, "allowSelfApprove", event.target.checked)
                        }
                      />
                      <span>{l("Allow self approve", "Kendi kendine onay")}</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
            <div className="font-semibold">
              {l("Escalation support", "Escalation destegi")}
            </div>
            <p className="mt-1">
              {l(
                "Add `escalationAfterHours` to a step when overdue reviews should escalate without leaving the normal pending queue.",
              "Geciken incelemeler normal pending kuyrugundan cikmadan escalate olsun istiyorsaniz adima `escalationAfterHours` ekleyin."
            )}
          </p>
            <pre className="mt-2 overflow-x-auto rounded border border-amber-200 bg-white/80 p-2 text-[11px] text-amber-950">{`{
  "stepNo": 2,
  "stageScopeType": "LEGAL_ENTITY",
  "requiredPermissionCode": "gl.period.close",
  "minApproverCount": 1,
  "allowSelfApprove": false,
  "escalationAfterHours": 24
}`}</pre>
          </div>
          <form onSubmit={onSaveSteps} className="space-y-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Advanced JSON", "Gelismis JSON")}
              </p>
              <textarea
                value={stepsJson}
                onChange={onStepsJsonChange}
                className="min-h-[220px] w-full rounded border border-slate-300 p-2 font-mono text-xs"
              />
              {stepsJsonError ? (
                <p className="mt-2 text-xs text-rose-700">{stepsJsonError}</p>
              ) : (
                <p className="mt-2 text-[11px] text-slate-500">
                  {l(
                    "Visual edits keep this JSON in sync. Paste JSON here only when you need bulk edits or template import.",
                    "Gorsel duzenlemeler bu JSON'u senkron tutar. Buraya JSON yalnizca toplu duzenleme veya sablon ice aktarimi icin yapistirin."
                  )}
                </p>
              )}
            </div>
            <button type="submit" disabled={saving === "steps" || !canWriteDefinitions || !toPositiveInt(selectedDefinitionId)} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "steps" ? l("Saving...", "Kaydediliyor...") : l("Save steps", "Adimlari kaydet")}</button>
          </form>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">{l("Assignments", "Atamalar")}</h2>
        <p className="mb-3 text-xs text-slate-500">
          {l(
            "Read scope assignments with workflow.assignment.read. Create or update them with workflow.assignment.write.",
            "Kapsam atamalarini workflow.assignment.read ile goruntuleyin. workflow.assignment.write ile olusturun veya guncelleyin."
          )}
        </p>
        <PermissionAccessNotice
          access={assignmentWriteAccess}
          permissionCode="workflow.assignment.write"
          className="mb-3"
        />
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
          {assignmentForm.scopeType === "COUNTRY" ? (
            <select value={assignmentForm.countryId} onChange={(event) => setAssignmentForm((prev) => ({ ...prev, countryId: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" required>
              <option value="">{l("Select country", "Ulke secin")}</option>
              {countries.map((row) => <option key={row.id} value={row.id}>{row.iso2} - {row.name}</option>)}
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
          <button type="submit" disabled={saving === "assignment" || !canWriteAssignments} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving === "assignment" ? l("Saving...", "Kaydediliyor...") : l("Save assignment", "Atamayi kaydet")}</button>
        </form>

        <div className="mt-3 max-h-72 overflow-auto rounded border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-2 py-2">ID</th><th className="px-2 py-2">{l("Process", "Surec")}</th><th className="px-2 py-2">{l("Scope", "Kapsam")}</th><th className="px-2 py-2">{l("Definition", "Tanim")}</th><th className="px-2 py-2">{l("Status", "Durum")}</th><th className="px-2 py-2">{l("Action", "Islem")}</th></tr></thead>
            <tbody>
              {assignments.map((row) => {
                const assignmentId = toPositiveInt(row?.id);
                const rowSaving = saving === `assignment-status-${assignmentId}`;
                const rowScope =
                  row.operatingUnitId
                    ? { scopeType: "OPERATING_UNIT", scopeId: row.operatingUnitId }
                    : row.legalEntityId
                      ? { scopeType: "LEGAL_ENTITY", scopeId: row.legalEntityId }
                      : row.countryId
                        ? { scopeType: "COUNTRY", scopeId: row.countryId }
                      : row.groupCompanyId
                        ? { scopeType: "GROUP", scopeId: row.groupCompanyId }
                        : tenantScopeId
                          ? { scopeType: "TENANT", scopeId: tenantScopeId }
                          : null;
                const rowScopeLabel =
                  row.operatingUnitId
                    ? `OPERATING_UNIT: ${row.operatingUnitCode || row.operatingUnitName || row.operatingUnitId}`
                    : row.legalEntityId
                      ? `LEGAL_ENTITY: ${row.legalEntityCode || row.legalEntityName || row.legalEntityId}`
                      : row.countryId
                        ? `COUNTRY: ${row.countryIso2 || row.countryName || row.countryId}`
                        : row.groupCompanyId
                          ? `GROUP: ${row.groupCompanyCode || row.groupCompanyName || row.groupCompanyId}`
                          : "TENANT";
                const rowWriteAccess = getPermissionAccess(
                  "workflow.assignment.write",
                  rowScope ? { scope: rowScope } : undefined
                );
                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">#{row.id}</td>
                    <td className="px-2 py-2">{row.processType}</td>
                    <td className="px-2 py-2">{rowScopeLabel}</td>
                    <td className="px-2 py-2">{row.workflowDefinitionCode} - {row.workflowDefinitionName}</td>
                    <td className="px-2 py-2">{row.status}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onToggleAssignmentStatus(row)} disabled={rowSaving || !rowWriteAccess.allowed} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60">{rowSaving ? l("Saving...", "Kaydediliyor...") : row.status === "ACTIVE" ? l("Set INACTIVE", "PASIF yap") : l("Set ACTIVE", "AKTIF yap")}</button>
                    </td>
                  </tr>
                );
              })}
              {assignments.length === 0 && !loading ? (<tr><td colSpan={6} className="px-2 py-3 text-slate-500">{l("No assignments.", "Atama yok.")}</td></tr>) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
