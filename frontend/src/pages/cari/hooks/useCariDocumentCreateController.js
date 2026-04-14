
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCariDocument, listCariDocumentWarehouseOptions } from "../../../api/cariDocuments.js";
import { listCariCounterparties } from "../../../api/cariCounterparty.js";
import { listCariPaymentTerms } from "../../../api/cariPaymentTerms.js";
import { listCashRegisters } from "../../../api/cashAdmin.js";
import { listAccounts } from "../../../api/glAdmin.js";
import { listItemCards } from "../../../api/itemCards.js";
import { listFixedAssetCategories, listFixedAssets } from "../../../api/fixedAssets.js";
import { listOperatingUnits } from "../../../api/orgAdmin.js";
import { listTaxRules, previewTaxComputation } from "../../../api/taxAdmin.js";
import {
  createMeSavedView,
  deleteMeSavedView,
  listMeSavedViews,
  updateMeSavedView,
} from "../../../api/me.js";
import { useAuth } from "../../../auth/useAuth.js";
import { useWorkingContext } from "../../../context/useWorkingContext.js";
import { useWorkingContextDefaults } from "../../../context/useWorkingContextDefaults.js";
import { useI18n } from "../../../i18n/useI18n.js";
import {
  buildDocumentMutationPayload,
  createDocumentLineDraft,
  DOCUMENT_DIRECTIONS,
  DOCUMENT_TYPES,
  getDocumentFxComputation,
  normalizeDocumentFormLines,
  requiresDueDate,
  validateDocumentMutationForm,
} from "../cariDocumentsUtils.js";
import {
  analyzeDocumentWarehouseBindings,
  buildChargeAllocationMethodTransitionPatch,
  buildChargeTargetDrafts,
  buildCloneDraftFormFromRow,
  buildDirectionScopedDraftForm,
  buildDocumentDraftTemplateDefinition,
  buildFixedAssetModeTransitionPatch,
  buildItemCardSelectionTransitionPatch,
  buildRowsById,
  buildSubledgerTypeTransitionPatch,
  buildTaxCategoryOptions,
  buildTemplateSafeDraftForm,
  createInitialDraftForm,
  createInitialRecurringTemplateRule,
  DEFAULT_FILTERS,
  DOCUMENT_CREATE_CONTEXT_MAPPINGS,
  DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE,
  DOCUMENT_RECURRING_TEMPLATE_CADENCES,
  expandAutoCreateFixedAssetLine,
  extendAccountOptionsForSelectedLines,
  extendCashRegisterOptionsForSelectedValue,
  extendFixedAssetCategoryOptionsForSelectedLines,
  extendFixedAssetOptionsForSelectedLines,
  extendItemCardOptionsForSelectedLines,
  extendWarehouseOptionsForSelectedLines,
  FIXED_ASSET_AP_IMPROVEMENT_ELIGIBLE_STATUSES,
  FIXED_ASSET_AR_ELIGIBLE_STATUSES,
  formatFixedAssetCategorySetupRequirementList,
  formatOperatingUnitDisplay,
  getCreateDraftDocumentTitle,
  getFixedAssetCategorySetupIssue,
  getImmediateCashSettlementLabel,
  isImmediateCashSettlementMode,
  mapCashRegisterLookupOptions,
  mapCounterpartyLookupOption,
  mapFixedAssetCategoryLookupOptions,
  mapFixedAssetLookupOptions,
  mapItemCardLookupOptions,
  mapLegalEntityLookupOption,
  mapOperatingUnitLookupOption,
  mapPaymentTermLookupOption,
  mapPostableAccountRows,
  mapWarehouseLookupOptions,
  normalizeApiError,
  normalizeChargeAllocationMethod,
  normalizeCurrencyCode,
  normalizeDocumentSettlementMode,
  normalizeTranslatedApiError,
  normalizeOptionalDecimalText,
  normalizePositiveIntText,
  normalizeRecurringAnchorDay,
  normalizeRecurringCadence,
  normalizeRecurringInterval,
  normalizeText,
  resolveCounterpartyRoleFromDirection,
  resolvePaymentTermDueDateCandidate,
  resetDocumentLineTaxPreview,
  resolveDocumentDraftTemplateState,
  toPositiveInt,
  translateDocumentMutationLineErrorMap,
} from "../cariDocumentsPageHelpers.js";
import {
  normalizeLookupQuery,
  prependOrReplaceCounterpartyOption,
} from "../counterpartyInlineCreate.js";

function buildSmartResetDraftForm(previousForm) {
  const baseline = createInitialDraftForm();
  return {
    ...baseline,
    legalEntityId: normalizeText(previousForm?.legalEntityId) || baseline.legalEntityId,
    operatingUnitId: normalizeText(previousForm?.operatingUnitId) || baseline.operatingUnitId,
    direction: normalizeText(previousForm?.direction) || baseline.direction,
    documentType: normalizeText(previousForm?.documentType) || baseline.documentType,
    documentDate: normalizeText(previousForm?.documentDate) || baseline.documentDate,
    currencyCode: normalizeCurrencyCode(previousForm?.currencyCode) || baseline.currencyCode,
  };
}

function buildRequestedScopes(legalEntityId, operatingUnitId) {
  const scopes = [];
  if (operatingUnitId) {
    scopes.push({ scopeType: "OPERATING_UNIT", scopeId: operatingUnitId });
  }
  if (legalEntityId) {
    scopes.push({ scopeType: "LEGAL_ENTITY", scopeId: legalEntityId });
  }
  return scopes;
}

function focusCreateDraftSection() {
  if (typeof document === "undefined") {
    return;
  }
  const target = document.getElementById("create-draft-document");
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function replaceDraftFormLines(setForm, transformer) {
  setForm((previous) => {
    const currentLines = normalizeDocumentFormLines(previous?.lines, {
      amountTxn: previous?.amountTxn,
    });
    const nextLines = normalizeDocumentFormLines(transformer(currentLines), {
      amountTxn: previous?.amountTxn,
    });
    return {
      ...previous,
      lines: nextLines,
    };
  });
}
function addDraftFormLine(setForm) {
  replaceDraftFormLines(setForm, (currentLines) => [...currentLines, createDocumentLineDraft()]);
}
function removeDraftFormLine(setForm, rowId) {
  replaceDraftFormLines(setForm, (currentLines) => {
    if (currentLines.length <= 1) {
      return currentLines;
    }
    const nextLines = currentLines.filter((row) => row?.rowId !== rowId);
    return nextLines.length > 0 ? nextLines : currentLines;
  });
}
function moveDraftFormLine(setForm, rowId, directionStep) {
  replaceDraftFormLines(setForm, (currentLines) => {
    const currentIndex = currentLines.findIndex((row) => row?.rowId === rowId);
    if (currentIndex < 0) {
      return currentLines;
    }
    const nextIndex = currentIndex + Number(directionStep || 0);
    if (nextIndex < 0 || nextIndex >= currentLines.length) {
      return currentLines;
    }
    const nextLines = [...currentLines];
    const [movedRow] = nextLines.splice(currentIndex, 1);
    nextLines.splice(nextIndex, 0, movedRow);
    return nextLines;
  });
}
function patchDraftFormLine(setForm, rowId, patch, { resetTaxPreview = false } = {}) {
  replaceDraftFormLines(setForm, (currentLines) =>
    currentLines.map((row) => {
      if (row?.rowId !== rowId) {
        return row;
      }
      const nextSeed = {
        ...row,
        ...patch,
      };
      return resetTaxPreview
        ? resetDocumentLineTaxPreview(nextSeed)
        : createDocumentLineDraft(nextSeed);
    })
  );
}
function changeDraftFormLineChargeAllocationMethod(setForm, rowId, nextMethod) {
  replaceDraftFormLines(setForm, (currentLines) => {
    const currentLine = currentLines.find((row) => row?.rowId === rowId);
    if (!currentLine) {
      return currentLines;
    }
    const patch = buildChargeAllocationMethodTransitionPatch(
      currentLine,
      nextMethod,
      currentLines
    );
    return currentLines.map((row) =>
      row?.rowId === rowId ? createDocumentLineDraft({ ...row, ...patch }) : row
    );
  });
}
function toggleDraftFormLineChargeTarget(setForm, chargeLineRowId, targetRowId) {
  replaceDraftFormLines(setForm, (currentLines) => {
    const currentLine = currentLines.find((row) => row?.rowId === chargeLineRowId);
    if (!currentLine) {
      return currentLines;
    }
    const normalizedMethod = normalizeChargeAllocationMethod(
      currentLine?.chargeAllocationMethod
    );
    if (normalizedMethod === "NONE") {
      return currentLines;
    }
    const targetDefaults = buildChargeTargetDrafts(currentLines, chargeLineRowId);
    const targetDraft =
      targetDefaults.find((target) => target.targetRowId === String(targetRowId || "")) || null;
    if (!targetDraft) {
      return currentLines;
    }
    const existingTargets = Array.isArray(currentLine?.chargeTargets)
      ? currentLine.chargeTargets
      : [];
    const hasTarget = existingTargets.some(
      (target) => String(target?.targetRowId || "") === String(targetRowId || "")
    );
    const nextTargets = hasTarget
      ? existingTargets.filter(
          (target) => String(target?.targetRowId || "") !== String(targetRowId || "")
        )
      : [
          ...existingTargets,
          {
            ...targetDraft,
            allocatedAmountTxn:
              normalizedMethod === "MANUAL"
                ? String(targetDraft.allocatedAmountTxn || "").trim()
                : "",
          },
        ];
    return currentLines.map((row) =>
      row?.rowId === chargeLineRowId
        ? createDocumentLineDraft({
            ...row,
            chargeTargets: nextTargets,
          })
        : row
    );
  });
}
function patchDraftFormLineChargeTargetAmount(
  setForm,
  chargeLineRowId,
  targetRowId,
  nextAmount
) {
  replaceDraftFormLines(setForm, (currentLines) =>
    currentLines.map((row) => {
      if (row?.rowId !== chargeLineRowId) {
        return row;
      }
      return createDocumentLineDraft({
        ...row,
        chargeTargets: Array.isArray(row?.chargeTargets)
          ? row.chargeTargets.map((target) =>
              String(target?.targetRowId || "") === String(targetRowId || "")
                ? {
                    ...target,
                    allocatedAmountTxn: String(nextAmount || "").trim(),
                  }
                : target
            )
          : [],
      });
    })
  );
}
/**
 * Manage the create-draft workbench state for CARI AP/AR documents.
 * Scope-aware lookups honor the current legal entity and operating unit so
 * OU-scoped branch users can load only the master data they are allowed to
 * see while preparing governed AP drafts.
 */
export default function useCariDocumentCreateController({
  fixedDirection = "",
  fixedAssetCategoryRefreshToken = 0,
  onDraftCreated,
  onOpenQuickCreateAsset,
  onOpenInlineFixedAssetCategoryCreate,
  onRequestFixedAssetCategorySetup,
  registerCreateBridgeApi,
  translateDocumentMutationError,
}) {
  const { language } = useI18n();
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
  const { hasPermission, getPermissionAccess } = useAuth();
  const {
    legalEntities: workingContextLegalEntities,
    loadingBase: workingContextBaseLoading,
    error: workingContextError,
  } = useWorkingContext();
  const canCreate = hasPermission("cari.doc.create");
  const canRead = hasPermission("cari.doc.read");
  const canReadCards = hasPermission("cari.card.read");
  const canUpsertCards = hasPermission("cari.card.upsert");
  const canReadCashRegisters = hasPermission("cash.register.read");
  const canReadGlAccounts = hasPermission("gl.account.read");
  const canReadOrgTree = hasPermission("org.tree.read");
  const canUpsertFixedAssets = hasPermission("fixed_assets.upsert");
  const canUpsertFixedAssetSettings = hasPermission("fixed_assets.settings.upsert");
  const hasFixedRouteDirection = Boolean(fixedDirection);
  const [createForm, setCreateForm] = useState(() => {
    const initialForm = createInitialDraftForm();
    return fixedDirection ? { ...initialForm, direction: fixedDirection } : initialForm;
  });
  const [createContextDefaultsSuspended, setCreateContextDefaultsSuspended] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [createValidationVisible, setCreateValidationVisible] = useState(false);
  const [createPaymentTermTouched, setCreatePaymentTermTouched] = useState(false);
  const [createDueDateTouched, setCreateDueDateTouched] = useState(false);
  const [createCurrencyTouched, setCreateCurrencyTouched] = useState(false);
  const [createCounterpartyOptions, setCreateCounterpartyOptions] = useState([]);
  const [createCounterpartyLoading, setCreateCounterpartyLoading] = useState(false);
  const [createCounterpartyLookupQuery, setCreateCounterpartyLookupQuery] = useState("");
  const [createPaymentTermOptions, setCreatePaymentTermOptions] = useState([]);
  const [createPaymentTermsLoading, setCreatePaymentTermsLoading] = useState(false);
  const [createPaymentTermsError, setCreatePaymentTermsError] = useState("");
  const [createCashRegisterRows, setCreateCashRegisterRows] = useState([]);
  const [createCashRegistersLoading, setCreateCashRegistersLoading] = useState(false);
  const [createCashRegistersError, setCreateCashRegistersError] = useState("");
  const [createOperatingUnitOptions, setCreateOperatingUnitOptions] = useState([]);
  const [createOperatingUnitsLoading, setCreateOperatingUnitsLoading] = useState(false);
  const [createOperatingUnitsError, setCreateOperatingUnitsError] = useState("");
  const [createOperatingUnitOverrideOpen, setCreateOperatingUnitOverrideOpen] =
    useState(false);
  const [createLineAccountRows, setCreateLineAccountRows] = useState([]);
  const [createLineAccountsLoading, setCreateLineAccountsLoading] = useState(false);
  const [createLineAccountsError, setCreateLineAccountsError] = useState("");
  const [createItemCardRows, setCreateItemCardRows] = useState([]);
  const [createItemCardsLoading, setCreateItemCardsLoading] = useState(false);
  const [createItemCardsError, setCreateItemCardsError] = useState("");
  const [createFixedAssetCategoryRows, setCreateFixedAssetCategoryRows] = useState([]);
  const [createFixedAssetCategoriesLoading, setCreateFixedAssetCategoriesLoading] =
    useState(false);
  const [createFixedAssetCategoriesError, setCreateFixedAssetCategoriesError] =
    useState("");
  const [createFixedAssetDraftRows, setCreateFixedAssetDraftRows] = useState([]);
  const [createFixedAssetDraftLoading, setCreateFixedAssetDraftLoading] = useState(false);
  const [createFixedAssetDraftError, setCreateFixedAssetDraftError] = useState("");
  const [createFixedAssetSaleRows, setCreateFixedAssetSaleRows] = useState([]);
  const [createFixedAssetSaleLoading, setCreateFixedAssetSaleLoading] = useState(false);
  const [createFixedAssetSaleError, setCreateFixedAssetSaleError] = useState("");
  const [createWarehouseRows, setCreateWarehouseRows] = useState([]);
  const [createWarehousesLoading, setCreateWarehousesLoading] = useState(false);
  const [createWarehousesError, setCreateWarehousesError] = useState("");
  const [taxRuleRows, setTaxRuleRows] = useState([]);
  const [taxCategoryLoading, setTaxCategoryLoading] = useState(false);
  const [taxCategoryError, setTaxCategoryError] = useState("");
  const [createLinePreviewLoading, setCreateLinePreviewLoading] = useState(false);
  const [createLinePreviewError, setCreateLinePreviewError] = useState("");
  const [createLinePreviewMessage, setCreateLinePreviewMessage] = useState("");
  const [createInlineCounterpartyModalOpen, setCreateInlineCounterpartyModalOpen] =
    useState(false);
  const [createInlineCounterpartyError, setCreateInlineCounterpartyError] = useState("");
  const [createInlineCounterpartyMessage, setCreateInlineCounterpartyMessage] =
    useState("");
  const [createRecurringRule, setCreateRecurringRule] = useState(() =>
    createInitialRecurringTemplateRule()
  );
  const [draftTemplatesLoading, setDraftTemplatesLoading] = useState(false);
  const [draftTemplatesSaving, setDraftTemplatesSaving] = useState(false);
  const [draftTemplatesError, setDraftTemplatesError] = useState("");
  const [draftTemplatesMessage, setDraftTemplatesMessage] = useState("");
  const [draftTemplates, setDraftTemplates] = useState([]);
  const [selectedDraftTemplateId, setSelectedDraftTemplateId] = useState("");
  const [defaultDraftTemplateHydrated, setDefaultDraftTemplateHydrated] = useState(false);
  const lastAppliedFixedRouteDirectionRef = useRef(null);
  const createFormRef = useRef(createForm);
  const fixedAssetCategoryRowsRef = useRef(createFixedAssetCategoryRows);
  const fixedAssetCategoryOptionsRef = useRef([]);
  const fixedAssetCategoriesByIdRef = useRef(new Map());
  const fixedAssetOperatingUnitOptionsRef = useRef([]);
  const lastAutoAppliedCreateCurrencyCodeRef = useRef("");
  useEffect(() => {
    createFormRef.current = createForm;
  }, [createForm]);
  const legalEntityLookupOptions = useMemo(
    () =>
      (workingContextLegalEntities || [])
        .map(mapLegalEntityLookupOption)
        .filter((row) => row.value),
    [workingContextLegalEntities]
  );
  const legalEntityRowsById = useMemo(
    () => buildRowsById(workingContextLegalEntities),
    [workingContextLegalEntities]
  );
  const createLegalEntityLookupOptions = useMemo(() => {
    const selectedLegalEntityId = normalizeText(createForm.legalEntityId);
    const rows = [...legalEntityLookupOptions];
    if (selectedLegalEntityId && !rows.some((row) => String(row.value) === selectedLegalEntityId)) {
      rows.unshift({
        value: selectedLegalEntityId,
        label: `Legal entity #${selectedLegalEntityId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [createForm.legalEntityId, legalEntityLookupOptions]);
  const createSelectedLegalEntity = useMemo(
    () => legalEntityRowsById.get(toPositiveInt(createForm.legalEntityId)) || null,
    [createForm.legalEntityId, legalEntityRowsById]
  );
  const createFunctionalCurrencyCode = useMemo(
    () =>
      normalizeCurrencyCode(
        createSelectedLegalEntity?.functional_currency_code ||
          createSelectedLegalEntity?.functionalCurrencyCode
      ),
    [createSelectedLegalEntity]
  );
  const createDocumentMutationOptions = useMemo(
    () => ({
      functionalCurrencyCode: createFunctionalCurrencyCode || null,
    }),
    [createFunctionalCurrencyCode]
  );
  const createDocumentFxComputation = useMemo(
    () => getDocumentFxComputation(createForm, createDocumentMutationOptions),
    [createDocumentMutationOptions, createForm]
  );
  const createResolvedAmountBaseText = useMemo(
    () => normalizeOptionalDecimalText(createDocumentFxComputation.resolvedAmountBase),
    [createDocumentFxComputation.resolvedAmountBase]
  );
  const createLineAccountOptions = useMemo(
    () => extendAccountOptionsForSelectedLines(createLineAccountRows, createForm.lines),
    [createForm.lines, createLineAccountRows]
  );
  const createItemCardOptions = useMemo(
    () =>
      extendItemCardOptionsForSelectedLines(
        mapItemCardLookupOptions(createItemCardRows),
        createForm.lines
      ),
    [createForm.lines, createItemCardRows]
  );
  const createTaxCategoryOptions = useMemo(
    () => buildTaxCategoryOptions(taxRuleRows, createForm.legalEntityId, createForm.lines),
    [createForm.legalEntityId, createForm.lines, taxRuleRows]
  );
  const createWarehouseRowsById = useMemo(
    () => buildRowsById(createWarehouseRows),
    [createWarehouseRows]
  );
  const createWarehouseOptions = useMemo(
    () =>
      extendWarehouseOptionsForSelectedLines(
        mapWarehouseLookupOptions(createWarehouseRows, l),
        createForm.lines,
        l
      ),
    [createForm.lines, createWarehouseRows, l]
  );
  const createWarehouseValidation = useMemo(
    () =>
      analyzeDocumentWarehouseBindings(createForm, {
        warehouseRowsById: createWarehouseRowsById,
        warehouseLoading: createWarehousesLoading,
        warehouseError: createWarehousesError,
        l,
      }),
    [createForm, createWarehouseRowsById, createWarehousesLoading, createWarehousesError, l]
  );
  const createValidationResult = useMemo(
    () => validateDocumentMutationForm(createForm, createDocumentMutationOptions),
    [createDocumentMutationOptions, createForm]
  );
  const createLineValidationMessages = useMemo(
    () =>
      createValidationVisible
        ? translateDocumentMutationLineErrorMap(
            createValidationResult.lineErrors,
            translateDocumentMutationError
          )
        : new Map(),
    [
      createValidationResult.lineErrors,
      createValidationVisible,
      translateDocumentMutationError,
    ]
  );
  const createValidationSummary = useMemo(() => {
    if (!createValidationVisible) {
      return "";
    }
    const messages = [
      ...createValidationResult.generalErrors.map((message) =>
        translateDocumentMutationError(message)
      ),
    ];
    if (createValidationResult.lineErrors.size > 0) {
      messages.push(
        l(
          "Fix the highlighted line validation errors.",
          "Vurgulanan satir dogrulama hatalarini duzeltin."
        )
      );
    }
    return [...new Set(messages.filter(Boolean))].join(" ");
  }, [
    createValidationResult.generalErrors,
    createValidationResult.lineErrors,
    createValidationVisible,
    l,
    translateDocumentMutationError,
  ]);
  const createLineAccountsById = useMemo(
    () => buildRowsById(createLineAccountRows),
    [createLineAccountRows]
  );
  const createFixedAssetOperatingUnitOptions = useMemo(
    () =>
      (createOperatingUnitOptions || [])
        .map(mapOperatingUnitLookupOption)
        .filter((row) => row.value),
    [createOperatingUnitOptions]
  );
  const createFixedAssetCategoriesById = useMemo(
    () => buildRowsById(createFixedAssetCategoryRows),
    [createFixedAssetCategoryRows]
  );
  const createFixedAssetCategoryOptions = useMemo(
    () =>
      extendFixedAssetCategoryOptionsForSelectedLines(
        mapFixedAssetCategoryLookupOptions(
          createFixedAssetCategoryRows,
          createLineAccountsById,
          l
        ),
        createForm.lines
      ),
    [createFixedAssetCategoryRows, createForm.lines, createLineAccountsById, l]
  );
  const createOperatingUnitsById = useMemo(
    () => buildRowsById(createOperatingUnitOptions),
    [createOperatingUnitOptions]
  );
  const createFixedAssetDraftRowsById = useMemo(
    () => buildRowsById(createFixedAssetDraftRows),
    [createFixedAssetDraftRows]
  );
  const createFixedAssetDraftOptions = useMemo(
    () =>
      extendFixedAssetOptionsForSelectedLines(
        mapFixedAssetLookupOptions(createFixedAssetDraftRows, createOperatingUnitsById, [
          "DRAFT",
        ]),
        createForm.lines
      ),
    [createFixedAssetDraftRows, createForm.lines, createOperatingUnitsById]
  );
  const createFixedAssetSaleRowsById = useMemo(
    () => buildRowsById(createFixedAssetSaleRows),
    [createFixedAssetSaleRows]
  );
  const createFixedAssetSaleOptions = useMemo(
    () =>
      extendFixedAssetOptionsForSelectedLines(
        mapFixedAssetLookupOptions(
          createFixedAssetSaleRows,
          createOperatingUnitsById,
          FIXED_ASSET_AR_ELIGIBLE_STATUSES
        ),
        createForm.lines
      ),
    [createFixedAssetSaleRows, createForm.lines, createOperatingUnitsById]
  );
  const createFixedAssetImprovementOptions = useMemo(() => {
    const improvementLines = normalizeDocumentFormLines(createForm.lines).filter(
      (line) =>
        line.subledgerType === "FIXED_ASSET" && line.fixedAssetMode === "IMPROVE_EXISTING"
    );
    return extendFixedAssetOptionsForSelectedLines(
      mapFixedAssetLookupOptions(
        createFixedAssetSaleRows,
        createOperatingUnitsById,
        FIXED_ASSET_AP_IMPROVEMENT_ELIGIBLE_STATUSES
      ),
      improvementLines
    );
  }, [createFixedAssetSaleRows, createForm.lines, createOperatingUnitsById]);
  const createCounterpartyLookupOptions = useMemo(() => {
    const selectedCounterpartyId = normalizeText(createForm.counterpartyId);
    const rows = (createCounterpartyOptions || [])
      .map(mapCounterpartyLookupOption)
      .filter((row) => row.value);
    if (selectedCounterpartyId && !rows.some((row) => String(row.value) === selectedCounterpartyId)) {
      rows.unshift({
        value: selectedCounterpartyId,
        label: `Counterparty #${selectedCounterpartyId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [createCounterpartyOptions, createForm.counterpartyId]);
  const createPaymentTermLookupOptions = useMemo(() => {
    const selectedPaymentTermId = normalizeText(createForm.paymentTermId);
    const rows = (createPaymentTermOptions || [])
      .map(mapPaymentTermLookupOption)
      .filter((row) => row.value);
    if (selectedPaymentTermId && !rows.some((row) => String(row.value) === selectedPaymentTermId)) {
      rows.unshift({
        value: selectedPaymentTermId,
        label: `Payment term #${selectedPaymentTermId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [createForm.paymentTermId, createPaymentTermOptions]);
  const selectedCreatePaymentTerm = useMemo(() => {
    const selectedPaymentTermId = toPositiveInt(createForm.paymentTermId);
    if (!selectedPaymentTermId) {
      return null;
    }
    return (
      createPaymentTermOptions.find(
        (row) => toPositiveInt(row?.id) === selectedPaymentTermId
      ) || null
    );
  }, [createForm.paymentTermId, createPaymentTermOptions]);
  const createImmediateCashDueDate =
    requiresDueDate(createForm.documentType) &&
    isImmediateCashSettlementMode(createForm.settlementMode)
      ? normalizeText(createForm.documentDate)
      : "";
  const createPaymentTermDerivedDueDate = resolvePaymentTermDueDateCandidate(
    createImmediateCashDueDate ? "" : createForm.documentDate,
    createImmediateCashDueDate ? null : selectedCreatePaymentTerm
  );
  const createDueDateForcedByImmediateCash = Boolean(
    createImmediateCashDueDate &&
      normalizeText(createForm.dueDate) === createImmediateCashDueDate
  );
  const createDueDateAutoDerived = Boolean(
    !createImmediateCashDueDate &&
      requiresDueDate(createForm.documentType) &&
      !createDueDateTouched &&
      createPaymentTermDerivedDueDate &&
      normalizeText(createForm.dueDate) === createPaymentTermDerivedDueDate
  );
  const createOperatingUnitLookupOptions = useMemo(() => {
    const selectedOperatingUnitId = normalizeText(createForm.operatingUnitId);
    const rows = (createOperatingUnitOptions || [])
      .map(mapOperatingUnitLookupOption)
      .filter((row) => row.value);
    if (
      selectedOperatingUnitId &&
      !rows.some((row) => String(row.value) === selectedOperatingUnitId)
    ) {
      rows.unshift({
        value: selectedOperatingUnitId,
        label: `Operating unit #${selectedOperatingUnitId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return rows;
  }, [createForm.operatingUnitId, createOperatingUnitOptions]);
  const selectedCreateCounterparty = useMemo(() => {
    const selectedCounterpartyId = toPositiveInt(createForm.counterpartyId);
    if (!selectedCounterpartyId) {
      return null;
    }
    return (
      createCounterpartyOptions.find(
        (row) => toPositiveInt(row?.id) === selectedCounterpartyId
      ) || null
    );
  }, [createCounterpartyOptions, createForm.counterpartyId]);
  const selectedCreateCounterpartyPrimaryOperatingUnitId = normalizePositiveIntText(
    selectedCreateCounterparty?.primaryOperatingUnitId
  );
  const selectedCreateCounterpartyPrimaryOperatingUnitLabel = formatOperatingUnitDisplay(
    selectedCreateCounterpartyPrimaryOperatingUnitId,
    selectedCreateCounterparty?.primaryOperatingUnitCode,
    selectedCreateCounterparty?.primaryOperatingUnitName
  );
  const createOperatingUnitDerivedFromCounterpartyPrimary = Boolean(
    selectedCreateCounterpartyPrimaryOperatingUnitId &&
      !createOperatingUnitOverrideOpen &&
      (!normalizeText(createForm.operatingUnitId) ||
        normalizeText(createForm.operatingUnitId) ===
          selectedCreateCounterpartyPrimaryOperatingUnitId)
  );
  const effectiveCreateOperatingUnitId = createOperatingUnitDerivedFromCounterpartyPrimary
    ? selectedCreateCounterpartyPrimaryOperatingUnitId
    : normalizePositiveIntText(createForm.operatingUnitId);
  const createRequestedLegalEntityId = toPositiveInt(createForm.legalEntityId);
  const createRequestedOperatingUnitId = toPositiveInt(effectiveCreateOperatingUnitId);
  const createRequestedScopes = buildRequestedScopes(
    createRequestedLegalEntityId,
    createRequestedOperatingUnitId
  );
  const canReadScopedItemCards = getPermissionAccess("item.card.read", {
    scopes: createRequestedScopes,
  }).allowed;
  const canReadScopedFixedAssets = getPermissionAccess("fixed_assets.read", {
    scopes: createRequestedScopes,
  }).allowed;
  const canReadScopedFixedAssetSettings = getPermissionAccess(
    "fixed_assets.settings.read",
    {
      scopes: createRequestedScopes,
    }
  ).allowed;
  const canReadFixedAssetSettings = canReadScopedFixedAssetSettings;
  const createCashRegisterLookupOptions = useMemo(
    () =>
      extendCashRegisterOptionsForSelectedValue(
        mapCashRegisterLookupOptions(createCashRegisterRows, l),
        createForm.settlementCashRegisterId,
        l
      ),
    [createCashRegisterRows, createForm.settlementCashRegisterId, l]
  );
  const createImmediateCashSelected = isImmediateCashSettlementMode(
    createForm.settlementMode
  );
  const createImmediateCashLabel = getImmediateCashSettlementLabel(createForm.direction, l);
  const createDraftDocumentTitle = getCreateDraftDocumentTitle(fixedDirection, l);
  const createInlineCounterpartyName = normalizeLookupQuery(createCounterpartyLookupQuery);
  const canInlineCreateCounterpartyInCreateForm = Boolean(
    canCreate &&
      canReadCards &&
      canUpsertCards &&
      toPositiveInt(createForm.legalEntityId) &&
      createInlineCounterpartyName
  );
  const createLegalEntityLookupLoading = Boolean(
    workingContextBaseLoading && legalEntityLookupOptions.length === 0
  );
  useEffect(() => {
    const suggestedCurrencyCode = normalizeCurrencyCode(createFunctionalCurrencyCode);
    if (!suggestedCurrencyCode) {
      return;
    }
    setCreateForm((previousForm) => {
      const currentCurrencyCode = normalizeCurrencyCode(previousForm.currencyCode);
      const lastAutoCurrencyCode = normalizeCurrencyCode(
        lastAutoAppliedCreateCurrencyCodeRef.current
      );
      const shouldApplySuggestedCurrency =
        !createCurrencyTouched &&
        (!currentCurrencyCode ||
          currentCurrencyCode === "USD" ||
          currentCurrencyCode === lastAutoCurrencyCode);
      if (!shouldApplySuggestedCurrency) {
        return previousForm;
      }
      lastAutoAppliedCreateCurrencyCodeRef.current = suggestedCurrencyCode;
      if (currentCurrencyCode === suggestedCurrencyCode) {
        return previousForm;
      }
      return {
        ...previousForm,
        currencyCode: suggestedCurrencyCode,
      };
    });
  }, [createCurrencyTouched, createFunctionalCurrencyCode]);
  const selectedDraftTemplate = useMemo(
    () =>
      draftTemplates.find(
        (row) => Number(row?.id || 0) === Number(selectedDraftTemplateId || 0)
      ) || null,
    [draftTemplates, selectedDraftTemplateId]
  );
  fixedAssetCategoryRowsRef.current = createFixedAssetCategoryRows;
  fixedAssetCategoryOptionsRef.current = createFixedAssetCategoryOptions;
  fixedAssetCategoriesByIdRef.current = createFixedAssetCategoriesById;
  fixedAssetOperatingUnitOptionsRef.current = createFixedAssetOperatingUnitOptions;
  useWorkingContextDefaults(
    setCreateForm,
    createContextDefaultsSuspended ? [] : DOCUMENT_CREATE_CONTEXT_MAPPINGS,
    [createContextDefaultsSuspended, createForm.legalEntityId, createForm.documentDate]
  );
  const resetCreateDraftFormWithSmartDefaults = useCallback(() => {
    setCreateForm((previousForm) => buildSmartResetDraftForm(previousForm));
    setCreateOperatingUnitOverrideOpen(false);
    setCreatePaymentTermTouched(false);
    setCreateDueDateTouched(false);
    setCreateCurrencyTouched(false);
    setCreateValidationVisible(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
  }, []);
  const applyCreateDraftFormSnapshot = useCallback((nextForm, options = {}) => {
    const normalized = buildTemplateSafeDraftForm(nextForm);
    const treatDueDateAsDerived = Boolean(options?.treatDueDateAsDerived);
    setCreateForm(normalized);
    setCreateOperatingUnitOverrideOpen(false);
    setCreatePaymentTermTouched(Boolean(normalizeText(normalized.paymentTermId)));
    setCreateDueDateTouched(
      treatDueDateAsDerived ? false : Boolean(normalizeText(normalized.dueDate))
    );
    setCreateCurrencyTouched(Boolean(normalizeCurrencyCode(normalized.currencyCode)));
    setCreateValidationVisible(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
  }, []);
  const prefillCreateForm = useCallback(
    (sourceRow, options = {}) => {
      if (!sourceRow) {
        throw new Error(
          l(
            "Document detail is required to prepare the correction draft.",
            "Duzeltme taslagini hazirlamak icin belge detayi gereklidir."
          )
        );
      }
      const nextForm = buildCloneDraftFormFromRow(sourceRow, createFormRef.current, {
        preserveSourceDocumentDate: Boolean(options?.preserveSourceDocumentDate),
      });
      applyCreateDraftFormSnapshot(nextForm, {
        treatDueDateAsDerived: Boolean(options?.treatDueDateAsDerived),
      });
      setDraftTemplatesError("");
      setDraftTemplatesMessage(
        options?.message ||
          l(
            `Draft form copied from document id=${sourceRow?.id || "-"}.`,
            `Taslak form belge id=${sourceRow?.id || "-"} kaydindan kopyalandi.`
          )
      );
      focusCreateDraftSection();
    },
    [applyCreateDraftFormSnapshot, l]
  );
  const reportShellDraftTemplateFeedback = useCallback((feedback = {}) => {
    const messageKind = String(feedback?.messageKind || "").trim().toLowerCase();
    const message = String(feedback?.message || "").trim();
    if (messageKind === "error") {
      setDraftTemplatesError(message);
      if (message) {
        setDraftTemplatesMessage("");
      }
      return;
    }
    setDraftTemplatesError("");
    setDraftTemplatesMessage(message);
  }, []);
  const applyPendingFixedAssetSalePrefill = useCallback(
    (prefill) => {
      if (!prefill) {
        return;
      }
      const assetLabel =
        prefill.assetNo || prefill.assetName || `#${prefill.targetFixedAssetId}`;
      applyCreateDraftFormSnapshot({
        legalEntityId: prefill.legalEntityId,
        operatingUnitId: prefill.operatingUnitId,
        direction: prefill.direction || "AR",
        documentType: "INVOICE",
        documentDate: new Date().toISOString().slice(0, 10),
        lines: [
          {
            subledgerType: "FIXED_ASSET",
            targetFixedAssetId: prefill.targetFixedAssetId,
            quantity: "1",
            description: l(
              `Sale of fixed asset ${assetLabel}`,
              `${assetLabel} duran varlik satisi`
            ),
          },
        ],
      });
      setCreateError("");
      setCreateMessage(
        l(
          `Sale draft was prefilled from fixed asset detail for ${assetLabel}. Complete counterparty and amount before saving.`,
          `${assetLabel} icin satis taslagi duran varlik detayindan hazirlandi. Kaydetmeden once cari ve tutari tamamlayin.`
        )
      );
      focusCreateDraftSection();
    },
    [applyCreateDraftFormSnapshot, l]
  );
  const getQuickCreateLookupContext = useCallback(() => ({
    categoryRows: fixedAssetCategoryRowsRef.current,
    categoryOptions: fixedAssetCategoryOptionsRef.current,
    categoriesById: fixedAssetCategoriesByIdRef.current,
    operatingUnitOptions: fixedAssetOperatingUnitOptionsRef.current,
  }), []);
  const applyQuickCreatedFixedAsset = useCallback((createdAssetRow, modalContext = {}) => {
    const createdAssetId = toPositiveInt(createdAssetRow?.id);
    if (!createdAssetId) {
      return;
    }
    setCreateFixedAssetDraftRows((previous) => {
      const nextRows = Array.isArray(previous) ? [...previous] : [];
      const existingIndex = nextRows.findIndex(
        (row) => toPositiveInt(row?.id) === createdAssetId
      );
      if (existingIndex >= 0) {
        nextRows[existingIndex] = createdAssetRow;
        return nextRows;
      }
      return [createdAssetRow, ...nextRows];
    });
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(
      setCreateForm,
      modalContext?.lineRowId,
      {
        subledgerType: "FIXED_ASSET",
        fixedAssetMode: "LINK_EXISTING",
        targetFixedAssetId: String(createdAssetId),
        quantity: "1",
      },
      { resetTaxPreview: true }
    );
  }, []);
  const applyInlineFixedAssetCategory = useCallback((categoryRow, modalContext = {}) => {
    const normalizedCategoryId = toPositiveInt(categoryRow?.id);
    if (!normalizedCategoryId) {
      return;
    }
    setCreateFixedAssetCategoryRows((current) =>
      current.some((row) => toPositiveInt(row?.id) === normalizedCategoryId)
        ? current.map((row) => (toPositiveInt(row?.id) === normalizedCategoryId ? categoryRow : row))
        : [categoryRow, ...current]
    );
    if (!modalContext?.rowId) {
      return;
    }
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(setCreateForm, modalContext.rowId, {
      fixedAssetCategoryId: String(normalizedCategoryId),
    });
  }, []);
  useEffect(() => {
    if (typeof registerCreateBridgeApi !== "function") {
      return undefined;
    }
    const bridgeApi = {
      prefillCreateForm,
      reportShellDraftTemplateFeedback,
      applyPendingFixedAssetSalePrefill,
      isReadyForShellPrefill: () => defaultDraftTemplateHydrated,
      getQuickCreateLookupContext,
      applyQuickCreatedFixedAsset,
      applyInlineFixedAssetCategory,
    };
    registerCreateBridgeApi(bridgeApi);
    return () => {
      registerCreateBridgeApi(null);
    };
  }, [
    applyPendingFixedAssetSalePrefill,
    applyInlineFixedAssetCategory,
    applyQuickCreatedFixedAsset,
    defaultDraftTemplateHydrated,
    getQuickCreateLookupContext,
    prefillCreateForm,
    reportShellDraftTemplateFeedback,
    registerCreateBridgeApi,
  ]);
  const runDocumentLineTaxPreview = useCallback(
    async ({ form, setForm, setLoading, setError, setMessage, targetRowId = null }) => {
      const legalEntityId = toPositiveInt(form?.legalEntityId);
      const postingDate = normalizeText(form?.documentDate);
      const direction = normalizeText(form?.direction).toUpperCase();
      const documentType = normalizeText(form?.documentType).toUpperCase();
      const currencyCode = normalizeCurrencyCode(form?.currencyCode);
      const lines = normalizeDocumentFormLines(form?.lines, {
        amountTxn: form?.amountTxn,
      });
      setError("");
      setMessage("");
      if (!legalEntityId || !postingDate || !direction || !documentType || !currencyCode) {
        setError(
          l(
            "Set legal entity, document date, direction, document type, and currency before previewing taxes.",
            "Vergi onizlemesinden once tuzel kisilik, belge tarihi, yon, belge turu ve para birimini girin."
          )
        );
        return;
      }
      if (lines.length === 0) {
        setError(
          l(
            "Add at least one line before previewing taxes.",
            "Vergi onizlemesinden once en az bir satir ekleyin."
          )
        );
        return;
      }
      setLoading(true);
      try {
        const previewDirection = direction === "AP" ? "PURCHASE" : "SALE";
        const counterpartyType = direction === "AP" ? "VENDOR" : "CUSTOMER";
        const nextLines = [];
        let refreshedCount = 0;
        let errorCount = 0;
        for (const line of lines) {
          if (targetRowId && line.rowId !== targetRowId) {
            nextLines.push(line);
            continue;
          }
          const lineNetAmountTxn = Number(line.lineNetAmountTxn || 0);
          const hasTaxCategory = Boolean(normalizeText(line.taxCategoryCode));
          if (!hasTaxCategory) {
            nextLines.push(
              createDocumentLineDraft({
                ...line,
                lineTaxAmountTxn: 0,
                taxes: [],
                previewStatus: "",
                previewError: "",
                previewUpdatedAt: "",
              })
            );
            continue;
          }
          if (lineNetAmountTxn <= 0) {
            errorCount += 1;
            nextLines.push(
              createDocumentLineDraft({
                ...line,
                lineTaxAmountTxn: 0,
                taxes: [],
                previewStatus: "ERROR",
                previewError: l(
                  "Line net amount must be > 0 before previewing tax.",
                  "Vergi onizlemesinden once satir net tutari 0'dan buyuk olmali."
                ),
                previewUpdatedAt: "",
              })
            );
            continue;
          }
          try {
            const preview = await previewTaxComputation({
              legalEntityId,
              postingDate,
              moduleCode: "CARI",
              documentType,
              taxCategoryCode: line.taxCategoryCode,
              lineKind: line.lineKind,
              counterpartyType,
              baseAmount: lineNetAmountTxn,
              direction: previewDirection,
              currencyCode,
            });
            const taxAmountTxn = Number(
              preview?.breakdown?.taxAmount ?? preview?.breakdown?.tax_amount ?? 0
            );
            nextLines.push(
              createDocumentLineDraft({
                ...line,
                lineTaxAmountTxn: taxAmountTxn,
                taxes: [
                  {
                    componentNo: 1,
                    taxCode:
                      preview?.taxCode?.code ||
                      preview?.taxCode?.taxCode ||
                      line.taxCategoryCode,
                    taxKind:
                      preview?.taxCode?.taxKind || preview?.taxCode?.tax_kind || null,
                    ratePct:
                      preview?.breakdown?.ratePct ?? preview?.breakdown?.rate_pct ?? 0,
                    taxBaseAmountTxn:
                      preview?.breakdown?.taxableBaseAmount ??
                      preview?.breakdown?.taxable_base_amount ??
                      lineNetAmountTxn,
                    taxAmountTxn,
                    taxPurposeCode:
                      preview?.mapping?.taxPurposeCode ||
                      preview?.mapping?.tax_purpose_code ||
                      null,
                    accountId:
                      Number(preview?.mapping?.accountId || preview?.mapping?.account_id || 0) ||
                      null,
                  },
                ],
                previewStatus: "READY",
                previewError: "",
                previewUpdatedAt: new Date().toISOString(),
              })
            );
            refreshedCount += 1;
          } catch (error) {
            errorCount += 1;
            nextLines.push(
              createDocumentLineDraft({
                ...line,
                lineTaxAmountTxn: 0,
                taxes: [],
                previewStatus: "ERROR",
                previewError: normalizeApiError(
                  error,
                  l(
                    "Failed to preview tax for line.",
                    "Satir icin vergi onizlemesi alinamadi."
                  )
                ),
                previewUpdatedAt: "",
              })
            );
          }
        }
        setForm((previous) => ({
          ...previous,
          lines: nextLines,
        }));
        if (refreshedCount > 0) {
          setMessage(
            l(
              `Tax preview refreshed for ${refreshedCount} line(s).`,
              `${refreshedCount} satir icin vergi onizlemesi yenilendi.`
            )
          );
        }
        if (errorCount > 0) {
          setError(
            l(
              `${errorCount} line(s) could not refresh tax preview.`,
              `${errorCount} satirin vergi onizlemesi yenilenemedi.`
            )
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [l]
  );
  const addCreateDocumentLine = useCallback(() => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    addDraftFormLine(setCreateForm);
  }, []);
  const removeCreateDocumentLine = useCallback((rowId) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    removeDraftFormLine(setCreateForm, rowId);
  }, []);
  const moveCreateDocumentLine = useCallback((rowId, directionStep) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    moveDraftFormLine(setCreateForm, rowId, directionStep);
  }, []);
  const patchCreateDocumentLine = useCallback((rowId, patch) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(setCreateForm, rowId, patch);
  }, []);
  const patchCreateDocumentLineWithTaxReset = useCallback((rowId, patch) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(setCreateForm, rowId, patch, { resetTaxPreview: true });
  }, []);
  const changeCreateDocumentLineSubledgerType = useCallback((rowId, nextSubledgerType) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    if (!currentLine) {
      return;
    }
    patchDraftFormLine(
      setCreateForm,
      rowId,
      buildSubledgerTypeTransitionPatch(currentLine, nextSubledgerType, createForm.direction),
      { resetTaxPreview: true }
    );
  }, [createForm]);
  const selectCreateDocumentLineItemCard = useCallback((rowId, itemCardId) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    const selectedItemCard = createItemCardRows.find(
      (row) => Number(row?.id || 0) === Number(itemCardId || 0)
    ) || null;
    if (!selectedItemCard) {
      patchDraftFormLine(setCreateForm, rowId, {
        itemCardId: "",
        warehouseId: "",
        warehouseCode: "",
        warehouseName: "",
      });
      return;
    }
    const nextPatch = buildItemCardSelectionTransitionPatch(
      currentLine,
      selectedItemCard,
      createForm.direction
    );
    if (!nextPatch) {
      return;
    }
    patchDraftFormLine(setCreateForm, rowId, nextPatch, { resetTaxPreview: true });
  }, [createForm.direction, createForm?.lines, createItemCardRows]);
  const selectCreateDocumentLineWarehouse = useCallback(
    (rowId, warehouseId) => {
      setCreateLinePreviewError("");
      setCreateLinePreviewMessage("");
      const selectedWarehouse =
        createWarehouseRowsById.get(Number(warehouseId || 0)) || null;
      if (!selectedWarehouse) {
        patchDraftFormLine(setCreateForm, rowId, {
          warehouseId: "",
          warehouseCode: "",
          warehouseName: "",
        });
        return;
      }
      patchDraftFormLine(setCreateForm, rowId, {
        warehouseId: String(toPositiveInt(selectedWarehouse.id) || ""),
        warehouseCode: normalizeText(selectedWarehouse.code),
        warehouseName: normalizeText(selectedWarehouse.name),
      });
    },
    [createWarehouseRowsById]
  );
  const changeCreateDocumentLineFixedAssetMode = useCallback((rowId, nextMode) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
      (row) => row?.rowId === rowId
    );
    if (!currentLine) {
      return;
    }
    patchDraftFormLine(
      setCreateForm,
      rowId,
      buildFixedAssetModeTransitionPatch(currentLine, nextMode, {
        defaultImprovementEffectiveDate: createForm.documentDate,
      }),
      { resetTaxPreview: true }
    );
  }, [createForm?.documentDate, createForm?.lines]);
  const changeCreateDocumentLineChargeAllocationMethod = useCallback((rowId, nextMethod) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    changeDraftFormLineChargeAllocationMethod(setCreateForm, rowId, nextMethod);
  }, []);
  const toggleCreateDocumentLineChargeTarget = useCallback((rowId, targetRowId) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    toggleDraftFormLineChargeTarget(setCreateForm, rowId, targetRowId);
  }, []);
  const patchCreateDocumentLineChargeTargetAmount = useCallback(
    (rowId, targetRowId, nextAmount) => {
      setCreateLinePreviewError("");
      setCreateLinePreviewMessage("");
      patchDraftFormLineChargeTargetAmount(setCreateForm, rowId, targetRowId, nextAmount);
    },
    []
  );
  const selectCreateDocumentLineFixedAssetCategory = useCallback(
    (rowId, categoryId) => {
      setCreateLinePreviewError("");
      setCreateLinePreviewMessage("");
      const categorySetupIssue = getFixedAssetCategorySetupIssue(
        categoryId,
        createFixedAssetCategoriesById
      );
      if (categorySetupIssue) {
        const requirementList = formatFixedAssetCategorySetupRequirementList(
          categorySetupIssue.missingRequirements,
          l
        );
        setCreateLinePreviewError(
          l(
            `Selected category "${categorySetupIssue.categoryLabel}" is missing required defaults: ${requirementList}. Configure it in Fixed Asset Settings first.`,
            `Secili "${categorySetupIssue.categoryLabel}" kategorisinde gerekli varsayilanlar eksik: ${requirementList}. Once Demirbas Ayarlarinda yapilandirin.`
          )
        );
        onRequestFixedAssetCategorySetup?.(categorySetupIssue);
        return;
      }
      patchDraftFormLine(setCreateForm, rowId, {
        fixedAssetCategoryId: categoryId ? String(categoryId) : "",
      });
    },
    [createFixedAssetCategoriesById, l, onRequestFixedAssetCategorySetup]
  );
  const selectCreateDocumentLineTargetFixedAsset = useCallback((rowId, assetId) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(
      setCreateForm,
      rowId,
      {
        targetFixedAssetId: assetId ? String(assetId) : "",
        quantity: "1",
      },
      { resetTaxPreview: true }
    );
  }, []);
  const changeCreateDocumentLineStockImpactMode = useCallback((rowId, nextMode) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    patchDraftFormLine(
      setCreateForm,
      rowId,
      {
        stockImpactMode: nextMode,
        ...(String(nextMode || "").trim().toUpperCase() === "NONE"
          ? {
              warehouseId: "",
              warehouseCode: "",
              warehouseName: "",
            }
          : {}),
      },
      { resetTaxPreview: true }
    );
  }, []);
  const expandCreateDocumentLineFixedAsset = useCallback((rowId) => {
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
    replaceDraftFormLines(setCreateForm, (currentLines) => {
      const currentIndex = currentLines.findIndex((row) => row?.rowId === rowId);
      if (currentIndex < 0) {
        return currentLines;
      }
      const currentLine = createDocumentLineDraft(currentLines[currentIndex]);
      const expandedRows = expandAutoCreateFixedAssetLine(currentLine);
      if (expandedRows.length <= 1) {
        return currentLines;
      }
      return [
        ...currentLines.slice(0, currentIndex),
        ...expandedRows,
        ...currentLines.slice(currentIndex + 1),
      ];
    });
  }, []);
  const openCreateQuickCreateFixedAsset = useCallback(
    (rowId) => {
      const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
        (row) => row?.rowId === rowId
      );
      onOpenQuickCreateAsset?.({
        scope: "create",
        lineRowId: rowId,
        legalEntityId: normalizeText(createForm.legalEntityId),
        documentDate: normalizeText(createForm.documentDate),
        currencyCode: normalizeCurrencyCode(createForm.currencyCode),
        name: normalizeText(currentLine?.description),
        categoryId: normalizeText(currentLine?.fixedAssetCategoryId),
        ownerOperatingUnitId: normalizeText(currentLine?.fixedAssetOwnerOperatingUnitId),
        locationOperatingUnitId: normalizeText(currentLine?.fixedAssetLocationOperatingUnitId),
      });
    },
    [createForm, onOpenQuickCreateAsset]
  );
  const openInlineFixedAssetCategoryCreateForCreateForm = useCallback(
    (rowId) => {
      const legalEntityId = toPositiveInt(createForm?.legalEntityId);
      if (!legalEntityId) {
        setCreateLinePreviewError(
          l(
            "Select legal entity before creating an asset category.",
            "Varlik kategorisi olusturmadan once tuzel kisilik secin."
          )
        );
        return;
      }
      const currentLine = normalizeDocumentFormLines(createForm?.lines).find(
        (row) => row?.rowId === rowId
      );
      onOpenInlineFixedAssetCategoryCreate?.({
        scope: "create",
        rowId,
        legalEntityId: String(legalEntityId),
        initialName: normalizeText(currentLine?.description),
      });
    },
    [createForm, l, onOpenInlineFixedAssetCategoryCreate]
  );
  const handleCreateDocumentLineTaxPreview = useCallback(
    async (rowId = null) => {
      await runDocumentLineTaxPreview({
        form: createForm,
        setForm: setCreateForm,
        setLoading: setCreateLinePreviewLoading,
        setError: setCreateLinePreviewError,
        setMessage: setCreateLinePreviewMessage,
        targetRowId: rowId,
      });
    },
    [createForm, runDocumentLineTaxPreview]
  );
  const handleCreateDirectionChange = useCallback((nextDirection) => {
    const normalizedDirection = normalizeText(nextDirection).toUpperCase();
    setCreateForm((previous) => {
      const safeDirection = DOCUMENT_DIRECTIONS.includes(normalizedDirection)
        ? normalizedDirection
        : previous.direction;
      if (safeDirection === previous.direction && !normalizeText(previous.counterpartyId)) {
        return previous;
      }
      const normalizedLines = normalizeDocumentFormLines(previous?.lines).map((row) => {
        const currentLine = createDocumentLineDraft(row);
        if (currentLine.subledgerType !== "FIXED_ASSET") {
          return currentLine;
        }
        if (safeDirection === "AR") {
          return createDocumentLineDraft({
            ...currentLine,
            fixedAssetMode: "",
            quantity: "1",
            fixedAssetCategoryId: "",
            fixedAssetOwnerOperatingUnitId: "",
            fixedAssetLocationOperatingUnitId: "",
            fixedAssetNameOverride: "",
            fixedAssetSerialNo: "",
            fixedAssetTag: "",
            revisedUsefulLifeMonths: "",
            lifeExtensionMonths: "",
          });
        }
        return createDocumentLineDraft({
          ...currentLine,
          fixedAssetMode: currentLine.targetFixedAssetId ? "LINK_EXISTING" : "AUTO_CREATE",
        });
      });
      return {
        ...previous,
        direction: safeDirection,
        counterpartyId: "",
        lines: normalizedLines,
      };
    });
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
  }, []);
  const handleCreateSettlementModeChange = useCallback((nextMode) => {
    const normalizedMode = normalizeDocumentSettlementMode(nextMode);
    setCreateForm((previous) => ({
      ...previous,
      settlementMode: normalizedMode,
      settlementCashRegisterId:
        normalizedMode === "IMMEDIATE_CASH" ? previous.settlementCashRegisterId : "",
    }));
    if (normalizedMode === "IMMEDIATE_CASH") {
      setCreateDueDateTouched(false);
    }
  }, []);
  const handleCreateLegalEntityChange = useCallback((nextValue) => {
    const normalizedLegalEntityId = nextValue ? String(nextValue) : "";
    setCreateContextDefaultsSuspended(true);
    setCreateForm((previous) => {
      if (normalizeText(previous.legalEntityId) === normalizedLegalEntityId) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: normalizedLegalEntityId,
        operatingUnitId: "",
        counterpartyId: "",
        paymentTermId: "",
        settlementCashRegisterId: "",
      };
    });
    setCreatePaymentTermTouched(false);
    setCreateDueDateTouched(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setCreateOperatingUnitsError("");
    setCreatePaymentTermsError("");
  }, []);
  const handleInlineCreateCounterpartyForCreateForm = useCallback(() => {
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    const name = normalizeLookupQuery(createCounterpartyLookupQuery);
    if (!canUpsertCards) {
      setCreateInlineCounterpartyError(
        l("Missing permission: cari.card.upsert", "Eksik yetki: cari.card.upsert")
      );
      return;
    }
    if (!legalEntityId) {
      setCreateInlineCounterpartyError(
        l(
          "Select legalEntityId before creating a counterparty.",
          "Cari olusturmadan once legalEntityId secin."
        )
      );
      return;
    }
    if (!name) {
      setCreateInlineCounterpartyError(
        l(
          "Type a counterparty name in lookup before creating.",
          "Cari olusturmadan once aramaya cari adini yazin."
        )
      );
      return;
    }
    setCreateInlineCounterpartyModalOpen(true);
  }, [canUpsertCards, createCounterpartyLookupQuery, createForm.legalEntityId, l]);
  const handleInlineCounterpartyCreatedForCreateForm = useCallback((row) => {
    const counterpartyId = toPositiveInt(row?.id);
    if (!counterpartyId) {
      setCreateInlineCounterpartyError(
        l(
          "Counterparty create response is missing row.id.",
          "Cari olusturma yanitinda row.id yok."
        )
      );
      return;
    }
    setCreateCounterpartyOptions((prev) => prependOrReplaceCounterpartyOption(prev, row));
    setCreateForm((prev) => ({
      ...prev,
      counterpartyId: String(counterpartyId),
      operatingUnitId: "",
    }));
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyMessage(
      l(
        `Counterparty created and selected. counterpartyId=${counterpartyId}`,
        `Cari olusturuldu ve secildi. counterpartyId=${counterpartyId}`
      )
    );
  }, [l]);
  const handleCreateDraft = useCallback(
    async (event) => {
      event.preventDefault();
      setCreateSaving(true);
      setCreateError("");
      setCreateMessage("");
      setCreateValidationVisible(true);
      try {
        if (createValidationResult.errors.length > 0) {
          return;
        }
        if (createWarehouseValidation.blockingMessages.length > 0) {
          setCreateError(createWarehouseValidation.blockingMessages.join(" "));
          return;
        }
        setCreateValidationVisible(false);
        const payload = buildDocumentMutationPayload(
          {
            ...createForm,
            operatingUnitId:
              normalizeText(createForm.operatingUnitId)
              || normalizeText(effectiveCreateOperatingUnitId),
          },
          createDocumentMutationOptions
        );
        const response = await createCariDocument(payload);
        setCreateMessage(
          l(
            `Draft document created. id=${response?.row?.id || "-"}`,
            `Belge taslagi olusturuldu. id=${response?.row?.id || "-"}`
          )
        );
        resetCreateDraftFormWithSmartDefaults();
        onDraftCreated?.({
          documentId: response?.row?.id ? Number(response.row.id) : null,
          responseRow: response?.row || null,
        });
      } catch (error) {
        setCreateError(
          normalizeTranslatedApiError(
            error,
            translateDocumentMutationError,
            translateDocumentMutationError(
              "Failed to create draft document."
            ) || l("Failed to create draft document.", "Belge taslagi olusturulamadi.")
          )
        );
      } finally {
        setCreateSaving(false);
      }
    },
    [
      createDocumentMutationOptions,
      createForm,
      createValidationResult.errors.length,
      createWarehouseValidation.blockingMessages,
      effectiveCreateOperatingUnitId,
      l,
      onDraftCreated,
      resetCreateDraftFormWithSmartDefaults,
      translateDocumentMutationError,
    ]
  );
  const loadDocumentDraftTemplates = useCallback(
    async (options = {}) => {
      if (!canCreate) {
        setDraftTemplates([]);
        setSelectedDraftTemplateId("");
        setDraftTemplatesLoading(false);
        return;
      }
      const preferredId = toPositiveInt(options.preferredId);
      setDraftTemplatesLoading(true);
      setDraftTemplatesError("");
      try {
        const response = await listMeSavedViews({
          moduleCode: DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE,
        });
        const nextRows = Array.isArray(response?.rows) ? response.rows : [];
        setDraftTemplates(nextRows);
        setSelectedDraftTemplateId((current) => {
          const currentId = toPositiveInt(current);
          if (preferredId && nextRows.some((row) => Number(row?.id) === preferredId)) {
            return String(preferredId);
          }
          if (currentId && nextRows.some((row) => Number(row?.id) === currentId)) {
            return String(currentId);
          }
          return nextRows[0]?.id ? String(nextRows[0].id) : "";
        });
      } catch (error) {
        setDraftTemplates([]);
        setSelectedDraftTemplateId("");
        setDraftTemplatesError(
          normalizeApiError(
            error,
            l("Failed to load draft templates.", "Taslak sablonlari yuklenemedi.")
          )
        );
      } finally {
        setDraftTemplatesLoading(false);
      }
    },
    [canCreate, l]
  );
  const applyDocumentDraftTemplate = useCallback(
    (templateRow, options = {}) => {
      const targetTemplate = templateRow && typeof templateRow === "object" ? templateRow : null;
      if (!targetTemplate) {
        setDraftTemplatesError(l("Draft template not found.", "Taslak sablon bulunamadi."));
        return;
      }
      const resolved = resolveDocumentDraftTemplateState(targetTemplate);
      applyCreateDraftFormSnapshot(resolved.draftForm);
      setCreateRecurringRule(resolved.recurringRule);
      setSelectedDraftTemplateId(String(targetTemplate.id));
      if (!options.silent) {
        setDraftTemplatesError("");
        setDraftTemplatesMessage(
          l(
            `Draft template applied: ${targetTemplate.name || targetTemplate.id}`,
            `Taslak sablon uygulandi: ${targetTemplate.name || targetTemplate.id}`
          )
        );
      }
    },
    [applyCreateDraftFormSnapshot, l]
  );
  const handleCreateDocumentDraftTemplate = useCallback(async () => {
    const rawName = window.prompt(l("Recurring template name", "Tekrarlayan sablon adi"), "");
    const name = String(rawName || "").trim();
    if (!name) {
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      const response = await createMeSavedView({
        moduleCode: DOCUMENT_DRAFT_TEMPLATE_MODULE_CODE,
        name,
        definition: buildDocumentDraftTemplateDefinition({
          form: createForm,
          recurringRule: createRecurringRule,
        }),
      });
      const createdId = toPositiveInt(response?.row?.id);
      await loadDocumentDraftTemplates({ preferredId: createdId });
      setDraftTemplatesMessage(
        l(`Recurring template created: ${name}`, `Tekrarlayan sablon olusturuldu: ${name}`)
      );
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(
          error,
          l(
            "Failed to create recurring draft template.",
            "Tekrarlayan taslak sablon olusturulamadi."
          )
        )
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }, [createForm, createRecurringRule, l, loadDocumentDraftTemplates]);
  const handleUpdateDocumentDraftTemplate = useCallback(async () => {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError(
        l("Select a recurring template to update.", "Guncellemek icin tekrarlayan bir sablon secin.")
      );
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      await updateMeSavedView(templateId, {
        definition: buildDocumentDraftTemplateDefinition({
          form: createForm,
          recurringRule: createRecurringRule,
        }),
      });
      await loadDocumentDraftTemplates({ preferredId: templateId });
      setDraftTemplatesMessage(
        l(
          `Recurring template updated: ${selectedDraftTemplate?.name || templateId}`,
          `Tekrarlayan sablon guncellendi: ${selectedDraftTemplate?.name || templateId}`
        )
      );
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(
          error,
          l(
            "Failed to update recurring draft template.",
            "Tekrarlayan taslak sablon guncellenemedi."
          )
        )
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }, [createForm, createRecurringRule, l, loadDocumentDraftTemplates, selectedDraftTemplate]);
  const handleSetDefaultDocumentDraftTemplate = useCallback(async () => {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError(
        l(
          "Select a recurring template to set as default.",
          "Varsayilan yapmak icin tekrarlayan bir sablon secin."
        )
      );
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      await updateMeSavedView(templateId, { isDefault: true });
      await loadDocumentDraftTemplates({ preferredId: templateId });
      setDraftTemplatesMessage(
        l("Recurring template set as default.", "Tekrarlayan sablon varsayilan yapildi.")
      );
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(
          error,
          l(
            "Failed to set recurring draft template as default.",
            "Tekrarlayan taslak sablon varsayilan yapilamadi."
          )
        )
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }, [l, loadDocumentDraftTemplates, selectedDraftTemplate]);
  const handleDeleteDocumentDraftTemplate = useCallback(async () => {
    const templateId = toPositiveInt(selectedDraftTemplate?.id);
    if (!templateId) {
      setDraftTemplatesError(
        l("Select a recurring template to delete.", "Silmek icin tekrarlayan bir sablon secin.")
      );
      return;
    }
    const confirmed = window.confirm(
      l(
        `Delete recurring template "${selectedDraftTemplate?.name || templateId}"?`,
        `"${selectedDraftTemplate?.name || templateId}" tekrarlayan sablonu silinsin mi?`
      )
    );
    if (!confirmed) {
      return;
    }
    setDraftTemplatesSaving(true);
    setDraftTemplatesError("");
    setDraftTemplatesMessage("");
    try {
      await deleteMeSavedView(templateId);
      await loadDocumentDraftTemplates();
      setDraftTemplatesMessage(
        l("Recurring template deleted.", "Tekrarlayan sablon silindi.")
      );
    } catch (error) {
      setDraftTemplatesError(
        normalizeApiError(
          error,
          l(
            "Failed to delete recurring draft template.",
            "Tekrarlayan taslak sablon silinemedi."
          )
        )
      );
    } finally {
      setDraftTemplatesSaving(false);
    }
  }, [l, loadDocumentDraftTemplates, selectedDraftTemplate]);
  useEffect(() => {
    if (!hasFixedRouteDirection) {
      lastAppliedFixedRouteDirectionRef.current = null;
      return;
    }
    if (lastAppliedFixedRouteDirectionRef.current === fixedDirection) {
      return;
    }
    lastAppliedFixedRouteDirectionRef.current = fixedDirection;
    setCreateForm((previousForm) => buildDirectionScopedDraftForm(previousForm, fixedDirection));
    setCreateOperatingUnitOverrideOpen(false);
    setCreatePaymentTermTouched(false);
    setCreateDueDateTouched(false);
    setCreateCounterpartyLookupQuery("");
    setCreateInlineCounterpartyError("");
    setCreateInlineCounterpartyMessage("");
    setCreateLinePreviewError("");
    setCreateLinePreviewMessage("");
  }, [fixedDirection, hasFixedRouteDirection]);
  useEffect(() => {
    if (!canCreate) {
      setDraftTemplates([]);
      setSelectedDraftTemplateId("");
      setDefaultDraftTemplateHydrated(false);
      return;
    }
    loadDocumentDraftTemplates();
  }, [canCreate, loadDocumentDraftTemplates]);
  useEffect(() => {
    if (!canCreate || defaultDraftTemplateHydrated || draftTemplatesLoading) {
      return;
    }
    const defaultTemplate = draftTemplates.find((row) => Boolean(row?.isDefault));
    if (defaultTemplate) {
      applyDocumentDraftTemplate(defaultTemplate, { silent: true });
    }
    setDefaultDraftTemplateHydrated(true);
  }, [
    applyDocumentDraftTemplate,
    canCreate,
    defaultDraftTemplateHydrated,
    draftTemplates,
    draftTemplatesLoading,
  ]);
  useEffect(() => {
    if (!canReadCards) {
      setCreateCounterpartyOptions([]);
      setCreateCounterpartyLoading(false);
      return;
    }
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    if (!legalEntityId) {
      setCreateCounterpartyOptions([]);
      setCreateCounterpartyLoading(false);
      return;
    }
    const role = resolveCounterpartyRoleFromDirection(createForm.direction);
    let active = true;
    async function loadCreateCounterparties() {
      setCreateCounterpartyLoading(true);
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          allowedOperatingUnitId: toPositiveInt(effectiveCreateOperatingUnitId) || undefined,
          role,
          status: "ACTIVE",
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) return;
        setCreateCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (!active) return;
        setCreateCounterpartyOptions([]);
      } finally {
        if (active) setCreateCounterpartyLoading(false);
      }
    }
    loadCreateCounterparties();
    return () => {
      active = false;
    };
  }, [
    canReadCards,
    createForm.direction,
    createForm.legalEntityId,
    effectiveCreateOperatingUnitId,
  ]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    setCreateCashRegistersError("");
    if (!canReadCashRegisters || !legalEntityId) {
      setCreateCashRegisterRows([]);
      setCreateCashRegistersLoading(false);
      return;
    }
    let active = true;
    async function loadCreateCashRegisters() {
      setCreateCashRegistersLoading(true);
      try {
        const operatingUnitId = toPositiveInt(effectiveCreateOperatingUnitId);
        const response = await listCashRegisters({
          legalEntityId,
          operatingUnitId: operatingUnitId || undefined,
          status: "ACTIVE",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateCashRegisterRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateCashRegisterRows([]);
        setCreateCashRegistersError(
          normalizeApiError(error, l("Failed to load cash registers.", "Kasalar yuklenemedi."))
        );
      } finally {
        if (active) {
          setCreateCashRegistersLoading(false);
        }
      }
    }
    loadCreateCashRegisters();
    return () => {
      active = false;
    };
  }, [canReadCashRegisters, createForm.legalEntityId, effectiveCreateOperatingUnitId, l]);
  useEffect(() => {
    setTaxCategoryError("");
    if (!canReadOrgTree) {
      setTaxRuleRows([]);
      setTaxCategoryLoading(false);
      return;
    }
    let active = true;
    async function loadTaxRulesForCategories() {
      setTaxCategoryLoading(true);
      try {
        const response = await listTaxRules({
          moduleCode: "CARI",
          status: "ACTIVE",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setTaxRuleRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setTaxRuleRows([]);
        setTaxCategoryError(
          normalizeApiError(
            error,
            l("Failed to load tax category options.", "Vergi kategori secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setTaxCategoryLoading(false);
        }
      }
    }
    loadTaxRulesForCategories();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, l]);
  useEffect(() => {
    if (!canReadOrgTree) {
      setCreateOperatingUnitOptions([]);
      setCreateOperatingUnitsLoading(false);
      setCreateOperatingUnitsError("");
      return;
    }
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    if (!legalEntityId) {
      setCreateOperatingUnitOptions([]);
      setCreateOperatingUnitsLoading(false);
      setCreateOperatingUnitsError("");
      return;
    }
    let active = true;
    async function loadCreateOperatingUnits() {
      setCreateOperatingUnitsLoading(true);
      setCreateOperatingUnitsError("");
      try {
        const response = await listOperatingUnits({
          legalEntityId,
          limit: 500,
          includeInactive: true,
        });
        if (!active) return;
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setCreateOperatingUnitOptions(rows);
        setCreateForm((previousForm) => {
          const selectedOperatingUnitId = normalizeText(previousForm.operatingUnitId);
          if (!selectedOperatingUnitId) {
            return previousForm;
          }
          const selectedStillVisible = rows.some(
            (row) => String(toPositiveInt(row?.id) || "") === selectedOperatingUnitId
          );
          return selectedStillVisible
            ? previousForm
            : { ...previousForm, operatingUnitId: "" };
        });
      } catch (error) {
        if (!active) return;
        setCreateOperatingUnitOptions([]);
        setCreateOperatingUnitsError(
          normalizeApiError(
            error,
            l(
              "Failed to load operating units for selected legal entity.",
              "Secili tuzel kisilik icin operasyon birimleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) setCreateOperatingUnitsLoading(false);
      }
    }
    loadCreateOperatingUnits();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, createForm.legalEntityId, l]);
  useEffect(() => {
    if (!canReadCards) {
      setCreatePaymentTermOptions([]);
      setCreatePaymentTermsLoading(false);
      setCreatePaymentTermsError("");
      return;
    }
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    if (!legalEntityId) {
      setCreatePaymentTermOptions([]);
      setCreatePaymentTermsLoading(false);
      setCreatePaymentTermsError("");
      return;
    }
    let active = true;
    async function loadCreatePaymentTerms() {
      setCreatePaymentTermsLoading(true);
      setCreatePaymentTermsError("");
      try {
        const response = await listCariPaymentTerms({
          legalEntityId,
          status: "ACTIVE",
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) return;
        setCreatePaymentTermOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) return;
        setCreatePaymentTermOptions([]);
        setCreatePaymentTermsError(
          normalizeApiError(
            error,
            l(
              "Failed to load payment terms for selected legal entity.",
              "Secili tuzel kisilik icin vade kosullari yuklenemedi."
            )
          )
        );
      } finally {
        if (active) setCreatePaymentTermsLoading(false);
      }
    }
    loadCreatePaymentTerms();
    return () => {
      active = false;
    };
  }, [canReadCards, createForm.legalEntityId, l]);
  useEffect(() => {
    if (!selectedCreateCounterparty) {
      return;
    }
    const suggestedPaymentTermId = toPositiveInt(
      selectedCreateCounterparty.defaultPaymentTermId
    );
    const suggestedCurrencyCode = normalizeCurrencyCode(
      selectedCreateCounterparty.defaultCurrencyCode
    );
    setCreateForm((previousForm) => {
      const nextForm = { ...previousForm };
      const currentPaymentTermId = normalizeText(previousForm.paymentTermId);
      const currentCurrencyCode = normalizeCurrencyCode(previousForm.currencyCode);
      let changed = false;
      if (!createPaymentTermTouched && !currentPaymentTermId && suggestedPaymentTermId) {
        nextForm.paymentTermId = String(suggestedPaymentTermId);
        changed = true;
      }
      if (
        !createCurrencyTouched &&
        (!currentCurrencyCode || currentCurrencyCode === "USD") &&
        suggestedCurrencyCode
      ) {
        nextForm.currencyCode = suggestedCurrencyCode;
        changed = true;
      }
      return changed ? nextForm : previousForm;
    });
  }, [createCurrencyTouched, createPaymentTermTouched, selectedCreateCounterparty]);
  useEffect(() => {
    if (createImmediateCashDueDate) {
      setCreateForm((previousForm) =>
        normalizeText(previousForm.dueDate) === createImmediateCashDueDate
          ? previousForm
          : { ...previousForm, dueDate: createImmediateCashDueDate }
      );
      return;
    }
    if (createDueDateTouched) {
      return;
    }
    if (!requiresDueDate(createForm.documentType)) {
      return;
    }
    const derivedDueDate = createPaymentTermDerivedDueDate;
    setCreateForm((previousForm) =>
      normalizeText(previousForm.dueDate) === (derivedDueDate || "")
        ? previousForm
        : { ...previousForm, dueDate: derivedDueDate || "" }
    );
  }, [
    createImmediateCashDueDate,
    createDueDateTouched,
    createForm.documentDate,
    createForm.documentType,
    createPaymentTermDerivedDueDate,
  ]);
  useEffect(() => {
    setCreateOperatingUnitOverrideOpen(false);
  }, [createForm.counterpartyId, createForm.direction, createForm.legalEntityId]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    setCreateLineAccountsError("");
    if (!canReadGlAccounts || !legalEntityId) {
      setCreateLineAccountRows([]);
      setCreateLineAccountsLoading(false);
      return;
    }
    let active = true;
    async function loadCreateLineAccounts() {
      setCreateLineAccountsLoading(true);
      try {
        const response = await listAccounts({
          legalEntityId,
          includeInactive: false,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateLineAccountRows(mapPostableAccountRows(response?.rows));
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateLineAccountRows([]);
        setCreateLineAccountsError(
          normalizeApiError(
            error,
            l(
              "Failed to load line posting account options.",
              "Satir kayit hesap secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setCreateLineAccountsLoading(false);
        }
      }
    }
    loadCreateLineAccounts();
    return () => {
      active = false;
    };
  }, [canReadGlAccounts, createForm.legalEntityId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    const operatingUnitId = toPositiveInt(effectiveCreateOperatingUnitId);
    setCreateItemCardsError("");
    if (!canReadScopedItemCards || !legalEntityId) {
      setCreateItemCardRows([]);
      setCreateItemCardsLoading(false);
      return;
    }
    let active = true;
    async function loadCreateItemCards() {
      setCreateItemCardsLoading(true);
      try {
        const response = await listItemCards({
          legalEntityId,
          operatingUnitId: operatingUnitId || undefined,
          status: "ACTIVE",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateItemCardRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateItemCardRows([]);
        setCreateItemCardsError(
          normalizeApiError(
            error,
            l("Failed to load item card options.", "Urun karti secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setCreateItemCardsLoading(false);
        }
      }
    }
    loadCreateItemCards();
    return () => {
      active = false;
    };
  }, [canReadScopedItemCards, createForm.legalEntityId, effectiveCreateOperatingUnitId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    const ownerOperatingUnitId = toPositiveInt(effectiveCreateOperatingUnitId);
    setCreateFixedAssetCategoriesError("");
    if (!canReadScopedFixedAssetSettings || !legalEntityId) {
      setCreateFixedAssetCategoryRows([]);
      setCreateFixedAssetCategoriesLoading(false);
      return;
    }
    let active = true;
    async function loadCreateFixedAssetCategories() {
      setCreateFixedAssetCategoriesLoading(true);
      try {
        const response = await listFixedAssetCategories({
          legalEntityId,
          ownerOperatingUnitId: ownerOperatingUnitId || undefined,
          status: "ACTIVE",
        });
        if (!active) {
          return;
        }
        setCreateFixedAssetCategoryRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateFixedAssetCategoryRows([]);
        setCreateFixedAssetCategoriesError(
          normalizeApiError(
            error,
            l(
              "Failed to load fixed asset categories.",
              "Duran varlik kategorileri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setCreateFixedAssetCategoriesLoading(false);
        }
      }
    }
    loadCreateFixedAssetCategories();
    return () => {
      active = false;
    };
  }, [
    canReadScopedFixedAssetSettings,
    createForm.legalEntityId,
    effectiveCreateOperatingUnitId,
    fixedAssetCategoryRefreshToken,
    l,
  ]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    const ownerOperatingUnitId = toPositiveInt(effectiveCreateOperatingUnitId);
    setCreateFixedAssetDraftError("");
    if (!canReadScopedFixedAssets || !legalEntityId) {
      setCreateFixedAssetDraftRows([]);
      setCreateFixedAssetDraftLoading(false);
      return;
    }
    let active = true;
    async function loadCreateFixedAssetDrafts() {
      setCreateFixedAssetDraftLoading(true);
      try {
        const response = await listFixedAssets({
          legalEntityId,
          ownerOperatingUnitId: ownerOperatingUnitId || undefined,
          status: "DRAFT",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateFixedAssetDraftRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateFixedAssetDraftRows([]);
        setCreateFixedAssetDraftError(
          normalizeApiError(
            error,
            l("Failed to load draft fixed assets.", "Taslak duran varliklar yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setCreateFixedAssetDraftLoading(false);
        }
      }
    }
    loadCreateFixedAssetDrafts();
    return () => {
      active = false;
    };
  }, [canReadScopedFixedAssets, createForm.legalEntityId, effectiveCreateOperatingUnitId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    const ownerOperatingUnitId = toPositiveInt(effectiveCreateOperatingUnitId);
    setCreateFixedAssetSaleError("");
    if (!canReadScopedFixedAssets || !legalEntityId) {
      setCreateFixedAssetSaleRows([]);
      setCreateFixedAssetSaleLoading(false);
      return;
    }
    let active = true;
    async function loadCreateFixedAssetSaleRows() {
      setCreateFixedAssetSaleLoading(true);
      try {
        const responses = await Promise.all(
          FIXED_ASSET_AR_ELIGIBLE_STATUSES.map((status) =>
            listFixedAssets({
              legalEntityId,
              ownerOperatingUnitId: ownerOperatingUnitId || undefined,
              status,
              limit: 500,
              offset: 0,
            })
          )
        );
        if (!active) {
          return;
        }
        const merged = new Map();
        responses.forEach((response) => {
          (Array.isArray(response?.rows) ? response.rows : []).forEach((row) => {
            const id = toPositiveInt(row?.id);
            if (id && !merged.has(id)) {
              merged.set(id, row);
            }
          });
        });
        setCreateFixedAssetSaleRows([...merged.values()]);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateFixedAssetSaleRows([]);
        setCreateFixedAssetSaleError(
          normalizeApiError(
            error,
            l("Failed to load target fixed assets.", "Hedef duran varliklar yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setCreateFixedAssetSaleLoading(false);
        }
      }
    }
    loadCreateFixedAssetSaleRows();
    return () => {
      active = false;
    };
  }, [canReadScopedFixedAssets, createForm.legalEntityId, effectiveCreateOperatingUnitId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(createForm.legalEntityId);
    const operatingUnitId = toPositiveInt(effectiveCreateOperatingUnitId);
    setCreateWarehousesError("");
    if (!canRead || !legalEntityId) {
      setCreateWarehouseRows([]);
      setCreateWarehousesLoading(false);
      return;
    }
    let active = true;
    async function loadCreateWarehouses() {
      setCreateWarehousesLoading(true);
      try {
        const response = await listCariDocumentWarehouseOptions({
          legalEntityId,
          operatingUnitId: operatingUnitId || undefined,
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setCreateWarehouseRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setCreateWarehouseRows([]);
        setCreateWarehousesError(
          normalizeApiError(
            error,
            l("Failed to load warehouse choices.", "Depo secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setCreateWarehousesLoading(false);
        }
      }
    }
    loadCreateWarehouses();
    return () => {
      active = false;
    };
  }, [canRead, createForm.legalEntityId, effectiveCreateOperatingUnitId, l]);
  return {
    l,
    canCreate,
    canReadCards,
    canUpsertCards,
    canReadCashRegisters,
    canReadGlAccounts,
    canReadOrgTree,
    canReadFixedAssetSettings,
    canUpsertFixedAssetSettings,
    canUpsertFixedAssets,
    canInlineCreateCounterpartyInCreateForm,
    workingContextError,
    hasFixedRouteDirection,
    createForm,
    setCreateForm,
    createSaving,
    createError,
    createMessage,
    createValidationSummary,
    createRecurringRule,
    setCreateRecurringRule,
    draftTemplatesLoading,
    draftTemplatesSaving,
    draftTemplatesError,
    draftTemplatesMessage,
    draftTemplates,
    selectedDraftTemplateId,
    setSelectedDraftTemplateId,
    selectedDraftTemplate,
    loadDocumentDraftTemplates,
    applyDocumentDraftTemplate,
    handleCreateDocumentDraftTemplate,
    handleUpdateDocumentDraftTemplate,
    handleSetDefaultDocumentDraftTemplate,
    handleDeleteDocumentDraftTemplate,
    createLegalEntityLookupOptions,
    createLegalEntityLookupLoading,
    createOperatingUnitDerivedFromCounterpartyPrimary,
    selectedCreateCounterpartyPrimaryOperatingUnitLabel,
    selectedCreateCounterpartyPrimaryOperatingUnitId,
    createOperatingUnitLookupOptions,
    createOperatingUnitsLoading,
    createOperatingUnitsError,
    createOperatingUnitOverrideOpen,
    setCreateOperatingUnitOverrideOpen,
    createCounterpartyLookupOptions,
    createCounterpartyLoading,
    createCounterpartyLookupQuery,
    setCreateCounterpartyLookupQuery,
    createInlineCounterpartyError,
    createInlineCounterpartyMessage,
    createInlineCounterpartyName,
    setCreateInlineCounterpartyError,
    setCreateInlineCounterpartyMessage,
    createPaymentTermLookupOptions,
    createPaymentTermsLoading,
    createPaymentTermsError,
    selectedCreatePaymentTerm,
    createImmediateCashDueDate,
    createDueDateForcedByImmediateCash,
    createDueDateAutoDerived,
    createImmediateCashSelected,
    createImmediateCashLabel,
    createCashRegisterLookupOptions,
    createCashRegistersLoading,
    createCashRegistersError,
    createDocumentFxComputation,
    createResolvedAmountBaseText,
    createFunctionalCurrencyCode,
    createLineAccountOptions,
    createLineAccountsLoading,
    createLineAccountsError,
    createItemCardOptions,
    createItemCardsLoading,
    createItemCardsError,
    createWarehouseOptions,
    createWarehouseValidation,
    createWarehousesLoading,
    createWarehousesError,
    createLineValidationMessages,
    createTaxCategoryOptions,
    taxCategoryLoading,
    taxCategoryError,
    createLinePreviewLoading,
    createLinePreviewError,
    createLinePreviewMessage,
    createFixedAssetCategoryOptions,
    createFixedAssetCategoriesLoading,
    createFixedAssetCategoriesError,
    createFixedAssetCategoriesById,
    createFixedAssetDraftOptions,
    createFixedAssetDraftLoading,
    createFixedAssetDraftError,
    createFixedAssetDraftRowsById,
    createFixedAssetImprovementOptions,
    createFixedAssetSaleOptions,
    createFixedAssetSaleLoading,
    createFixedAssetSaleError,
    createFixedAssetSaleRowsById,
    createFixedAssetOperatingUnitOptions,
    createDraftDocumentTitle,
    DOCUMENT_DIRECTIONS,
    DOCUMENT_TYPES,
    DOCUMENT_RECURRING_TEMPLATE_CADENCES,
    normalizeRecurringCadence,
    normalizeRecurringInterval,
    normalizeRecurringAnchorDay,
    normalizeDocumentSettlementMode,
    normalizeOptionalDecimalText,
    requiresDueDate,
    toPositiveInt,
    normalizeText,
    setCreatePaymentTermTouched,
    setCreateDueDateTouched,
    setCreateCurrencyTouched,
    handleCreateDirectionChange,
    handleCreateSettlementModeChange,
    handleCreateLegalEntityChange,
    handleInlineCreateCounterpartyForCreateForm,
    createInlineCounterpartyModalOpen,
    setCreateInlineCounterpartyModalOpen,
    handleInlineCounterpartyCreatedForCreateForm,
    handleCreateDraft,
    resetCreateDraftFormWithSmartDefaults,
    onOpenInlineFixedAssetCategoryCreate: openInlineFixedAssetCategoryCreateForCreateForm,
    onAddLine: addCreateDocumentLine,
    onRemoveLine: removeCreateDocumentLine,
    onMoveLine: moveCreateDocumentLine,
    onPatchLine: patchCreateDocumentLine,
    onPatchTaxSensitiveLine: patchCreateDocumentLineWithTaxReset,
    onChangeSubledgerType: changeCreateDocumentLineSubledgerType,
    onChangeFixedAssetMode: changeCreateDocumentLineFixedAssetMode,
    onChangeChargeAllocationMethod: changeCreateDocumentLineChargeAllocationMethod,
    onToggleChargeTarget: toggleCreateDocumentLineChargeTarget,
    onChangeChargeTargetAmount: patchCreateDocumentLineChargeTargetAmount,
    onSelectFixedAssetCategory: selectCreateDocumentLineFixedAssetCategory,
    onSelectTargetFixedAsset: selectCreateDocumentLineTargetFixedAsset,
    onSelectItemCard: selectCreateDocumentLineItemCard,
    onChangeStockImpactMode: changeCreateDocumentLineStockImpactMode,
    onSelectWarehouse: selectCreateDocumentLineWarehouse,
    onExpandFixedAssetLine: expandCreateDocumentLineFixedAsset,
    onOpenQuickCreateFixedAsset: openCreateQuickCreateFixedAsset,
    onPreviewAll: () => handleCreateDocumentLineTaxPreview(),
    onPreviewRow: (rowId) => handleCreateDocumentLineTaxPreview(rowId),
  };
}
