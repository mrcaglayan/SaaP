
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

const ASSIGNMENT_SCOPE_TYPES = [
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
];

const STEP_SCOPE_TYPES = ["OPERATING_UNIT", "LEGAL_ENTITY", "COUNTRY", "GROUP"];

const SETUP_STEPS = [1, 2, 3, 4, 5];

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
  return sourceRows.map((row, index) => normalizeStepDraft(row, index + 1, processType));
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
      ? Math.max(1, Number(step?.escalationAfterHours) || 1)
      : null,
  }));
}

function getProcessLabel(l, processType) {
  const normalized = String(processType || "").toUpperCase();

  if (normalized === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return l("AP Document Posting", "AP Belge Kaydi");
  }
  if (normalized === "PERIOD_CLOSE") {
    return l("Period Close", "Donem Kapanisi");
  }
  if (normalized === "CONSOLIDATION_RUN") {
    return l("Consolidation Run", "Konsolidasyon Calistirma");
  }
  if (normalized === "LOCAL_CLOSE_PACK") {
    return l("Local Close Pack", "Yerel Kapanis Paketi");
  }

  return normalized || "-";
}

function getScopeLabel(l, scopeType) {
  const normalized = String(scopeType || "").toUpperCase();

  if (normalized === "TENANT") {
    return l("Tenant", "Tenant");
  }
  if (normalized === "GROUP") {
    return l("Group", "Grup");
  }
  if (normalized === "COUNTRY") {
    return l("Country", "Ulke");
  }
  if (normalized === "LEGAL_ENTITY") {
    return l("Legal Entity", "Legal Entity");
  }
  if (normalized === "OPERATING_UNIT") {
    return l("Operating Unit", "Operating Unit");
  }

  return normalized || "-";
}

function getProcessRecommendation(l, processType) {
  const normalized = String(processType || "").toUpperCase();

  if (normalized === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE) {
    return {
      title: l("Recommended for AP posting", "AP kaydi icin onerilen"),
      points: [
        l("Use 1 country-level approval step.", "1 adet country seviyesinde onay adimi kullanin."),
        l("Leave reviewer permission empty.", "Inceleyen yetkisini bos birakin."),
        l("Keep self-approval off.", "Kendi kendine onayi kapali tutun."),
        l("Typical assignment scope: Country.", "Tipik atama kapsami: Country."),
      ],
    };
  }

  if (normalized === "PERIOD_CLOSE") {
    return {
      title: l("Recommended for period close", "Donem kapanisi icin onerilen"),
      points: [
        l(
          "Start with Operating Unit → Legal Entity → Group.",
          "Operating Unit → Legal Entity → Group ile baslayin."
        ),
        l(
          "Required reviewer permission: gl.period.close.",
          "Gerekli inceleyen yetkisi: gl.period.close."
        ),
      ],
    };
  }

  if (normalized === "CONSOLIDATION_RUN") {
    return {
      title: l("Recommended for consolidation", "Konsolidasyon icin onerilen"),
      points: [
        l(
          "Start with Operating Unit → Legal Entity → Group.",
          "Operating Unit → Legal Entity → Group ile baslayin."
        ),
        l(
          "Required reviewer permission: consolidation.run.finalize.",
          "Gerekli inceleyen yetkisi: consolidation.run.finalize."
        ),
      ],
    };
  }

  return {
    title: l("Recommended for local close packs", "Yerel kapanis paketleri icin onerilen"),
    points: [
      l(
        "Start with one Legal Entity approval step.",
        "Bir adet Legal Entity onay adimi ile baslayin."
      ),
      l(
        "Only add custom routing when the business process really needs it.",
        "Sadece is sureci gercekten gerekiyorsa ozel yonlendirme ekleyin."
      ),
    ],
  };
}

function buildStepPreviewText(l, step, processType) {
  const level = getScopeLabel(l, step?.stageScopeType).toLowerCase();
  const minCount = Math.max(1, Number(step?.minApproverCount || 1));
  const selfApprove = Boolean(step?.allowSelfApprove);
  const escalation = String(step?.escalationAfterHours || "").trim();
  const permissionCode = String(step?.requiredPermissionCode || "").trim();
  const isAp = String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;

  const parts = [];

  parts.push(
    minCount === 1
      ? l(`One ${level}-level approval is required.`, `${level} seviyesinde 1 onay gerekir.`)
      : l(
          `${minCount} ${level}-level approvals are required.`,
          `${level} seviyesinde ${minCount} onay gerekir.`
        )
  );

  if (isAp) {
    parts.push(
      l(
        "Reviewer authority comes from the workflow assignment scope.",
        "Inceleyen yetkisi workflow atama kapsamindan gelir."
      )
    );
  } else if (permissionCode) {
    parts.push(
      l(
        `Approvers must have permission "${permissionCode}".`,
        `Onaylayanlarin "${permissionCode}" yetkisine sahip olmasi gerekir.`
      )
    );
  }

  parts.push(
    selfApprove
      ? l("The submitter may approve their own item.", "Gonderen kisi kendi kaydini onaylayabilir.")
      : l("The submitter cannot approve their own item.", "Gonderen kisi kendi kaydini onaylayamaz.")
  );

  if (escalation) {
    parts.push(
      l(
        `This step escalates after ${escalation} hours if still pending.`,
        `Bu adim hala bekliyorsa ${escalation} saat sonra escalate olur.`
      )
    );
  }

  return parts.join(" ");
}

function buildWorkflowPreviewText(l, stepDrafts) {
  const rows = Array.isArray(stepDrafts) ? stepDrafts : [];
  if (rows.length === 0) {
    return l("No approval steps defined yet.", "Henuz onay adimi tanimlanmadi.");
  }

  if (rows.length === 1) {
    return l(
      `This workflow requires ${getScopeLabel(l, rows[0]?.stageScopeType)} approval.`,
      `Bu workflow ${getScopeLabel(l, rows[0]?.stageScopeType)} seviyesinde onay gerektirir.`
    );
  }

  return l(
    `This workflow requires approvals in this order: ${rows
      .map((step, index) => `${index + 1}. ${getScopeLabel(l, step?.stageScopeType)}`)
      .join(" → ")}.`,
    `Bu workflow su sirayla onay ister: ${rows
      .map((step, index) => `${index + 1}. ${getScopeLabel(l, step?.stageScopeType)}`)
      .join(" → ")}.`
  );
}

function buildAssignmentEffectText(
  l,
  assignmentForm,
  selectedCountry,
  selectedGroupCompany,
  selectedLegalEntity,
  selectedOperatingUnit
) {
  const scopeType = String(assignmentForm?.scopeType || "").toUpperCase();

  if (scopeType === "TENANT") {
    return l(
      "This workflow will apply across the whole tenant.",
      "Bu workflow tum tenant genelinde gecerli olur."
    );
  }

  if (scopeType === "GROUP") {
    return l(
      `This workflow will apply under Group = ${
        selectedGroupCompany?.code || selectedGroupCompany?.name || "-"
      }.`,
      `Bu workflow Group = ${
        selectedGroupCompany?.code || selectedGroupCompany?.name || "-"
      } altinda gecerli olur.`
    );
  }

  if (scopeType === "COUNTRY") {
    return l(
      `This workflow will apply under Country = ${
        selectedCountry?.iso2 || selectedCountry?.name || "-"
      }.`,
      `Bu workflow Country = ${
        selectedCountry?.iso2 || selectedCountry?.name || "-"
      } altinda gecerli olur.`
    );
  }

  if (scopeType === "LEGAL_ENTITY") {
    return l(
      `This workflow will apply only to Legal Entity = ${
        selectedLegalEntity?.code || selectedLegalEntity?.name || "-"
      }.`,
      `Bu workflow yalnizca Legal Entity = ${
        selectedLegalEntity?.code || selectedLegalEntity?.name || "-"
      } icin gecerli olur.`
    );
  }

  if (scopeType === "OPERATING_UNIT") {
    return l(
      `This workflow will apply only to Operating Unit = ${
        selectedOperatingUnit?.code || selectedOperatingUnit?.name || "-"
      }.`,
      `Bu workflow yalnizca Operating Unit = ${
        selectedOperatingUnit?.code || selectedOperatingUnit?.name || "-"
      } icin gecerli olur.`
    );
  }

  return l(
    "Choose a scope to see where this workflow will apply.",
    "Workflow'un nerede gecerli olacagini gormek icin kapsam secin."
  );
}

function buildAssignmentScopeLabel(l, row) {
  if (row?.operatingUnitId) {
    return `OPERATING_UNIT: ${row.operatingUnitCode || row.operatingUnitName || row.operatingUnitId}`;
  }
  if (row?.legalEntityId) {
    return `LEGAL_ENTITY: ${row.legalEntityCode || row.legalEntityName || row.legalEntityId}`;
  }
  if (row?.countryId) {
    return `COUNTRY: ${row.countryIso2 || row.countryName || row.countryId}`;
  }
  if (row?.groupCompanyId) {
    return `GROUP: ${row.groupCompanyCode || row.groupCompanyName || row.groupCompanyId}`;
  }
  return l("TENANT", "TENANT");
}

function getMeaningText(l, currentStep) {
  if (currentStep === 1) {
    return l(
      "Choose the business process this workflow will control.",
      "Bu workflow'un hangi is surecini yonetecegini secin."
    );
  }
  if (currentStep === 2) {
    return l(
      "A workflow is the reusable approval recipe.",
      "Workflow tekrar kullanilabilir onay tarifidir."
    );
  }
  if (currentStep === 3) {
    return l(
      "Steps define who approves and in what order.",
      "Adimlar kimin hangi sirada onayladigini belirler."
    );
  }
  if (currentStep === 4) {
    return l(
      "Assignment decides where the workflow becomes active.",
      "Atama workflow'un nerede aktif olacagini belirler."
    );
  }
  return l(
    "Review the full setup before leaving the page.",
    "Sayfadan ayrilmadan once tum kurulumu gozden gecirin."
  );
}

function getNextActionText(l, currentStep) {
  if (currentStep === 1) {
    return l("Next: create or select a workflow.", "Siradaki adim: workflow olusturun veya secin.");
  }
  if (currentStep === 2) {
    return l("Next: define approval steps.", "Siradaki adim: onay adimlarini tanimlayin.");
  }
  if (currentStep === 3) {
    return l(
      "Next: choose where this workflow applies.",
      "Siradaki adim: workflow'un nerede gecerli olacagini secin."
    );
  }
  if (currentStep === 4) {
    return l("Next: review the setup.", "Siradaki adim: kurulumu gozden gecirin.");
  }
  return l("Setup review complete.", "Kurulum gozden gecirildi.");
}

function WorkflowSetupProgress({ currentStep, l }) {
  const labels = [
    l("Choose type", "Tur secin"),
    l("Create or select workflow", "Workflow olustur veya sec"),
    l("Define approvals", "Onaylari tanimla"),
    l("Choose scope", "Kapsam sec"),
    l("Review", "Gozden gecir"),
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-800">
        {l("Setup progress", "Kurulum ilerlemesi")}
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {SETUP_STEPS.map((stepNo, index) => {
          const active = stepNo === currentStep;
          const done = stepNo < currentStep;

          return (
            <div
              key={stepNo}
              className={`rounded-lg border px-3 py-2 text-sm ${
                active
                  ? "border-cyan-400 bg-cyan-50 text-cyan-900"
                  : done
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-wide">
                {l("Step", "Adim")} {stepNo}
              </div>
              <div className="mt-1">{labels[index]}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WorkflowTypeSection({ l, processType, onChange }) {
  const recommendation = getProcessRecommendation(l, processType);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">
        {l("1. Choose workflow type", "1. Workflow turunu secin")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {l(
          "Choose the business process this workflow controls.",
          "Bu workflow'un yonettigi is surecini secin."
        )}
      </p>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-800">
          {l("Workflow type", "Workflow turu")}
        </span>
        <p className="mt-1 text-xs text-slate-500">
          {l(
            "This choice affects the recommended approval structure and defaults.",
            "Bu secim onerilen onay yapisini ve varsayilanlari belirler."
          )}
        </p>
        <select
          value={processType}
          onChange={(event) => onChange(event.target.value)}
          className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        >
          {PROCESS_TYPES.map((row) => (
            <option key={row} value={row}>
              {getProcessLabel(l, row)}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-3">
        <div className="text-sm font-semibold text-cyan-900">{recommendation.title}</div>
        <ul className="mt-2 list-disc pl-5 text-sm text-cyan-900">
          {recommendation.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function WorkflowDefinitionSection({
  l,
  mode,
  onModeChange,
  definitions,
  selectedDefinitionId,
  onSelectDefinition,
  definitionForm,
  setDefinitionForm,
  onCreateDefinition,
  saving,
  canWriteDefinitions,
  definitionWriteAccess,
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">
        {l("2. Create or select workflow", "2. Workflow olusturun veya secin")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {l(
          "A workflow is the reusable approval recipe for this process.",
          "Workflow bu surec icin tekrar kullanilabilir onay tarifidir."
        )}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onModeChange("select")}
          className={`rounded px-3 py-2 text-sm font-medium ${
            mode === "select" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"
          }`}
        >
          {l("Use existing", "Var olani kullan")}
        </button>
        <button
          type="button"
          onClick={() => onModeChange("create")}
          className={`rounded px-3 py-2 text-sm font-medium ${
            mode === "create" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"
          }`}
        >
          {l("Create new", "Yeni olustur")}
        </button>
      </div>

      <PermissionAccessNotice
        access={definitionWriteAccess}
        permissionCode="workflow.definition.write"
        className="mt-4"
      />

      {mode === "select" ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-800">
              {l("Saved workflows", "Kayitli workflow'lar")}
            </span>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "Only workflows that match the selected workflow type are shown.",
                "Yalnizca secilen workflow turune uyan kayitlar gosterilir."
              )}
            </p>
            <select
              value={selectedDefinitionId}
              onChange={(event) => onSelectDefinition(event.target.value)}
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">{l("Select a workflow", "Workflow secin")}</option>
              {definitions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>

          {definitions.length === 0 ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {l(
                "No workflows found for this type yet. Create one below.",
                "Bu tur icin henuz workflow bulunmuyor. Asagida yeni bir tane olusturun."
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onCreateDefinition} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-800">
              {l("Workflow code", "Workflow kodu")}
            </span>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "Stable technical identifier for this workflow.",
                "Bu workflow icin sabit teknik kimliktir."
              )}
            </p>
            <input
              value={definitionForm.code}
              onChange={(event) =>
                setDefinitionForm((prev) => ({ ...prev, code: event.target.value }))
              }
              placeholder="WF_STD_AP_COUNTRY_POSTING_V1"
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-800">
              {l("Workflow name", "Workflow adi")}
            </span>
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "Business-friendly name that admins can recognize easily.",
                "Yoneticilerin kolayca taniyabilecegi is diliyle isim."
              )}
            </p>
            <input
              value={definitionForm.name}
              onChange={(event) =>
                setDefinitionForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Standard AP Country Approval Gate"
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-800">
              {l("Version", "Versiyon")}
            </span>
            <p className="mt-1 text-xs text-slate-500">
              {l("Use 1 for a new workflow design.", "Yeni workflow tasarimi icin 1 kullanin.")}
            </p>
            <input
              type="number"
              min={1}
              value={definitionForm.versionNo}
              onChange={(event) =>
                setDefinitionForm((prev) => ({ ...prev, versionNo: event.target.value }))
              }
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-3 text-sm md:self-end">
            <input
              type="checkbox"
              checked={Boolean(definitionForm.isActive)}
              onChange={(event) =>
                setDefinitionForm((prev) => ({ ...prev, isActive: event.target.checked }))
              }
            />
            <span>{l("Available for use", "Kullanima acik")}</span>
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving || !canWriteDefinitions}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? l("Creating...", "Olusturuluyor...") : l("Create workflow", "Workflow olustur")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ApprovalStepCard({
  l,
  index,
  step,
  processType,
  onFieldChange,
  onRemove,
  disableRemove,
}) {
  const isAp = String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900">
          {l("Step", "Adim")} {index + 1}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disableRemove}
          className="rounded border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-60"
        >
          {l("Remove", "Kaldir")}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Step order", "Adim sirasi")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {l("Sequence number for this approval stage.", "Bu onay asamasi icin sira numarasi.")}
          </p>
          <input
            type="number"
            min={1}
            value={step.stepNo}
            onChange={(event) => onFieldChange("stepNo", event.target.value)}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Approval level", "Onay seviyesi")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {l(
              "Choose the organizational level where the approver must exist.",
              "Onaylayicinin bulunmasi gereken organizasyon seviyesini secin."
            )}
          </p>
          <select
            value={step.stageScopeType}
            onChange={(event) => onFieldChange("stageScopeType", event.target.value)}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {STEP_SCOPE_TYPES.map((row) => (
              <option key={row} value={row}>
                {getScopeLabel(l, row)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Required reviewer permission", "Gerekli inceleyen yetkisi")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {isAp
              ? l(
                  "Not used for AP Document Posting. Reviewer authority comes from assignment scope.",
                  "AP Belge Kaydi icin kullanilmaz. Inceleyen yetkisi atama kapsamindan gelir."
                )
              : l(
                  "Permission the approver must hold for this step.",
                  "Onaylayicinin bu adim icin sahip olmasi gereken yetki."
                )}
          </p>
          <input
            type="text"
            value={step.requiredPermissionCode}
            onChange={(event) => onFieldChange("requiredPermissionCode", event.target.value)}
            disabled={isAp}
            placeholder={isAp ? l("Leave empty for AP", "AP icin bos birakin") : "permission.code"}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Minimum approvals", "Minimum onay sayisi")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {l(
              "How many approvals are required at this step.",
              "Bu adimda kac onay gerektigini belirler."
            )}
          </p>
          <input
            type="number"
            min={1}
            value={step.minApproverCount}
            onChange={(event) => onFieldChange("minApproverCount", event.target.value)}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Escalate if overdue after", "Gecikirse su kadar sonra escalate et")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {l(
              "Optional. Escalate this step after this many hours.",
              "Opsiyonel. Bu adimi belirtilen saat sonra escalate eder."
            )}
          </p>
          <input
            type="number"
            min={1}
            value={step.escalationAfterHours}
            onChange={(event) => onFieldChange("escalationAfterHours", event.target.value)}
            placeholder="24"
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-3 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={Boolean(step.allowSelfApprove)}
            onChange={(event) => onFieldChange("allowSelfApprove", event.target.checked)}
          />
          <span>{l("Allow self-approval", "Kendi kendine onay ver")}</span>
          <span className="ml-2 text-xs text-slate-500">{l("Recommended: Off", "Onerilen: Kapali")}</span>
        </label>
      </div>

      <div className="mt-3 rounded border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
        {buildStepPreviewText(l, step, processType)}
      </div>
    </div>
  );
}

function WorkflowStepsSection({
  l,
  selectedDefinition,
  processType,
  stepDrafts,
  onChangeStepDrafts,
  onResetStepsToDefaults,
  onSaveSteps,
  showAdvancedJson,
  onToggleAdvancedJson,
  stepsJson,
  onStepsJsonChange,
  stepsJsonError,
  saving,
  canWriteDefinitions,
  workflowPreviewText,
}) {
  function onStepFieldChange(index, field, value) {
    onChangeStepDrafts((prev) =>
      prev.map((step, stepIndex) =>
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
    onChangeStepDrafts((prev) => [
      ...prev,
      normalizeStepDraft({}, (Array.isArray(prev) ? prev.length : 0) + 1, processType),
    ]);
  }

  function onRemoveStep(index) {
    onChangeStepDrafts((prev) => {
      if (!Array.isArray(prev) || prev.length <= 1) {
        return prev;
      }
      return prev.filter((_, stepIndex) => stepIndex !== index);
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">
        {l("3. Define approval steps", "3. Onay adimlarini tanimlayin")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {l(
          "Choose who must approve and in what order.",
          "Kimin hangi sirada onay verecegini secin."
        )}
      </p>

      <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {selectedDefinition
          ? `${l("Selected workflow", "Secilen workflow")}: ${selectedDefinition.code} (${getProcessLabel(
              l,
              selectedDefinition.processType
            )})`
          : l("Create or select a workflow first.", "Once bir workflow olusturun veya secin.")}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onResetStepsToDefaults}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
        >
          {l("Reset to recommended setup", "Onerilen kurulumlara don")}
        </button>
        <button
          type="button"
          onClick={onAddStep}
          className="rounded border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-800"
        >
          {l("Add approval step", "Onay adimi ekle")}
        </button>
        <button
          type="button"
          onClick={onToggleAdvancedJson}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
        >
          {showAdvancedJson
            ? l("Hide advanced JSON", "Gelismis JSON'u gizle")
            : l("Show advanced JSON", "Gelismis JSON'u goster")}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {stepDrafts.map((step, index) => (
          <ApprovalStepCard
            key={`workflow-step-${index}`}
            l={l}
            index={index}
            step={step}
            processType={processType}
            onFieldChange={(field, value) => onStepFieldChange(index, field, value)}
            onRemove={() => onRemoveStep(index)}
            disableRemove={stepDrafts.length <= 1}
          />
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="font-semibold">{l("Workflow preview", "Workflow onizlemesi")}</div>
        <p className="mt-1">{workflowPreviewText}</p>
      </div>

      {showAdvancedJson ? (
        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-800">
            {l("Advanced step JSON", "Gelismis adim JSON")}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {l(
              "For power users only. Most workflow setups should use the visual editor.",
              "Yalnizca ileri kullanicilar icin. Cogu workflow kurulumu gorsel editor ile yapilmalidir."
            )}
          </p>
          <textarea
            value={stepsJson}
            onChange={onStepsJsonChange}
            className="mt-2 min-h-[220px] w-full rounded border border-slate-300 p-2 font-mono text-xs"
          />
          {stepsJsonError ? (
            <p className="mt-2 text-xs text-rose-700">{stepsJsonError}</p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              {l(
                "Paste JSON here only for bulk edits or template import.",
                "Buraya JSON'u yalnizca toplu duzenleme veya sablon ice aktarma icin yapistirin."
              )}
            </p>
          )}
        </div>
      ) : null}

      <form onSubmit={onSaveSteps} className="mt-4">
        <button
          type="submit"
          disabled={saving || !canWriteDefinitions || !selectedDefinition}
          className="rounded bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? l("Saving...", "Kaydediliyor...") : l("Save approval steps", "Onay adimlarini kaydet")}
        </button>
      </form>
    </section>
  );
}

function WorkflowAssignmentSection({
  l,
  assignmentForm,
  setAssignmentForm,
  filteredDefinitionOptions,
  countries,
  groupCompanies,
  legalEntities,
  operatingUnits,
  effectText,
  assignmentWriteAccess,
  canWriteAssignments,
  onCreateAssignment,
  saving,
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">
        {l("4. Choose where this workflow applies", "4. Workflow'un nerede gecerli oldugunu secin")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {l(
          "Select the organizational scope where this workflow becomes active.",
          "Bu workflow'un aktif olacagi organizasyon kapsamını secin."
        )}
      </p>

      <PermissionAccessNotice
        access={assignmentWriteAccess}
        permissionCode="workflow.assignment.write"
        className="mt-4"
      />

      <form onSubmit={onCreateAssignment} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Selected workflow", "Secilen workflow")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {l(
              "Choose the workflow that will apply at the selected scope.",
              "Secilen kapsamda gecerli olacak workflow'u secin."
            )}
          </p>
          <select
            value={assignmentForm.workflowDefinitionId}
            onChange={(event) =>
              setAssignmentForm((prev) => ({
                ...prev,
                workflowDefinitionId: event.target.value,
              }))
            }
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">{l("Select workflow", "Workflow secin")}</option>
            {filteredDefinitionOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} - {row.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Applies to", "Gecerli oldugu kapsam")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {l(
              "Choose the organizational level where this workflow becomes active.",
              "Workflow'un aktif olacagi organizasyon seviyesini secin."
            )}
          </p>
          <select
            value={assignmentForm.scopeType}
            onChange={(event) =>
              setAssignmentForm((prev) => ({
                ...prev,
                scopeType: event.target.value,
              }))
            }
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {ASSIGNMENT_SCOPE_TYPES.map((row) => (
              <option key={row} value={row}>
                {getScopeLabel(l, row)}
              </option>
            ))}
          </select>
        </label>

        {assignmentForm.scopeType === "GROUP" ? (
          <label className="block">
            <span className="text-sm font-medium text-slate-800">
              {l("Select group company", "Grup sirketi secin")}
            </span>
            <select
              value={assignmentForm.groupCompanyId}
              onChange={(event) =>
                setAssignmentForm((prev) => ({
                  ...prev,
                  groupCompanyId: event.target.value,
                }))
              }
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select group company", "Grup sirketi secin")}</option>
              {groupCompanies.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {assignmentForm.scopeType === "COUNTRY" ? (
          <label className="block">
            <span className="text-sm font-medium text-slate-800">
              {l("Select country", "Ulke secin")}
            </span>
            <select
              value={assignmentForm.countryId}
              onChange={(event) =>
                setAssignmentForm((prev) => ({
                  ...prev,
                  countryId: event.target.value,
                }))
              }
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select country", "Ulke secin")}</option>
              {countries.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.iso2} - {row.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {assignmentForm.scopeType === "LEGAL_ENTITY" ? (
          <label className="block">
            <span className="text-sm font-medium text-slate-800">
              {l("Select legal entity", "Legal entity secin")}
            </span>
            <select
              value={assignmentForm.legalEntityId}
              onChange={(event) =>
                setAssignmentForm((prev) => ({
                  ...prev,
                  legalEntityId: event.target.value,
                }))
              }
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select legal entity", "Legal entity secin")}</option>
              {legalEntities.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {assignmentForm.scopeType === "OPERATING_UNIT" ? (
          <label className="block">
            <span className="text-sm font-medium text-slate-800">
              {l("Select operating unit", "Operating unit secin")}
            </span>
            <select
              value={assignmentForm.operatingUnitId}
              onChange={(event) =>
                setAssignmentForm((prev) => ({
                  ...prev,
                  operatingUnitId: event.target.value,
                }))
              }
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">{l("Select operating unit", "Operating unit secin")}</option>
              {operatingUnits.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Effective from", "Gecerlilik baslangici")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {l(
              "Date when this workflow assignment starts being valid.",
              "Bu workflow atamasinin gecerli olmaya basladigi tarih."
            )}
          </p>
          <input
            type="date"
            value={assignmentForm.effectiveFrom}
            onChange={(event) =>
              setAssignmentForm((prev) => ({
                ...prev,
                effectiveFrom: event.target.value,
              }))
            }
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-800">
            {l("Assignment status", "Atama durumu")}
          </span>
          <p className="mt-1 text-xs text-slate-500">
            {l(
              "Choose whether this assignment is active now.",
              "Bu atamanin simdi aktif olup olmadigini secin."
            )}
          </p>
          <select
            value={assignmentForm.status}
            onChange={(event) =>
              setAssignmentForm((prev) => ({
                ...prev,
                status: event.target.value,
              }))
            }
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="ACTIVE">{l("Active", "Aktif")}</option>
            <option value="INACTIVE">{l("Inactive", "Pasif")}</option>
          </select>
        </label>

        <div className="md:col-span-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900">
          <div className="font-semibold">{l("Effect of this assignment", "Bu atamanin etkisi")}</div>
          <p className="mt-1">{effectText}</p>
        </div>

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={saving || !canWriteAssignments}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? l("Saving...", "Kaydediliyor...") : l("Save assignment", "Atamayi kaydet")}
          </button>
        </div>
      </form>
    </section>
  );
}

function WorkflowReviewSection({
  l,
  selectedDefinition,
  stepDrafts,
  assignmentForm,
  workflowPreviewText,
  assignmentEffectText,
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">
        {l("5. Review your setup", "5. Kurulumu gozden gecirin")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {l(
          "Review the workflow before leaving this page.",
          "Sayfadan ayrilmadan once workflow'u gozden gecirin."
        )}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-900">
            {l("Workflow summary", "Workflow ozeti")}
          </div>
          <dl className="mt-2 space-y-2 text-sm text-slate-700">
            <div>
              <dt className="font-medium">{l("Code", "Kod")}</dt>
              <dd>{selectedDefinition?.code || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium">{l("Name", "Ad")}</dt>
              <dd>{selectedDefinition?.name || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium">{l("Type", "Tur")}</dt>
              <dd>{getProcessLabel(l, selectedDefinition?.processType || assignmentForm.processType)}</dd>
            </div>
            <div>
              <dt className="font-medium">{l("Steps", "Adimlar")}</dt>
              <dd>{Array.isArray(stepDrafts) ? stepDrafts.length : 0}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-900">
            {l("Outcome", "Sonuc")}
          </div>
          <p className="mt-2 text-sm text-slate-700">{workflowPreviewText}</p>
          <p className="mt-2 text-sm text-slate-700">{assignmentEffectText}</p>
        </div>
      </div>
    </section>
  );
}

function WorkflowSetupSidebar({
  l,
  currentStep,
  processType,
  selectedDefinition,
  stepDrafts,
  assignmentForm,
  workflowPreviewText,
  assignmentEffectText,
}) {
  const recommendation = getProcessRecommendation(l, processType);

  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-900">
          {l("Current setup summary", "Mevcut kurulum ozeti")}
        </div>
        <dl className="mt-3 space-y-2 text-sm text-slate-700">
          <div>
            <dt className="font-medium">{l("Workflow type", "Workflow turu")}</dt>
            <dd>{getProcessLabel(l, processType)}</dd>
          </div>
          <div>
            <dt className="font-medium">{l("Workflow", "Workflow")}</dt>
            <dd>{selectedDefinition?.name || selectedDefinition?.code || l("Not selected yet", "Henuz secilmedi")}</dd>
          </div>
          <div>
            <dt className="font-medium">{l("Steps", "Adimlar")}</dt>
            <dd>{Array.isArray(stepDrafts) ? stepDrafts.length : 0}</dd>
          </div>
          <div>
            <dt className="font-medium">{l("Assignment status", "Atama durumu")}</dt>
            <dd>{assignmentForm?.status || "-"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
        <div className="text-sm font-semibold text-cyan-900">{recommendation.title}</div>
        <ul className="mt-2 list-disc pl-5 text-sm text-cyan-900">
          {recommendation.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-900">{l("What this means", "Bu ne anlama gelir")}</div>
        <p className="mt-2 text-sm text-slate-700">{getMeaningText(l, currentStep)}</p>
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="text-sm font-semibold text-emerald-900">{l("Next step", "Siradaki adim")}</div>
        <p className="mt-2 text-sm text-emerald-900">{getNextActionText(l, currentStep)}</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-900">{l("Live preview", "Canli onizleme")}</div>
        <p className="mt-2 text-sm text-slate-700">{workflowPreviewText}</p>
        <p className="mt-2 text-sm text-slate-700">{assignmentEffectText}</p>
      </section>
    </aside>
  );
}

function WorkflowRecordsSection({
  l,
  definitions,
  assignments,
  loading,
  selectedDefinitionId,
  onSelectDefinition,
  onToggleAssignmentStatus,
  getRowToggleAccess,
}) {
  const [tab, setTab] = useState("workflows");

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("workflows")}
          className={`rounded px-3 py-2 text-sm font-medium ${
            tab === "workflows" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"
          }`}
        >
          {l("Existing workflows", "Mevcut workflow'lar")}
        </button>
        <button
          type="button"
          onClick={() => setTab("assignments")}
          className={`rounded px-3 py-2 text-sm font-medium ${
            tab === "assignments" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"
          }`}
        >
          {l("Existing assignments", "Mevcut atamalar")}
        </button>
      </div>

      {tab === "workflows" ? (
        <div className="overflow-auto rounded border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">{l("Code", "Kod")}</th>
                <th className="px-3 py-2">{l("Name", "Ad")}</th>
                <th className="px-3 py-2">{l("Type", "Tur")}</th>
                <th className="px-3 py-2">{l("Steps", "Adimlar")}</th>
                <th className="px-3 py-2">{l("Action", "Islem")}</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-100 ${
                    toPositiveInt(row?.id) === toPositiveInt(selectedDefinitionId) ? "bg-cyan-50" : ""
                  }`}
                >
                  <td className="px-3 py-2">#{row.id}</td>
                  <td className="px-3 py-2">{row.code}</td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{getProcessLabel(l, row.processType)}</td>
                  <td className="px-3 py-2">{Number(row.stepCount || 0)}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onSelectDefinition(String(row.id))}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                    >
                      {l("Select", "Sec")}
                    </button>
                  </td>
                </tr>
              ))}

              {definitions.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-slate-500">
                    {l("No workflows found.", "Workflow bulunmadi.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-auto rounded border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">{l("Type", "Tur")}</th>
                <th className="px-3 py-2">{l("Scope", "Kapsam")}</th>
                <th className="px-3 py-2">{l("Workflow", "Workflow")}</th>
                <th className="px-3 py-2">{l("Status", "Durum")}</th>
                <th className="px-3 py-2">{l("Action", "Islem")}</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((row) => {
                const assignmentId = toPositiveInt(row?.id);
                const rowSaving = false;
                const rowAccess = getRowToggleAccess(row);

                return (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">#{row.id}</td>
                    <td className="px-3 py-2">{getProcessLabel(l, row.processType)}</td>
                    <td className="px-3 py-2">{buildAssignmentScopeLabel(l, row)}</td>
                    <td className="px-3 py-2">
                      {row.workflowDefinitionCode} - {row.workflowDefinitionName}
                    </td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onToggleAssignmentStatus(row)}
                        disabled={rowSaving || !rowAccess.allowed || !assignmentId}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        {row.status === "ACTIVE"
                          ? l("Set inactive", "Pasif yap")
                          : l("Set active", "Aktif yap")}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {assignments.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-slate-500">
                    {l("No assignments found.", "Atama bulunmadi.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Guided drop-in refactor of workflow governance setup.
 * Keeps the existing API calls, permissions, and business logic,
 * but presents them as a directive setup experience.
 */
export default function WorkflowSetupPage() {
  const { getPermissionAccess, hasPermission, user } = useAuth();
  const { language } = useI18n();
  const { getModuleRows, refresh: refreshModuleReadiness } = useModuleReadiness();

  const l = (en, tr) => (language === "tr" ? tr : en);
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

  const [currentStep, setCurrentStep] = useState(1);
  const [definitionMode, setDefinitionMode] = useState("create");
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);

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

  const visibleDefinitions = useMemo(
    () =>
      definitions.filter(
        (row) =>
          String(row?.processType || "").toUpperCase() ===
          String(definitionForm.processType || "").toUpperCase()
      ),
    [definitions, definitionForm.processType]
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

  const selectedDefinition = useMemo(
    () =>
      definitions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(selectedDefinitionId)
      ) || null,
    [definitions, selectedDefinitionId]
  );

  const selectedCountry = useMemo(
    () => countries.find((row) => String(row.id) === String(assignmentForm.countryId)) || null,
    [countries, assignmentForm.countryId]
  );

  const selectedGroupCompany = useMemo(
    () =>
      groupCompanies.find((row) => String(row.id) === String(assignmentForm.groupCompanyId)) || null,
    [groupCompanies, assignmentForm.groupCompanyId]
  );

  const selectedLegalEntity = useMemo(
    () =>
      legalEntities.find((row) => String(row.id) === String(assignmentForm.legalEntityId)) || null,
    [legalEntities, assignmentForm.legalEntityId]
  );

  const selectedOperatingUnit = useMemo(
    () =>
      operatingUnits.find((row) => String(row.id) === String(assignmentForm.operatingUnitId)) || null,
    [operatingUnits, assignmentForm.operatingUnitId]
  );

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

  const workflowPreviewText = useMemo(
    () => buildWorkflowPreviewText(l, stepDrafts),
    [l, stepDrafts]
  );

  const assignmentEffectText = useMemo(
    () =>
      buildAssignmentEffectText(
        l,
        assignmentForm,
        selectedCountry,
        selectedGroupCompany,
        selectedLegalEntity,
        selectedOperatingUnit
      ),
    [
      l,
      assignmentForm,
      selectedCountry,
      selectedGroupCompany,
      selectedLegalEntity,
      selectedOperatingUnit,
    ]
  );

  const workflowReadinessRows = getModuleRows("closeConsolidationWorkflow");
  const workflowReadyCount = workflowReadinessRows.filter((row) => Boolean(row?.ready)).length;
  const workflowTotalCount = workflowReadinessRows.length;

  function applyStepDrafts(nextDrafts, processType = selectedDefinition?.processType || definitionForm.processType) {
    const normalizedDrafts = buildStepDrafts(processType, nextDrafts);
    setStepDrafts(normalizedDrafts);
    setStepsJson(JSON.stringify(serializeStepDrafts(normalizedDrafts, processType), null, 2));
    setStepsJsonError("");
  }

  async function loadData() {
    if (!canReadWorkflow && !canReadOrgTree) {
      setDefinitions([]);
      setAssignments([]);
      setCountries([]);
      setGroupCompanies([]);
      setLegalEntities([]);
      setOperatingUnits([]);
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

      setDefinitions(Array.isArray(definitionsRes?.rows) ? definitionsRes.rows : []);
      setAssignments(Array.isArray(assignmentsRes?.rows) ? assignmentsRes.rows : []);
      setCountries(Array.isArray(countriesRes?.rows) ? countriesRes.rows : []);
      setGroupCompanies(Array.isArray(groupsRes?.rows) ? groupsRes.rows : []);
      setLegalEntities(Array.isArray(entitiesRes?.rows) ? entitiesRes.rows : []);
      setOperatingUnits(Array.isArray(unitsRes?.rows) ? unitsRes.rows : []);
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
    setAssignmentForm((prev) =>
      prev.processType === definitionForm.processType
        ? prev
        : {
            ...prev,
            processType: definitionForm.processType,
          }
    );
  }, [definitionForm.processType]);

  useEffect(() => {
    if (!visibleDefinitions.some((row) => toPositiveInt(row?.id) === toPositiveInt(selectedDefinitionId))) {
      setSelectedDefinitionId("");
    }
  }, [visibleDefinitions, selectedDefinitionId]);

  useEffect(() => {
    setAssignmentForm((prev) => {
      const selectedId = toPositiveInt(selectedDefinitionId);
      const currentId = toPositiveInt(prev.workflowDefinitionId);

      if (selectedId && filteredDefinitionOptions.some((row) => toPositiveInt(row?.id) === selectedId)) {
        return currentId === selectedId
          ? prev
          : {
              ...prev,
              workflowDefinitionId: String(selectedId),
            };
      }

      if (currentId && filteredDefinitionOptions.some((row) => toPositiveInt(row?.id) === currentId)) {
        return prev;
      }

      return prev.workflowDefinitionId
        ? {
            ...prev,
            workflowDefinitionId: "",
          }
        : prev;
    });
  }, [selectedDefinitionId, filteredDefinitionOptions]);

  useEffect(() => {
    const definitionId = toPositiveInt(selectedDefinitionId);
    const selectedProcessType = selectedDefinition?.processType || definitionForm.processType;

    if (!definitionId || !canReadDefinitions) {
      const nextDrafts = buildStepDrafts(selectedProcessType, []);
      setStepDrafts(nextDrafts);
      setStepsJson(JSON.stringify(serializeStepDrafts(nextDrafts, selectedProcessType), null, 2));
      setStepsJsonError("");
      return;
    }

    let active = true;

    (async () => {
      try {
        const response = await listWorkflowDefinitionSteps(definitionId);
        if (!active) {
          return;
        }

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
        setStepsJson(JSON.stringify(serializeStepDrafts(nextDrafts, selectedProcessType), null, 2));
        setStepsJsonError("");
      } catch (err) {
        if (!active) {
          return;
        }
        setError(
          err?.response?.data?.message ||
            l("Failed to load workflow steps.", "Workflow adimlari yuklenemedi.")
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [canReadDefinitions, definitionForm.processType, selectedDefinition?.processType, selectedDefinitionId, l]);

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

    const nextDrafts = buildStepDrafts(selectedDefinition?.processType || definitionForm.processType, parsed);
    setStepDrafts(nextDrafts);
    setStepsJsonError("");
  }

  function onResetStepsToDefaults() {
    applyStepDrafts(buildDefaultSteps(selectedDefinition?.processType || definitionForm.processType));
  }

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
        setAssignmentForm((prev) => ({
          ...prev,
          processType: definitionForm.processType,
          workflowDefinitionId: String(response.row.id),
        }));
      }

      setDefinitionMode("select");
      setCurrentStep(3);
      setMessage(
        l(
          "Workflow created. Next, define who must approve.",
          "Workflow olusturuldu. Siradaki adim: kimin onaylayacagini tanimlayin."
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to create workflow.", "Workflow olusturulamadi.")
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
      setError(l("Select a workflow first.", "Once bir workflow secin."));
      return;
    }

    if (stepsJsonError) {
      setError(stepsJsonError);
      return;
    }

    const parsedSteps = serializeStepDrafts(
      stepDrafts,
      selectedDefinition?.processType || definitionForm.processType
    );

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
      setCurrentStep(4);
      setMessage(
        l(
          "Approval steps saved. Next, choose where this workflow applies.",
          "Onay adimlari kaydedildi. Siradaki adim: workflow'un nerede gecerli olacagini secin."
        )
      );
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
      setError(l("A workflow must be selected.", "Bir workflow secilmelidir."));
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
      setCurrentStep(5);
      setMessage(
        l(
          "Assignment saved. Review the setup summary below.",
          "Atama kaydedildi. Asagidaki kurulum ozetini gozden gecirin."
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Failed to save workflow assignment.", "Workflow atamasi kaydedilemedi.")
      );
    } finally {
      setSaving("");
    }
  }

  function getAssignmentRowWriteAccess(row) {
    const rowScope = row?.operatingUnitId
      ? { scopeType: "OPERATING_UNIT", scopeId: row.operatingUnitId }
      : row?.legalEntityId
        ? { scopeType: "LEGAL_ENTITY", scopeId: row.legalEntityId }
        : row?.countryId
          ? { scopeType: "COUNTRY", scopeId: row.countryId }
          : row?.groupCompanyId
            ? { scopeType: "GROUP", scopeId: row.groupCompanyId }
            : tenantScopeId
              ? { scopeType: "TENANT", scopeId: tenantScopeId }
              : null;

    return getPermissionAccess(
      "workflow.assignment.write",
      rowScope ? { scope: rowScope } : undefined
    );
  }

  async function onToggleAssignmentStatus(row) {
    const assignmentId = toPositiveInt(row?.id);
    if (!assignmentId) {
      return;
    }

    const rowWriteAccess = getAssignmentRowWriteAccess(row);
    if (!rowWriteAccess.allowed) {
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
      setMessage(l("Assignment status updated.", "Atama durumu guncellendi."));
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {l("Workflow Setup", "Workflow Kurulumu")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Create approval workflows, define approval steps, and choose where they apply.",
            "Onay workflow'lari olusturun, onay adimlarini tanimlayin ve nerede gecerli olacaklarini secin."
          )}
        </p>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
          <div className="font-semibold">{l("How this page works", "Bu sayfa nasil calisir")}</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{l("Workflow = the reusable approval recipe", "Workflow = tekrar kullanilabilir onay tarifi")}</li>
            <li>{l("Steps = who approves and in what order", "Adimlar = kimin hangi sirada onayladigi")}</li>
            <li>{l("Assignment = where that workflow becomes active", "Atama = workflow'un nerede aktif oldugu")}</li>
          </ul>
        </div>
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
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
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
            "org.tree.read is required to load country, group, legal entity, and operating unit selectors.",
            "Country, grup, legal entity ve operating unit secicilerini yuklemek icin org.tree.read gerekir."
          )}
        </div>
      ) : null}

      <WorkflowSetupProgress currentStep={currentStep} l={l} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <WorkflowTypeSection
            l={l}
            processType={definitionForm.processType}
            onChange={(processType) => {
              setDefinitionForm((prev) => ({ ...prev, processType }));
              setAssignmentForm((prev) => ({
                ...prev,
                processType,
                workflowDefinitionId: "",
              }));
              setSelectedDefinitionId("");
              setDefinitionMode("create");
              setCurrentStep(2);
            }}
          />

          <WorkflowDefinitionSection
            l={l}
            mode={definitionMode}
            onModeChange={(nextMode) => {
              setDefinitionMode(nextMode);
              setCurrentStep(2);
            }}
            definitions={visibleDefinitions}
            selectedDefinitionId={selectedDefinitionId}
            onSelectDefinition={(value) => {
              setSelectedDefinitionId(value);
              setAssignmentForm((prev) => ({ ...prev, workflowDefinitionId: value }));
              setCurrentStep(3);
            }}
            definitionForm={definitionForm}
            setDefinitionForm={setDefinitionForm}
            onCreateDefinition={onCreateDefinition}
            saving={saving === "definition"}
            canWriteDefinitions={canWriteDefinitions}
            definitionWriteAccess={definitionWriteAccess}
          />

          <WorkflowStepsSection
            l={l}
            selectedDefinition={selectedDefinition}
            processType={selectedDefinition?.processType || definitionForm.processType}
            stepDrafts={stepDrafts}
            onChangeStepDrafts={(updater) => {
              if (typeof updater === "function") {
                setStepDrafts((prev) => {
                  const nextDrafts = updater(prev);
                  const normalized = buildStepDrafts(
                    selectedDefinition?.processType || definitionForm.processType,
                    nextDrafts
                  );
                  setStepsJson(
                    JSON.stringify(
                      serializeStepDrafts(
                        normalized,
                        selectedDefinition?.processType || definitionForm.processType
                      ),
                      null,
                      2
                    )
                  );
                  setStepsJsonError("");
                  return normalized;
                });
                return;
              }

              applyStepDrafts(updater, selectedDefinition?.processType || definitionForm.processType);
            }}
            onResetStepsToDefaults={onResetStepsToDefaults}
            onSaveSteps={onSaveSteps}
            showAdvancedJson={showAdvancedJson}
            onToggleAdvancedJson={() => setShowAdvancedJson((prev) => !prev)}
            stepsJson={stepsJson}
            onStepsJsonChange={onStepsJsonChange}
            stepsJsonError={stepsJsonError}
            saving={saving === "steps"}
            canWriteDefinitions={canWriteDefinitions}
            workflowPreviewText={workflowPreviewText}
          />

          <WorkflowAssignmentSection
            l={l}
            assignmentForm={assignmentForm}
            setAssignmentForm={setAssignmentForm}
            filteredDefinitionOptions={filteredDefinitionOptions}
            countries={countries}
            groupCompanies={groupCompanies}
            legalEntities={legalEntities}
            operatingUnits={operatingUnits}
            effectText={assignmentEffectText}
            assignmentWriteAccess={assignmentWriteAccess}
            canWriteAssignments={canWriteAssignments}
            onCreateAssignment={onCreateAssignment}
            saving={saving === "assignment"}
          />

          <WorkflowReviewSection
            l={l}
            selectedDefinition={selectedDefinition}
            stepDrafts={stepDrafts}
            assignmentForm={assignmentForm}
            workflowPreviewText={workflowPreviewText}
            assignmentEffectText={assignmentEffectText}
          />
        </div>

        <WorkflowSetupSidebar
          l={l}
          currentStep={currentStep}
          processType={definitionForm.processType}
          selectedDefinition={selectedDefinition}
          stepDrafts={stepDrafts}
          assignmentForm={assignmentForm}
          workflowPreviewText={workflowPreviewText}
          assignmentEffectText={assignmentEffectText}
        />
      </div>

      <WorkflowRecordsSection
        l={l}
        definitions={definitions}
        assignments={assignments}
        loading={loading}
        selectedDefinitionId={selectedDefinitionId}
        onSelectDefinition={(value) => {
          const selectedRow = definitions.find((row) => String(row.id) === String(value));
          if (!selectedRow) {
            return;
          }

          setDefinitionForm((prev) => ({
            ...prev,
            processType: selectedRow.processType,
          }));

          setAssignmentForm((prev) => ({
            ...prev,
            processType: selectedRow.processType,
            workflowDefinitionId: String(selectedRow.id),
          }));

          setDefinitionMode("select");
          setSelectedDefinitionId(String(selectedRow.id));
          setCurrentStep(3);
        }}
        onToggleAssignmentStatus={onToggleAssignmentStatus}
        getRowToggleAccess={getAssignmentRowWriteAccess}
      />
    </div>
  );
}
