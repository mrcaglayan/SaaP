import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listCariDocumentWarehouseOptions,
  updateCariDocument,
} from "../../../api/cariDocuments.js";
import { listCariCounterparties } from "../../../api/cariCounterparty.js";
import { listCashRegisters } from "../../../api/cashAdmin.js";
import { listAccounts } from "../../../api/glAdmin.js";
import { listItemCards } from "../../../api/itemCards.js";
import {
  listFixedAssetCategories,
  listFixedAssets,
} from "../../../api/fixedAssets.js";
import { listOperatingUnits } from "../../../api/orgAdmin.js";
import { listTaxRules, previewTaxComputation } from "../../../api/taxAdmin.js";
import { useAuth } from "../../../auth/useAuth.js";
import {
  buildDocumentMutationPayload,
  createDocumentLineDraft,
  DOCUMENT_TYPES,
  getDocumentFxComputation,
  mapDocumentRowToForm,
  normalizeDocumentFormLines,
  requiresDueDate,
  validateDocumentMutationForm,
} from "../cariDocumentsUtils.js";
import {
  analyzeDocumentWarehouseBindings,
  buildChargeAllocationMethodTransitionPatch,
  buildChargeTargetDrafts,
  buildFixedAssetModeTransitionPatch,
  buildItemCardSelectionTransitionPatch,
  buildRowsById,
  buildSubledgerTypeTransitionPatch,
  buildTaxCategoryOptions,
  createInitialDraftForm,
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
  getFixedAssetCategorySetupIssue,
  getImmediateCashSettlementLabel,
  isDraft,
  isImmediateCashSettlementMode,
  mapCashRegisterLookupOptions,
  mapCounterpartyLookupOption,
  mapFixedAssetCategoryLookupOptions,
  mapFixedAssetLookupOptions,
  mapItemCardLookupOptions,
  mapOperatingUnitLookupOption,
  mapPostableAccountRows,
  mapWarehouseLookupOptions,
  normalizeApiError,
  normalizeChargeAllocationMethod,
  normalizeCurrencyCode,
  normalizeDocumentSettlementMode,
  normalizeOptionalDecimalText,
  normalizeText,
  normalizeTranslatedApiError,
  resetDocumentLineTaxPreview,
  resolveCounterpartyRoleFromDirection,
  toPositiveInt,
  translateDocumentMutationLineErrorMap,
} from "../cariDocumentsPageHelpers.js";
import {
  normalizeLookupQuery,
  prependOrReplaceCounterpartyOption,
} from "../counterpartyInlineCreate.js";

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
  replaceDraftFormLines(setForm, (currentLines) => [
    ...currentLines,
    createDocumentLineDraft(),
  ]);
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
      targetDefaults.find((target) => target.targetRowId === String(targetRowId || "")) ||
      null;
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

export default function useCariDocumentEditController({
  selectedDetail = null,
  selectedSnapshot = null,
  fixedDirection = "",
  fixedAssetCategoryRefreshToken = 0,
  workingContextLegalEntities = [],
  onDocumentUpdated,
  onOpenQuickCreateAsset,
  onOpenInlineFixedAssetCategoryCreate,
  onRequestFixedAssetCategorySetup,
  registerEditBridgeApi,
  translateDocumentMutationError,
  l = (en) => en,
}) {
  void fixedDirection;

  const { hasPermission } = useAuth();
  const canCreate = hasPermission("cari.doc.create");
  const canUpdate = hasPermission("cari.doc.update");
  const canCancel = hasPermission("cari.doc.cancel");
  const canRead = hasPermission("cari.doc.read");
  const canReadCards = hasPermission("cari.card.read");
  const canUpsertCards = hasPermission("cari.card.upsert");
  const canReadCashRegisters = hasPermission("cash.register.read");
  const canReadItemCards = hasPermission("item.card.read");
  const canReadGlAccounts = hasPermission("gl.account.read");
  const canReadOrgTree = hasPermission("org.tree.read");
  const canReadFixedAssets = hasPermission("fixed_assets.read");
  const canUpsertFixedAssets = hasPermission("fixed_assets.upsert");
  const canReadFixedAssetSettings = hasPermission("fixed_assets.settings.read");
  const canUpsertFixedAssetSettings = hasPermission("fixed_assets.settings.upsert");

  const [editForm, setEditForm] = useState(() => createInitialDraftForm());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editValidationVisible, setEditValidationVisible] = useState(false);
  const [_editDueDateTouched, setEditDueDateTouched] = useState(false);
  const [editCounterpartyOptions, setEditCounterpartyOptions] = useState([]);
  const [editCounterpartyLoading, setEditCounterpartyLoading] = useState(false);
  const [editCounterpartyLookupQuery, setEditCounterpartyLookupQuery] = useState("");
  const [editCashRegisterRows, setEditCashRegisterRows] = useState([]);
  const [editCashRegistersLoading, setEditCashRegistersLoading] = useState(false);
  const [editCashRegistersError, setEditCashRegistersError] = useState("");
  const [editOperatingUnitOptions, setEditOperatingUnitOptions] = useState([]);
  const [editOperatingUnitsLoading, setEditOperatingUnitsLoading] = useState(false);
  const [editOperatingUnitsError, setEditOperatingUnitsError] = useState("");
  const [editLineAccountRows, setEditLineAccountRows] = useState([]);
  const [editLineAccountsLoading, setEditLineAccountsLoading] = useState(false);
  const [editLineAccountsError, setEditLineAccountsError] = useState("");
  const [editItemCardRows, setEditItemCardRows] = useState([]);
  const [editItemCardsLoading, setEditItemCardsLoading] = useState(false);
  const [editItemCardsError, setEditItemCardsError] = useState("");
  const [editFixedAssetCategoryRows, setEditFixedAssetCategoryRows] = useState([]);
  const [editFixedAssetCategoriesLoading, setEditFixedAssetCategoriesLoading] =
    useState(false);
  const [editFixedAssetCategoriesError, setEditFixedAssetCategoriesError] =
    useState("");
  const [editFixedAssetDraftRows, setEditFixedAssetDraftRows] = useState([]);
  const [editFixedAssetDraftLoading, setEditFixedAssetDraftLoading] = useState(false);
  const [editFixedAssetDraftError, setEditFixedAssetDraftError] = useState("");
  const [editFixedAssetSaleRows, setEditFixedAssetSaleRows] = useState([]);
  const [editFixedAssetSaleLoading, setEditFixedAssetSaleLoading] = useState(false);
  const [editFixedAssetSaleError, setEditFixedAssetSaleError] = useState("");
  const [editWarehouseRows, setEditWarehouseRows] = useState([]);
  const [editWarehousesLoading, setEditWarehousesLoading] = useState(false);
  const [editWarehousesError, setEditWarehousesError] = useState("");
  const [taxRuleRows, setTaxRuleRows] = useState([]);
  const [taxCategoryLoading, setTaxCategoryLoading] = useState(false);
  const [taxCategoryError, setTaxCategoryError] = useState("");
  const [editLinePreviewLoading, setEditLinePreviewLoading] = useState(false);
  const [editLinePreviewError, setEditLinePreviewError] = useState("");
  const [editLinePreviewMessage, setEditLinePreviewMessage] = useState("");
  const [editInlineCounterpartyModalOpen, setEditInlineCounterpartyModalOpen] =
    useState(false);
  const [editInlineCounterpartyError, setEditInlineCounterpartyError] = useState("");
  const [editInlineCounterpartyMessage, setEditInlineCounterpartyMessage] =
    useState("");

  const activeDocumentId = toPositiveInt(selectedDetail?.id || selectedSnapshot?.id);
  const canEditSelected = Boolean(selectedDetail && isDraft(selectedDetail) && canUpdate);
  const canCancelSelected = Boolean(selectedDetail && isDraft(selectedDetail) && canCancel);

  const fixedAssetCategoryRowsRef = useRef(editFixedAssetCategoryRows);
  const fixedAssetCategoryOptionsRef = useRef([]);
  const fixedAssetCategoriesByIdRef = useRef(new Map());
  const fixedAssetOperatingUnitOptionsRef = useRef([]);

  const legalEntityRowsById = useMemo(
    () =>
      new Map(
        (workingContextLegalEntities || [])
          .map((row) => [toPositiveInt(row?.id), row])
          .filter(([id]) => id)
      ),
    [workingContextLegalEntities]
  );
  const editSelectedLegalEntity = useMemo(
    () => legalEntityRowsById.get(toPositiveInt(editForm.legalEntityId)) || null,
    [editForm.legalEntityId, legalEntityRowsById]
  );
  const editFunctionalCurrencyCode = useMemo(
    () =>
      normalizeCurrencyCode(
        editSelectedLegalEntity?.functional_currency_code ||
          editSelectedLegalEntity?.functionalCurrencyCode
      ),
    [editSelectedLegalEntity]
  );
  const editDocumentMutationOptions = useMemo(
    () => ({
      functionalCurrencyCode: editFunctionalCurrencyCode || null,
    }),
    [editFunctionalCurrencyCode]
  );
  const operatingUnitsById = useMemo(
    () => buildRowsById(editOperatingUnitOptions),
    [editOperatingUnitOptions]
  );
  const editDocumentFxComputation = useMemo(
    () => getDocumentFxComputation(editForm, editDocumentMutationOptions),
    [editDocumentMutationOptions, editForm]
  );
  const editResolvedAmountBaseText = useMemo(() => {
    if (editFunctionalCurrencyCode) {
      return normalizeOptionalDecimalText(editDocumentFxComputation.derivedAmountBase);
    }
    return normalizeOptionalDecimalText(editForm.amountBase);
  }, [
    editDocumentFxComputation.derivedAmountBase,
    editForm.amountBase,
    editFunctionalCurrencyCode,
  ]);
  const editLineAccountOptions = useMemo(
    () => extendAccountOptionsForSelectedLines(editLineAccountRows, editForm.lines),
    [editForm.lines, editLineAccountRows]
  );
  const editItemCardOptions = useMemo(
    () =>
      extendItemCardOptionsForSelectedLines(
        mapItemCardLookupOptions(editItemCardRows),
        editForm.lines
      ),
    [editForm.lines, editItemCardRows]
  );
  const editTaxCategoryOptions = useMemo(
    () => buildTaxCategoryOptions(taxRuleRows, editForm.legalEntityId, editForm.lines),
    [editForm.legalEntityId, editForm.lines, taxRuleRows]
  );
  const editWarehouseRowsById = useMemo(
    () => buildRowsById(editWarehouseRows),
    [editWarehouseRows]
  );
  const editWarehouseOptions = useMemo(
    () =>
      extendWarehouseOptionsForSelectedLines(
        mapWarehouseLookupOptions(editWarehouseRows, l),
        editForm.lines,
        l
      ),
    [editForm.lines, editWarehouseRows, l]
  );
  const editWarehouseValidation = useMemo(
    () =>
      analyzeDocumentWarehouseBindings(editForm, {
        warehouseRowsById: editWarehouseRowsById,
        warehouseLoading: editWarehousesLoading,
        warehouseError: editWarehousesError,
        l,
      }),
    [editForm, editWarehouseRowsById, editWarehousesLoading, editWarehousesError, l]
  );
  const editValidationResult = useMemo(
    () => validateDocumentMutationForm(editForm, editDocumentMutationOptions),
    [editDocumentMutationOptions, editForm]
  );
  const editLineValidationMessages = useMemo(
    () =>
      editValidationVisible
        ? translateDocumentMutationLineErrorMap(
            editValidationResult.lineErrors,
            translateDocumentMutationError
          )
        : new Map(),
    [editValidationResult.lineErrors, editValidationVisible, translateDocumentMutationError]
  );
  const editValidationSummary = useMemo(() => {
    if (!editValidationVisible) {
      return "";
    }
    const messages = [
      ...editValidationResult.generalErrors.map((message) =>
        translateDocumentMutationError(message)
      ),
    ];
    if (editValidationResult.lineErrors.size > 0) {
      messages.push(
        l(
          "Fix the highlighted line validation errors.",
          "Vurgulanan satir dogrulama hatalarini duzeltin."
        )
      );
    }
    return [...new Set(messages.filter(Boolean))].join(" ");
  }, [
    editValidationResult.generalErrors,
    editValidationResult.lineErrors,
    editValidationVisible,
    l,
    translateDocumentMutationError,
  ]);
  const editItemCardRowsById = useMemo(
    () =>
      new Map(
        (Array.isArray(editItemCardRows) ? editItemCardRows : [])
          .map((row) => [Number(row?.id || 0), row])
          .filter(([id]) => id > 0)
      ),
    [editItemCardRows]
  );
  const editLineAccountsById = useMemo(
    () => buildRowsById(editLineAccountOptions),
    [editLineAccountOptions]
  );
  const editFixedAssetCategoriesById = useMemo(
    () => buildRowsById(editFixedAssetCategoryRows),
    [editFixedAssetCategoryRows]
  );
  const editFixedAssetDraftRowsById = useMemo(
    () => buildRowsById(editFixedAssetDraftRows),
    [editFixedAssetDraftRows]
  );
  const editFixedAssetSaleRowsById = useMemo(
    () => buildRowsById(editFixedAssetSaleRows),
    [editFixedAssetSaleRows]
  );
  const editFixedAssetOperatingUnitOptions = useMemo(
    () =>
      (editOperatingUnitOptions || [])
        .map(mapOperatingUnitLookupOption)
        .filter((row) => row.value),
    [editOperatingUnitOptions]
  );
  const editFixedAssetCategoryOptions = useMemo(
    () =>
      extendFixedAssetCategoryOptionsForSelectedLines(
        mapFixedAssetCategoryLookupOptions(
          editFixedAssetCategoryRows,
          editLineAccountsById,
          l
        ),
        editForm.lines
      ),
    [editFixedAssetCategoryRows, editForm.lines, editLineAccountsById, l]
  );
  const editFixedAssetDraftOptions = useMemo(
    () =>
      extendFixedAssetOptionsForSelectedLines(
        mapFixedAssetLookupOptions(editFixedAssetDraftRows, operatingUnitsById, ["DRAFT"]),
        editForm.lines
      ),
    [editFixedAssetDraftRows, editForm.lines, operatingUnitsById]
  );
  const editFixedAssetSaleOptions = useMemo(
    () =>
      extendFixedAssetOptionsForSelectedLines(
        mapFixedAssetLookupOptions(
          editFixedAssetSaleRows,
          operatingUnitsById,
          FIXED_ASSET_AR_ELIGIBLE_STATUSES
        ),
        editForm.lines
      ),
    [editFixedAssetSaleRows, editForm.lines, operatingUnitsById]
  );
  const editFixedAssetImprovementOptions = useMemo(() => {
    const improvementLines = normalizeDocumentFormLines(editForm.lines).filter(
      (line) =>
        line.subledgerType === "FIXED_ASSET" && line.fixedAssetMode === "IMPROVE_EXISTING"
    );
    return extendFixedAssetOptionsForSelectedLines(
      mapFixedAssetLookupOptions(
        editFixedAssetSaleRows,
        operatingUnitsById,
        FIXED_ASSET_AP_IMPROVEMENT_ELIGIBLE_STATUSES
      ),
      improvementLines
    );
  }, [editFixedAssetSaleRows, editForm.lines, operatingUnitsById]);
  const editCounterpartyLookupOptions = useMemo(
    () =>
      (editCounterpartyOptions || [])
        .map(mapCounterpartyLookupOption)
        .filter((row) => row.value),
    [editCounterpartyOptions]
  );
  const editOperatingUnitLookupOptions = useMemo(() => {
    const selectedOperatingUnitId = normalizeText(editForm.operatingUnitId);
    const rows = (editOperatingUnitOptions || [])
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
  }, [editForm.operatingUnitId, editOperatingUnitOptions]);
  const editCashRegisterLookupOptions = useMemo(
    () =>
      extendCashRegisterOptionsForSelectedValue(
        mapCashRegisterLookupOptions(editCashRegisterRows, l),
        editForm.settlementCashRegisterId,
        l
      ),
    [editCashRegisterRows, editForm.settlementCashRegisterId, l]
  );
  const editImmediateCashSelected = isImmediateCashSettlementMode(
    editForm.settlementMode
  );
  const editImmediateCashLabel = getImmediateCashSettlementLabel(editForm.direction, l);
  const editImmediateCashDueDate =
    requiresDueDate(editForm.documentType) &&
    isImmediateCashSettlementMode(editForm.settlementMode)
      ? normalizeText(editForm.documentDate)
      : "";
  const editInlineCounterpartyName = normalizeLookupQuery(editCounterpartyLookupQuery);
  const canInlineCreateCounterpartyInEditForm = Boolean(
    canEditSelected &&
      canReadCards &&
      canUpsertCards &&
      toPositiveInt(editForm.legalEntityId) &&
      editInlineCounterpartyName
  );

  fixedAssetCategoryRowsRef.current = editFixedAssetCategoryRows;
  fixedAssetCategoryOptionsRef.current = editFixedAssetCategoryOptions;
  fixedAssetCategoriesByIdRef.current = editFixedAssetCategoriesById;
  fixedAssetOperatingUnitOptionsRef.current = editFixedAssetOperatingUnitOptions;

  const getQuickCreateLookupContext = useCallback(
    () => ({
      categoryRows: fixedAssetCategoryRowsRef.current,
      categoryOptions: fixedAssetCategoryOptionsRef.current,
      categoriesById: fixedAssetCategoriesByIdRef.current,
      operatingUnitOptions: fixedAssetOperatingUnitOptionsRef.current,
    }),
    []
  );
  const applyQuickCreatedFixedAsset = useCallback((createdAssetRow, modalContext = {}) => {
    const createdAssetId = toPositiveInt(createdAssetRow?.id);
    if (!createdAssetId) {
      return;
    }
    setEditFixedAssetDraftRows((previous) => {
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
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(
      setEditForm,
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
    setEditFixedAssetCategoryRows((current) =>
      current.some((row) => toPositiveInt(row?.id) === normalizedCategoryId)
        ? current.map((row) =>
            toPositiveInt(row?.id) === normalizedCategoryId ? categoryRow : row
          )
        : [categoryRow, ...current]
    );
    if (!modalContext?.rowId) {
      return;
    }
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(setEditForm, modalContext.rowId, {
      fixedAssetCategoryId: String(normalizedCategoryId),
    });
  }, []);

  useEffect(() => {
    if (typeof registerEditBridgeApi !== "function") {
      return undefined;
    }
    const bridgeApi = {
      getQuickCreateLookupContext,
      applyQuickCreatedFixedAsset,
      applyInlineFixedAssetCategory,
    };
    registerEditBridgeApi(bridgeApi);
    return () => {
      registerEditBridgeApi(null);
    };
  }, [
    applyInlineFixedAssetCategory,
    applyQuickCreatedFixedAsset,
    getQuickCreateLookupContext,
    registerEditBridgeApi,
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

  const handleEditDocumentLineTaxPreview = useCallback(
    async (rowId = null) => {
      await runDocumentLineTaxPreview({
        form: editForm,
        setForm: setEditForm,
        setLoading: setEditLinePreviewLoading,
        setError: setEditLinePreviewError,
        setMessage: setEditLinePreviewMessage,
        targetRowId: rowId,
      });
    },
    [editForm, runDocumentLineTaxPreview]
  );

  const addEditDocumentLine = useCallback(() => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    addDraftFormLine(setEditForm);
  }, []);
  const removeEditDocumentLine = useCallback((rowId) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    removeDraftFormLine(setEditForm, rowId);
  }, []);
  const moveEditDocumentLine = useCallback((rowId, directionStep) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    moveDraftFormLine(setEditForm, rowId, directionStep);
  }, []);
  const patchEditDocumentLine = useCallback((rowId, patch) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(setEditForm, rowId, patch);
  }, []);
  const patchEditDocumentLineWithTaxReset = useCallback((rowId, patch) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(setEditForm, rowId, patch, { resetTaxPreview: true });
  }, []);
  const changeEditDocumentLineSubledgerType = useCallback(
    (rowId, nextSubledgerType) => {
      setEditLinePreviewError("");
      setEditLinePreviewMessage("");
      const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
        (row) => row?.rowId === rowId
      );
      if (!currentLine) {
        return;
      }
      patchDraftFormLine(
        setEditForm,
        rowId,
        buildSubledgerTypeTransitionPatch(currentLine, nextSubledgerType, editForm.direction),
        { resetTaxPreview: true }
      );
    },
    [editForm]
  );
  const selectEditDocumentLineItemCard = useCallback(
    (rowId, itemCardId) => {
      setEditLinePreviewError("");
      setEditLinePreviewMessage("");
      const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
        (row) => row?.rowId === rowId
      );
      const selectedItemCard = editItemCardRowsById.get(Number(itemCardId || 0)) || null;
      if (!selectedItemCard) {
        patchDraftFormLine(setEditForm, rowId, {
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
        editForm.direction
      );
      if (!nextPatch) {
        return;
      }
      patchDraftFormLine(setEditForm, rowId, nextPatch, { resetTaxPreview: true });
    },
    [editForm, editItemCardRowsById]
  );
  const selectEditDocumentLineWarehouse = useCallback(
    (rowId, warehouseId) => {
      setEditLinePreviewError("");
      setEditLinePreviewMessage("");
      const selectedWarehouse = editWarehouseRowsById.get(Number(warehouseId || 0)) || null;
      if (!selectedWarehouse) {
        patchDraftFormLine(setEditForm, rowId, {
          warehouseId: "",
          warehouseCode: "",
          warehouseName: "",
        });
        return;
      }
      patchDraftFormLine(setEditForm, rowId, {
        warehouseId: String(toPositiveInt(selectedWarehouse.id) || ""),
        warehouseCode: normalizeText(selectedWarehouse.code),
        warehouseName: normalizeText(selectedWarehouse.name),
      });
    },
    [editWarehouseRowsById]
  );
  const changeEditDocumentLineFixedAssetMode = useCallback(
    (rowId, nextMode) => {
      setEditLinePreviewError("");
      setEditLinePreviewMessage("");
      const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
        (row) => row?.rowId === rowId
      );
      if (!currentLine) {
        return;
      }
      patchDraftFormLine(
        setEditForm,
        rowId,
        buildFixedAssetModeTransitionPatch(currentLine, nextMode, {
          defaultImprovementEffectiveDate: editForm.documentDate,
        }),
        { resetTaxPreview: true }
      );
    },
    [editForm]
  );
  const changeEditDocumentLineChargeAllocationMethod = useCallback((rowId, nextMethod) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    changeDraftFormLineChargeAllocationMethod(setEditForm, rowId, nextMethod);
  }, []);
  const toggleEditDocumentLineChargeTarget = useCallback((rowId, targetRowId) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    toggleDraftFormLineChargeTarget(setEditForm, rowId, targetRowId);
  }, []);
  const patchEditDocumentLineChargeTargetAmount = useCallback(
    (rowId, targetRowId, nextAmount) => {
      setEditLinePreviewError("");
      setEditLinePreviewMessage("");
      patchDraftFormLineChargeTargetAmount(setEditForm, rowId, targetRowId, nextAmount);
    },
    []
  );
  const selectEditDocumentLineFixedAssetCategory = useCallback(
    (rowId, categoryId) => {
      setEditLinePreviewError("");
      setEditLinePreviewMessage("");
      const categorySetupIssue = getFixedAssetCategorySetupIssue(
        categoryId,
        editFixedAssetCategoriesById
      );
      if (categorySetupIssue) {
        const requirementList = formatFixedAssetCategorySetupRequirementList(
          categorySetupIssue.missingRequirements,
          l
        );
        setEditLinePreviewError(
          l(
            `Selected category "${categorySetupIssue.categoryLabel}" is missing required defaults: ${requirementList}. Configure it in Fixed Asset Settings first.`,
            `Secili "${categorySetupIssue.categoryLabel}" kategorisinde gerekli varsayilanlar eksik: ${requirementList}. Once Demirbas Ayarlarinda yapilandirin.`
          )
        );
        onRequestFixedAssetCategorySetup?.(categorySetupIssue);
        return;
      }
      patchDraftFormLine(setEditForm, rowId, {
        fixedAssetCategoryId: categoryId ? String(categoryId) : "",
      });
    },
    [editFixedAssetCategoriesById, l, onRequestFixedAssetCategorySetup]
  );
  const openInlineFixedAssetCategoryCreateForEditForm = useCallback(
    (rowId) => {
      const legalEntityId = toPositiveInt(editForm?.legalEntityId);
      if (!legalEntityId) {
        setEditLinePreviewError(
          l(
            "Select legal entity before creating an asset category.",
            "Varlik kategorisi olusturmadan once tuzel kisilik secin."
          )
        );
        return;
      }
      const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
        (row) => row?.rowId === rowId
      );
      onOpenInlineFixedAssetCategoryCreate?.({
        scope: "edit",
        rowId,
        legalEntityId: String(legalEntityId),
        initialName: normalizeText(currentLine?.description),
      });
    },
    [editForm, l, onOpenInlineFixedAssetCategoryCreate]
  );
  const selectEditDocumentLineTargetFixedAsset = useCallback((rowId, assetId) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(
      setEditForm,
      rowId,
      {
        targetFixedAssetId: assetId ? String(assetId) : "",
        quantity: "1",
      },
      { resetTaxPreview: true }
    );
  }, []);
  const changeEditDocumentLineStockImpactMode = useCallback((rowId, nextMode) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    patchDraftFormLine(
      setEditForm,
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
  const expandEditDocumentLineFixedAsset = useCallback((rowId) => {
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
    replaceDraftFormLines(setEditForm, (currentLines) => {
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
  const openEditQuickCreateFixedAsset = useCallback(
    (rowId) => {
      const currentLine = normalizeDocumentFormLines(editForm?.lines).find(
        (row) => row?.rowId === rowId
      );
      onOpenQuickCreateAsset?.({
        scope: "edit",
        lineRowId: rowId,
        legalEntityId: normalizeText(editForm.legalEntityId),
        documentDate: normalizeText(editForm.documentDate),
        currencyCode: normalizeCurrencyCode(editForm.currencyCode),
        name: normalizeText(currentLine?.description),
        categoryId: normalizeText(currentLine?.fixedAssetCategoryId),
        ownerOperatingUnitId: normalizeText(currentLine?.fixedAssetOwnerOperatingUnitId),
        locationOperatingUnitId: normalizeText(
          currentLine?.fixedAssetLocationOperatingUnitId
        ),
      });
    },
    [editForm, onOpenQuickCreateAsset]
  );
  const handleEditSettlementModeChange = useCallback((nextMode) => {
    const normalizedMode = normalizeDocumentSettlementMode(nextMode);
    setEditForm((previous) => ({
      ...previous,
      settlementMode: normalizedMode,
      settlementCashRegisterId:
        normalizedMode === "IMMEDIATE_CASH" ? previous.settlementCashRegisterId : "",
    }));
    if (normalizedMode === "IMMEDIATE_CASH") {
      setEditDueDateTouched(false);
    }
  }, []);
  const handleEditLegalEntityChange = useCallback((nextValue) => {
    const normalizedLegalEntityId = normalizeText(nextValue);
    setEditForm((previous) => ({
      ...previous,
      legalEntityId: normalizedLegalEntityId,
      operatingUnitId:
        normalizeText(previous.legalEntityId) === normalizedLegalEntityId
          ? previous.operatingUnitId
          : "",
      settlementCashRegisterId:
        normalizeText(previous.legalEntityId) === normalizedLegalEntityId
          ? previous.settlementCashRegisterId
          : "",
    }));
  }, []);
  const handleInlineCreateCounterpartyForEditForm = useCallback(async () => {
    setEditInlineCounterpartyError("");
    setEditInlineCounterpartyMessage("");
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    const name = normalizeLookupQuery(editCounterpartyLookupQuery);
    if (!canUpsertCards) {
      setEditInlineCounterpartyError(
        l("Missing permission: cari.card.upsert", "Eksik yetki: cari.card.upsert")
      );
      return;
    }
    if (!legalEntityId) {
      setEditInlineCounterpartyError(
        l(
          "Select legalEntityId before creating a counterparty.",
          "Cari olusturmadan once legalEntityId secin."
        )
      );
      return;
    }
    if (!name) {
      setEditInlineCounterpartyError(
        l(
          "Type a counterparty name in lookup before creating.",
          "Cari olusturmadan once aramaya cari adini yazin."
        )
      );
      return;
    }
    setEditInlineCounterpartyModalOpen(true);
  }, [canUpsertCards, editCounterpartyLookupQuery, editForm.legalEntityId, l]);
  const handleInlineCounterpartyCreatedForEditForm = useCallback(
    (row) => {
      const counterpartyId = toPositiveInt(row?.id);
      if (!counterpartyId) {
        setEditInlineCounterpartyError(
          l(
            "Counterparty create response is missing row.id.",
            "Cari olusturma yanitinda row.id yok."
          )
        );
        return;
      }
      setEditCounterpartyOptions((prev) => prependOrReplaceCounterpartyOption(prev, row));
      setEditForm((prev) => ({ ...prev, counterpartyId: String(counterpartyId) }));
      setEditCounterpartyLookupQuery("");
      setEditInlineCounterpartyMessage(
        l(
          `Counterparty created and selected. counterpartyId=${counterpartyId}`,
          `Cari olusturuldu ve secildi. counterpartyId=${counterpartyId}`
        )
      );
    },
    [l]
  );
  const handleUpdateDraft = useCallback(
    async (event) => {
      event.preventDefault();
      if (!activeDocumentId || !canEditSelected) {
        setEditError(
          l(
            "Only DRAFT documents can be edited with cari.doc.update permission.",
            "Yalnizca DRAFT belgeler `cari.doc.update` yetkisiyle duzenlenebilir."
          )
        );
        return;
      }
      setEditSaving(true);
      setEditError("");
      setEditMessage("");
      setEditValidationVisible(true);
      try {
        if (editValidationResult.errors.length > 0) {
          return;
        }
        if (editWarehouseValidation.blockingMessages.length > 0) {
          setEditError(editWarehouseValidation.blockingMessages.join(" "));
          return;
        }
        setEditValidationVisible(false);
        const payload = buildDocumentMutationPayload(editForm, editDocumentMutationOptions);
        if (!payload.rowVersion) {
          payload.rowVersion = Number(selectedDetail?.rowVersion || 0) || undefined;
        }
        const response = await updateCariDocument(activeDocumentId, payload);
        const responseRow = response?.row || null;
        setEditMessage(l("Draft document updated.", "Belge taslagi guncellendi."));
        if (responseRow) {
          setEditForm(mapDocumentRowToForm(responseRow));
          setEditDueDateTouched(false);
        }
        onDocumentUpdated?.({
          responseRow,
          refreshList: true,
          refreshDetail: true,
        });
      } catch (error) {
        setEditError(
          normalizeTranslatedApiError(
            error,
            translateDocumentMutationError,
            l("Failed to update draft document.", "Belge taslagi guncellenemedi.")
          )
        );
      } finally {
        setEditSaving(false);
      }
    },
    [
      activeDocumentId,
      canEditSelected,
      editDocumentMutationOptions,
      editForm,
      editValidationResult.errors.length,
      editWarehouseValidation.blockingMessages,
      l,
      onDocumentUpdated,
      selectedDetail,
      translateDocumentMutationError,
    ]
  );

  useEffect(() => {
    if (!selectedDetail || !isDraft(selectedDetail)) {
      return;
    }
    setEditForm(mapDocumentRowToForm(selectedDetail));
    setEditDueDateTouched(false);
    setEditValidationVisible(false);
    setEditLinePreviewError("");
    setEditLinePreviewMessage("");
  }, [selectedDetail]);
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
    if (!editImmediateCashDueDate) {
      return;
    }
    setEditForm((previousForm) =>
      normalizeText(previousForm.dueDate) === editImmediateCashDueDate
        ? previousForm
        : { ...previousForm, dueDate: editImmediateCashDueDate }
    );
  }, [editImmediateCashDueDate]);
  useEffect(() => {
    if (!canReadOrgTree) {
      setEditOperatingUnitOptions([]);
      setEditOperatingUnitsLoading(false);
      setEditOperatingUnitsError("");
      return;
    }
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    if (!legalEntityId) {
      setEditOperatingUnitOptions([]);
      setEditOperatingUnitsLoading(false);
      setEditOperatingUnitsError("");
      return;
    }
    let active = true;
    async function loadEditOperatingUnits() {
      setEditOperatingUnitsLoading(true);
      setEditOperatingUnitsError("");
      try {
        const response = await listOperatingUnits({
          legalEntityId,
          limit: 500,
          includeInactive: true,
        });
        if (!active) {
          return;
        }
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setEditOperatingUnitOptions(rows);
        setEditForm((previousForm) => {
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
        if (!active) {
          return;
        }
        setEditOperatingUnitOptions([]);
        setEditOperatingUnitsError(
          normalizeApiError(
            error,
            l(
              "Failed to load operating units for selected legal entity.",
              "Secili tuzel kisilik icin operasyon birimleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditOperatingUnitsLoading(false);
        }
      }
    }
    loadEditOperatingUnits();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, editForm.legalEntityId, l]);
  useEffect(() => {
    if (!canReadCards) {
      setEditCounterpartyOptions([]);
      setEditCounterpartyLoading(false);
      return;
    }
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    if (!legalEntityId) {
      setEditCounterpartyOptions([]);
      setEditCounterpartyLoading(false);
      return;
    }
    const role = resolveCounterpartyRoleFromDirection(editForm.direction);
    let active = true;
    async function loadEditCounterparties() {
      setEditCounterpartyLoading(true);
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          role,
          status: "ACTIVE",
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (!active) {
          return;
        }
        setEditCounterpartyOptions([]);
      } finally {
        if (active) {
          setEditCounterpartyLoading(false);
        }
      }
    }
    loadEditCounterparties();
    return () => {
      active = false;
    };
  }, [canReadCards, editForm.direction, editForm.legalEntityId]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditCashRegistersError("");
    if (!canReadCashRegisters || !legalEntityId) {
      setEditCashRegisterRows([]);
      setEditCashRegistersLoading(false);
      return;
    }
    let active = true;
    async function loadEditCashRegisters() {
      setEditCashRegistersLoading(true);
      try {
        const response = await listCashRegisters({
          legalEntityId,
          status: "ACTIVE",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditCashRegisterRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditCashRegisterRows([]);
        setEditCashRegistersError(
          normalizeApiError(error, l("Failed to load cash registers.", "Kasalar yuklenemedi."))
        );
      } finally {
        if (active) {
          setEditCashRegistersLoading(false);
        }
      }
    }
    loadEditCashRegisters();
    return () => {
      active = false;
    };
  }, [canReadCashRegisters, editForm.legalEntityId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditLineAccountsError("");
    if (!canReadGlAccounts || !legalEntityId) {
      setEditLineAccountRows([]);
      setEditLineAccountsLoading(false);
      return;
    }
    let active = true;
    async function loadEditLineAccounts() {
      setEditLineAccountsLoading(true);
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
        setEditLineAccountRows(mapPostableAccountRows(response?.rows));
      } catch (error) {
        if (!active) {
          return;
        }
        setEditLineAccountRows([]);
        setEditLineAccountsError(
          normalizeApiError(
            error,
            l(
              "Failed to load edit-line account options.",
              "Duzenleme satir hesap secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditLineAccountsLoading(false);
        }
      }
    }
    loadEditLineAccounts();
    return () => {
      active = false;
    };
  }, [canReadGlAccounts, editForm.legalEntityId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditItemCardsError("");
    if (!canReadItemCards || !legalEntityId) {
      setEditItemCardRows([]);
      setEditItemCardsLoading(false);
      return;
    }
    let active = true;
    async function loadEditItemCards() {
      setEditItemCardsLoading(true);
      try {
        const response = await listItemCards({
          legalEntityId,
          status: "ACTIVE",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditItemCardRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditItemCardRows([]);
        setEditItemCardsError(
          normalizeApiError(
            error,
            l(
              "Failed to load edit-line item card options.",
              "Duzenleme satiri urun karti secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditItemCardsLoading(false);
        }
      }
    }
    loadEditItemCards();
    return () => {
      active = false;
    };
  }, [canReadItemCards, editForm.legalEntityId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditFixedAssetCategoriesError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setEditFixedAssetCategoryRows([]);
      setEditFixedAssetCategoriesLoading(false);
      return;
    }
    let active = true;
    async function loadEditFixedAssetCategories() {
      setEditFixedAssetCategoriesLoading(true);
      try {
        const response = await listFixedAssetCategories({
          legalEntityId,
          status: "ACTIVE",
        });
        if (!active) {
          return;
        }
        setEditFixedAssetCategoryRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditFixedAssetCategoryRows([]);
        setEditFixedAssetCategoriesError(
          normalizeApiError(
            error,
            l("Failed to load fixed asset categories.", "Duran varlik kategorileri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setEditFixedAssetCategoriesLoading(false);
        }
      }
    }
    loadEditFixedAssetCategories();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, editForm.legalEntityId, fixedAssetCategoryRefreshToken, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditFixedAssetDraftError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setEditFixedAssetDraftRows([]);
      setEditFixedAssetDraftLoading(false);
      return;
    }
    let active = true;
    async function loadEditFixedAssetDraftRows() {
      setEditFixedAssetDraftLoading(true);
      try {
        const response = await listFixedAssets({
          legalEntityId,
          status: "DRAFT",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setEditFixedAssetDraftRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditFixedAssetDraftRows([]);
        setEditFixedAssetDraftError(
          normalizeApiError(
            error,
            l("Failed to load draft fixed assets.", "Taslak duran varliklar yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setEditFixedAssetDraftLoading(false);
        }
      }
    }
    loadEditFixedAssetDraftRows();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, editForm.legalEntityId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    setEditFixedAssetSaleError("");
    if (!canReadFixedAssets || !legalEntityId) {
      setEditFixedAssetSaleRows([]);
      setEditFixedAssetSaleLoading(false);
      return;
    }
    let active = true;
    async function loadEditFixedAssetSaleRows() {
      setEditFixedAssetSaleLoading(true);
      try {
        const responses = await Promise.all(
          FIXED_ASSET_AR_ELIGIBLE_STATUSES.map((status) =>
            listFixedAssets({
              legalEntityId,
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
        setEditFixedAssetSaleRows([...merged.values()]);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditFixedAssetSaleRows([]);
        setEditFixedAssetSaleError(
          normalizeApiError(
            error,
            l("Failed to load target fixed assets.", "Hedef duran varliklar yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setEditFixedAssetSaleLoading(false);
        }
      }
    }
    loadEditFixedAssetSaleRows();
    return () => {
      active = false;
    };
  }, [canReadFixedAssets, editForm.legalEntityId, l]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(editForm.legalEntityId);
    const operatingUnitId = toPositiveInt(editForm.operatingUnitId);
    setEditWarehousesError("");
    if (!canRead || !legalEntityId) {
      setEditWarehouseRows([]);
      setEditWarehousesLoading(false);
      return;
    }
    let active = true;
    async function loadEditWarehouses() {
      setEditWarehousesLoading(true);
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
        setEditWarehouseRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEditWarehouseRows([]);
        setEditWarehousesError(
          normalizeApiError(
            error,
            l(
              "Failed to load edit-line warehouse choices.",
              "Duzenleme satiri depo secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setEditWarehousesLoading(false);
        }
      }
    }
    loadEditWarehouses();
    return () => {
      active = false;
    };
  }, [canRead, editForm.legalEntityId, editForm.operatingUnitId, l]);

  return {
    canCreate,
    canReadCards,
    canUpsertCards,
    canReadCashRegisters,
    canReadGlAccounts,
    canReadOrgTree,
    canReadFixedAssetSettings,
    canUpsertFixedAssetSettings,
    canUpsertFixedAssets,
    canEditSelected,
    canCancelSelected,
    editForm,
    setEditForm,
    editSaving,
    editError,
    editMessage,
    editValidationSummary,
    editOperatingUnitLookupOptions,
    editOperatingUnitsLoading,
    editOperatingUnitsError,
    editCounterpartyLookupOptions,
    editCounterpartyLoading,
    editCounterpartyLookupQuery,
    setEditCounterpartyLookupQuery,
    editInlineCounterpartyError,
    editInlineCounterpartyMessage,
    editInlineCounterpartyName,
    canInlineCreateCounterpartyInEditForm,
    setEditInlineCounterpartyError,
    setEditInlineCounterpartyMessage,
    editCashRegisterLookupOptions,
    editCashRegistersLoading,
    editCashRegistersError,
    editImmediateCashSelected,
    editImmediateCashLabel,
    editImmediateCashDueDate,
    editDocumentFxComputation,
    editResolvedAmountBaseText,
    editLineAccountOptions,
    editLineAccountsLoading,
    editLineAccountsError,
    editItemCardOptions,
    editItemCardsLoading,
    editItemCardsError,
    editWarehouseOptions,
    editWarehouseValidation,
    editWarehousesLoading,
    editWarehousesError,
    editLineValidationMessages,
    editTaxCategoryOptions,
    taxCategoryLoading,
    taxCategoryError,
    editLinePreviewLoading,
    editLinePreviewError,
    editLinePreviewMessage,
    editFixedAssetCategoryOptions,
    editFixedAssetCategoriesLoading,
    editFixedAssetCategoriesError,
    editFixedAssetCategoriesById,
    editFixedAssetDraftOptions,
    editFixedAssetDraftLoading,
    editFixedAssetDraftError,
    editFixedAssetDraftRowsById,
    editFixedAssetImprovementOptions,
    editFixedAssetSaleOptions,
    editFixedAssetSaleLoading,
    editFixedAssetSaleError,
    editFixedAssetSaleRowsById,
    editFixedAssetOperatingUnitOptions,
    editFunctionalCurrencyCode,
    DOCUMENT_TYPES,
    normalizeDocumentSettlementMode,
    normalizeOptionalDecimalText,
    requiresDueDate,
    toPositiveInt,
    setEditDueDateTouched,
    handleEditSettlementModeChange,
    handleEditLegalEntityChange,
    handleInlineCreateCounterpartyForEditForm,
    editInlineCounterpartyModalOpen,
    setEditInlineCounterpartyModalOpen,
    handleInlineCounterpartyCreatedForEditForm,
    handleUpdateDraft,
    onAddLine: addEditDocumentLine,
    onRemoveLine: removeEditDocumentLine,
    onMoveLine: moveEditDocumentLine,
    onPatchLine: patchEditDocumentLine,
    onPatchTaxSensitiveLine: patchEditDocumentLineWithTaxReset,
    onChangeSubledgerType: changeEditDocumentLineSubledgerType,
    onChangeFixedAssetMode: changeEditDocumentLineFixedAssetMode,
    onChangeChargeAllocationMethod: changeEditDocumentLineChargeAllocationMethod,
    onToggleChargeTarget: toggleEditDocumentLineChargeTarget,
    onChangeChargeTargetAmount: patchEditDocumentLineChargeTargetAmount,
    onSelectFixedAssetCategory: selectEditDocumentLineFixedAssetCategory,
    onSelectTargetFixedAsset: selectEditDocumentLineTargetFixedAsset,
    onSelectItemCard: selectEditDocumentLineItemCard,
    onChangeStockImpactMode: changeEditDocumentLineStockImpactMode,
    onSelectWarehouse: selectEditDocumentLineWarehouse,
    onExpandFixedAssetLine: expandEditDocumentLineFixedAsset,
    onOpenQuickCreateFixedAsset: openEditQuickCreateFixedAsset,
    onOpenInlineFixedAssetCategoryCreate:
      openInlineFixedAssetCategoryCreateForEditForm,
    onPreviewAll: () => handleEditDocumentLineTaxPreview(),
    onPreviewRow: (rowId) => handleEditDocumentLineTaxPreview(rowId),
  };
}
