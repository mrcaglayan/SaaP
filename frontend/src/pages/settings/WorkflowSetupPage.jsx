import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  listWorkflowAuthorityDefinitions,
} from "../security/roleCatalog.js";
import {
  findOrgScopeTreeNodeByScopeSelection,
  getOrgScopeTreeRoot,
} from "../../shared/orgScopeTree.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SecurityAdminWorkspaceShell from "../security/SecurityAdminWorkspaceShell.jsx";
import SecurityWorkflowWorkbenchTabs from "../security/components/workflows/SecurityWorkflowWorkbenchTabs.jsx";
import WorkflowAssignmentStep from "./workflows/components/WorkflowAssignmentStep.jsx";
import ApprovalRoutingMatrixSection from "./workflows/components/ApprovalRoutingMatrixSection.jsx";
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
  buildWorkflowCoverageReviewModel,
  buildWorkflowPresetComparisonModel,
  buildWorkflowPresetPreviewModel,
  buildStepDrafts,
  buildStepPreview,
  buildWorkflowStepValidationModel,
  buildWorkflowPreview,
  getApWorkflowRequiredPermissionCode,
  listWorkflowStepAuthorityOptions,
  normalizeStepDraft,
  PROCESS_TYPES,
  safeParseJsonArray,
  serializeStepDrafts,
  STEP_SCOPE_TYPES,
  todayIsoDate,
  toPositiveInt,
} from "./workflows/utils/workflowSetupHelpers.js";
import { getWorkflowSetupText } from "./workflows/utils/workflowSetupText.js";
import { AP_DOCUMENT_WORKFLOW_PROCESS_TYPE } from "../../../../shared/cariDocumentWorkflowGovernance.js";

const WORKFLOW_WORKBENCH_TABS = Object.freeze([
  "definitions",
  "assignments",
  "coverage",
  "records",
  "setup",
]);
const EMPTY_WORKFLOW_PRESET_ENTRIES = Object.freeze([]);

function updateWorkbenchSearchParams(searchParams, changes) {
  const nextSearchParams = new URLSearchParams(searchParams);

  Object.entries(changes).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      nextSearchParams.delete(key);
      return;
    }
    nextSearchParams.set(key, String(value));
  });

  return nextSearchParams;
}

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
 * Renders workflow governance either as the canonical security-admin workbench
 * or as the underlying guided setup flow, while reusing the existing
 * definition, assignment, routing-matrix, and records components.
 */
export default function WorkflowSetupPage({ workspaceMode = "" }) {
  const { getPermissionAccess, hasPermission, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { language } = useI18n();
  const { refresh: refreshModuleReadiness } = useModuleReadiness();

  const l = useMemo(() => (en, tr) => (language === "tr" ? tr : en), [language]);
  const text = useMemo(() => getWorkflowSetupText(l), [l]);
  const tenantScopeId = toPositiveInt(user?.tenant_id);
  const isSecurityAdminWorkbench = workspaceMode === "security-admin";
  const activeWorkbenchTab = WORKFLOW_WORKBENCH_TABS.includes(
    String(searchParams.get("tab") || "")
  )
    ? String(searchParams.get("tab") || "")
    : WORKFLOW_WORKBENCH_TABS[0];

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
  const isApWorkflowProcess =
    String(selectedProcessType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;
  const selectedProcessTypeLabel =
    text.workflowTypeLabels[String(selectedProcessType || "").toUpperCase()] ||
    selectedProcessType ||
    "-";
  const selectedRecommendation =
    text.processRecommendations[String(selectedProcessType || "").toUpperCase()] || null;

  function navigateToWorkbenchTab(nextTab, extraChanges = {}) {
    if (!isSecurityAdminWorkbench) {
      return;
    }

    setSearchParams(
      updateWorkbenchSearchParams(searchParams, {
        tab: nextTab,
        ...extraChanges,
      })
    );
  }

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
  // The role-only hard delete removed shipped workflow preset metadata from the UI.
  const workflowPresetEntries = EMPTY_WORKFLOW_PRESET_ENTRIES;
  const workflowAuthorityEntries = useMemo(
    () => listWorkflowAuthorityDefinitions(selectedProcessType),
    [selectedProcessType]
  );
  const workflowStepAuthorityOptions = useMemo(
    () =>
      listWorkflowStepAuthorityOptions({
        processType: selectedProcessType,
        workflowAuthorityEntries,
      }),
    [selectedProcessType, workflowAuthorityEntries]
  );
  const workflowStepCatalogContext = useMemo(
    () => ({
      workflowAuthorityEntries,
      workflowPresetEntries,
    }),
    [workflowAuthorityEntries, workflowPresetEntries]
  );
  const workflowPresetOptions = useMemo(
    () =>
      isApWorkflowProcess
        ? []
        : workflowPresetEntries.filter(
            (entry) =>
              String(entry?.workflowFamily || "").toUpperCase() ===
              String(selectedProcessType || "").toUpperCase()
          ),
    [isApWorkflowProcess, selectedProcessType, workflowPresetEntries]
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
        workflowAuthorityEntries,
        l,
      }),
    [selectedWorkflowPreset, text.stepScopeLabels, workflowAuthorityEntries, l]
  );
  const workflowPresetComparison = useMemo(
    () =>
      buildWorkflowPresetComparisonModel({
        presetEntry: selectedWorkflowPreset,
        stepDrafts,
        stepScopeLabels: text.stepScopeLabels,
        workflowAuthorityEntries,
        l,
      }),
    [selectedWorkflowPreset, stepDrafts, text.stepScopeLabels, workflowAuthorityEntries, l]
  );
  const apStepBuilderPresetProps = isApWorkflowProcess
    ? {
        workflowPresetOptions: [],
        selectedWorkflowPreset: null,
        workflowPresetPreview: null,
        workflowPresetComparison: null,
        onSelectWorkflowPreset: undefined,
        onCloneWorkflowPreset: undefined,
        onResetStepsToSelectedPreset: undefined,
      }
    : {
        workflowPresetOptions,
        selectedWorkflowPreset,
        workflowPresetPreview,
        workflowPresetComparison,
        onSelectWorkflowPreset,
        onCloneWorkflowPreset,
        onResetStepsToSelectedPreset,
      };
  const apReviewPresetProps = isApWorkflowProcess
    ? {
        selectedWorkflowPreset: null,
        workflowPresetPreview: null,
        workflowPresetComparison: null,
      }
    : {
        selectedWorkflowPreset,
        workflowPresetPreview,
        workflowPresetComparison,
      };
  const workflowStepValidation = useMemo(
    () =>
      buildWorkflowStepValidationModel({
        stepDrafts,
        processType: selectedProcessType,
        workflowAuthorityEntries,
        coverageDiagnostics,
        stepScopeLabels: text.stepScopeLabels,
        l,
      }),
    [
      coverageDiagnostics,
      l,
      selectedProcessType,
      stepDrafts,
      workflowAuthorityEntries,
      text.stepScopeLabels,
    ]
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
          canEdit: access.allowed,
          canToggleStatus: access.allowed,
          isSaving: saving === `assignment-status-${row.id}`,
          scopeLabel: buildAssignmentScopeLabel(row, l),
        };
      }),
    [assignments, getPermissionAccess, l, saving, tenantScopeId]
  );
  const coverageReviewModel = useMemo(
    () =>
      buildWorkflowCoverageReviewModel({
        diagnostics: coverageDiagnostics,
        workflowType: selectedProcessType,
        lookups: {
          countries,
          groupCompanies,
          legalEntities,
          operatingUnits,
        },
        tenantScopeId,
        l,
      }),
    [
      countries,
      coverageDiagnostics,
      groupCompanies,
      l,
      legalEntities,
      operatingUnits,
      selectedProcessType,
      tenantScopeId,
    ]
  );
  const activeAssignmentCount = assignmentRows.filter(
    (row) => String(row?.status || "").toUpperCase() === "ACTIVE"
  ).length;
  const inactiveAssignmentCount = Math.max(
    assignmentRows.length - activeAssignmentCount,
    0
  );
  const apRoutingRuleCount = assignmentRows.filter(
    (row) =>
      String(row?.processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE
  ).length;
  const assignedWorkflowTypeCount = new Set(
    assignmentRows
      .map((row) => String(row?.processType || "").trim().toUpperCase())
      .filter(Boolean)
  ).size;
  const assignmentScopeCount = new Set(
    assignmentRows.map((row) => String(row?.scopeLabel || "").trim()).filter(Boolean)
  ).size;
  const coverageGapCount = Array.isArray(coverageReviewModel?.warningCards)
    ? coverageReviewModel.warningCards.length
    : 0;
  const checkedActorCount = Array.isArray(coverageReviewModel?.summaryCards)
    ? coverageReviewModel.summaryCards.length
    : 0;

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

  function canWriteAssignmentAtScope(selection) {
    if (!selection) {
      return false;
    }
    const access = getPermissionAccess("workflow.assignment.write", {
      scope: selection,
    });
    return access.allowed;
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

  function syncDefinitionSelection(definitionId) {
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
      return definition;
    }

    return null;
  }

  function selectDefinitionForEditing(definitionId, targetStep = 3) {
    const definition = syncDefinitionSelection(definitionId);
    setCurrentStep(definition ? targetStep : 3);
  }

  function selectDefinitionForWorkbench(definitionId) {
    syncDefinitionSelection(definitionId);
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
                actionCode: row?.actionCode ?? null,
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
    if (
      !canReadAssignments ||
      isApWorkflowProcess ||
      (currentStep < 4 &&
        (!isSecurityAdminWorkbench || activeWorkbenchTab !== "coverage"))
    ) {
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
    activeWorkbenchTab,
    canReadAssignments,
    currentStep,
    isApWorkflowProcess,
    isSecurityAdminWorkbench,
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
          "Workflow created. Next, define the workflow steps.",
          "Workflow olusturuldu. Siradaki adim: workflow adimlarini tanimlayin."
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
    if (workflowStepValidation.hasBlockingIssues) {
      setError(workflowStepValidation.summaryText);
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
          "Workflow steps saved. Review the setup and save the assignment.",
          "Workflow adimlari kaydedildi. Kurulumu inceleyin ve atamayi kaydedin."
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
      field === "requiredAuthorityCode" ||
      field === "actionCode" ||
      field === "stageScopeType"
        ? String(value || "").trim().toUpperCase()
        : value;
    const selectedAuthority =
      field === "requiredAuthorityCode"
        ? workflowStepAuthorityOptions.find(
            (entry) => String(entry?.code || "").trim().toUpperCase() === normalizedFieldValue
          ) || null
        : null;
    applyStepDrafts(
      stepDrafts.map((step, stepIndex) =>
        stepIndex !== index
          ? step
          : field === "actionCode" && isApWorkflowProcess
            ? {
                ...step,
                actionCode: normalizedFieldValue,
                requiredAuthorityCode: "",
                requiredAuthorityLabel: "",
                requiredPermissionCode:
                  getApWorkflowRequiredPermissionCode(normalizedFieldValue),
                actionLabel: "",
                minApproverCount: normalizedFieldValue === "APPROVE" ? step.minApproverCount : "1",
                allowSelfApprove:
                  normalizedFieldValue === "APPROVE" ? Boolean(step.allowSelfApprove) : false,
              }
          : field === "requiredAuthorityCode"
            ? {
                ...step,
                requiredAuthorityCode: normalizedFieldValue,
                requiredAuthorityLabel: selectedAuthority?.displayName || "",
                requiredPermissionCode: selectedAuthority?.primaryPermissionCode || "",
                actionLabel: "",
              }
            : field === "stageScopeType"
              ? {
                ...step,
                stageScopeType: normalizedFieldValue,
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
    if (isApWorkflowProcess) {
      const currentSteps = Array.isArray(stepDrafts) ? stepDrafts : [];
      const insertIndex = currentSteps.findIndex(
        (step) => String(step?.actionCode || "").trim().toUpperCase() === "POST"
      );
      const nextStepNo =
        insertIndex >= 0
          ? Math.max(1, Number(currentSteps[insertIndex]?.stepNo || insertIndex + 1) || insertIndex + 1)
          : (Array.isArray(currentSteps) ? currentSteps.length : 0) + 1;
      const nextDraft = normalizeStepDraft(
        {
          actionCode: "APPROVE",
          requiredPermissionCode: getApWorkflowRequiredPermissionCode("APPROVE"),
        },
        nextStepNo,
        selectedProcessType,
        workflowStepCatalogContext
      );

      if (insertIndex >= 0) {
        const nextSteps = currentSteps.map((step, stepIndex) =>
          stepIndex < insertIndex
            ? step
            : {
                ...step,
                stepNo: String(
                  Math.max(1, Number(step?.stepNo || stepIndex + 1) || stepIndex + 1) + 1
                ),
              }
        );
        nextSteps.splice(insertIndex, 0, {
          ...nextDraft,
          stepNo: String(nextStepNo),
        });
        applyStepDrafts(nextSteps, selectedProcessType);
        return;
      }

      applyStepDrafts([...currentSteps, nextDraft], selectedProcessType);
      return;
    }

    applyStepDrafts(
      [
        ...stepDrafts,
        normalizeStepDraft(
          {
            requiredAuthorityCode: workflowStepAuthorityOptions[0]?.code || "",
            requiredAuthorityLabel: workflowStepAuthorityOptions[0]?.displayName || "",
            requiredPermissionCode:
              workflowStepAuthorityOptions[0]?.primaryPermissionCode || "",
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
        "Preset applied to this workflow. Review the steps before saving.",
        "Preset bu workflow'a uygulandi. Kaydetmeden once adimlari gozden gecirin."
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

  /**
   * Save one AP routing-matrix row through the existing workflow definition and
   * assignment APIs so the matrix stays an admin layer over the current model.
   */
  async function onSaveApprovalRoutingRule(draft) {
    const targetMode = String(draft?.targetMode || "definition").trim().toLowerCase();
    const selectedScope = resolveAssignmentScopeSelection(draft, tenantScopeId);

    if (!selectedScope) {
      setError(l("Select a route scope first.", "Once bir rota kapsami secin."));
      return;
    }
    if (targetMode !== "definition") {
      setError(
        l(
          "AP routing matrix routes must use an existing workflow definition.",
          "AP rota matrisi kayitlari mevcut bir workflow tanimi kullanmalidir."
        )
      );
      return;
    }
    if (!canWriteAssignmentAtScope(selectedScope)) {
      setError(getWorkflowAssignmentScopeDisabledReason(getPermissionAccess("workflow.assignment.write", {
        scope: selectedScope,
      }), l));
      return;
    }

    let workflowDefinitionId = toPositiveInt(draft?.workflowDefinitionId);
    setSaving(`routing-save-${toPositiveInt(draft?.id) || "new"}`);
    setError("");
    setMessage("");
    try {
      const payload = {
        processType: AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
        workflowDefinitionId,
        effectiveFrom: draft?.effectiveFrom,
        effectiveTo: draft?.effectiveTo || undefined,
        status: draft?.status || "ACTIVE",
        priority:
          draft?.priority === undefined || draft?.priority === null || draft?.priority === ""
            ? 100
            : Number(draft.priority),
        isFallback: Boolean(draft?.isFallback),
        minAmount:
          draft?.minAmount === undefined || draft?.minAmount === null || draft?.minAmount === ""
            ? undefined
            : Number(draft.minAmount),
        maxAmount:
          draft?.maxAmount === undefined || draft?.maxAmount === null || draft?.maxAmount === ""
            ? undefined
            : Number(draft.maxAmount),
      };

      if (draft?.scopeType === "GROUP") {
        payload.groupCompanyId = toPositiveInt(draft?.groupCompanyId) || undefined;
      }
      if (draft?.scopeType === "COUNTRY") {
        payload.countryId = toPositiveInt(draft?.countryId) || undefined;
      }
      if (draft?.scopeType === "LEGAL_ENTITY") {
        payload.legalEntityId = toPositiveInt(draft?.legalEntityId) || undefined;
      }
      if (draft?.scopeType === "OPERATING_UNIT") {
        payload.operatingUnitId = toPositiveInt(draft?.operatingUnitId) || undefined;
      }

      if (toPositiveInt(draft?.id)) {
        await updateWorkflowAssignment(toPositiveInt(draft.id), payload);
      } else {
        await createWorkflowAssignment(payload);
      }

      await loadData();
      await refreshModuleReadiness({ global: true });
      setMessage(
        toPositiveInt(draft?.id)
          ? l("Routing rule updated.", "Yonlendirme kurali guncellendi.")
          : l("Routing rule saved.", "Yonlendirme kurali kaydedildi.")
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          l("Routing rule could not be saved.", "Yonlendirme kurali kaydedilemedi.")
      );
      throw err;
    } finally {
      setSaving("");
    }
  }

  async function onRetireApprovalRoutingRule(row) {
    const assignmentId = toPositiveInt(row?.id);
    if (!assignmentId) {
      return;
    }
    if (!row?.canEdit) {
      setError(
        l(
          "Missing permission: workflow.assignment.write",
          "Eksik yetki: workflow.assignment.write"
        )
      );
      return;
    }

    setSaving(`routing-retire-${assignmentId}`);
    setError("");
    setMessage("");
    try {
      await updateWorkflowAssignment(assignmentId, {
        status: "INACTIVE",
        effectiveTo: row?.effectiveTo || todayIsoDate(),
      });
      await loadData();
      await refreshModuleReadiness({ global: true });
      setMessage(
        l(
          "Routing rule removed from the active matrix.",
          "Yonlendirme kurali aktif matristen kaldirildi."
        )
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          l("Routing rule could not be removed.", "Yonlendirme kurali kaldirilamadi.")
      );
      throw err;
    } finally {
      setSaving("");
    }
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

  function openSetupWizardAtStep(stepNumber) {
    setCurrentStep(stepNumber);
    navigateToWorkbenchTab("setup");
  }

  function openSelectedDefinitionInSetup(targetStep = 4) {
    if (selectedDefinitionId) {
      selectDefinitionForEditing(selectedDefinitionId, targetStep);
      navigateToWorkbenchTab("setup");
      return;
    }

    openSetupWizardAtStep(1);
  }

  function renderRecordsSection(defaultTab = "workflows", onSelectDefinition = selectDefinitionForEditing) {
    return (
      <WorkflowRecordsSection
        key={`${defaultTab}:${String(selectedDefinitionId || "")}`}
        l={l}
        definitions={definitions}
        assignments={assignmentRows}
        loading={loading}
        selectedDefinitionId={selectedDefinitionId}
        onSelectDefinition={onSelectDefinition}
        onToggleAssignmentStatus={onToggleAssignmentStatus}
        getWorkflowTypeLabel={(value) =>
          text.workflowTypeLabels[String(value || "").toUpperCase()] || value || "-"
        }
        defaultTab={defaultTab}
      />
    );
  }

  const sharedAlerts = (
    <>
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
    </>
  );

  const legacySurface = (
    <div className="space-y-6">
      <WorkflowSetupProgress
        currentStep={currentStep}
        steps={text.progressSteps}
        canReachStep={canReachStep}
        onSelectStep={goToStep}
      />

      {sharedAlerts}

      <div
        className={`grid gap-6 ${
          currentStep === 4 && isApWorkflowProcess
            ? ""
            : currentStep === 4
              ? "xl:grid-cols-[minmax(0,1fr)_300px]"
              : "xl:grid-cols-[minmax(0,1fr)_340px]"
        }`}
      >
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
              workflowStepAuthorityOptions={workflowStepAuthorityOptions}
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
              {...apStepBuilderPresetProps}
              workflowStepValidation={workflowStepValidation}
              coverageDiagnosticsLoading={coverageDiagnosticsLoading}
              coverageDiagnosticsError={coverageDiagnosticsError}
              canReadCoverageDiagnostics={canReadAssignments}
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
              {...apReviewPresetProps}
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

        {!(currentStep === 4 && isApWorkflowProcess) ? (
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
            compactForStepBuilder={currentStep === 4}
          />
        ) : null}
      </div>

      {canReadAssignments ? (
        <ApprovalRoutingMatrixSection
          l={l}
          assignments={assignmentRows}
          definitions={definitions}
          presetEntries={workflowPresetEntries}
          orgTreeRoot={orgTreeRoot}
          tenantScopeId={tenantScopeId}
          scopeTypeLabels={text.scopeTypeLabels}
          getNodeDisabledReason={getAssignmentNodeDisabledReason}
          canWriteAny={hasPermission("workflow.assignment.write")}
          canWriteScopeSelection={canWriteAssignmentAtScope}
          saving={saving}
          onSaveRule={onSaveApprovalRoutingRule}
          onRetireRule={onRetireApprovalRoutingRule}
        />
      ) : null}

      {renderRecordsSection()}
    </div>
  );

  if (!isSecurityAdminWorkbench) {
    return legacySurface;
  }

  const workflowWorkbenchStats = [
    {
      title: "Definitions",
      value: definitions.length,
      description: "Saved workflow definitions currently visible in governance records.",
      tone: "blue",
    },
    {
      title: "Assignments",
      value: `${activeAssignmentCount} active / ${inactiveAssignmentCount} inactive`,
      description: "Workflow assignments stay inspectable before you reopen the setup flow.",
      tone: "green",
    },
    {
      title: "AP routing rules",
      value: apRoutingRuleCount,
      description: "AP document-posting routes currently surfaced in the routing matrix.",
      tone: "violet",
    },
    {
      title: "Coverage",
      value: coverageGapCount > 0 ? `${coverageGapCount} warnings` : `${checkedActorCount} checks`,
      description:
        coverageGapCount > 0
          ? "Coverage diagnostics found unresolved workflow-actor gaps in the current preview."
          : checkedActorCount > 0
            ? "Coverage diagnostics are available directly from the workflow workbench."
            : "Open the coverage tab or the setup builder to run coverage diagnostics.",
      tone: coverageGapCount > 0 ? "amber" : "blue",
    },
  ];

  const workbenchActions =
    activeWorkbenchTab === "setup"
      ? [
          {
            to: "/app/ayarlar/security-admin/workflows?tab=records",
            label: "Open records",
            tone: "primary",
          },
          {
            to: "/app/ayarlar/security-admin/workflows?tab=coverage",
            label: "Open coverage",
          },
        ]
      : [
          {
            label: "Open setup wizard",
            tone: "primary",
            onClick: () =>
              openSetupWizardAtStep(
                activeWorkbenchTab === "assignments"
                  ? 2
                  : activeWorkbenchTab === "coverage"
                    ? 4
                    : 1
              ),
          },
          {
            to: "/app/ayarlar/security-admin/catalog?tab=access-model",
            label: "Open access model catalog",
          },
        ];

  const workbenchContext = (() => {
    switch (activeWorkbenchTab) {
      case "assignments":
        return {
          title: "Assignments first show where rules apply",
          description:
            "Review saved workflow assignments and scope spread before you change status or reopen the setup flow.",
          badges: [
            `${activeAssignmentCount} active`,
            `${assignmentScopeCount} scopes`,
            `${assignedWorkflowTypeCount} workflow types`,
          ],
        };
      case "coverage":
        return {
          title: "Coverage is a first-class governance surface",
          description:
            "The routing matrix and diagnostics stay reachable without dropping straight into the create/edit wizard.",
          badges: [
            `${apRoutingRuleCount} AP routes`,
            `${coverageGapCount} warnings`,
            `${checkedActorCount} checks`,
          ],
        };
      case "records":
        return {
          title: "Records keep governance inspectable",
          description:
            "Use the records tab to review saved workflow definitions and assignments without mixing them into the setup flow.",
          badges: [
            `${definitions.length} definitions`,
            `${assignmentRows.length} assignments`,
          ],
        };
      case "setup":
        return {
          title: "The wizard remains available, but secondary",
          description:
            "Create and edit still use the existing guided steps, while the workbench keeps inspection and coverage outside the wizard.",
          badges: [
            `Step ${currentStep}/${text.progressSteps.length}`,
            `${stepDrafts.length} drafted steps`,
          ],
        };
      case "definitions":
      default:
        return {
          title: "Definitions are the landing surface",
          description:
            "Admins land on saved workflow definitions first so governance is inspectable before it becomes editable.",
          badges: [
            `${definitions.length} definitions`,
            `${activeAssignmentCount} active assignments`,
          ],
        };
    }
  })();

  const workflowWorkbenchContent = (() => {
    if (activeWorkbenchTab === "setup") {
      return legacySurface;
    }

    if (activeWorkbenchTab === "definitions") {
      return (
        <div className="space-y-6">
          {sharedAlerts}

          <Card className="rounded-3xl border-border/80">
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>{l("Workflow definitions", "Workflow tanimlari")}</CardTitle>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {l(
                      "Inspect saved workflow definitions before editing steps or opening create flows.",
                      "Adimlari duzenlemeden veya yeni akis olusturmadan once kayitli workflow tanimlarini inceleyin."
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {selectedDefinition
                      ? selectedDefinition.name || selectedDefinition.code
                      : l("No definition selected", "Tanim secilmedi")}
                  </Badge>
                  <Badge variant="outline">
                    {selectedDefinition
                      ? `${Number(selectedDefinition.stepCount || stepDrafts.length || 0)} ${l("steps", "adim")}`
                      : l("Select a row to inspect", "Incelemek icin satir secin")}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => openSetupWizardAtStep(1)}>
                {l("Create workflow", "Workflow olustur")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => openSelectedDefinitionInSetup(4)}
                disabled={!selectedDefinitionId}
              >
                {l("Edit selected workflow", "Secili workflow'u duzenle")}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/app/ayarlar/security-admin/catalog?tab=access-model&modelTab=workflow_presets">
                  {l("Browse workflow presets", "Workflow presetlerini incele")}
                </Link>
              </Button>
            </CardContent>
          </Card>

          {renderRecordsSection("workflows", selectDefinitionForWorkbench)}
        </div>
      );
    }

    if (activeWorkbenchTab === "assignments") {
      return (
        <div className="space-y-6">
          {sharedAlerts}

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="rounded-3xl border-border/80">
              <CardHeader className="pb-2">
                <CardTitle>{l("Active assignments", "Aktif atamalar")}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="text-3xl font-semibold text-foreground">{activeAssignmentCount}</div>
                <p className="mt-2 leading-6">
                  {l(
                    "Assignments currently applying live workflow definitions at scope.",
                    "Kapsamda canli workflow tanimlarini uygulayan atamalar."
                  )}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border/80">
              <CardHeader className="pb-2">
                <CardTitle>{l("Covered scopes", "Kapsanan kapsamlar")}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="text-3xl font-semibold text-foreground">{assignmentScopeCount}</div>
                <p className="mt-2 leading-6">
                  {l(
                    "Distinct scopes currently represented across saved workflow assignments.",
                    "Kayitli workflow atamalarinda temsil edilen farkli kapsamlar."
                  )}
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-border/80">
              <CardHeader className="pb-2">
                <CardTitle>{l("Workflow types", "Workflow tipleri")}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="text-3xl font-semibold text-foreground">{assignedWorkflowTypeCount}</div>
                <p className="mt-2 leading-6">
                  {l(
                    "Process families currently covered by saved workflow assignments.",
                    "Kayitli workflow atamalarinin kapsadigi surec aileleri."
                  )}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl border-border/80">
            <CardHeader className="space-y-3">
              <CardTitle>{l("Assignment workbench", "Atama workbench'i")}</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                {l(
                  "Review current assignment posture first, then reopen the wizard only when you need to change scope or status.",
                  "Mevcut atama durusunu once inceleyin; kapsam veya durum degistirmeniz gerektiginde sihirbazi yeniden acin."
                )}
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => openSetupWizardAtStep(2)}>
                {l("Create assignment", "Atama olustur")}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/app/ayarlar/security-admin/users?tab=assignments">
                  {l("Open user assignments", "Kullanici atamalarini ac")}
                </Link>
              </Button>
              <Button type="button" variant="outline" onClick={() => navigateToWorkbenchTab("coverage")}>
                {l("Review coverage", "Coverage gorunumunu ac")}
              </Button>
            </CardContent>
          </Card>

          {renderRecordsSection("assignments", selectDefinitionForWorkbench)}
        </div>
      );
    }

    if (activeWorkbenchTab === "coverage") {
      return (
        <div className="space-y-6">
          {sharedAlerts}

          <Card className="rounded-3xl border-border/80">
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>{l("Coverage diagnostics", "Coverage tanilari")}</CardTitle>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {l(
                      "Coverage now has its own tab so routing and actor gaps are inspectable before you change saved workflow records.",
                      "Coverage artik kendi sekmesine sahip; boylece yonlendirme ve aktor bosluklari kayitlari degistirmeden once incelenebilir."
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{selectedProcessTypeLabel}</Badge>
                  <Badge variant="outline">{assignmentLabel}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => openSetupWizardAtStep(4)}>
                {l("Open step builder", "Adim kurucusunu ac")}
              </Button>
              <Button asChild type="button" variant="outline">
                <Link to="/app/ayarlar/security-admin/catalog?tab=access-model">
                  {l("Review access model catalog", "Erisim model katalogunu incele")}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="grid gap-4 md:grid-cols-2">
              {coverageDiagnosticsLoading ? (
                <Card className="rounded-3xl border-border/80">
                  <CardContent className="py-8 text-sm text-muted-foreground">
                    {l("Coverage diagnostics are loading...", "Coverage tanilari yukleniyor...")}
                  </CardContent>
                </Card>
              ) : Array.isArray(coverageReviewModel?.summaryCards) &&
                coverageReviewModel.summaryCards.length > 0 ? (
                coverageReviewModel.summaryCards.map((card) => (
                  <div
                    key={card.key}
                    className={`rounded-3xl border px-5 py-5 shadow-sm ${card.toneClass}`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">
                      {card.statusLabel}
                    </div>
                    <div className="mt-2 text-lg font-semibold">{card.actorLabel}</div>
                    <p className="mt-2 text-sm leading-6">{card.detailText}</p>
                    {card.uncoveredScopeLabels.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {card.uncoveredScopeLabels.map((scopeLabel) => (
                          <Badge key={`${card.key}:${scopeLabel}`} variant="outline">
                            {scopeLabel}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <Card className="rounded-3xl border-border/80">
                  <CardContent className="py-8 text-sm leading-6 text-muted-foreground">
                    {l(
                      "Coverage follows the current workflow setup state. Open the setup tab to change scope, type, or steps, then return here to inspect diagnostics.",
                      "Coverage mevcut workflow kurulum durumunu izler. Kapsami, tipi veya adimlari degistirmek icin kurulum sekmesini acin; sonra tanilari incelemek icin buraya donun."
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            <Card className="rounded-3xl border-border/80">
              <CardHeader className="pb-2">
                <CardTitle>{l("Coverage outcome", "Coverage sonucu")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {coverageDiagnosticsError ? (
                  <Alert variant="destructive">
                    <AlertTitle>{l("Coverage diagnostics failed", "Coverage tanilari basarisiz")}</AlertTitle>
                    <AlertDescription>{coverageDiagnosticsError}</AlertDescription>
                  </Alert>
                ) : null}

                {coverageReviewModel?.checkedOnLabel ? (
                  <p className="font-medium text-foreground">{coverageReviewModel.checkedOnLabel}</p>
                ) : null}

                {coverageReviewModel?.successText ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-emerald-900">
                    {coverageReviewModel.successText}
                  </div>
                ) : null}

                {Array.isArray(coverageReviewModel?.warningCards) &&
                coverageReviewModel.warningCards.length > 0 ? (
                  coverageReviewModel.warningCards.map((warning) => (
                    <div
                      key={warning.key}
                      className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-amber-950"
                    >
                      <div className="font-semibold">{warning.title}</div>
                      <p className="mt-1 leading-6">{warning.description}</p>
                      {warning.technicalHint ? (
                        <p className="mt-2 text-xs text-amber-900">{warning.technicalHint}</p>
                      ) : null}
                    </div>
                  ))
                ) : !coverageDiagnosticsLoading && !coverageDiagnosticsError ? (
                  <p>
                    {l(
                      "No workflow-actor warnings are currently visible for the selected preview state.",
                      "Secili onizleme durumu icin su anda workflow-aktor uyarisi gorunmuyor."
                    )}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {canReadAssignments ? (
            <ApprovalRoutingMatrixSection
              l={l}
              assignments={assignmentRows}
              definitions={definitions}
              presetEntries={workflowPresetEntries}
              orgTreeRoot={orgTreeRoot}
              tenantScopeId={tenantScopeId}
              scopeTypeLabels={text.scopeTypeLabels}
              getNodeDisabledReason={getAssignmentNodeDisabledReason}
              canWriteAny={hasPermission("workflow.assignment.write")}
              canWriteScopeSelection={canWriteAssignmentAtScope}
              saving={saving}
              onSaveRule={onSaveApprovalRoutingRule}
              onRetireRule={onRetireApprovalRoutingRule}
            />
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {sharedAlerts}

        <Card className="rounded-3xl border-border/80">
          <CardHeader className="space-y-3">
            <CardTitle>{l("Workflow records", "Workflow kayitlari")}</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              {l(
                "Keep saved definitions and assignments inspectable from one records surface before deciding whether a wizard flow is needed.",
                "Kayitli tanimlari ve atamalari, bir sihirbaz akisina ihtiyac olup olmadigina karar vermeden once tek kayit yuzeyinden inceleyin."
              )}
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => openSelectedDefinitionInSetup(4)}>
              {selectedDefinitionId
                ? l("Edit selected definition", "Secili tanimi duzenle")
                : l("Open setup wizard", "Kurulum sihirbazini ac")}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigateToWorkbenchTab("assignments")}>
              {l("Open assignments tab", "Atamalar sekmesini ac")}
            </Button>
          </CardContent>
        </Card>

        {renderRecordsSection("workflows", selectDefinitionForWorkbench)}
      </div>
    );
  })();

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="workflows"
      sectionKey="workflow-governance"
      eyebrow="Security / Workflow governance"
      title="Workflow Governance"
      description="Inspect workflow definitions, assignments, coverage, and records before opening the guided setup wizard. The security-admin workbench keeps the workflow domain inspectable first and editable second."
      actions={workbenchActions}
      stats={workflowWorkbenchStats}
      toolbar={
        <>
          <SecurityWorkflowWorkbenchTabs
            activeTab={activeWorkbenchTab}
            counts={{
              definitions: definitions.length,
              assignments: assignmentRows.length,
              coverage: coverageGapCount > 0 ? coverageGapCount : apRoutingRuleCount,
              records: definitions.length + assignmentRows.length,
              setup: `${currentStep}/${text.progressSteps.length}`,
            }}
          />

          <Card className="rounded-3xl border-border/80">
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>{workbenchContext.title}</CardTitle>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {workbenchContext.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {workbenchContext.badges.map((badgeLabel) => (
                    <Badge key={badgeLabel} variant="outline">
                      {badgeLabel}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardHeader>
          </Card>
        </>
      }
    >
      {workflowWorkbenchContent}
    </SecurityAdminWorkspaceShell>
  );
}
