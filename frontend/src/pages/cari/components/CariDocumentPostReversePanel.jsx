
import { Link } from "react-router-dom";
import {
  FIXED_ASSET_DETAIL_ROUTE_PREFIX,
  buildInventoryMovementLink,
  buildInventoryTransferLink,
  formatFixedAssetTransactionTypeLabel,
  formatReadinessReason,
  normalizeOptionalDecimalText,
  normalizePositiveIntText,
} from "../cariDocumentsPageHelpers.js";
import useCariDocumentPostReverseController from "../hooks/useCariDocumentPostReverseController.js";
export default function CariDocumentPostReversePanel({
  selectedSnapshot = null,
  selectedDetailForPosting = null,
  fixedDirection = "",
  onDocumentSubmitted,
  onDocumentPosted,
  onDocumentReversed,
  requestCreatePrefill,
  translateDocumentMutationError,
  onSummaryStateChange,
  l,
}) {
  const controller = useCariDocumentPostReverseController({
    selectedSnapshot,
    selectedDetailForPosting,
    fixedDirection,
    onDocumentSubmitted,
    onDocumentPosted,
    onDocumentReversed,
    requestCreatePrefill,
    translateDocumentMutationError,
    onSummaryStateChange,
    l,
  });
  const {
    canCreate,
    canFxOverride,
    canSubmitSelected,
    canPostSelected,
    canReadGlAccounts,
    canReverseSelected,
    cariPostingNotReady,
    filteredPostOffsetAccountOptions,
    handleAddPostFormPostingLine,
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
    selectedDocumentAmountBase,
    selectedDocumentAmountTxn,
    selectedDocumentDirection,
    selectedDocumentId,
    selectedDocumentLegalEntityId,
    selectedWorkflowGate,
    selectedWorkflowGateState,
    selectedDocumentPostingRulesReady,
    selectedDocumentUsesStoredTaxesForPosting,
    selectedOffsetAccountType,
    setPostForm,
    setReverseForm,
  } = controller;
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
        {l("Submit / Post / Reverse", "Gonder / Kaydet / Ters Kayit")}
      </h3>
      {selectedDocumentDirection === "AP" && selectedWorkflowGate ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900">
          <p className="font-semibold">
            {l("Workflow gate", "Workflow kapisi")}: {selectedWorkflowGateState || "NONE"}
          </p>
          <p className="mt-1 text-xs text-slate-700">
            {selectedWorkflowGate?.message ||
              l(
                "No workflow gate message is currently available.",
                "Su anda workflow kapisi mesaji yok."
              )}
          </p>
          {selectedWorkflowGate?.latestDecisionComment ? (
            <p className="mt-2 text-xs text-slate-700">
              {l("Latest decision note", "Son karar notu")}:{" "}
              {selectedWorkflowGate.latestDecisionComment}
            </p>
          ) : null}
          {selectedWorkflowGate?.workflowInstanceId ? (
            <p className="mt-2 text-xs text-slate-700">
              workflowInstanceId=#{selectedWorkflowGate.workflowInstanceId}
            </p>
          ) : null}
        </div>
      ) : null}
      {canSubmitSelected || submitError || submitMessage ? (
        <div className="mt-3 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-950">
          <p className="font-semibold">
            {l("Submit for approval", "Onaya gonder")}
          </p>
          <p className="mt-1 text-xs text-cyan-900">
            {l(
              "Governed AP documents move to SUBMITTED before workflow approval and posting.",
              "Yonetime tabi AP belgeleri workflow onayi ve kayit oncesinde SUBMITTED durumuna gecer."
            )}
          </p>
          <button
            type="button"
            className="mt-3 rounded-md bg-cyan-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={handleSubmitDocument}
            disabled={!canSubmitSelected || submitSaving}
          >
            {submitSaving
              ? l("Submitting...", "Gonderiliyor...")
              : l("Submit Document", "Belgeyi Gonder")}
          </button>
          {submitError ? (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {submitError}
            </div>
          ) : null}
          {submitMessage ? (
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {submitMessage}
            </div>
          ) : null}
        </div>
      ) : null}
      {cariPostingNotReady ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">
            {l("Setup incomplete (CARI posting)", "Kurulum eksik (CARI kaydi)")}
          </p>
          <p className="mt-1">
            {l(
              "Posting is disabled for legalEntityId=",
              "Kayit islemi su legalEntityId icin kapali:"
            )}
            {selectedDocumentLegalEntityId}.
          </p>
          {Array.isArray(selectedCariPostingReadiness?.missingPurposeCodes) &&
          selectedCariPostingReadiness.missingPurposeCodes.length > 0 ? (
            <p className="mt-1">
              {l("Missing purpose codes:", "Eksik amac kodlari:")}{" "}
              {selectedCariPostingReadiness.missingPurposeCodes.join(", ")}
            </p>
          ) : null}
          {Array.isArray(selectedCariPostingReadiness?.invalidMappings) &&
          selectedCariPostingReadiness.invalidMappings.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {selectedCariPostingReadiness.invalidMappings.map((row, index) => (
                <li key={`cari-readiness-invalid-${index}`}>
                  {String(row?.purposeCode || "-")}: {formatReadinessReason(row?.reason, l)}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              to="/app/ayarlar/hesap-plani-ayarlari#manual-purpose-mappings"
              className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
            >
              {l("Fix manually", "Elle Duzelt")}
            </Link>
            <Link
              to="/app/ayarlar/hesap-plani-ayarlari#template-wizard"
              className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900"
            >
              {l("Use template", "Sablon Kullan")}
            </Link>
          </div>
        </div>
      ) : null}
      <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
        {l("Default Offset Account (Optional)", "Varsayilan Karsi Hesap (Opsiyonel)")}
        <select
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
          value={postForm.offsetAccountId}
          onChange={(event) =>
            setPostForm((prev) => ({ ...prev, offsetAccountId: event.target.value }))
          }
          disabled={
            !canPostSelected || postSaving || postOffsetAccountsLoading || !canReadGlAccounts
          }
        >
          <option value="">
            {l(
              "Use default CARI purpose mapping",
              "Varsayilan CARI amac eslemesini kullan"
            )}
          </option>
          {filteredPostOffsetAccountOptions.map((row) => (
            <option key={`post-offset-account-${row.id}`} value={String(row.id)}>
              {row.code} - {row.name} ({row.accountType || "-"})
            </option>
          ))}
        </select>
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={Boolean(postForm.showAllOffsetAccounts)}
          onChange={(event) =>
            setPostForm((prev) => ({
              ...prev,
              showAllOffsetAccounts: event.target.checked,
            }))
          }
          disabled={!canPostSelected || postSaving || !canReadGlAccounts}
        />
        {l("Show all account types", "Tum hesap turlerini goster")}
      </label>
      <p className="mt-1 text-xs text-slate-600">
        {l(
          "Applied when a posting line does not choose its own offset account.",
          "Bir kayit satiri kendi karsi hesabini secmezse uygulanir."
        )}
      </p>
      {selectedOffsetAccountType && !postForm.showAllOffsetAccounts ? (
        <p className="mt-1 text-xs text-slate-600">
          Filtered by direction={selectedDocumentDirection}: showing only{" "}
          {selectedOffsetAccountType} accounts.
        </p>
      ) : null}
      {!canReadGlAccounts ? (
        <p className="mt-1 text-xs text-amber-700">
          {l(
            "Missing permission: `gl.account.read`. Default mapping will be used.",
            "Eksik yetki: `gl.account.read`. Varsayilan esleme kullanilacak."
          )}
        </p>
      ) : null}
      {postOffsetAccountsLoading ? (
        <p className="mt-1 text-xs text-slate-600">
          {l(
            "Loading postable account options...",
            "Kaydedilebilir hesap secenekleri yukleniyor..."
          )}
        </p>
      ) : null}
      {postOffsetAccountsError ? (
        <p className="mt-1 text-xs text-rose-700">{postOffsetAccountsError}</p>
      ) : null}
      {!postOffsetAccountsLoading &&
      !postOffsetAccountsError &&
      canReadGlAccounts &&
      filteredPostOffsetAccountOptions.length === 0 ? (
        <p className="mt-1 text-xs text-slate-600">
          {selectedOffsetAccountType && !postForm.showAllOffsetAccounts
            ? l(
                `No postable ${selectedOffsetAccountType} accounts found for selected legal entity.`,
                `Secili tuzel kisilik icin kaydedilebilir ${selectedOffsetAccountType} hesap bulunamadi.`
              )
            : l(
                "No postable accounts found for selected legal entity.",
                "Secili tuzel kisilik icin kaydedilebilir hesap bulunamadi."
              )}
        </p>
      ) : null}
      <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={postForm.usePostingLines}
          onChange={(event) =>
            setPostForm((prev) => {
              const usePostingLines = event.target.checked;
              if (!usePostingLines) {
                return {
                  ...prev,
                  usePostingLines: false,
                };
              }
              const existingLines = Array.isArray(prev.postingLines)
                ? prev.postingLines
                : [];
              if (existingLines.length > 0) {
                return {
                  ...prev,
                  usePostingLines: true,
                };
              }
              return {
                ...prev,
                usePostingLines: true,
                postingLines: [
                  {
                    ...prev.postingLines?.[0],
                    amountTxn: selectedDocumentAmountTxn,
                    amountBase: selectedDocumentAmountBase,
                  },
                ],
              };
            })
          }
          disabled={
            !canPostSelected ||
            postSaving ||
            !selectedDocumentPostingRulesReady ||
            selectedDocumentUsesStoredTaxesForPosting
          }
        />
        {l("Split posting by line items", "Kaydi satirlara bol")}
      </label>
      {!selectedDocumentPostingRulesReady && selectedDocumentId ? (
        <p className="mt-1 text-xs text-slate-600">
          {l(
            "Loading draft line detail to determine whether split posting is available.",
            "Bolunmus kaydin uygun olup olmadigini belirlemek icin taslak satir detayi yukleniyor."
          )}
        </p>
      ) : null}
      {selectedDocumentUsesStoredTaxesForPosting ? (
        <p className="mt-1 text-xs text-amber-700">
          {l(
            "Split posting is disabled because this draft already stores line-level taxes.",
            "Bu taslakta satir bazli vergi kayitli oldugu icin bolunmus kayit kapatildi."
          )}
        </p>
      ) : null}
      {postForm.usePostingLines && !selectedDocumentUsesStoredTaxesForPosting ? (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
              {l("Posting lines", "Kayit satirlari")}
            </p>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
              onClick={handleAddPostFormPostingLine}
              disabled={!canPostSelected || postSaving}
            >
              {l("Add line", "Satir Ekle")}
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {(Array.isArray(postForm.postingLines) ? postForm.postingLines : []).map(
              (line, index) => (
                <div
                  key={line.rowId || `post-line-${index + 1}`}
                  className="rounded-md border border-slate-200 bg-white p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">
                      {l("Line", "Satir")} {index + 1}
                    </p>
                    <button
                      type="button"
                      className="rounded border border-rose-300 px-2 py-0.5 text-[11px] font-semibold text-rose-700 disabled:opacity-40"
                      onClick={() => handleRemovePostFormPostingLine(line.rowId)}
                      disabled={
                        !canPostSelected ||
                        postSaving ||
                        (postForm.postingLines || []).length <= 1
                      }
                    >
                      {l("Remove", "Kaldir")}
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Description (Optional)", "Aciklama (Opsiyonel)")}
                      <input
                        type="text"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.description || ""}
                        maxLength={255}
                        onChange={(event) =>
                          handleUpdatePostFormPostingLine(line.rowId, {
                            description: event.target.value,
                          })
                        }
                        disabled={!canPostSelected || postSaving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Offset Account (Optional)", "Karsi Hesap (Opsiyonel)")}
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={normalizePositiveIntText(line.offsetAccountId)}
                        onChange={(event) =>
                          handleUpdatePostFormPostingLine(line.rowId, {
                            offsetAccountId: normalizePositiveIntText(event.target.value),
                          })
                        }
                        disabled={
                          !canPostSelected ||
                          postSaving ||
                          postOffsetAccountsLoading ||
                          !canReadGlAccounts
                        }
                      >
                        <option value="">
                          {l(
                            "Use default offset for this post",
                            "Bu kayit icin varsayilan karsi hesabi kullan"
                          )}
                        </option>
                        {filteredPostOffsetAccountOptions.map((row) => (
                          <option
                            key={`post-line-offset-account-${line.rowId}-${row.id}`}
                            value={String(row.id)}
                          >
                            {row.code} - {row.name} ({row.accountType || "-"})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l(
                        "Invoice Amount (Invoice Currency)",
                        "Fatura Tutari (Fatura Para Birimi)"
                      )}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.amountTxn || ""}
                        onChange={(event) =>
                          handleUpdatePostFormPostingLine(line.rowId, {
                            amountTxn: normalizeOptionalDecimalText(event.target.value),
                          })
                        }
                        disabled={!canPostSelected || postSaving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l(
                        "Base Amount (Legal Entity Currency)",
                        "Baz Tutar (Tuzel Kisilik Para Birimi)"
                      )}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.amountBase || ""}
                        onChange={(event) =>
                          handleUpdatePostFormPostingLine(line.rowId, {
                            amountBase: normalizeOptionalDecimalText(event.target.value),
                          })
                        }
                        disabled={!canPostSelected || postSaving}
                      />
                    </label>
                  </div>
                </div>
              )
            )}
          </div>
          <div className="mt-2 text-xs text-slate-700">
            <p>
              {l("Draft totals txn/base:", "Taslak toplam txn/base:")}{" "}
              {selectedDocumentAmountTxn ?? "-"} / {selectedDocumentAmountBase ?? "-"}
            </p>
            <p>
              {l("Posting line totals txn/base:", "Kayit satiri toplam txn/base:")}{" "}
              {postFormPostingLineSummary.totalTxn} / {postFormPostingLineSummary.totalBase}
            </p>
          </div>
          {postFormPostingLineSummary.invalidAmountRows > 0 ? (
            <p className="mt-1 text-xs text-amber-700">
              {postFormPostingLineSummary.invalidAmountRows}{" "}
              {l(
                "line(s) have missing or invalid amounts.",
                "satirda eksik veya gecersiz tutar var."
              )}
            </p>
          ) : null}
          {postFormPostingLineSummary.lineCount > 0 &&
          postFormPostingLineSummary.hasDraftTotals &&
          !postFormPostingLineSummary.matchesDraftTotals ? (
            <p className="mt-1 text-xs text-amber-700">
              {l(
                "Posting line totals must match draft totals before posting.",
                "Kayit oncesi satir toplamlari taslak toplamlariyla eslesmelidir."
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={postForm.useFxOverride}
          onChange={(event) =>
            setPostForm((prev) => ({ ...prev, useFxOverride: event.target.checked }))
          }
          disabled={!canPostSelected || postSaving}
        />
        {l("useFxOverride", "Kur gecersiz kilma kullan")}
      </label>
      <input
        type="text"
        className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder={l("fxOverrideReason", "Kur gecersiz kilma nedeni")}
        value={postForm.fxOverrideReason}
        onChange={(event) =>
          setPostForm((prev) => ({ ...prev, fxOverrideReason: event.target.value }))
        }
        disabled={!canPostSelected || postSaving}
      />
      {postForm.useFxOverride && !canFxOverride ? (
        <p className="mt-2 text-sm text-amber-700">
          {l(
            "You cannot post with FX override. Missing permission: `cari.fx.override`.",
            "Kur gecersiz kilma ile kayit yapamazsiniz. Eksik yetki: `cari.fx.override`."
          )}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        onClick={handlePostDraft}
        disabled={!canPostSelected || postSaving || !postingLinesReadyForSubmit}
      >
        {postSaving ? l("Posting...", "Kaydediliyor...") : l("Post Draft", "Taslagi Kaydet")}
      </button>
      {postError ? (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {postError}
        </div>
      ) : null}
      {postTransferGuidance ? (
        <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <p className="font-semibold">
            {l(
              "Stock exists in another ownership context. Use an explicit transfer before posting again.",
              "Stok baska bir sahiplik baglaminda mevcut. Yeniden kayda almadan once acik bir transfer kullanin."
            )}
          </p>
          <p className="mt-1 text-xs">
            {[
              postTransferGuidance.itemCardCode ||
                postTransferGuidance.itemCardName ||
                l("Item", "Kalem"),
              postTransferGuidance.transferSourceWarehouseCode ||
              postTransferGuidance.transferSourceWarehouseName
                ? `${l("Suggested source", "Onerilen kaynak")}: ${
                    postTransferGuidance.transferSourceWarehouseCode ||
                    postTransferGuidance.transferSourceWarehouseName
                  }`
                : "",
              postTransferGuidance.warehouseCode || postTransferGuidance.warehouseName
                ? `${l("Target warehouse", "Hedef depo")}: ${
                    postTransferGuidance.warehouseCode || postTransferGuidance.warehouseName
                  }`
                : "",
              postTransferGuidance.requestedQuantity
                ? `${l("Quantity", "Miktar")}: ${postTransferGuidance.requestedQuantity}`
                : "",
            ]
              .filter(Boolean)
              .join(" | ")}
          </p>
          <p className="mt-2 text-xs">
            <Link
              to={buildInventoryTransferLink({
                legalEntityId: selectedSnapshot?.legalEntityId,
                sourceWarehouseId: postTransferGuidance.transferSourceWarehouseId,
                targetWarehouseId: postTransferGuidance.warehouseId,
                itemCardId: postTransferGuidance.itemCardId,
                quantityRequested: postTransferGuidance.requestedQuantity,
                sourceModule: "CARI",
                sourceEntityType: "CARI_DOCUMENT",
                sourceEntityId: selectedDocumentId,
              })}
              className="font-semibold underline underline-offset-2"
            >
              {l("Open inventory transfers", "Stok transferlerini ac")}
            </Link>{" "}
            {l(
              "to create the cross-context replenishment, then post the draft again.",
              "ile contextler arasi ikmali olusturun, sonra taslagi yeniden kayda alin."
            )}
          </p>
        </div>
      ) : null}
      {postFixedAssetImprovementGuidance ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">
            {postFixedAssetImprovementGuidance.reasonCode ===
            "FA_IMPROVEMENT_SAME_DAY_LIFE_CHANGE_CONFLICT"
              ? l(
                  "Another same-day life-changing improvement blocks this entry.",
                  "Ayni gun tarihli baska bir omur degistiren iyilestirme bu kaydi blokluyor."
                )
              : l(
                  "A later fixed-asset transaction blocks this earlier improvement.",
                  "Daha sonraki bir demirbas hareketi bu daha erken iyilestirmeyi blokluyor."
                )}
          </p>
          <p className="mt-1 text-xs">
            {[
              postFixedAssetImprovementGuidance.assetId
                ? `${l("Asset", "Varlik")}: #${postFixedAssetImprovementGuidance.assetId}`
                : "",
              postFixedAssetImprovementGuidance.blockingTransactionId
                ? `${l("Blocking transaction", "Bloklayan hareket")}: #${postFixedAssetImprovementGuidance.blockingTransactionId}`
                : "",
              postFixedAssetImprovementGuidance.blockingTransactionType
                ? `${l("Type", "Tur")}: ${formatFixedAssetTransactionTypeLabel(
                    postFixedAssetImprovementGuidance.blockingTransactionType,
                    l
                  )}`
                : "",
              postFixedAssetImprovementGuidance.blockingEffectiveDate
                ? `${l("Effective date", "Etkinlik tarihi")}: ${postFixedAssetImprovementGuidance.blockingEffectiveDate}`
                : "",
            ]
              .filter(Boolean)
              .join(" | ")}
          </p>
          <p className="mt-2 text-xs">
            {postFixedAssetImprovementGuidance.reasonCode ===
            "FA_IMPROVEMENT_SAME_DAY_LIFE_CHANGE_CONFLICT"
              ? l(
                  "Only one useful-life-changing improvement is allowed per asset on the same effective date. Open the asset transaction list, reverse or revise the other same-day improvement, then return and post this line again.",
                  "Ayni etkinlik tarihinde varlik basina yalnizca bir faydali omur degistiren iyilestirmeye izin verilir. Demirbas hareket listesini acin, diger ayni gun iyilestirmesini tersleyin veya duzeltin, sonra geri donup bu satiri yeniden kayda alin."
                )
              : l(
                  "Do this in order: open the asset transaction list, reverse or correct the later transaction, then return and post this earlier improvement again.",
                  "Sirayla sunu yapin: demirbas hareket listesini acin, daha sonraki hareketi tersleyin veya duzeltin, sonra geri donup bu daha erken iyilestirmeyi yeniden kayda alin."
                )}
          </p>
          {postFixedAssetImprovementGuidance.assetId ? (
            <p className="mt-2 text-xs">
              <Link
                to={`${FIXED_ASSET_DETAIL_ROUTE_PREFIX}/${postFixedAssetImprovementGuidance.assetId}?tab=transactions${
                  postFixedAssetImprovementGuidance.blockingTransactionId
                    ? `&transactionId=${postFixedAssetImprovementGuidance.blockingTransactionId}`
                    : ""
                }`}
                className="font-semibold underline underline-offset-2"
              >
                {l("Open asset transactions", "Demirbas hareketlerini ac")}
              </Link>{" "}
              {l(
                "to review the blocker and continue from there.",
                "ile bloklayan kaydi inceleyip oradan devam edin."
              )}
            </p>
          ) : null}
        </div>
      ) : null}
      {postMessage ? (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {postMessage}
        </div>
      ) : null}
      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-600">
        {l("Reverse Reason", "Ters Kayit Nedeni")}
        <input
          type="text"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
          value={reverseForm.reason}
          onChange={(event) =>
            setReverseForm((prev) => ({ ...prev, reason: event.target.value }))
          }
          disabled={!canReverseSelected || reverseSaving}
        />
      </label>
      <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
        {l("Reversal Date", "Ters Kayit Tarihi")}
        <input
          type="date"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
          value={reverseForm.reversalDate}
          onChange={(event) =>
            setReverseForm((prev) => ({ ...prev, reversalDate: event.target.value }))
          }
          disabled={!canReverseSelected || reverseSaving}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={handleReversePosted}
          disabled={!canReverseSelected || reverseSaving}
        >
          {reverseSaving
            ? l("Reversing...", "Ters kayit olusturuluyor...")
            : l("Reverse Document", "Belgeyi Tersle")}
        </button>
        {canCreate ? (
          <button
            type="button"
            className="rounded-md border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-700 disabled:opacity-50"
            onClick={handleReverseAndCopyPosted}
            disabled={!canReverseSelected || reverseSaving}
          >
            {reverseSaving
              ? l("Reversing...", "Ters kayit olusturuluyor...")
              : l("Reverse + Copy to Draft", "Tersle + Taslaga Kopyala")}
          </button>
        ) : null}
      </div>
      {reverseError ? (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {reverseError}
        </div>
      ) : null}
      {reverseInventoryBlocks.length > 0 ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-semibold">
            {l(
              "Reverse is blocked by linked inventory effects:",
              "Ters kayit bagli stok etkileri nedeniyle engellendi:"
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
            <span className="rounded-full border border-amber-300 bg-white px-2 py-1">
              {`${reverseInventoryBlockSummary.issueCount} ${l("issue", "cikis")}`}
            </span>
            <span className="rounded-full border border-amber-300 bg-white px-2 py-1">
              {`${reverseInventoryBlockSummary.receiptCount} ${l("receipt", "alim")}`}
            </span>
          </div>
          {reverseInventoryBlockSummary.stepMessages.length > 0 ? (
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">
              {reverseInventoryBlockSummary.stepMessages.map((message, index) => (
                <li key={`reverse-inventory-step-${index}`}>{message}</li>
              ))}
            </ol>
          ) : null}
          <p className="mt-2 text-xs text-amber-900">
            <Link
              to={buildInventoryMovementLink(selectedSnapshot?.legalEntityId)}
              className="font-semibold underline underline-offset-2"
            >
              {l("Inventory Movements", "Stok Hareketleri")}
            </Link>{" "}
            {l(
              "opens `/app/stok-yansitma-islemleri` for the blocking legal entity context.",
              "engel koyan tuzel kisilik baglamiyla `/app/stok-yansitma-islemleri` ekranini acar."
            )}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {reverseInventoryBlocks.map((row, index) => (
              <li
                key={`reverse-inventory-block-${row.stockLinkId || row.inventoryMovementId || index}`}
              >
                {row.inventoryMovementId ? (
                  <Link
                    to={buildInventoryMovementLink(
                      row.legalEntityId || selectedSnapshot?.legalEntityId,
                      row.inventoryMovementId
                    )}
                    className="font-semibold underline underline-offset-2"
                  >
                    {`#${row.inventoryMovementId}`}
                  </Link>
                ) : (
                  "#-"
                )}{" "}
                {`| ${row.inventoryMovementType || "-"} | ${
                  row.itemCardCode || row.itemCardName || l("Item", "Kalem")
                } | ${row.warehouseCode || row.warehouseName || l("Warehouse", "Depo")}`}
                {row.documentLineNo ? ` | ${l("Line", "Satir")} ${row.documentLineNo}` : ""}
                {row.inventoryValuationStatus ? ` | ${row.inventoryValuationStatus}` : ""}
                {row.suggestedActionMessage ? ` | ${row.suggestedActionMessage}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {reverseMessage ? (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {reverseMessage}
        </div>
      ) : null}
    </div>
  );
}
