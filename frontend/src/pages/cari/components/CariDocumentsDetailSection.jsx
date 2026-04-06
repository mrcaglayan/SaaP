import { useCallback, useMemo, useState } from "react";
import {
  buildLifecycleTimelineSteps,
  getLifecycleAllowedActions,
  getLifecycleStatusMeta,
} from "../../../lifecycle/lifecycleRules.js";
import {
  buildDocumentLifecycleEvents,
  normalizeCurrencyCode,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";
import CariDocumentCommentsPanel from "./CariDocumentCommentsPanel.jsx";
import CariDocumentDetailContent from "./CariDocumentDetailContent.jsx";
import CariDocumentEditPanel from "./CariDocumentEditPanel.jsx";
import CariDocumentEvidencePanel from "./CariDocumentEvidencePanel.jsx";
import CariDocumentOpsStatusPanel from "./CariDocumentOpsStatusPanel.jsx";
import CariDocumentPostReversePanel from "./CariDocumentPostReversePanel.jsx";
import CariDocumentRelatedPanel from "./CariDocumentRelatedPanel.jsx";
import useCariDocumentDetailController from "../hooks/useCariDocumentDetailController.js";

/**
 * Hosts the selected-document detail shell plus child action and side-panel domains.
 */
export default function CariDocumentsDetailSection({
  selectedDocumentId = null,
  detailRefreshToken = 0,
  selectedSnapshot: shellSelectedSnapshot = null,
  canRead = false,
  canReadFixedAssets = false,
  workingContextLegalEntities = [],
  l,
  onDetailStateChange,
  registerDetailBridgeApi,
  fixedDirection = "",
  fixedAssetCategoryRefreshToken = 0,
  onDocumentUpdated,
  onDocumentSubmitted,
  onDocumentPosted,
  onDocumentReversed,
  onCancelDraft,
  onCancelAndCopyDraft,
  cancelSaving = false,
  cancelError = "",
  requestCreatePrefill,
  onOpenQuickCreateAsset,
  onOpenInlineFixedAssetCategoryCreate,
  onRequestFixedAssetCategorySetup,
  registerEditBridgeApi,
  translateDocumentMutationError,
  canCopySelectedToDraft = false,
  onCopySelectedDocumentToCreateForm,
}) {
  const controller = useCariDocumentDetailController({
    selectedDocumentId,
    detailRefreshToken,
    selectedSnapshot: shellSelectedSnapshot,
    canRead,
    canReadFixedAssets,
    l,
    onDetailStateChange,
    registerDetailBridgeApi,
  });
  const {
    selectedDetail,
    selectedDetailForPosting,
    selectedSnapshot,
    detailLoading,
    detailError,
    detailFixedAssetRowsById,
  } = controller;
  const [postReverseSummaryState, setPostReverseSummaryState] = useState({
    documentId: toPositiveInt(selectedDocumentId),
    reverseResult: null,
    linkedCashRows: [],
    linkedCashLoading: false,
    linkedCashError: "",
    canReadReports: false,
  });

  const handlePostReverseSummaryStateChange = useCallback((nextState = {}) => {
    setPostReverseSummaryState({
      documentId: toPositiveInt(selectedDocumentId),
      reverseResult: nextState?.reverseResult || null,
      linkedCashRows: Array.isArray(nextState?.linkedCashRows)
        ? nextState.linkedCashRows
        : [],
      linkedCashLoading: Boolean(nextState?.linkedCashLoading),
      linkedCashError: String(nextState?.linkedCashError || ""),
      canReadReports: Boolean(nextState?.canReadReports),
    });
  }, [selectedDocumentId]);
  const activePostReverseSummaryState =
    postReverseSummaryState.documentId === toPositiveInt(selectedDocumentId)
      ? postReverseSummaryState
      : {
          reverseResult: null,
          linkedCashRows: [],
          linkedCashLoading: false,
          linkedCashError: "",
          canReadReports: false,
        };

  const legalEntityRowsById = useMemo(
    () =>
      new Map(
        (workingContextLegalEntities || [])
          .map((row) => [toPositiveInt(row?.id), row])
          .filter(([id]) => id)
      ),
    [workingContextLegalEntities]
  );
  const selectedDocumentLegalEntityId = toPositiveInt(
    selectedSnapshot?.legalEntityId || selectedSnapshot?.legal_entity_id
  );
  const selectedDocumentLegalEntity = useMemo(
    () => legalEntityRowsById.get(selectedDocumentLegalEntityId) || null,
    [legalEntityRowsById, selectedDocumentLegalEntityId]
  );
  const selectedDocumentFunctionalCurrencyCode = useMemo(
    () =>
      normalizeCurrencyCode(
        selectedDocumentLegalEntity?.functional_currency_code ||
          selectedDocumentLegalEntity?.functionalCurrencyCode
      ),
    [selectedDocumentLegalEntity]
  );
  const selectedDocumentLifecycleMeta = useMemo(
    () => getLifecycleStatusMeta("cariDocument", selectedSnapshot?.status, l),
    [l, selectedSnapshot?.status]
  );
  const selectedDocumentLifecycleActions = useMemo(
    () => getLifecycleAllowedActions("cariDocument", selectedSnapshot?.status, l),
    [l, selectedSnapshot?.status]
  );
  const selectedDocumentLifecycleTimeline = useMemo(
    () =>
      buildLifecycleTimelineSteps(
        "cariDocument",
        selectedSnapshot?.status,
        buildDocumentLifecycleEvents(selectedSnapshot, l),
        l
      ),
    [l, selectedSnapshot]
  );
  const draftActionsPanel = selectedSnapshot ? (
    <CariDocumentEditPanel
      selectedDetail={selectedDetail}
      selectedSnapshot={selectedSnapshot}
      fixedDirection={fixedDirection}
      fixedAssetCategoryRefreshToken={fixedAssetCategoryRefreshToken}
      workingContextLegalEntities={workingContextLegalEntities}
      onDocumentUpdated={onDocumentUpdated}
      onCancelDraft={onCancelDraft}
      onCancelAndCopyDraft={onCancelAndCopyDraft}
      cancelSaving={cancelSaving}
      cancelError={cancelError}
      onOpenQuickCreateAsset={onOpenQuickCreateAsset}
      onOpenInlineFixedAssetCategoryCreate={onOpenInlineFixedAssetCategoryCreate}
      onRequestFixedAssetCategorySetup={onRequestFixedAssetCategorySetup}
      registerEditBridgeApi={registerEditBridgeApi}
      translateDocumentMutationError={translateDocumentMutationError}
      l={l}
    />
  ) : null;
  const postReverseSummaryPanel = selectedSnapshot ? (
    <>
      {activePostReverseSummaryState.reverseResult ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {l("Reverse linkage", "Ters baglanti")}: `response.row.id`=
          {activePostReverseSummaryState.reverseResult.reversalDocumentId || "-"}, `response.row.documentNo`=
          {activePostReverseSummaryState.reverseResult.reversalDocumentNo || "-"}, `response.journal.reversalJournalEntryId`=
          {activePostReverseSummaryState.reverseResult.reversalJournalEntryId || "-"}
        </div>
      ) : null}
      {activePostReverseSummaryState.canReadReports ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">
            {l(
              "Linked settlements / cash transactions",
              "Bagli mahsuplar / nakit hareketleri"
            )}
          </p>
          {activePostReverseSummaryState.linkedCashError ? (
            <p className="mt-1 text-rose-700">
              {activePostReverseSummaryState.linkedCashError}
            </p>
          ) : null}
          {activePostReverseSummaryState.linkedCashLoading ? (
            <p className="mt-1 text-slate-600">
              {l("Loading linkage...", "Baglanti yukleniyor...")}
            </p>
          ) : null}
          {!activePostReverseSummaryState.linkedCashLoading &&
          activePostReverseSummaryState.linkedCashRows.length === 0 ? (
            <p className="mt-1 text-slate-600">
              {l(
                "No linked settlements found for this document as of today.",
                "Bu belge icin bugun itibariyla bagli mahsup bulunmuyor."
              )}
            </p>
          ) : null}
          {!activePostReverseSummaryState.linkedCashLoading &&
          activePostReverseSummaryState.linkedCashRows.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {activePostReverseSummaryState.linkedCashRows.map((row, index) => (
                <li
                  key={`doc-link-${row.settlementBatchId || row.settlementNo || index}`}
                  className="rounded border border-slate-200 bg-white px-2 py-1"
                >
                  settlement={row.settlementNo || row.settlementBatchId || "-"} (
                  {row.settlementDate || "-"}) | cashTransactionId=
                  {row.cashTransactionId || "-"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  ) : null;
  const postReverseActionsPanel = selectedSnapshot ? (
    <CariDocumentPostReversePanel
      key={`post-reverse-${toPositiveInt(selectedDocumentId) || "none"}`}
      selectedSnapshot={selectedSnapshot}
      selectedDetailForPosting={selectedDetailForPosting}
      fixedDirection={fixedDirection}
      onDocumentSubmitted={onDocumentSubmitted}
      onDocumentPosted={onDocumentPosted}
      onDocumentReversed={onDocumentReversed}
      requestCreatePrefill={requestCreatePrefill}
      translateDocumentMutationError={translateDocumentMutationError}
      onSummaryStateChange={handlePostReverseSummaryStateChange}
      l={l}
    />
  ) : null;
  const relatedPanel = selectedSnapshot ? (
    <CariDocumentRelatedPanel
      key={`related-${toPositiveInt(selectedDocumentId) || "none"}`}
      selectedSnapshot={selectedSnapshot}
      canRead={canRead}
      l={l}
    />
  ) : null;
  const opsStatusPanel = selectedSnapshot ? (
    <CariDocumentOpsStatusPanel
      key={`ops-status-${toPositiveInt(selectedDocumentId) || "none"}`}
      selectedSnapshot={selectedSnapshot}
      canRead={canRead}
      l={l}
    />
  ) : null;
  const commentsPanel = selectedSnapshot ? (
    <CariDocumentCommentsPanel
      key={`comments-${toPositiveInt(selectedDocumentId) || "none"}`}
      selectedSnapshot={selectedSnapshot}
      canRead={canRead}
      l={l}
    />
  ) : null;
  const evidencePanel = selectedSnapshot ? (
    <CariDocumentEvidencePanel
      key={`evidence-${toPositiveInt(selectedDocumentId) || "none"}`}
      selectedSnapshot={selectedSnapshot}
      canRead={canRead}
      l={l}
    />
  ) : null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        {l("Detail + Actions", "Detay + Islemler")}
      </h2>
      {detailLoading && !selectedSnapshot && toPositiveInt(selectedDocumentId) ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {l("Loading document detail...", "Belge detayi yukleniyor...")}
        </div>
      ) : null}
      {detailError ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {detailError}
        </div>
      ) : null}
      <CariDocumentDetailContent
        selectedSnapshot={selectedSnapshot}
        detailFixedAssetRowsById={detailFixedAssetRowsById}
        selectedDocumentFunctionalCurrencyCode={selectedDocumentFunctionalCurrencyCode}
        selectedDocumentLifecycleMeta={selectedDocumentLifecycleMeta}
        selectedDocumentLifecycleActions={selectedDocumentLifecycleActions}
        selectedDocumentLifecycleTimeline={selectedDocumentLifecycleTimeline}
        draftActionsPanel={draftActionsPanel}
        postReverseSummaryPanel={postReverseSummaryPanel}
        postReverseActionsPanel={postReverseActionsPanel}
        relatedPanel={relatedPanel}
        opsStatusPanel={opsStatusPanel}
        commentsPanel={commentsPanel}
        evidencePanel={evidencePanel}
        canReadFixedAssets={canReadFixedAssets}
        canCopySelectedToDraft={canCopySelectedToDraft}
        onCopySelectedDocumentToCreateForm={onCopySelectedDocumentToCreateForm}
        l={l}
      />
    </section>
  );
}
