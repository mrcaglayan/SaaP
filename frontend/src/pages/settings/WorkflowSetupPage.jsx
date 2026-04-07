import { useEffect, useMemo, useState } from "react";
import {
  listCountries,
  listGroupCompanies,
  listLegalEntities,
  listOperatingUnits,
  listOrgTree,
} from "../../api/orgAdmin.js";
import {
  createWorkflowAssignment,
  createWorkflowDefinition,
  listWorkflowAssignments,
  listWorkflowDefinitions,
  listWorkflowDefinitionSteps,
  replaceWorkflowDefinitionSteps,
  runWorkflowCoverageDiagnostics,
  updateWorkflowAssignment,
} from "../../api/workflows.js";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useModuleReadiness } from "../../readiness/useModuleReadiness.js";
import {
  listBusinessRoleCatalogEntries,
  listWorkflowPackageCatalogEntries,
  listWorkflowPresetCatalogEntries,
} from "../security/roleCatalog.js";
import {
  findOrgScopeTreeNodeByScopeSelection,
  getOrgScopeTreeRoot,
} from "../../shared/orgScopeTree.js";
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
  buildWorkflowPresetComparisonModel,
  buildWorkflowPresetPreviewModel,
  buildStepDrafts,
  buildStepPreview,
  buildWorkflowPreview,
  listWorkflowStepPackageOptions,
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

function resolveAssignmentScopeSelection(form, tenantScopeId) {
  const scopeId = resolveAssignmentScopeId(form, tenantScopeId);
  if (!scopeId) {
    return null;
  }

  return {
    scopeType: String(form?.scopeType || "").trim().toUpperCase(),
    scopeId,
  };
}

function applyAssignmentScopeSelection(previousForm, selection) {
  const scopeType = String(selection?.scopeType || "").trim().toUpperCase();
  const scopeId = toPositiveInt(selection?.scopeId);
  if (!scopeType || !scopeId) {
    return previousForm;
  }

  const scopeValue = String(scopeId);
  return {
    ...previousForm,
    scopeType,
    groupCompanyId: scopeType === "GROUP" ? scopeValue : "",
    countryId: scopeType === "COUNTRY" ? scopeValue : "",
    legalEntityId: scopeType === "LEGAL_ENTITY" ? scopeValue : "",
    operatingUnitId: scopeType === "OPERATING_UNIT" ? scopeValue : "",
  };
}

function getWorkflowAssignmentScopeDisabledReason(access, l) {
  if (!access || access.allowed) {
    return "";
  }
  if (access.missingPermission) {
    return l(
      "Missing permission: workflow.assignment.write",
      "Eksik yetki: workflow.assignment.write"
    );
  }
  if (access.wrongScope) {
    return l(
      "Your workflow assignment access does not cover this scope.",
      "Workflow atama yetkiniz bu kapsami icermiyor."
    );
  }
  return l(
    "This scope cannot be used for workflow assignments.",
    "Bu kapsam workflow atamalari icin kullanilamaz."
  );
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
  const [assignmentReviewSaved, setAssignmentReviewSaved] = useState(false);
  const [coverageDiagnostics, setCoverageDiagnostics] = useState(null);
  const [coverageDiagnosticsLoading, setCoverageDiagnosticsLoading] = useState(false);
  const [coverageDiagnosticsError, setCoverageDiagnosticsError] = useState("");

  const [currentStep, setCurrentStep] = useState(1);
  const [definitionMode, setDefinitionMode] = useState("create");
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);

  const [definitions, setDefinitions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [orgTreeRoot, setOrgTreeRoot] = useState(null);
  const [countries, setCountries] = useState([]);
  const [groupCompanies, setGroupCompanies] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [assignmentScopeNodeKey, setAssignmentScopeNodeKey] = useState("");

  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [stepsJson, setStepsJson] = useState("[]");
  const [stepDrafts, setStepDrafts] = useState(() => buildStepDrafts("PERIOD_CLOSE", []));
  const [stepsJsonError, setStepsJsonError] = useState("");
  const [selectedWorkflowPresetCode, setSelectedWorkflowPresetCode] = useState("");

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

  const assignmentScopeSelection = useMemo(
    () => resolveAssignmentScopeSelection(assignmentForm, tenantScopeId),
    [assignmentForm, tenantScopeId]
  );
  const selectedAssignmentScopeNode = useMemo(
    () =>
      findOrgScopeTreeNodeByScopeSelection(
        orgTreeRoot,
        assignmentScopeSelection,
        assignmentScopeNodeKey
      ),
    [assignmentScopeNodeKey, assignmentScopeSelection, orgTreeRoot]
  );

  const workflowPreviewText = useMemo(
    () => buildWorkflowPreview(stepDrafts, text.stepScopeLabels, l),
    [stepDrafts, text.stepScopeLabels, l]
  );
  const workflowPresetEntries = useMemo(() => listWorkflowPresetCatalogEntries(), []);
  const workflowPackageEntries = useMemo(() => listWorkflowPackageCatalogEntries(), []);
  const businessRoleEntries = useMemo(() => listBusinessRoleCatalogEntries(), []);
  const workflowStepPackageOptions = useMemo(
    () =>
      listWorkflowStepPackageOptions({
        processType: selectedProcessType,
        workflowPackageEntries,
      }),
    [selectedProcessType, workflowPackageEntries]
  );
  const workflowStepCatalogContext = useMemo(
    () => ({
      workflowPackageEntries,
      workflowPresetEntries,
      businessRoleEntries,
    }),
    [businessRoleEntries, workflowPackageEntries, workflowPresetEntries]
  );
  const workflowStepBusinessRoleOptions = useMemo(
    () =>
      businessRoleEntries.map((entry) => ({
        code: entry.code,
        label: entry.displayName,
        defaultScope: entry.defaultScope,
      })),
    [businessRoleEntries]
  );
  const workflowPresetOptions = useMemo(
    () =>
      workflowPresetEntries.filter(
        (entry) =>
          String(entry?.workflowFamily || "").toUpperCase() ===
          String(selectedProcessType || "").toUpperCase()
      ),
    [selectedProcessType, workflowPresetEntries]
  );
  const selectedWorkflowPreset = useMemo(
    () =>
      workflowPresetOptions.find(
        (entry) => String(entry?.code || "") === String(selectedWorkflowPresetCode || "")
      ) || null,
    [selectedWorkflowPresetCode, workflowPresetOptions]
  );
  const workflowPresetPreview = useMemo(
    () =>
      buildWorkflowPresetPreviewModel({
        presetEntry: selectedWorkflowPreset,
        stepScopeLabels: text.stepScopeLabels,
        l,
      }),
    [selectedWorkflowPreset, text.stepScopeLabels, l]
  );
  const workflowPresetComparison = useMemo(
    () =>
      buildWorkflowPresetComparisonModel({
        presetEntry: selectedWorkflowPreset,
        stepDrafts,
        stepScopeLabels: text.stepScopeLabels,
        l,
      }),
    [selectedWorkflowPreset, stepDrafts, text.stepScopeLabels, l]
  );
  const assignmentEffectText = useMemo(
    () =>
      buildAssignmentEffectText({
        assignmentForm,
        scopeNode: selectedAssignmentScopeNode,
        l,
      }),
    [
      assignmentForm,
      selectedAssignmentScopeNode,
      l,
    ]
  );
  const assignmentLabel = useMemo(
    () =>
      buildAssignmentSelectionLabel({
        assignmentForm,
        scopeNode: selectedAssignmentScopeNode,
        scopeTypeLabels: text.scopeTypeLabels,
        l,
      }),
    [
      assignmentForm,
      selectedAssignmentScopeNode,
      text.scopeTypeLabels,
      l,
    ]
  );
  const assignmentWriteAccess = getPermissionAccess(
    "workflow.assignment.write",
    assignmentScopeSelection
      ? {
          scope: assignmentScopeSelection,
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

  function handleAssignmentScopeSelect(nextSelection, node = null) {
    setAssignmentScopeNodeKey(String(node?.key || ""));
    setAssignmentForm((prev) => applyAssignmentScopeSelection(prev, nextSelection));
  }

  function getAssignmentNodeDisabledReason(_node, selection) {
    // The backend can keep ancestor nodes visible for navigation, so workflow
    // assignment overlays scope-write access on top of backend selectability.
    const access = getPermissionAccess(
      "workflow.assignment.write",
      selection ? { scope: selection } : undefined
    );
    return getWorkflowAssignmentScopeDisabledReason(access, l);
  }

  function applyStepDrafts(nextDrafts, processType = selectedProcessType) {
    const normalizedDrafts = buildStepDrafts(
      processType,
      nextDrafts,
      workflowStepCatalogContext
    );
    setStepDrafts(normalizedDrafts);
    setStepsJson(JSON.stringify(serializeStepDrafts(normalizedDrafts, processType), null, 2));
    setStepsJsonError("");
  }

  function selectDefinitionForEditing(definitionId, targetStep = 3) {
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

    setCurrentStep(3);
  }

  function continueSelectedDefinition() {
    if (!toPositiveInt(selectedDefinitionId)) {
      setError(l("Select a workflow first.", "Once bir workflow secin."));
      return;
    }
    setError("");
    setCurrentStep(4);
  }

  function continueToDefinitionStep() {
    if (!canWriteAssignments) {
      setError(getWorkflowAssignmentScopeDisabledReason(assignmentWriteAccess, l));
      return;
    }
    if (!orgTreeRoot) {
      setError(
        l(
          "Load the organization tree before continuing.",
          "Devam etmeden once organizasyon agacini yukleyin."
        )
      );
      return;
    }
    if (!assignmentScopeSelection) {
      setError(
        l(
          "Select a target scope first.",
          "Once bir hedef kapsam secin."
        )
      );
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
      return currentStep >= 2 && Boolean(assignmentScopeSelection);
    }
    if (stepNumber === 4) {
      return currentStep >= 3 && Boolean(toPositiveInt(selectedDefinitionId));
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
      setOrgTreeRoot(null);
      setCountries([]);
      setGroupCompanies([]);
      setLegalEntities([]);
      setOperatingUnits([]);
      setAssignmentScopeNodeKey("");
      setSelectedDefinitionId("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [definitionsRes, assignmentsRes, orgTreeRes, countriesRes, groupsRes, entitiesRes, unitsRes] =
        await Promise.all([
          canReadDefinitions ? listWorkflowDefinitions({ limit: 200 }) : Promise.resolve(null),
          canReadAssignments ? listWorkflowAssignments({ limit: 300 }) : Promise.resolve(null),
          canReadOrgTree ? listOrgTree({ shape: "nested" }) : Promise.resolve(null),
          canReadOrgTree ? listCountries() : Promise.resolve(null),
          canReadOrgTree ? listGroupCompanies() : Promise.resolve(null),
          canReadOrgTree ? listLegalEntities() : Promise.resolve(null),
          canReadOrgTree ? listOperatingUnits() : Promise.resolve(null),
        ]);

      const nextDefinitions = Array.isArray(definitionsRes?.rows) ? definitionsRes.rows : [];
      setDefinitions(nextDefinitions);
      setAssignments(Array.isArray(assignmentsRes?.rows) ? assignmentsRes.rows : []);
      setOrgTreeRoot(getOrgScopeTreeRoot(orgTreeRes));
      // Keep the flat lookups only for coverage diagnostics compatibility. The
      // workflow scope summaries now come from the canonical tree itself.
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
      setOrgTreeRoot(null);
      setAssignmentScopeNodeKey("");
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
      const nextDrafts = buildStepDrafts(processType, [], workflowStepCatalogContext);
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
        const nextDrafts = buildStepDrafts(
          processType,
          normalizedRows,
          workflowStepCatalogContext
        );
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
  }, [
    canReadDefinitions,
    definitionForm.processType,
    l,
    selectedDefinition?.processType,
    selectedDefinitionId,
    workflowStepCatalogContext,
  ]);

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

  useEffect(() => {
    if (workflowPresetOptions.length === 0) {
      setSelectedWorkflowPresetCode("");
      return;
    }
    if (
      workflowPresetOptions.some(
        (entry) => String(entry?.code || "") === String(selectedWorkflowPresetCode || "")
      )
    ) {
      return;
    }
    setSelectedWorkflowPresetCode(String(workflowPresetOptions[0]?.code || ""));
  }, [selectedWorkflowPresetCode, workflowPresetOptions]);

  useEffect(() => {
    if (!assignmentReviewSaved) {
      return;
    }
    setAssignmentReviewSaved(false);
    setMessage("");
  }, [
    assignmentForm.countryId,
    assignmentForm.effectiveFrom,
    assignmentForm.groupCompanyId,
    assignmentForm.legalEntityId,
    assignmentForm.operatingUnitId,
    assignmentForm.processType,
    assignmentForm.scopeType,
    assignmentForm.status,
    assignmentForm.workflowDefinitionId,
    assignmentReviewSaved,
    selectedDefinitionId,
    stepsJson,
  ]);

  useEffect(() => {
    if (currentStep !== 5 || !canReadAssignments) {
      setCoverageDiagnostics(null);
      setCoverageDiagnosticsLoading(false);
      setCoverageDiagnosticsError("");
      return undefined;
    }

    const assignmentPayload = {
      processType: selectedProcessType,
      scopeType: assignmentForm.scopeType,
      groupCompanyId: assignmentForm.groupCompanyId || undefined,
      countryId: assignmentForm.countryId || undefined,
      legalEntityId: assignmentForm.legalEntityId || undefined,
      operatingUnitId: assignmentForm.operatingUnitId || undefined,
      effectiveOn: assignmentForm.effectiveFrom || undefined,
      steps: serializeStepDrafts(stepDrafts, selectedProcessType).map((step) => ({
        stepNo: step.stepNo,
        stageScopeType: step.stageScopeType,
        requiredPermissionCode: step.requiredPermissionCode,
        minApproverCount: step.minApproverCount,
      })),
    };

    let ignore = false;
    setCoverageDiagnosticsLoading(true);
    setCoverageDiagnosticsError("");
    (async () => {
      try {
        const response = await runWorkflowCoverageDiagnostics(assignmentPayload);
        if (!ignore) {
          setCoverageDiagnostics(response || null);
        }
      } catch (err) {
        if (!ignore) {
          setCoverageDiagnostics(null);
          setCoverageDiagnosticsError(
            err?.response?.data?.message ||
              l(
                "Workflow coverage diagnostics could not be loaded.",
                "Workflow kapsam tanilari yuklenemedi."
              )
          );
        }
      } finally {
        if (!ignore) {
          setCoverageDiagnosticsLoading(false);
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [
    assignmentForm.countryId,
    assignmentForm.effectiveFrom,
    assignmentForm.groupCompanyId,
    assignmentForm.legalEntityId,
    assignmentForm.operatingUnitId,
    assignmentForm.scopeType,
    canReadAssignments,
    currentStep,
    l,
    selectedProcessType,
    stepDrafts,
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
      setCurrentStep(4);
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
      setCurrentStep(5);
      setMessage(
        l(
          "Approval steps saved. Review the setup and save the assignment.",
          "Onay adimlari kaydedildi. Kurulumu inceleyin ve atamayi kaydedin."
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

    const nextDrafts = buildStepDrafts(
      selectedProcessType,
      parsed,
      workflowStepCatalogContext
    );
    setStepDrafts(nextDrafts);
    setStepsJsonError("");
  }

  function onStepFieldChange(index, field, value) {
    const normalizedFieldValue =
      field === "requiredPackageCode" ? String(value || "").trim().toUpperCase() : value;
    applyStepDrafts(
      stepDrafts.map((step, stepIndex) =>
        stepIndex !== index
          ? step
          : field === "requiredPackageCode"
            ? {
                ...step,
                requiredPackageCode: normalizedFieldValue,
                requiredPackageLabel: "",
                requiredPermissionCode: "",
                actionLabel: "",
                eligibleBusinessRoleCodes: [],
                eligibleBusinessRoleLabels: [],
              }
            : field === "stageScopeType"
              ? {
                  ...step,
                  stageScopeType: normalizedFieldValue,
                  eligibleBusinessRoleCodes: [],
                  eligibleBusinessRoleLabels: [],
                }
            : {
                ...step,
                [field]: normalizedFieldValue,
              }
      ),
      selectedProcessType
    );
  }

  function onAddStep() {
    applyStepDrafts(
      [
        ...stepDrafts,
        normalizeStepDraft(
          {
            requiredPackageCode: workflowStepPackageOptions[0]?.code || "",
          },
          (Array.isArray(stepDrafts) ? stepDrafts.length : 0) + 1,
          selectedProcessType,
          workflowStepCatalogContext
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

  function onSelectWorkflowPreset(presetCode) {
    setSelectedWorkflowPresetCode(String(presetCode || ""));
  }

  function applySelectedWorkflowPresetBaseline(messageText) {
    if (!workflowPresetComparison?.canApply || !selectedWorkflowPreset) {
      setError(
        workflowPresetComparison?.supportNote ||
          selectedWorkflowPreset?.extensionNote ||
          l(
            "This preset is preview-only in the current workflow step model.",
            "Bu preset mevcut workflow adim modelinde yalnizca onizlemedir."
          )
      );
      return;
    }

    applyStepDrafts(
      workflowPresetComparison.baselineDrafts,
      selectedWorkflowPreset.workflowFamily
    );
    setError("");
    setMessage(messageText);
  }

  function onCloneWorkflowPreset() {
    applySelectedWorkflowPresetBaseline(
      l(
        "Preset cloned into this workflow. Review the steps before saving.",
        "Preset bu workflow'a kopyalandi. Kaydetmeden once adimlari gozden gecirin."
      )
    );
  }

  function onResetStepsToSelectedPreset() {
    applySelectedWorkflowPresetBaseline(
      l(
        "Current customizations were reset to the selected preset baseline.",
        "Mevcut ozellestirmeler secilen preset temeline sifirlandi."
      )
    );
  }

  function buildStepPreviewText(step) {
    return buildStepPreview(step, selectedProcessType, text.stepScopeLabels, l);
  }

  async function onCreateAssignment(event) {
    event?.preventDefault?.();
    if (!canWriteAssignments) {
      setError(
        l(
          "Missing permission: workflow.assignment.write",
          "Eksik yetki: workflow.assignment.write"
        )
      );
      return;
    }
    if (!orgTreeRoot) {
      setError(
        l(
          "Load the organization tree before saving the assignment.",
          "Atamayi kaydetmeden once organizasyon agacini yukleyin."
        )
      );
      return;
    }

    if (!assignmentScopeSelection) {
      setError(
        l(
          "Select an assignment scope first.",
          "Once bir atama kapsami secin."
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
      setAssignmentReviewSaved(true);
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
              "org.tree.read is required to load the shared workflow assignment scope tree.",
              "Paylasilan workflow atama kapsam agacini yuklemek icin org.tree.read gerekir."
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
            <WorkflowAssignmentStep
              l={l}
              form={assignmentForm}
              onFormChange={setAssignmentForm}
              orgTreeRoot={orgTreeRoot}
              scopeValue={assignmentScopeSelection}
              scopeValueNodeKey={assignmentScopeNodeKey}
              onSelectScope={handleAssignmentScopeSelect}
              allowedScopeTypes={Object.keys(text.scopeTypeLabels)}
              getNodeDisabledReason={getAssignmentNodeDisabledReason}
              effectText={assignmentEffectText}
              onSubmit={continueToDefinitionStep}
              saving={false}
              canWrite={canWriteAssignments}
              access={assignmentWriteAccess}
              scopeTypeLabels={text.scopeTypeLabels}
              workflowTypeLabel={selectedProcessTypeLabel}
              onBack={() => setCurrentStep(1)}
            />
          ) : null}

          {currentStep === 3 ? (
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
              targetScopeLabel={assignmentLabel}
              targetScopeEffectText={assignmentEffectText}
              onBack={() => setCurrentStep(2)}
            />
          ) : null}

          {currentStep === 4 ? (
            <WorkflowStepsBuilderStep
              l={l}
              processType={selectedProcessType}
              selectedDefinition={selectedDefinition}
              targetScopeLabel={assignmentLabel}
              targetScopeEffectText={assignmentEffectText}
              stepDrafts={stepDrafts}
              stepScopeTypes={STEP_SCOPE_TYPES}
              stepScopeLabels={text.stepScopeLabels}
              workflowStepPackageOptions={workflowStepPackageOptions}
              workflowStepBusinessRoleOptions={workflowStepBusinessRoleOptions}
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
              onBack={() => setCurrentStep(3)}
              workflowPresetOptions={workflowPresetOptions}
              selectedWorkflowPreset={selectedWorkflowPreset}
              workflowPresetPreview={workflowPresetPreview}
              workflowPresetComparison={workflowPresetComparison}
              onSelectWorkflowPreset={onSelectWorkflowPreset}
              onCloneWorkflowPreset={onCloneWorkflowPreset}
              onResetStepsToSelectedPreset={onResetStepsToSelectedPreset}
              apBusinessLabels={text.apBusinessLabels}
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
              onSubmitAssignment={onCreateAssignment}
              assignmentSaving={saving === "assignment"}
              canWriteAssignment={canWriteAssignments}
              assignmentSaved={assignmentReviewSaved}
              selectedWorkflowPreset={selectedWorkflowPreset}
              workflowPresetPreview={workflowPresetPreview}
              workflowPresetComparison={workflowPresetComparison}
              coverageDiagnostics={coverageDiagnostics}
              coverageDiagnosticsLoading={coverageDiagnosticsLoading}
              coverageDiagnosticsError={coverageDiagnosticsError}
              coverageLookups={{
                countries,
                groupCompanies,
                legalEntities,
                operatingUnits,
              }}
              tenantScopeId={tenantScopeId}
            />
          ) : null}
        </div>

        <WorkflowSetupSidebar
          l={l}
          currentStep={currentStep}
          processTypeLabel={selectedProcessTypeLabel}
          definition={selectedDefinition}
          stepDrafts={stepDrafts}
          hasTargetScope={currentStep >= 2 && Boolean(assignmentScopeSelection)}
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
