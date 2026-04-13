import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listCariDocumentWarehouseOptions,
  postCariDocument,
  reverseCariDocument,
  submitCariDocument,
} from "../../../api/cariDocuments.js";
import { getCariCounterpartyStatementReport } from "../../../api/cariReports.js";
import { listAccounts } from "../../../api/glAdmin.js";
import {
  approveWorkflowInstance,
  getWorkflowInstance,
  rejectWorkflowInstance,
  returnWorkflowInstance,
} from "../../../api/workflows.js";
import { useAuth } from "../../../auth/useAuth.js";
import { useModuleReadiness } from "../../../readiness/useModuleReadiness.js";
import { buildCariWorkflowActionExplainabilityModel } from "../cariWorkflowExplainability.js";
import { mapDocumentRowToForm } from "../cariDocumentsUtils.js";
import {
  amountsMatch,
  analyzeDocumentWarehouseBindings,
  buildInitialPostForm,
  buildRowsById,
  canSubmitDocument,
  canReverseDocument,
  createPostingLineDraft,
  documentUsesStoredLineTaxes,
  extractFixedAssetImprovementGuidanceFromError,
  extractTransferRequiredGuidanceFromError,
  isDocClassWorkflowGoverned,
  isDraft,
  mapPostableAccountRows,
  normalizeApiError,
  normalizeDirection,
  normalizeInventoryReverseBlocks,
  normalizePositiveIntText,
  normalizeText,
  normalizeTranslatedApiError,
  resolveOffsetAccountTypeByDirection,
  todayIsoDate,
  toPositiveDecimal,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";

function addPostFormPostingLine(setPostForm) {
  setPostForm((previous) => {
    const rows = Array.isArray(previous?.postingLines) ? previous.postingLines : [];
    return {
      ...previous,
      postingLines: [...rows, createPostingLineDraft()],
    };
  });
}

function updatePostFormPostingLine(setPostForm, rowId, patch) {
  setPostForm((previous) => {
    const rows = Array.isArray(previous?.postingLines) ? previous.postingLines : [];
    let changed = false;
    const nextRows = rows.map((row) => {
      if (row?.rowId !== rowId) {
        return row;
      }
      changed = true;
      return {
        ...row,
        ...patch,
      };
    });
    if (!changed) {
      return previous;
    }
    return {
      ...previous,
      postingLines: nextRows,
    };
  });
}

function removePostFormPostingLine(setPostForm, rowId) {
  setPostForm((previous) => {
    const rows = Array.isArray(previous?.postingLines) ? previous.postingLines : [];
    if (rows.length <= 1) {
      return previous;
    }
    const nextRows = rows.filter((row) => row?.rowId !== rowId);
    if (nextRows.length === rows.length) {
      return previous;
    }
    return {
      ...previous,
      postingLines: nextRows,
    };
  });
}

/**
 * Hosts the selected-document submit/post/reverse action state so the detail
 * shell can keep workflow and legacy posting affordances in one place.
 */
export default function useCariDocumentPostReverseController({
  selectedSnapshot = null,
  selectedDetailForPosting = null,
  fixedDirection = "",
  onDocumentSubmitted,
  onDocumentPosted,
  onDocumentReversed,
  requestCreatePrefill,
  translateDocumentMutationError,
  onSummaryStateChange,
  l = (en) => en,
}) {
  const { hasPermission } = useAuth();
  const { getModuleRow } = useModuleReadiness();

  const canCreate = hasPermission("cari.doc.create");
  const canRead = hasPermission("cari.doc.read");
  const canSubmit = hasPermission("cari.doc.submit");
  const canPost = hasPermission("cari.doc.post");
  const canReverse = hasPermission("cari.doc.reverse");
  const canFxOverride = hasPermission("cari.fx.override");
  const canReadReports = hasPermission("cari.report.read");
  const canReadGlAccounts = hasPermission("gl.account.read");
  const canApproveWorkflow = hasPermission("approvals.requests.approve");

  const [postForm, setPostForm] = useState(() => buildInitialPostForm());
  const [postOffsetAccountOptions, setPostOffsetAccountOptions] = useState([]);
  const [postOffsetAccountsLoading, setPostOffsetAccountsLoading] = useState(false);
  const [postOffsetAccountsError, setPostOffsetAccountsError] = useState("");
  const [postWarehouseRows, setPostWarehouseRows] = useState([]);
  const [postWarehousesLoading, setPostWarehousesLoading] = useState(false);
  const [postWarehousesError, setPostWarehousesError] = useState("");
  const [submitSaving, setSubmitSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const [postSaving, setPostSaving] = useState(false);
  const [postError, setPostError] = useState("");
  const [postTransferGuidance, setPostTransferGuidance] = useState(null);
  const [postFixedAssetImprovementGuidance, setPostFixedAssetImprovementGuidance] =
    useState(null);
  const [postMessage, setPostMessage] = useState("");
  const [reverseForm, setReverseForm] = useState(() => ({
    reason: l("Manual reversal", "Manuel ters kayit"),
    reversalDate: "",
  }));
  const [reverseSaving, setReverseSaving] = useState(false);
  const [reverseError, setReverseError] = useState("");
  const [reverseMessage, setReverseMessage] = useState("");
  const [reverseResult, setReverseResult] = useState(null);
  const [reverseInventoryBlocks, setReverseInventoryBlocks] = useState([]);
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [approvalMessage, setApprovalMessage] = useState("");
  const [approvalDecisionNote, setApprovalDecisionNote] = useState("");
  const [workflowInstanceDetail, setWorkflowInstanceDetail] = useState(null);
  const [linkedCashRows, setLinkedCashRows] = useState([]);
  const [linkedCashLoading, setLinkedCashLoading] = useState(false);
  const [linkedCashError, setLinkedCashError] = useState("");

  const selectedDocumentId = toPositiveInt(
    selectedDetailForPosting?.id || selectedSnapshot?.id
  );
  const selectedDocumentLegalEntityId = toPositiveInt(
    selectedSnapshot?.legalEntityId || selectedSnapshot?.legal_entity_id
  );
  const selectedDocumentDirection = normalizeDirection(
    selectedSnapshot?.direction ||
      selectedSnapshot?.documentDirection ||
      fixedDirection
  );
  const selectedOffsetAccountType = resolveOffsetAccountTypeByDirection(
    selectedDocumentDirection
  );
  const selectedCariPostingReadiness = useMemo(
    () => getModuleRow("cariPosting", selectedDocumentLegalEntityId),
    [getModuleRow, selectedDocumentLegalEntityId]
  );
  const cariPostingNotReady = Boolean(
    selectedCariPostingReadiness && !selectedCariPostingReadiness.ready
  );
  const selectedDocumentWorkflowGoverned = useMemo(
    () => isDocClassWorkflowGoverned(selectedSnapshot),
    [selectedSnapshot]
  );
  const selectedWorkflowGate = useMemo(
    () => selectedDetailForPosting?.workflowGate || selectedSnapshot?.workflowGate || null,
    [selectedDetailForPosting, selectedSnapshot]
  );
  const selectedWorkflowGateState = normalizeText(
    selectedWorkflowGate?.state
  ).toUpperCase();
  const selectedDocumentStatus = normalizeText(selectedSnapshot?.status).toUpperCase();
  const isApGovernedDocument = Boolean(
    selectedSnapshot &&
      selectedDocumentDirection === "AP" &&
      selectedDocumentWorkflowGoverned
  );
  const selectedDocumentReturned =
    selectedDocumentStatus === "RETURNED";
  const canSubmitSelected = Boolean(
    selectedSnapshot &&
      selectedDocumentDirection === "AP" &&
      selectedDocumentWorkflowGoverned &&
      canSubmitDocument(selectedSnapshot) &&
      canSubmit &&
      Boolean(selectedWorkflowGate?.assignmentResolved)
  );
  const canPostSelected = Boolean(
    selectedSnapshot &&
      canPost &&
      !cariPostingNotReady &&
      (
        selectedDocumentDirection !== "AP" ||
        !selectedDocumentWorkflowGoverned ||
        !selectedWorkflowGate?.assignmentResolved
          ? isDraft(selectedSnapshot)
          : selectedWorkflowGateState === "APPROVED" &&
            String(selectedSnapshot?.status || "").trim().toUpperCase() === "APPROVED"
      )
  );
  const canReverseSelected = Boolean(
    selectedSnapshot && canReverseDocument(selectedSnapshot) && canReverse
  );
  const canApproveSelected = Boolean(
    selectedSnapshot &&
      selectedDocumentDirection === "AP" &&
      selectedDocumentWorkflowGoverned &&
      canApproveWorkflow &&
      selectedWorkflowGateState === "PENDING" &&
      String(selectedSnapshot?.status || "").trim().toUpperCase() === "SUBMITTED" &&
      selectedWorkflowGate?.workflowInstanceId
  );
  const showApprovalActionsSection = Boolean(
    isApGovernedDocument && selectedWorkflowGateState === "PENDING"
  );
  const showSubmitActionsSection = Boolean(
    isApGovernedDocument &&
      (selectedDocumentStatus === "DRAFT" || selectedDocumentStatus === "RETURNED")
  );
  const filteredPostOffsetAccountOptions = useMemo(() => {
    const sourceOptions = Array.isArray(postOffsetAccountOptions)
      ? postOffsetAccountOptions
      : [];
    if (postForm.showAllOffsetAccounts || !selectedOffsetAccountType) {
      return sourceOptions;
    }
    return sourceOptions.filter(
      (row) => String(row?.accountType || "").toUpperCase() === selectedOffsetAccountType
    );
  }, [postForm.showAllOffsetAccounts, postOffsetAccountOptions, selectedOffsetAccountType]);
  const selectedDocumentAmountTxn = toPositiveDecimal(
    selectedSnapshot?.amountTxn ?? selectedSnapshot?.amount_txn
  );
  const selectedDocumentAmountBase = toPositiveDecimal(
    selectedSnapshot?.amountBase ?? selectedSnapshot?.amount_base
  );
  const selectedDocumentPostingRulesReady = !selectedDocumentId || Boolean(
    selectedDetailForPosting
  );
  const selectedDocumentUsesStoredTaxesForPosting = useMemo(
    () => documentUsesStoredLineTaxes(selectedDetailForPosting),
    [selectedDetailForPosting]
  );
  const selectedPostingDraftForm = useMemo(
    () =>
      selectedDetailForPosting ? mapDocumentRowToForm(selectedDetailForPosting) : null,
    [selectedDetailForPosting]
  );
  const selectedPostingWarehouseValidation = useMemo(
    () =>
      analyzeDocumentWarehouseBindings(selectedPostingDraftForm, {
        warehouseRowsById: buildRowsById(postWarehouseRows),
        warehouseLoading: postWarehousesLoading,
        warehouseError: postWarehousesError,
        l,
      }),
    [l, postWarehouseRows, postWarehousesError, postWarehousesLoading, selectedPostingDraftForm]
  );
  const reverseInventoryBlockSummary = useMemo(() => {
    const issueCount = reverseInventoryBlocks.filter(
      (row) => String(row?.inventoryMovementType || "").trim().toUpperCase() === "ISSUE"
    ).length;
    const receiptCount = reverseInventoryBlocks.filter(
      (row) => String(row?.inventoryMovementType || "").trim().toUpperCase() === "RECEIPT"
    ).length;
    const stepMessages = [];
    if (issueCount > 0) {
      stepMessages.push(
        l(
          "Reverse the linked valued issue movement first in Inventory Movements.",
          "Stok Hareketleri ekraninda once bagli degerlenmis cikis hareketini tersleyin."
        )
      );
      stepMessages.push(
        l(
          "If stock still needs to leave after correction, rematerialize the reopened successor pending stock link.",
          "Duzeltmeden sonra stok cikisi hala gerekiyorsa yeniden acilan ardil bekleyen stok baglantisini tekrar yansitin."
        )
      );
    }
    if (receiptCount > 0) {
      stepMessages.push(
        l(
          "Undo the linked materialized receipt only when no later issue chronology still depends on it.",
          "Bagli gerceklestirilmis alimi yalnizca daha sonraki cikis kronolojisi hala buna bagli degilse geri alin."
        )
      );
    }
    if (reverseInventoryBlocks.length > 0) {
      stepMessages.push(
        l(
          "Use the inventory movement links below, then retry the document reverse.",
          "Asagidaki stok hareketi baglantilarini kullanin, sonra belge ters kaydini tekrar deneyin."
        )
      );
    }
    return {
      issueCount,
      receiptCount,
      stepMessages,
    };
  }, [l, reverseInventoryBlocks]);
  const postFormPostingLineSummary = useMemo(() => {
    const rows = Array.isArray(postForm.postingLines) ? postForm.postingLines : [];
    let totalTxn = 0;
    let totalBase = 0;
    let invalidAmountRows = 0;
    for (const row of rows) {
      const lineAmountTxn = toPositiveDecimal(row?.amountTxn);
      const lineAmountBase = toPositiveDecimal(row?.amountBase);
      if (!lineAmountTxn || !lineAmountBase) {
        invalidAmountRows += 1;
      }
      if (lineAmountTxn) {
        totalTxn = Number((totalTxn + lineAmountTxn).toFixed(6));
      }
      if (lineAmountBase) {
        totalBase = Number((totalBase + lineAmountBase).toFixed(6));
      }
    }
    const hasDraftTotals = Boolean(
      selectedDocumentAmountTxn && selectedDocumentAmountBase
    );
    const matchesDraftTotals = Boolean(
      hasDraftTotals &&
        invalidAmountRows === 0 &&
        amountsMatch(totalTxn, selectedDocumentAmountTxn) &&
        amountsMatch(totalBase, selectedDocumentAmountBase)
    );
    return {
      lineCount: rows.length,
      invalidAmountRows,
      totalTxn,
      totalBase,
      hasDraftTotals,
      matchesDraftTotals,
    };
  }, [postForm.postingLines, selectedDocumentAmountBase, selectedDocumentAmountTxn]);
  const postingLinesReadyForSubmit = !postForm.usePostingLines || Boolean(
    postFormPostingLineSummary.lineCount > 0 &&
      postFormPostingLineSummary.hasDraftTotals &&
      postFormPostingLineSummary.invalidAmountRows === 0 &&
      postFormPostingLineSummary.matchesDraftTotals
  );

  useEffect(() => {
    if (typeof onSummaryStateChange !== "function") {
      return;
    }
    onSummaryStateChange({
      reverseResult,
      linkedCashRows,
      linkedCashLoading,
      linkedCashError,
      canReadReports,
    });
  }, [
    canReadReports,
    linkedCashError,
    linkedCashLoading,
    linkedCashRows,
    onSummaryStateChange,
    reverseResult,
  ]);

  useEffect(() => {
    const documentId = selectedDocumentId;
    const legalEntityId = Number(selectedSnapshot?.legalEntityId || 0);
    const counterpartyId = Number(selectedSnapshot?.counterpartyId || 0);
    if (!canReadReports || !documentId || !legalEntityId || !counterpartyId) {
      setLinkedCashRows([]);
      setLinkedCashError("");
      setLinkedCashLoading(false);
      return;
    }

    let active = true;
    async function loadLinkedCashRows() {
      setLinkedCashLoading(true);
      setLinkedCashError("");
      try {
        const payload = await getCariCounterpartyStatementReport({
          legalEntityId,
          counterpartyId,
          asOfDate: todayIsoDate(),
          status: "ALL",
          includeDetails: true,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        const allocationRows = Array.isArray(payload?.allocations?.rows)
          ? payload.allocations.rows
          : [];
        const settlementRows = Array.isArray(payload?.settlements?.rows)
          ? payload.settlements.rows
          : [];
        const settlementIdSet = new Set(
          allocationRows
            .filter((row) => Number(row?.documentId || 0) === documentId)
            .map((row) => Number(row?.settlementBatchId || 0))
            .filter((id) => id > 0)
        );
        const nextLinkedCashRows = settlementRows
          .filter((row) => settlementIdSet.has(Number(row?.settlementBatchId || 0)))
          .map((row) => ({
            settlementBatchId: Number(row?.settlementBatchId || 0) || null,
            settlementNo: row?.settlementNo || null,
            settlementDate: row?.settlementDate || null,
            cashTransactionId: Number(row?.cashTransactionId || 0) || null,
          }));
        setLinkedCashRows(nextLinkedCashRows);
      } catch (error) {
        if (!active) {
          return;
        }
        setLinkedCashRows([]);
        setLinkedCashError(
          normalizeApiError(
            error,
            l(
              "Failed to load linked settlements / cash transactions.",
              "Bagli mahsuplar / nakit hareketleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setLinkedCashLoading(false);
        }
      }
    }

    loadLinkedCashRows();
    return () => {
      active = false;
    };
  }, [
    canReadReports,
    l,
    selectedDocumentId,
    selectedSnapshot?.counterpartyId,
    selectedSnapshot?.legalEntityId,
  ]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(
      selectedDetailForPosting?.legalEntityId || selectedDetailForPosting?.legal_entity_id
    );
    const operatingUnitId = toPositiveInt(
      selectedDetailForPosting?.operatingUnitId || selectedDetailForPosting?.operating_unit_id
    );
    setPostWarehousesError("");
    if (!canRead || !legalEntityId || !selectedDetailForPosting) {
      setPostWarehouseRows([]);
      setPostWarehousesLoading(false);
      return;
    }

    let active = true;
    async function loadPostWarehouses() {
      setPostWarehousesLoading(true);
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
        setPostWarehouseRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setPostWarehouseRows([]);
        setPostWarehousesError(
          normalizeApiError(
            error,
            l(
              "Failed to load posting warehouse choices.",
              "Kayit icin depo secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setPostWarehousesLoading(false);
        }
      }
    }

    loadPostWarehouses();
    return () => {
      active = false;
    };
  }, [canRead, l, selectedDetailForPosting]);

  useEffect(() => {
    setPostOffsetAccountsError("");
    if (!canReadGlAccounts || !selectedDocumentLegalEntityId) {
      setPostOffsetAccountOptions([]);
      setPostOffsetAccountsLoading(false);
      return;
    }

    let active = true;
    async function loadPostOffsetAccounts() {
      setPostOffsetAccountsLoading(true);
      try {
        const response = await listAccounts({
          legalEntityId: selectedDocumentLegalEntityId,
          includeInactive: false,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setPostOffsetAccountOptions(mapPostableAccountRows(response?.rows));
      } catch (error) {
        if (!active) {
          return;
        }
        setPostOffsetAccountOptions([]);
        setPostOffsetAccountsError(
          normalizeApiError(
            error,
            l(
              "Failed to load postable account options.",
              "Kaydedilebilir hesap secenekleri yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setPostOffsetAccountsLoading(false);
        }
      }
    }

    loadPostOffsetAccounts();
    return () => {
      active = false;
    };
  }, [canReadGlAccounts, l, selectedDocumentLegalEntityId]);

  useEffect(() => {
    const availableOptionIds = new Set(
      filteredPostOffsetAccountOptions
        .map((row) => Number(row?.id || 0))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
    setPostForm((previous) => {
      let changed = false;
      let nextOffsetAccountId = previous.offsetAccountId;
      if (nextOffsetAccountId) {
        const exists = availableOptionIds.has(Number(nextOffsetAccountId));
        if (!exists) {
          nextOffsetAccountId = "";
          changed = true;
        }
      }

      const existingLines = Array.isArray(previous.postingLines)
        ? previous.postingLines
        : [];
      const nextPostingLines = existingLines.map((line) => {
        const currentOffsetAccountId = normalizePositiveIntText(line?.offsetAccountId);
        if (!currentOffsetAccountId) {
          return line;
        }
        const exists = availableOptionIds.has(Number(currentOffsetAccountId));
        if (exists) {
          return line;
        }
        changed = true;
        return {
          ...line,
          offsetAccountId: "",
        };
      });

      if (!changed) {
        return previous;
      }
      return {
        ...previous,
        offsetAccountId: nextOffsetAccountId,
        postingLines: nextPostingLines,
      };
    });
  }, [filteredPostOffsetAccountOptions]);

  useEffect(() => {
    const nextInitial = buildInitialPostForm(selectedSnapshot);
    setPostForm((previous) => {
      if (Number(previous?.documentId || 0) === Number(nextInitial.documentId || 0)) {
        return previous;
      }
      return nextInitial;
    });
    setSubmitError("");
    setSubmitMessage("");
    setPostError("");
    setPostMessage("");
    setPostTransferGuidance(null);
    setPostFixedAssetImprovementGuidance(null);
    setApprovalError("");
    setApprovalMessage("");
    setApprovalDecisionNote("");
  }, [selectedDocumentId, selectedSnapshot]);

  useEffect(() => {
    const workflowInstanceId = toPositiveInt(selectedWorkflowGate?.workflowInstanceId);
    let cancelled = false;
    if (!selectedDocumentWorkflowGoverned || !workflowInstanceId) {
      setWorkflowInstanceDetail(null);
      return undefined;
    }
    setWorkflowInstanceDetail((previous) =>
      Number(previous?.id || 0) === workflowInstanceId ? previous : null
    );
    getWorkflowInstance(workflowInstanceId)
      .then((response) => {
        if (!cancelled) {
          setWorkflowInstanceDetail(response?.row || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkflowInstanceDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentWorkflowGoverned, selectedWorkflowGate?.workflowInstanceId]);

  useEffect(() => {
    if (!selectedDocumentUsesStoredTaxesForPosting) {
      return;
    }
    setPostForm((previous) =>
      previous.usePostingLines
        ? {
            ...previous,
            usePostingLines: false,
          }
        : previous
    );
  }, [selectedDocumentUsesStoredTaxesForPosting]);

  useEffect(() => {
    setReverseForm({
      reason: l("Manual reversal", "Manuel ters kayit"),
      reversalDate: "",
    });
    setReverseError("");
    setReverseMessage("");
    setReverseResult(null);
    setReverseInventoryBlocks([]);
  }, [l, selectedDocumentId]);

  const handleAddPostFormPostingLine = useCallback(() => {
    addPostFormPostingLine(setPostForm);
  }, []);
  const handleUpdatePostFormPostingLine = useCallback((rowId, patch) => {
    updatePostFormPostingLine(setPostForm, rowId, patch);
  }, []);
  const handleRemovePostFormPostingLine = useCallback((rowId) => {
    removePostFormPostingLine(setPostForm, rowId);
  }, []);

  const handleSubmitDocument = useCallback(async () => {
    if (!selectedDocumentId || !canSubmitSelected) {
      setSubmitError(
        l(
          "Only governed AP documents in DRAFT or RETURNED can be submitted with cari.doc.submit permission.",
          "Yalnizca yonetime tabi AP belgeleri DRAFT veya RETURNED durumunda `cari.doc.submit` yetkisiyle gonderilebilir."
        )
      );
      return;
    }

    setSubmitSaving(true);
    setSubmitError("");
    setSubmitMessage("");
    try {
      const response = await submitCariDocument(selectedDocumentId);
      const responseRow = response?.row || null;
      setSubmitMessage(
        selectedDocumentReturned
          ? l(
              `Document resubmitted for approval. status=${responseRow?.status || "SUBMITTED"}`,
              `Belge yeniden onaya gonderildi. durum=${responseRow?.status || "SUBMITTED"}`
            )
          : l(
              `Document submitted for approval. status=${responseRow?.status || "SUBMITTED"}`,
              `Belge onay icin gonderildi. durum=${responseRow?.status || "SUBMITTED"}`
            )
      );
      onDocumentSubmitted?.({
        responseRow,
        refreshList: true,
        refreshDetail: true,
      });
    } catch (error) {
      setSubmitError(
        normalizeTranslatedApiError(
          error,
          translateDocumentMutationError,
          l(
            "Failed to submit document for approval.",
            "Belge onay icin gonderilemedi."
          )
        )
      );
    } finally {
      setSubmitSaving(false);
    }
  }, [
    canSubmitSelected,
    l,
    onDocumentSubmitted,
    selectedDocumentId,
    selectedDocumentReturned,
    translateDocumentMutationError,
  ]);

  const handleApproveDocument = useCallback(async () => {
    const instanceId = toPositiveInt(selectedWorkflowGate?.workflowInstanceId);
    if (!instanceId || !canApproveSelected) {
      setApprovalError(
        l(
          "Cannot approve: document is not in a pending workflow state or you lack approvals.requests.approve permission.",
          "Onaylanamaz: belge bekleyen workflow durumunda degil veya approvals.requests.approve yetkiniz yok."
        )
      );
      return;
    }
    setApprovalSaving(true);
    setApprovalError("");
    setApprovalMessage("");
    try {
      await approveWorkflowInstance(instanceId, {
        decisionNote: approvalDecisionNote.trim() || undefined,
      });
      setApprovalMessage(
        l("Document approved successfully.", "Belge basariyla onaylandi.")
      );
      onDocumentSubmitted?.({ refreshList: true, refreshDetail: true });
    } catch (error) {
      setApprovalError(
        normalizeApiError(error, l("Failed to approve document.", "Belge onaylanamadi."))
      );
    } finally {
      setApprovalSaving(false);
    }
  }, [approvalDecisionNote, canApproveSelected, l, onDocumentSubmitted, selectedWorkflowGate]);

  const handleRejectDocument = useCallback(async () => {
    const instanceId = toPositiveInt(selectedWorkflowGate?.workflowInstanceId);
    if (!instanceId || !canApproveSelected) {
      setApprovalError(
        l(
          "Cannot reject: document is not in a pending workflow state or you lack permission.",
          "Reddedilemez: belge bekleyen workflow durumunda degil veya yetkiniz yok."
        )
      );
      return;
    }
    if (!approvalDecisionNote.trim()) {
      setApprovalError(
        l(
          "A decision note is required when rejecting a document.",
          "Belge reddederken karar notu zorunludur."
        )
      );
      return;
    }
    setApprovalSaving(true);
    setApprovalError("");
    setApprovalMessage("");
    try {
      await rejectWorkflowInstance(instanceId, {
        decisionNote: approvalDecisionNote.trim(),
      });
      setApprovalMessage(
        l("Document rejected.", "Belge reddedildi.")
      );
      onDocumentSubmitted?.({ refreshList: true, refreshDetail: true });
    } catch (error) {
      setApprovalError(
        normalizeApiError(error, l("Failed to reject document.", "Belge reddedilemedi."))
      );
    } finally {
      setApprovalSaving(false);
    }
  }, [approvalDecisionNote, canApproveSelected, l, onDocumentSubmitted, selectedWorkflowGate]);

  const handleReturnDocument = useCallback(async () => {
    const instanceId = toPositiveInt(selectedWorkflowGate?.workflowInstanceId);
    if (!instanceId || !canApproveSelected) {
      setApprovalError(
        l(
          "Cannot return: document is not in a pending workflow state or you lack permission.",
          "Iade edilemez: belge bekleyen workflow durumunda degil veya yetkiniz yok."
        )
      );
      return;
    }
    if (!approvalDecisionNote.trim()) {
      setApprovalError(
        l(
          "A decision note is required when returning a document for correction.",
          "Belge duzeltme icin iade ederken karar notu zorunludur."
        )
      );
      return;
    }
    setApprovalSaving(true);
    setApprovalError("");
    setApprovalMessage("");
    try {
      await returnWorkflowInstance(instanceId, {
        decisionNote: approvalDecisionNote.trim(),
      });
      setApprovalMessage(
        l("Document returned for correction.", "Belge duzeltme icin iade edildi.")
      );
      onDocumentSubmitted?.({ refreshList: true, refreshDetail: true });
    } catch (error) {
      setApprovalError(
        normalizeApiError(error, l("Failed to return document.", "Belge iade edilemedi."))
      );
    } finally {
      setApprovalSaving(false);
    }
  }, [approvalDecisionNote, canApproveSelected, l, onDocumentSubmitted, selectedWorkflowGate]);

  const handlePostDraft = useCallback(async () => {
    setPostTransferGuidance(null);
    setPostFixedAssetImprovementGuidance(null);
    if (cariPostingNotReady) {
      setPostError(
        l(
          "Setup incomplete for selected legal entity. Configure CARI purpose mappings in GL Setup first.",
          "Secili tuzel kisilik icin kurulum eksik. Once GL Ayarlari altinda CARI amac eslemelerini tamamlayin."
        )
      );
      return;
    }
    if (!selectedDocumentId || !canPostSelected) {
      const workflowGateMessage = normalizeText(selectedWorkflowGate?.message);
      if (
        selectedDocumentDirection === "AP" &&
        selectedDocumentWorkflowGoverned &&
        workflowGateMessage
      ) {
        setPostError(workflowGateMessage);
        return;
      }
      setPostError(
        l(
          "The selected document is not postable from its current lifecycle state with cari.doc.post permission.",
          "Secili belge mevcut yasam dongusu durumundan `cari.doc.post` yetkisiyle kayda alinamaz."
        )
      );
      return;
    }
    if (!selectedDetailForPosting) {
      setPostError(
        l(
          "Authoritative document detail is still loading. Wait a moment and try posting again.",
          "Yetkili belge detayi halen yukleniyor. Biraz bekleyip tekrar kayda alin."
        )
      );
      return;
    }
    if (
      selectedDocumentDirection === "AP" &&
      selectedDocumentWorkflowGoverned &&
      selectedWorkflowGate?.assignmentResolved &&
      selectedWorkflowGateState !== "APPROVED"
    ) {
      setPostError(
        normalizeText(selectedWorkflowGate?.message) ||
          l(
            "Workflow approval is required before posting.",
            "Kayit oncesi workflow onayi gerekir."
          )
      );
      return;
    }
    if (selectedPostingWarehouseValidation.blockingMessages.length > 0) {
      setPostError(selectedPostingWarehouseValidation.blockingMessages.join(" "));
      return;
    }
    if (postForm.useFxOverride && !canFxOverride) {
      setPostError(
        l(
          "FX override requires permission: cari.fx.override. Disable override or request access.",
          "Kur gecersiz kilma icin `cari.fx.override` yetkisi gerekir. Gecersiz kilmayi kapatin veya erisim isteyin."
        )
      );
      return;
    }
    if (postForm.useFxOverride && !String(postForm.fxOverrideReason || "").trim()) {
      setPostError(
        l(
          "fxOverrideReason is required when useFxOverride=true.",
          "useFxOverride=true iken fxOverrideReason zorunludur."
        )
      );
      return;
    }

    const payload = {
      useFxOverride: Boolean(postForm.useFxOverride),
      fxOverrideReason: postForm.useFxOverride
        ? String(postForm.fxOverrideReason || "").trim()
        : null,
      offsetAccountId: toPositiveInt(postForm.offsetAccountId) || null,
    };

    if (selectedDocumentUsesStoredTaxesForPosting && postForm.usePostingLines) {
      setPostError(
        l(
          "Split posting is not available for drafts that already store line-level taxes.",
          "Satir bazli vergisi kayitli taslaklarda bolunmus kayit kullanilamaz."
        )
      );
      return;
    }

    if (postForm.usePostingLines) {
      if (!selectedDocumentAmountTxn || !selectedDocumentAmountBase) {
        setPostError(
          l(
            "Selected draft amountTxn/amountBase is invalid. Re-open the draft and try again.",
            "Secili taslak amountTxn/amountBase gecersiz. Taslagi yeniden acip tekrar deneyin."
          )
        );
        return;
      }
      const sourceLines = Array.isArray(postForm.postingLines)
        ? postForm.postingLines
        : [];
      if (sourceLines.length === 0) {
        setPostError(
          l("Add at least one posting line.", "En az bir kayit satiri ekleyin.")
        );
        return;
      }

      let totalTxn = 0;
      let totalBase = 0;
      const postingLines = [];
      for (let index = 0; index < sourceLines.length; index += 1) {
        const line = sourceLines[index] || {};
        const lineAmountTxn = toPositiveDecimal(line.amountTxn);
        const lineAmountBase = toPositiveDecimal(line.amountBase);
        if (!lineAmountTxn || !lineAmountBase) {
          setPostError(
            l(
              `Line ${index + 1}: amountTxn and amountBase must be greater than 0.`,
              `Satir ${index + 1}: amountTxn ve amountBase 0'dan buyuk olmali.`
            )
          );
          return;
        }

        const lineOffsetAccountRaw = normalizeText(line.offsetAccountId);
        const lineOffsetAccountId = lineOffsetAccountRaw
          ? toPositiveInt(lineOffsetAccountRaw)
          : null;
        if (lineOffsetAccountRaw && !lineOffsetAccountId) {
          setPostError(
            l(
              `Line ${index + 1}: offset account is invalid.`,
              `Satir ${index + 1}: karsi hesap gecersiz.`
            )
          );
          return;
        }

        totalTxn = Number((totalTxn + lineAmountTxn).toFixed(6));
        totalBase = Number((totalBase + lineAmountBase).toFixed(6));
        postingLines.push({
          amountTxn: lineAmountTxn,
          amountBase: lineAmountBase,
          offsetAccountId: lineOffsetAccountId || null,
          description: normalizeText(line.description).slice(0, 255) || null,
        });
      }

      if (
        !amountsMatch(totalTxn, selectedDocumentAmountTxn) ||
        !amountsMatch(totalBase, selectedDocumentAmountBase)
      ) {
        setPostError(
          l(
            `Line totals must match draft totals. Draft txn/base: ${selectedDocumentAmountTxn} / ${selectedDocumentAmountBase}. Entered txn/base: ${totalTxn} / ${totalBase}.`,
            `Satir toplamlari taslak toplamlariyla eslesmelidir. Taslak txn/base: ${selectedDocumentAmountTxn} / ${selectedDocumentAmountBase}. Girilen txn/base: ${totalTxn} / ${totalBase}.`
          )
        );
        return;
      }

      payload.postingLines = postingLines;
    }

    setPostSaving(true);
    setPostError("");
    setPostTransferGuidance(null);
    setPostFixedAssetImprovementGuidance(null);
    setPostMessage("");
    try {
      const response = await postCariDocument(selectedDocumentId, payload);
      const responseRow = response?.row || null;
      setPostMessage(
        l(
          `Draft posted. postedJournalEntryId=${responseRow?.postedJournalEntryId || response?.journal?.journalEntryId || "-"}`,
          `Taslak kayda alindi. postedJournalEntryId=${responseRow?.postedJournalEntryId || response?.journal?.journalEntryId || "-"}`
        )
      );
      setPostTransferGuidance(null);
      setPostFixedAssetImprovementGuidance(null);
      onDocumentPosted?.({
        responseRow,
        refreshList: true,
        refreshDetail: true,
      });
    } catch (error) {
      setPostTransferGuidance(extractTransferRequiredGuidanceFromError(error));
      setPostFixedAssetImprovementGuidance(
        extractFixedAssetImprovementGuidanceFromError(error)
      );
      setPostError(
        normalizeTranslatedApiError(
          error,
          translateDocumentMutationError,
          l("Failed to post draft document.", "Belge taslagi kayda alinamadi.")
        )
      );
    } finally {
      setPostSaving(false);
    }
  }, [
    canFxOverride,
    canPostSelected,
    cariPostingNotReady,
    l,
    onDocumentPosted,
    postForm,
    selectedDetailForPosting,
    selectedDocumentAmountBase,
    selectedDocumentAmountTxn,
    selectedDocumentDirection,
    selectedDocumentId,
    selectedDocumentWorkflowGoverned,
    selectedDocumentUsesStoredTaxesForPosting,
    selectedPostingWarehouseValidation.blockingMessages,
    selectedWorkflowGate,
    selectedWorkflowGateState,
    translateDocumentMutationError,
  ]);

  const handleReversePosted = useCallback(async () => {
    if (!selectedDocumentId || !canReverseSelected) {
      setReverseError(
        l(
          "Only POSTED documents or immediate-cash SETTLED documents can be reversed with cari.doc.reverse permission.",
          "Yalnizca POSTED belgeler veya IMMEDIATE_CASH SETTLED belgeler `cari.doc.reverse` yetkisiyle terslenebilir."
        )
      );
      return;
    }
    if (!selectedDetailForPosting) {
      setReverseError(
        l(
          "Authoritative document detail is still loading. Wait a moment and try reversing again.",
          "Yetkili belge detayi halen yukleniyor. Biraz bekleyip tekrar ters kayit deneyin."
        )
      );
      return;
    }
    setReverseSaving(true);
    setReverseError("");
    setReverseMessage("");
    setReverseInventoryBlocks([]);
    try {
      const response = await reverseCariDocument(selectedDocumentId, {
        reason:
          String(reverseForm.reason || "").trim() ||
          l("Manual reversal", "Manuel ters kayit"),
        reversalDate: String(reverseForm.reversalDate || "").trim() || undefined,
      });
      setReverseResult({
        reversalDocumentId: response?.row?.id || null,
        reversalDocumentNo: response?.row?.documentNo || null,
        reversalJournalEntryId: response?.journal?.reversalJournalEntryId || null,
      });
      setReverseMessage(
        l(
          `Reverse completed. reversalDocumentId=${response?.row?.id || "-"}`,
          `Ters kayit tamamlandi. reversalDocumentId=${response?.row?.id || "-"}`
        )
      );
      setReverseInventoryBlocks([]);
      onDocumentReversed?.({
        originalRow: response?.original || null,
        reversalRow: response?.row || null,
        refreshList: true,
        refreshDetail: true,
      });
    } catch (error) {
      setReverseInventoryBlocks(normalizeInventoryReverseBlocks(error));
      setReverseError(
        normalizeApiError(error, l("Failed to reverse document.", "Belge terslenemedi."))
      );
    } finally {
      setReverseSaving(false);
    }
  }, [
    canReverseSelected,
    l,
    onDocumentReversed,
    reverseForm.reason,
    reverseForm.reversalDate,
    selectedDetailForPosting,
    selectedDocumentId,
  ]);

  const handleReverseAndCopyPosted = useCallback(async () => {
    if (!selectedDocumentId || !canReverseSelected || !canCreate) {
      setReverseError(
        l(
          "Reverse + copy requires both cari.doc.reverse and cari.doc.create permissions.",
          "Tersle + kopyala icin hem cari.doc.reverse hem de cari.doc.create yetkisi gerekir."
        )
      );
      return;
    }
    if (!selectedDetailForPosting) {
      setReverseError(
        l(
          "Authoritative document detail is still loading. Wait a moment and try reverse + copy again.",
          "Yetkili belge detayi halen yukleniyor. Biraz bekleyip tekrar tersle + kopyala deneyin."
        )
      );
      return;
    }
    setReverseSaving(true);
    setReverseError("");
    setReverseMessage("");
    setReverseInventoryBlocks([]);
    try {
      const sourceRow = selectedDetailForPosting || selectedSnapshot;
      const response = await reverseCariDocument(selectedDocumentId, {
        reason:
          String(reverseForm.reason || "").trim() ||
          l("Manual reversal", "Manuel ters kayit"),
        reversalDate: String(reverseForm.reversalDate || "").trim() || undefined,
      });
      setReverseResult({
        reversalDocumentId: response?.row?.id || null,
        reversalDocumentNo: response?.row?.documentNo || null,
        reversalJournalEntryId: response?.journal?.reversalJournalEntryId || null,
      });
      setReverseMessage(
        l(
          `Reverse completed. reversalDocumentId=${response?.row?.id || "-"}`,
          `Ters kayit tamamlandi. reversalDocumentId=${response?.row?.id || "-"}`
        )
      );
      setReverseInventoryBlocks([]);
      onDocumentReversed?.({
        originalRow: response?.original || null,
        reversalRow: response?.row || null,
        refreshList: true,
        refreshDetail: true,
      });
      requestCreatePrefill?.(sourceRow, {
        preserveSourceDocumentDate: true,
        treatDueDateAsDerived: true,
        message: l(
          `Correction draft copied from reversed document id=${sourceRow?.id || "-"}.`,
          `Duzeltme taslagi terslenen belge id=${sourceRow?.id || "-"} kaydindan kopyalandi.`
        ),
      });
    } catch (error) {
      setReverseInventoryBlocks(normalizeInventoryReverseBlocks(error));
      setReverseError(
        normalizeApiError(
          error,
          l("Failed to reverse and copy document.", "Belge terslenip kopyalanamadi.")
        )
      );
    } finally {
      setReverseSaving(false);
    }
  }, [
    canCreate,
    canReverseSelected,
    l,
    onDocumentReversed,
    requestCreatePrefill,
    reverseForm.reason,
    reverseForm.reversalDate,
    selectedDetailForPosting,
    selectedDocumentId,
    selectedSnapshot,
  ]);

  const workflowExplanation = useMemo(() => {
    return buildCariWorkflowActionExplainabilityModel({
      row: selectedSnapshot,
      workflowInstance: workflowInstanceDetail,
      canReadSelected: canRead,
      canSubmitSelected,
      canApproveSelected,
      canApproveWorkflow,
      canPostSelected,
      l,
    });
  }, [
    canApproveSelected,
    canApproveWorkflow,
    canPostSelected,
    canSubmitSelected,
    canRead,
    l,
    selectedSnapshot,
    workflowInstanceDetail,
  ]);

  const approvalActionDisabledReason = useMemo(() => {
    if (!showApprovalActionsSection || canApproveSelected) {
      return "";
    }
    if (approvalSaving) {
      return l(
        "Approval decision is already being processed.",
        "Onay karari zaten isleniyor."
      );
    }
    if (!canRead) {
      return l(
        "You cannot review this document because you do not have document visibility.",
        "Belge goruntuleme yetkiniz olmadigi icin bu belgeyi inceleyemezsiniz."
      );
    }
    if (workflowExplanation?.requiredPackageLabel && workflowExplanation?.requiredScopeType) {
      return l(
        `You can view this document but cannot approve it because ${workflowExplanation.requiredPackageLabel} is required at ${workflowExplanation.requiredScopeType} scope.`,
        `Bu belgeyi goruntuleyebilirsiniz ancak onaylayamazsiniz; cunku ${workflowExplanation.requiredScopeType} kapsaminda ${workflowExplanation.requiredPackageLabel} gerekir.`
      );
    }
    if (!canApproveWorkflow) {
      return l(
        "You can view this document but cannot approve it from your current access scope.",
        "Bu belgeyi goruntuleyebilirsiniz ancak mevcut erisim kapsaminizla onaylayamazsiniz."
      );
    }
    return l(
      "This approval step is not currently actionable for your access context.",
      "Bu onay adimi mevcut erisim baglaminiz icin su anda uygulanabilir degil."
    );
  }, [
    approvalSaving,
    canApproveSelected,
    canApproveWorkflow,
    canRead,
    l,
    showApprovalActionsSection,
    workflowExplanation?.requiredPackageLabel,
    workflowExplanation?.requiredScopeType,
  ]);

  const submitActionDisabledReason = useMemo(() => {
    if (!showSubmitActionsSection || canSubmitSelected) {
      return "";
    }
    if (submitSaving) {
      return l(
        "Submit is already being processed.",
        "Gonderim zaten isleniyor."
      );
    }
    if (!canRead) {
      return l(
        "You cannot submit because this document is not visible to your current access context.",
        "Bu belge mevcut erisim baglaminizda gorunur olmadigi icin gonderemezsiniz."
      );
    }
    if (!canSubmit) {
      return l(
        "You can view this document but cannot submit it because `cari.doc.submit` is missing.",
        "Bu belgeyi goruntuleyebilirsiniz ancak `cari.doc.submit` eksik oldugu icin gonderemezsiniz."
      );
    }
    if (!selectedWorkflowGate?.assignmentResolved) {
      return l(
        "Submit is disabled because no active workflow assignment exists for this document scope.",
        "Bu belge kapsami icin aktif workflow atamasi olmadigindan gonderim kapali."
      );
    }
    return l(
      "Only governed AP drafts or returned documents can be submitted.",
      "Yalnizca yonetime tabi AP taslaklari veya iade edilen belgeler gonderilebilir."
    );
  }, [
    canRead,
    canSubmit,
    canSubmitSelected,
    l,
    selectedWorkflowGate?.assignmentResolved,
    showSubmitActionsSection,
    submitSaving,
  ]);

  const postActionDisabledReason = useMemo(() => {
    if (canPostSelected && postingLinesReadyForSubmit) {
      return "";
    }
    if (postSaving) {
      return l(
        "Posting is already being processed.",
        "Kayit islemi zaten isleniyor."
      );
    }
    if (!canRead) {
      return l(
        "You cannot post because this document is not visible to your current access context.",
        "Bu belge mevcut erisim baglaminizda gorunur olmadigi icin kaydedemezsiniz."
      );
    }
    if (isApGovernedDocument && workflowExplanation?.requiredPackageLabel && workflowExplanation?.requiredScopeType) {
      if (selectedWorkflowGateState === "PENDING") {
        return l(
          `You can view this document but cannot post it because it is waiting for ${workflowExplanation.requiredPackageLabel} at ${workflowExplanation.requiredScopeType} scope.`,
          `Bu belgeyi goruntuleyebilirsiniz ancak kaydedemezsiniz; cunku ${workflowExplanation.requiredScopeType} kapsaminda ${workflowExplanation.requiredPackageLabel} bekleniyor.`
        );
      }
      if (selectedWorkflowGateState === "BLOCKED") {
        if (String(selectedWorkflowGate?.currentActionCode || "").trim().toUpperCase() === "DRAFT") {
          return l(
            "You cannot post because the document is still in its draft step.",
            "Belge hala taslak adiminda oldugu icin kaydedemezsiniz."
          );
        }
        return l(
          "You cannot post because the submission step is still pending.",
          "Gonderim adimi halen bekledigi icin kaydedemezsiniz."
        );
      }
      if (selectedWorkflowGateState === "RETURNED") {
        return l(
          "You cannot post while the document is returned for correction. Resubmit it after the correction is complete.",
          "Belge duzeltme icin iade edildigi surece kaydedemezsiniz. Duzeltme tamamlaninca yeniden gonderin."
        );
      }
      if (selectedWorkflowGateState === "APPROVED" && !canPost) {
        return l(
          `You can view this document but cannot post it because ${workflowExplanation.requiredPackageLabel} is required at ${workflowExplanation.requiredScopeType} scope.`,
          `Bu belgeyi goruntuleyebilirsiniz ancak kaydedemezsiniz; cunku ${workflowExplanation.requiredScopeType} kapsaminda ${workflowExplanation.requiredPackageLabel} gerekir.`
        );
      }
    }
    if (cariPostingNotReady) {
      return l(
        `Posting is disabled until CARI setup is completed for legalEntityId=${selectedDocumentLegalEntityId}.`,
        `legalEntityId=${selectedDocumentLegalEntityId} icin CARI kurulumu tamamlanana kadar kayit kapali.`
      );
    }
    if (!canPost) {
      return l(
        "You do not have posting authority for this document.",
        "Bu belge icin kayit yetkiniz yok."
      );
    }
    if (!postingLinesReadyForSubmit) {
      return l(
        "Posting line totals must be valid and match the draft totals before posting.",
        "Kayit oncesinde kayit satiri toplamlari gecerli olmali ve taslak toplamlariyla eslesmelidir."
      );
    }
    if (selectedDocumentStatus === "POSTED") {
      return l(
        "This document is already posted.",
        "Bu belge zaten kaydedildi."
      );
    }
    return l(
      "This document cannot be posted in its current status.",
      "Bu belge mevcut durumunda kaydedilemez."
    );
  }, [
    canPost,
    canPostSelected,
    canRead,
    cariPostingNotReady,
    isApGovernedDocument,
    l,
    postSaving,
    postingLinesReadyForSubmit,
    selectedDocumentLegalEntityId,
    selectedDocumentStatus,
    selectedWorkflowGate?.currentActionCode,
    selectedWorkflowGateState,
    workflowExplanation?.requiredPackageLabel,
    workflowExplanation?.requiredScopeType,
  ]);

  return {
    approvalDecisionNote,
    approvalActionDisabledReason,
    approvalError,
    approvalMessage,
    approvalSaving,
    canApproveSelected,
    canCreate,
    canFxOverride,
    canSubmitSelected,
    canPostSelected,
    canReadGlAccounts,
    canReverseSelected,
    cariPostingNotReady,
    filteredPostOffsetAccountOptions,
    handleAddPostFormPostingLine,
    handleApproveDocument,
    handleRejectDocument,
    handleReturnDocument,
    handleSubmitDocument,
    handlePostDraft,
    handleRemovePostFormPostingLine,
    handleReverseAndCopyPosted,
    handleReversePosted,
    handleUpdatePostFormPostingLine,
    postError,
    postFixedAssetImprovementGuidance,
    postForm,
    postFormPostingLineSummary,
    postMessage,
    postOffsetAccountsError,
    postOffsetAccountsLoading,
    postSaving,
    postTransferGuidance,
    postingLinesReadyForSubmit,
    submitError,
    submitMessage,
    submitSaving,
    reverseError,
    reverseForm,
    reverseInventoryBlockSummary,
    reverseInventoryBlocks,
    reverseMessage,
    reverseSaving,
    selectedCariPostingReadiness,
    selectedDocumentStatus,
    selectedDocumentAmountBase,
    selectedDocumentAmountTxn,
    selectedDocumentDirection,
    selectedDocumentId,
    selectedDocumentLegalEntityId,
    showApprovalActionsSection,
    showSubmitActionsSection,
    submitActionDisabledReason,
    selectedWorkflowGate,
    selectedWorkflowGateState,
    workflowExplanation,
    postActionDisabledReason,
    selectedDocumentPostingRulesReady,
    selectedDocumentUsesStoredTaxesForPosting,
    selectedOffsetAccountType,
    setApprovalDecisionNote,
    setPostForm,
    setReverseForm,
  };
}
