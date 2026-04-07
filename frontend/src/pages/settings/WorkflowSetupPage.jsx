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
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import WorkflowAssignmentStep from "./workflows/components/WorkflowAssignmentStep.jsx";
import WorkflowDefinitionStep from "./workflows/components/WorkflowDefinitionStep.jsx";
import WorkflowRecordsSection from "./workflows/components/WorkflowRecordsSection.jsx";
import WorkflowReviewStep from "./workflows/components/WorkflowReviewStep.jsx";
import WorkflowSetupProgress from "./workflows/components/WorkflowSetupProgress.jsx";
import WorkflowSetupSidebar from "./workflows/components/WorkflowSetupSidebar.jsx";
import WorkflowStepsBuilderStep from "./workflows/components/WorkflowStepsBuilderStep.jsx";
import WorkflowTypeStep from "./workflows/components/WorkflowTypeStep.jsx";
import {
  buildAssignmentEffectText,
  buildAssignmentSelectionLabel,
  buildAssignmentScopeLabel,
  buildDefaultSteps,
  buildStepDrafts,
  buildStepPreview,
  buildWorkflowPreview,
  normalizeStepDraft,
  PROCESS_TYPES,
  safeParseJsonArray,
  serializeStepDrafts,
  STEP_SCOPE_TYPES,
  todayIsoDate,
  toPositiveInt,
} from "./workflows/utils/workflowSetupHelpers.js";
import { getWorkflowSetupText } from "./workflows/utils/workflowSetupText.js";

function resolveAssignmentScopeId(form, tenantScopeId) {
  if (form.scopeType === "TENANT") {
    return tenantScopeId;
  }
  if (form.scopeType === "GROUP") {
    return toPositiveInt(form.groupCompanyId);
  }
  if (form.scopeType === "COUNTRY") {
    return toPositiveInt(form.countryId);
  }
  if (form.scopeType === "LEGAL_ENTITY") {
    return toPositiveInt(form.legalEntityId);
  }
  if (form.scopeType === "OPERATING_UNIT") {
    return toPositiveInt(form.operatingUnitId);
  }
  return null;
}

function resolveAssignmentRowScope(row, tenantScopeId) {
  if (row?.operatingUnitId) {
    return { scopeType: "OPERATING_UNIT", scopeId: row.operatingUnitId };
  }
  if (row?.legalEntityId) {
    return { scopeType: "LEGAL_ENTITY", scopeId: row.legalEntityId };
  }
  if (row?.countryId) {
    return { scopeType: "COUNTRY", scopeId: row.countryId };
  }
  if (row?.groupCompanyId) {
    return { scopeType: "GROUP", scopeId: row.groupCompanyId };
  }
  if (tenantScopeId) {
    return { scopeType: "TENANT", scopeId: tenantScopeId };
  }
  return null;
}

/**
 * Manages workflow definitions, review steps, and scope assignments in a guided setup flow.
 */
export default function WorkflowSetupPage() {
  const { getPermissionAccess, hasPermission, user } = useAuth();
  const { language } = useI18n();
  const { refresh: refreshModuleReadiness } = useModuleReadiness();

  const l = useMemo(() => (en, tr) => (language === "tr" ? tr : en), [language]);
  const text = useMemo(() => getWorkflowSetupText(l), [l]);
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
  const [stepDrafts, setStepDrafts] = useState(() => buildStepDrafts("PERIOD_CLOSE", []));
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

  const selectedDefinition = useMemo(
    () =>
      definitions.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(selectedDefinitionId)
      ) || null,
    [definitions, selectedDefinitionId]
  );

  const selectedProcessType =
    selectedDefinition?.processType || definitionForm.processType || assignmentForm.processType;
  const selectedProcessTypeLabel =
    text.workflowTypeLabels[String(selectedProcessType || "").toUpperCase()] ||
    selectedProcessType ||
    "-";
  const selectedRecommendation =
    text.processRecommendations[String(selectedProcessType || "").toUpperCase()] || null;

  const filteredDefinitionOptions = useMemo(
    () =>
      definitions.filter(
        (row) =>
          String(row?.processType || "").toUpperCase() ===
          String(assignmentForm.processType || "").toUpperCase()
      ),
    [definitions, assignmentForm.processType]
  );

  const selectedCountry = useMemo(
    () => countries.find((row) => String(row.id) === String(assignmentForm.countryId)) || null,
    [countries, assignmentForm.countryId]
  );
  const selectedGroupCompany = useMemo(
    () =>
      groupCompanies.find((row) => String(row.id) === String(assignmentForm.groupCompanyId)) ||
      null,
    [groupCompanies, assignmentForm.groupCompanyId]
  );
  const selectedLegalEntity = useMemo(
    () =>
      legalEntities.find((row) => String(row.id) === String(assignmentForm.legalEntityId)) ||
      null,
    [legalEntities, assignmentForm.legalEntityId]
  );
  const selectedOperatingUnit = useMemo(
    () =>
      operatingUnits.find((row) => String(row.id) === String(assignmentForm.operatingUnitId)) ||
      null,
    [operatingUnits, assignmentForm.operatingUnitId]
  );

  const workflowPreviewText = useMemo(
    () => buildWorkflowPreview(stepDrafts, text.stepScopeLabels, l),
    [stepDrafts, text.stepScopeLabels, l]
  );
  const assignmentEffectText = useMemo(
    () =>
      buildAssignmentEffectText({
        assignmentForm,
        selectedCountry,
        selectedGroupCompany,
        selectedLegalEntity,
        selectedOperatingUnit,
        l,
      }),
    [
      assignmentForm,
      selectedCountry,
      selectedGroupCompany,
      selectedLegalEntity,
      selectedOperatingUnit,
      l,
    ]
  );
  const assignmentLabel = useMemo(
    () =>
      buildAssignmentSelectionLabel({
        assignmentForm,
        selectedCountry,
        selectedGroupCompany,
        selectedLegalEntity,
        selectedOperatingUnit,
        scopeTypeLabels: text.scopeTypeLabels,
        l,
      }),
    [
      assignmentForm,
      selectedCountry,
      selectedGroupCompany,
      selectedLegalEntity,
      selectedOperatingUnit,
      text.scopeTypeLabels,
      l,
    ]
  );

  const assignmentScopeId = resolveAssignmentScopeId(assignmentForm, tenantScopeId);
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

  const assignmentRows = useMemo(
    () =>
      assignments.map((row) => {
        const rowScope = resolveAssignmentRowScope(row, tenantScopeId);
        const access = getPermissionAccess(
          "workflow.assignment.write",
          rowScope ? { scope: rowScope } : undefined
        );
        return {
          ...row,
          canToggleStatus: access.allowed,
          isSaving: saving === `assignment-status-${row.id}`,
          scopeLabel: buildAssignmentScopeLabel(row, l),
        };
      }),
    [assignments, getPermissionAccess, l, saving, tenantScopeId]
  );

  function applyStepDrafts(nextDrafts, processType = selectedProcessType) {
    const normalizedDrafts = buildStepDrafts(processType, nextDrafts);
    setStepDrafts(normalizedDrafts);
    setStepsJson(JSON.stringify(serializeStepDrafts(normalizedDrafts, processType), null, 2));
    setStepsJsonError("");
  }

  function selectDefinitionForEditing(definitionId, targetStep = 2) {
    const nextId = String(definitionId || "");
    const definition =
      definitions.find((row) => toPositiveInt(row?.id) === toPositiveInt(nextId)) || null;

    setSelectedDefinitionId(nextId);
    setDefinitionMode("select");
    if (definition) {
      setDefinitionForm((prev) => ({
        ...prev,
        processType: definition.processType,
      }));
      setAssignmentForm((prev) => ({
        ...prev,
        processType: definition.processType,
        workflowDefinitionId: nextId,
      }));
      setCurrentStep(targetStep);
      return;
    }

    setCurrentStep(2);
  }

  function continueSelectedDefinition() {
    if (!toPositiveInt(selectedDefinitionId)) {
      setError(l("Select a workflow first.", "Once bir workflow secin."));
      return;
    }
    setError("");
    setCurrentStep(3);
  }

  function canReachStep(stepNumber) {
    if (stepNumber <= currentStep) {
      return true;
    }
    if (stepNumber === 2) {
      return true;
    }
    if (stepNumber === 3) {
      return Boolean(toPositiveInt(selectedDefinitionId));
    }
    if (stepNumber === 4) {
      return currentStep >= 4;
    }
    if (stepNumber === 5) {
      return currentStep >= 5;
    }
    return false;
  }

  function goToStep(stepNumber) {
    if (canReachStep(stepNumber)) {
      setCurrentStep(stepNumber);
    }
  }

  function syncProcessType(processType) {
    const normalizedProcessType = String(processType || "").toUpperCase();
    const selectedMatches =
      String(selectedDefinition?.processType || "").toUpperCase() === normalizedProcessType;

    setDefinitionForm((prev) => ({ ...prev, processType }));
    setAssignmentForm((prev) => ({
      ...prev,
      processType,
      workflowDefinitionId: selectedMatches ? prev.workflowDefinitionId : "",
    }));

    if (!selectedMatches) {
      setSelectedDefinitionId("");
      applyStepDrafts(buildDefaultSteps(processType), processType);
    }
  }

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
        const current = toPositiveInt(prev);
        if (current && nextDefinitions.some((row) => toPositiveInt(row?.id) === current)) {
          return prev;
        }
        return "";
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
    const processType = selectedDefinition?.processType || definitionForm.processType;

    if (!definitionId || !canReadDefinitions) {
      const nextDrafts = buildStepDrafts(processType, []);
      setStepDrafts(nextDrafts);
      setStepsJson(JSON.stringify(serializeStepDrafts(nextDrafts, processType), null, 2));
      setStepsJsonError("");
      return;
    }

    (async () => {
      try {
        const response = await listWorkflowDefinitionSteps(definitionId);
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        const normalizedRows =
          rows.length > 0
            ? rows.map((row) => ({
                stepNo: Number(row?.stepNo || 0) || 1,
                stageScopeType: String(row?.stageScopeType || "LEGAL_ENTITY"),
                requiredPermissionCode: row?.requiredPermissionCode ?? null,
                minApproverCount: Number(row?.minApproverCount || 1) || 1,
                allowSelfApprove: Boolean(row?.allowSelfApprove),
                escalationAfterHours: row?.escalationAfterHours ?? null,
              }))
            : buildDefaultSteps(processType);
        const nextDrafts = buildStepDrafts(processType, normalizedRows);
        setStepDrafts(nextDrafts);
        setStepsJson(JSON.stringify(serializeStepDrafts(nextDrafts, processType), null, 2));
        setStepsJsonError("");
      } catch (err) {
        setError(
          err?.response?.data?.message ||
            l("Failed to load workflow steps.", "Workflow adimlari yuklenemedi.")
        );
      }
    })();
  }, [canReadDefinitions, definitionForm.processType, l, selectedDefinition?.processType, selectedDefinitionId]);

  useEffect(() => {
    const definitionExists = filteredDefinitionOptions.some(
      (row) => toPositiveInt(row?.id) === toPositiveInt(assignmentForm.workflowDefinitionId)
    );
    if (definitionExists) {
      return;
    }
    if (
      selectedDefinition &&
      String(selectedDefinition.processType || "").toUpperCase() ===
        String(assignmentForm.processType || "").toUpperCase()
    ) {
      setAssignmentForm((prev) => ({
        ...prev,
        workflowDefinitionId: String(selectedDefinition.id),
      }));
      return;
    }
    setAssignmentForm((prev) => ({
      ...prev,
      workflowDefinitionId: "",
    }));
  }, [
    assignmentForm.workflowDefinitionId,
    assignmentForm.processType,
    filteredDefinitionOptions,
    selectedDefinition,
  ]);

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
      const newDefinitionId = String(response?.row?.id || "");

      setSelectedDefinitionId(newDefinitionId);
      setDefinitionMode("select");
      setAssignmentForm((prev) => ({
        ...prev,
        processType: definitionForm.processType,
        workflowDefinitionId: newDefinitionId,
      }));

      await loadData();
      setCurrentStep(3);
      setMessage(
        l(
          "Workflow created. Next, define who must approve.",
          "Workflow olusturuldu. Siradaki adim: kimin onay verecegini tanimlayin."
        )
      );
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
      setError(l("Select a workflow first.", "Once bir workflow secin."));
      return;
    }
    if (stepsJsonError) {
      setError(stepsJsonError);
      return;
    }

    const parsedSteps = serializeStepDrafts(stepDrafts, selectedProcessType);
    if (!parsedSteps.length) {
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

  function onStepsJsonChange(nextValue) {
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

    const nextDrafts = buildStepDrafts(selectedProcessType, parsed);
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
      ),
      selectedProcessType
    );
  }

  function onAddStep() {
    applyStepDrafts(
      [
        ...stepDrafts,
        normalizeStepDraft(
          {},
          (Array.isArray(stepDrafts) ? stepDrafts.length : 0) + 1,
          selectedProcessType
        ),
      ],
      selectedProcessType
    );
  }

  function onRemoveStep(index) {
    if (!Array.isArray(stepDrafts) || stepDrafts.length <= 1) {
      return;
    }
    applyStepDrafts(
      stepDrafts.filter((_, stepIndex) => stepIndex !== index),
      selectedProcessType
    );
  }

  function onResetStepsToDefaults() {
    applyStepDrafts(buildDefaultSteps(selectedProcessType), selectedProcessType);
  }

  function buildStepPreviewText(step) {
    return buildStepPreview(step, selectedProcessType, text.stepScopeLabels, l);
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
      setError(l("Select a workflow definition first.", "Once workflow tanimi secin."));
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
          "Assignment saved. Review the setup before leaving.",
          "Atama kaydedildi. Ayrilmadan once kurulumu gozden gecirin."
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

  async function onToggleAssignmentStatus(row) {
    const assignmentId = toPositiveInt(row?.id);
    if (!assignmentId) {
      return;
    }
    if (!row?.canToggleStatus) {
      setError(
        l(
          "Missing permission: workflow.assignment.write",
          "Eksik yetki: workflow.assignment.write"
        )
      );
      return;
    }

    const nextStatus =
      String(row?.status || "").toUpperCase() === "ACTIVE" ? "INACTIVE" : "ACTIVE";
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
    <div className="space-y-6">
      <WorkflowSetupProgress
        currentStep={currentStep}
        steps={text.progressSteps}
        canReachStep={canReachStep}
        onSelectStep={goToStep}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{l("Workflow setup error", "Workflow kurulum hatasi")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {message ? (
        <Alert className="border-emerald-200 bg-emerald-50/90 text-emerald-900">
          <AlertTitle>{l("Workflow setup updated", "Workflow kurulumu guncellendi")}</AlertTitle>
          <AlertDescription className="text-emerald-800">{message}</AlertDescription>
        </Alert>
      ) : null}

      {!canReadWorkflow ? (
        <Alert>
          <AlertTitle>{l("Workflow read access is missing", "Workflow okuma erisimi eksik")}</AlertTitle>
          <AlertDescription>
            {l(
              "Missing workflow read permission: workflow.definition.read or workflow.assignment.read",
              "Eksik workflow okuma yetkisi: workflow.definition.read veya workflow.assignment.read"
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {!canReadOrgTree ? (
        <Alert>
          <AlertTitle>{l("Organization tree access is missing", "Organizasyon agaci erisimi eksik")}</AlertTitle>
          <AlertDescription>
            {l(
              "org.tree.read is required to load country, group, legal entity, and operating unit selectors.",
              "Country, grup, legal entity ve operating unit secicilerini yuklemek icin org.tree.read gerekir."
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {currentStep === 1 ? (
            <WorkflowTypeStep
              l={l}
              processTypes={PROCESS_TYPES}
              value={definitionForm.processType}
              onChange={syncProcessType}
              onNext={() => setCurrentStep(2)}
              workflowTypeLabels={text.workflowTypeLabels}
              workflowTypeMeta={text.workflowTypeMeta}
            />
          ) : null}

          {currentStep === 2 ? (
            <WorkflowDefinitionStep
              l={l}
              mode={definitionMode}
              onModeChange={setDefinitionMode}
              definitions={definitions.filter(
                (row) =>
                  String(row?.processType || "").toUpperCase() ===
                  String(definitionForm.processType || "").toUpperCase()
              )}
              selectedDefinitionId={selectedDefinitionId}
              onSelectDefinition={selectDefinitionForEditing}
              onContinueSelectedDefinition={continueSelectedDefinition}
              form={definitionForm}
              onFormChange={setDefinitionForm}
              onSubmit={onCreateDefinition}
              saving={saving === "definition"}
              canWrite={canWriteDefinitions}
              access={definitionWriteAccess}
              onBack={() => setCurrentStep(1)}
            />
          ) : null}

          {currentStep === 3 ? (
            <WorkflowStepsBuilderStep
              l={l}
              processType={selectedProcessType}
              selectedDefinition={selectedDefinition}
              stepDrafts={stepDrafts}
              stepScopeTypes={STEP_SCOPE_TYPES}
              stepScopeLabels={text.stepScopeLabels}
              onStepFieldChange={onStepFieldChange}
              onAddStep={onAddStep}
              onRemoveStep={onRemoveStep}
              onResetStepsToDefaults={onResetStepsToDefaults}
              stepsJson={stepsJson}
              onChangeStepsJson={onStepsJsonChange}
              stepsJsonError={stepsJsonError}
              showAdvancedJson={showAdvancedJson}
              onToggleAdvancedJson={() => setShowAdvancedJson((prev) => !prev)}
              workflowPreviewText={workflowPreviewText}
              buildStepPreviewText={buildStepPreviewText}
              onSubmit={onSaveSteps}
              saving={saving === "steps"}
              canWrite={canWriteDefinitions}
              onBack={() => setCurrentStep(2)}
            />
          ) : null}

          {currentStep === 4 ? (
            <WorkflowAssignmentStep
              l={l}
              form={assignmentForm}
              onFormChange={setAssignmentForm}
              definitions={filteredDefinitionOptions}
              countries={countries}
              groupCompanies={groupCompanies}
              legalEntities={legalEntities}
              operatingUnits={operatingUnits}
              effectText={assignmentEffectText}
              onSubmit={onCreateAssignment}
              saving={saving === "assignment"}
              canWrite={canWriteAssignments}
              access={assignmentWriteAccess}
              scopeTypeLabels={text.scopeTypeLabels}
              scopeTypeMeta={text.scopeTypeMeta}
              workflowTypeLabel={selectedProcessTypeLabel}
              onBack={() => setCurrentStep(3)}
            />
          ) : null}

          {currentStep === 5 ? (
            <WorkflowReviewStep
              l={l}
              definition={selectedDefinition}
              stepDrafts={stepDrafts}
              assignmentForm={assignmentForm}
              assignmentLabel={assignmentLabel}
              workflowType={selectedProcessType}
              workflowTypeLabel={selectedProcessTypeLabel}
              workflowPreviewText={workflowPreviewText}
              assignmentEffectText={assignmentEffectText}
              onBack={() => setCurrentStep(4)}
            />
          ) : null}
        </div>

        <WorkflowSetupSidebar
          l={l}
          currentStep={currentStep}
          processTypeLabel={selectedProcessTypeLabel}
          definition={selectedDefinition}
          stepDrafts={stepDrafts}
          assignmentLabel={assignmentLabel}
          assignmentStatus={assignmentForm.status}
          recommendation={selectedRecommendation}
          workflowPreviewText={workflowPreviewText}
          assignmentEffectText={assignmentEffectText}
          quickGuide={text.quickGuide}
        />
      </div>

      <WorkflowRecordsSection
        l={l}
        definitions={definitions}
        assignments={assignmentRows}
        loading={loading}
        selectedDefinitionId={selectedDefinitionId}
        onSelectDefinition={selectDefinitionForEditing}
        onToggleAssignmentStatus={onToggleAssignmentStatus}
        getWorkflowTypeLabel={(value) =>
          text.workflowTypeLabels[String(value || "").toUpperCase()] || value || "-"
        }
      />
    </div>
  );
}
