import MoneyText from "../../../components/MoneyText.jsx";
import StatusTimeline from "../../../components/StatusTimeline.jsx";
import { Link } from "react-router-dom";
import {
  firstDefinedRowValue,
  FIXED_ASSET_DETAIL_ROUTE_PREFIX,
  formatWarehouseDisplay,
  getDocumentOperatingUnitLabel,
  normalizeChargeAllocationMethod,
  normalizeText,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";

/**
 * Renders the selected-document summary, stored lines, lifecycle snapshot, and hosted panels.
 */
export default function CariDocumentDetailContent({
  selectedSnapshot = null,
  detailFixedAssetRowsById,
  selectedDocumentFunctionalCurrencyCode = "",
  selectedDocumentLifecycleMeta = null,
  selectedDocumentLifecycleActions = [],
  selectedDocumentLifecycleTimeline = [],
  draftActionsPanel = null,
  postReverseSummaryPanel = null,
  postReverseActionsPanel = null,
  relatedPanel = null,
  opsStatusPanel = null,
  commentsPanel = null,
  evidencePanel = null,
  canReadFixedAssets = false,
  canCopySelectedToDraft = false,
  onCopySelectedDocumentToCreateForm,
  l,
}) {
  if (!selectedSnapshot) {
    return null;
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {l("Document Detail", "Belge Detayi")}
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt className="font-semibold text-slate-600">documentNo</dt>
          <dd>{selectedSnapshot.documentNo || "-"}</dd>
          <dt className="font-semibold text-slate-600">status</dt>
          <dd>{selectedSnapshot.status || "-"}</dd>
          <dt className="font-semibold text-slate-600">operatingUnit</dt>
          <dd>{getDocumentOperatingUnitLabel(selectedSnapshot)}</dd>
          <dt className="font-semibold text-slate-600">postedJournalEntryId</dt>
          <dd>{selectedSnapshot.postedJournalEntryId || "-"}</dd>
          <dt className="font-semibold text-slate-600">reversalOfDocumentId</dt>
          <dd>{selectedSnapshot.reversalOfDocumentId || "-"}</dd>
          <dt className="font-semibold text-slate-600">counterpartyCodeSnapshot</dt>
          <dd>{selectedSnapshot.counterpartyCodeSnapshot || "-"}</dd>
          <dt className="font-semibold text-slate-600">counterpartyNameSnapshot</dt>
          <dd>{selectedSnapshot.counterpartyNameSnapshot || "-"}</dd>
          <dt className="font-semibold text-slate-600">dueDateSnapshot</dt>
          <dd>{selectedSnapshot.dueDateSnapshot || "-"}</dd>
          <dt className="font-semibold text-slate-600">amountTxn</dt>
          <dd>
            <MoneyText
              amount={firstDefinedRowValue(selectedSnapshot, "amountTxn", "amount_txn")}
              currencyCode={firstDefinedRowValue(
                selectedSnapshot,
                "currencyCode",
                "currency_code",
                "currencyCodeSnapshot",
                "currency_code_snapshot"
              )}
            />
          </dd>
          <dt className="font-semibold text-slate-600">amountBase</dt>
          <dd>
            <MoneyText
              amount={firstDefinedRowValue(selectedSnapshot, "amountBase", "amount_base")}
              currencyCode={selectedDocumentFunctionalCurrencyCode}
            />
          </dd>
          <dt className="font-semibold text-slate-600">subtotalAmountTxn</dt>
          <dd>
            <MoneyText
              amount={firstDefinedRowValue(
                selectedSnapshot,
                "subtotalAmountTxn",
                "subtotal_amount_txn"
              )}
              currencyCode={firstDefinedRowValue(
                selectedSnapshot,
                "currencyCode",
                "currency_code",
                "currencyCodeSnapshot",
                "currency_code_snapshot"
              )}
            />
          </dd>
          <dt className="font-semibold text-slate-600">taxAmountTxn</dt>
          <dd>
            <MoneyText
              amount={firstDefinedRowValue(
                selectedSnapshot,
                "taxAmountTxn",
                "tax_amount_txn"
              )}
              currencyCode={firstDefinedRowValue(
                selectedSnapshot,
                "currencyCode",
                "currency_code",
                "currencyCodeSnapshot",
                "currency_code_snapshot"
              )}
            />
          </dd>
          <dt className="font-semibold text-slate-600">grossAmountTxn</dt>
          <dd>
            <MoneyText
              amount={firstDefinedRowValue(
                selectedSnapshot,
                "grossAmountTxn",
                "gross_amount_txn"
              )}
              currencyCode={firstDefinedRowValue(
                selectedSnapshot,
                "currencyCode",
                "currency_code",
                "currencyCodeSnapshot",
                "currency_code_snapshot"
              )}
            />
          </dd>
          <dt className="font-semibold text-slate-600">currencyCodeSnapshot</dt>
          <dd>{selectedSnapshot.currencyCodeSnapshot || "-"}</dd>
          <dt className="font-semibold text-slate-600">fxRateSnapshot</dt>
          <dd>{selectedSnapshot.fxRateSnapshot || "-"}</dd>
        </dl>
        {String(selectedSnapshot.status || "").trim().toUpperCase() === "RETURNED" ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
            <p className="font-semibold">
              {l("Returned for correction", "Duzeltme icin iade edildi")}
            </p>
            <p className="mt-1 text-xs text-amber-900">
              {l(
                "Update the bill, then resubmit it once the correction is complete.",
                "Belgeyi duzeltin, duzeltme tamamlaninca yeniden gonderin."
              )}
            </p>
            <p className="mt-2">
              {normalizeText(selectedSnapshot.returnReason || selectedSnapshot.return_reason) ||
                l("No return reason recorded.", "Iade nedeni kayitli degil.")}
            </p>
            <p className="mt-2 text-xs text-amber-900">
              {l("Returned at", "Iade zamani")}:{" "}
              {selectedSnapshot.returnedAt || selectedSnapshot.returned_at || "-"}
            </p>
          </div>
        ) : null}
        <div className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            {l("Commercial lines", "Ticari satirlar")}
          </p>
          {!Array.isArray(selectedSnapshot.lines) || selectedSnapshot.lines.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              {l("No stored document lines.", "Kayitli belge satiri yok.")}
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {selectedSnapshot.lines.map((line) => {
                const isFixedAssetLine = line.subledgerType === "FIXED_ASSET";
                const chargeAllocationMethod = normalizeChargeAllocationMethod(
                  line.chargeAllocationMethod
                );
                const isChargeLine = chargeAllocationMethod !== "NONE";
                const chargeTargets = Array.isArray(line.chargeTargets)
                  ? line.chargeTargets
                  : [];
                const targetFixedAssetId = toPositiveInt(line.targetFixedAssetId);
                const generatedFixedAssets = Array.isArray(line.generatedFixedAssets)
                  ? line.generatedFixedAssets
                  : [];
                const targetFixedAsset =
                  targetFixedAssetId && detailFixedAssetRowsById instanceof Map
                    ? detailFixedAssetRowsById.get(targetFixedAssetId) || null
                    : null;
                const targetFixedAssetLabel =
                  normalizeText(targetFixedAsset?.assetNo) ||
                  normalizeText(targetFixedAsset?.name) ||
                  (targetFixedAssetId ? `#${targetFixedAssetId}` : "");

                return (
                  <div
                    key={`detail-line-${line.id || line.lineNo}`}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-slate-800">
                      <span className="font-semibold">
                        {l("Line", "Satir")} {line.lineNo || "-"} |{" "}
                        {line.lineKind || "STANDARD"}
                      </span>
                      <span>
                        {isChargeLine
                          ? l(
                              "Posting account ignored for charge lines",
                              "Gider dagitim satirlarinda kayit hesabi yok sayilir"
                            )
                          : `${l("Posting account", "Kayit hesabi")} #${
                              line.postingAccountId || "-"
                            }`}
                      </span>
                    </div>
                    <div className="mt-1 text-slate-700">{line.description || "-"}</div>
                    <div className="mt-1 flex flex-wrap gap-3 text-slate-600">
                      {isFixedAssetLine ? (
                        <>
                          <span>
                            {l("Fixed asset mode", "Demirbas modu")}:{" "}
                            {line.fixedAssetMode || "-"}
                          </span>
                          <span>
                            {l("Fixed asset", "Demirbas")}:{" "}
                            {targetFixedAssetId ? (
                              canReadFixedAssets ? (
                                <Link
                                  to={`${FIXED_ASSET_DETAIL_ROUTE_PREFIX}/${targetFixedAssetId}`}
                                  className="text-cyan-700 hover:underline"
                                >
                                  {targetFixedAssetLabel}
                                </Link>
                              ) : (
                                targetFixedAssetLabel
                              )
                            ) : line.fixedAssetMode === "AUTO_CREATE" ? (
                              generatedFixedAssets.length > 0
                                ? l(
                                    "Generated assets are listed below",
                                    "Olusan demirbaslar asagida listeleniyor"
                                  )
                                : l("Auto-create on post", "Kayitta otomatik olusturulur")
                            ) : (
                              "-"
                            )}
                          </span>
                        </>
                      ) : (
                        <span>
                          {l("Item card", "Urun karti")}: {line.itemCardId || "-"}
                        </span>
                      )}
                      <span>
                        {l("Qty", "Miktar")}: {line.quantity ?? "-"}
                      </span>
                      <span>
                        {l("Unit price", "Birim fiyat")}: {line.unitPriceTxn ?? "-"}
                      </span>
                      <span>
                        {l("Tax category", "Vergi kategorisi")}:{" "}
                        {line.taxCategoryCode || "-"}
                      </span>
                      <span>
                        {l("Stock impact", "Stok etkisi")}:{" "}
                        {line.stockImpactMode || "NONE"}
                      </span>
                      <span>
                        {l("Warehouse", "Depo")}:{" "}
                        {formatWarehouseDisplay(
                          line.warehouseId,
                          line.warehouseCode,
                          line.warehouseName
                        )}
                      </span>
                      {isChargeLine ? (
                        <span>
                          {l("Charge allocation", "Gider dagitimi")}:{" "}
                          {chargeAllocationMethod}
                        </span>
                      ) : null}
                    </div>
                    {isChargeLine ? (
                      <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-2 text-slate-700">
                        <p className="font-semibold text-amber-900">
                          {l("Charge targets", "Gider hedefleri")}
                        </p>
                        {chargeTargets.length === 0 ? (
                          <p className="mt-1 text-[11px] text-amber-900">
                            {l("No stored targets.", "Kayitli hedef yok.")}
                          </p>
                        ) : (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {chargeTargets.map((target, targetIndex) => {
                              const targetLineNo = toPositiveInt(target?.targetLineNo);
                              const targetLine = (selectedSnapshot.lines || []).find(
                                (candidate) =>
                                  toPositiveInt(candidate?.lineNo) === targetLineNo
                              );
                              const targetLabel = [
                                `${l("Line", "Satir")} ${targetLineNo || "-"}`,
                                normalizeText(targetLine?.description) || null,
                              ]
                                .filter(Boolean)
                                .join(" | ");
                              return (
                                <span
                                  key={`detail-line-${line.id || line.lineNo}-charge-target-${
                                    targetLineNo || targetIndex
                                  }`}
                                  className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[11px] text-amber-900"
                                >
                                  {targetLabel}
                                  {target?.allocatedAmountTxn != null ? (
                                    <>
                                      {" | "}
                                      <MoneyText
                                        amount={target.allocatedAmountTxn}
                                        currencyCode={
                                          selectedSnapshot.currencyCodeSnapshot ||
                                          selectedSnapshot.currencyCode
                                        }
                                        className="inline"
                                      />
                                    </>
                                  ) : (
                                    ` | ${l("Calculated on post", "Kayitta hesaplanir")}`
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}
                    {isFixedAssetLine &&
                    line.fixedAssetMode === "AUTO_CREATE" &&
                    generatedFixedAssets.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="font-semibold text-slate-700">
                          {l("Generated fixed assets", "Olusan demirbaslar")}:
                        </span>
                        {generatedFixedAssets.map((assetRow) => {
                          const generatedAssetId = toPositiveInt(assetRow?.id);
                          const generatedAssetLabel =
                            normalizeText(assetRow?.assetNo) ||
                            normalizeText(assetRow?.name) ||
                            (generatedAssetId ? `#${generatedAssetId}` : "-");
                          const generatedAssetStatus = normalizeText(assetRow?.status);
                          const generatedAssetUnitNo = toPositiveInt(
                            assetRow?.sourceCariDocumentLineUnitNo
                          );
                          const chipLabel = [
                            generatedAssetUnitNo
                              ? `${l("Unit", "Birim")} ${generatedAssetUnitNo}`
                              : null,
                            generatedAssetLabel,
                            generatedAssetStatus || null,
                          ]
                            .filter(Boolean)
                            .join(" | ");
                          return generatedAssetId && canReadFixedAssets ? (
                            <Link
                              key={`generated-fixed-asset-${line.id || line.lineNo}-${generatedAssetId}`}
                              to={`${FIXED_ASSET_DETAIL_ROUTE_PREFIX}/${generatedAssetId}`}
                              className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-cyan-800 hover:bg-cyan-100 hover:underline"
                            >
                              {chipLabel}
                            </Link>
                          ) : (
                            <span
                              key={`generated-fixed-asset-${line.id || line.lineNo}-${
                                generatedAssetId || generatedAssetLabel
                              }`}
                              className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700"
                            >
                              {chipLabel}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <div className="rounded border border-slate-200 bg-white px-2 py-1">
                        <span className="block text-[11px] uppercase tracking-wide text-slate-500">
                          {l("Net", "Net")}
                        </span>
                        <MoneyText
                          amount={line.lineNetAmountTxn}
                          currencyCode={
                            selectedSnapshot.currencyCodeSnapshot ||
                            selectedSnapshot.currencyCode
                          }
                        />
                      </div>
                      <div className="rounded border border-slate-200 bg-white px-2 py-1">
                        <span className="block text-[11px] uppercase tracking-wide text-slate-500">
                          {l("Tax", "Vergi")}
                        </span>
                        <MoneyText
                          amount={line.lineTaxAmountTxn}
                          currencyCode={
                            selectedSnapshot.currencyCodeSnapshot ||
                            selectedSnapshot.currencyCode
                          }
                        />
                      </div>
                      <div className="rounded border border-slate-200 bg-white px-2 py-1">
                        <span className="block text-[11px] uppercase tracking-wide text-slate-500">
                          {l("Gross", "Brut")}
                        </span>
                        <MoneyText
                          amount={line.lineGrossAmountTxn}
                          currencyCode={
                            selectedSnapshot.currencyCodeSnapshot ||
                            selectedSnapshot.currencyCode
                          }
                        />
                      </div>
                    </div>
                    {Array.isArray(line.taxes) && line.taxes.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-slate-600">
                        {line.taxes.map((taxRow) => (
                          <li
                            key={`detail-line-tax-${line.id || line.lineNo}-${taxRow.componentNo || 0}`}
                          >
                            {(taxRow.taxCode || l("Tax", "Vergi"))} | {taxRow.ratePct ?? 0}% |{" "}
                            <MoneyText
                              amount={taxRow.taxAmountTxn}
                              currencyCode={
                                selectedSnapshot.currencyCodeSnapshot ||
                                selectedSnapshot.currencyCode
                              }
                              className="inline"
                            />
                            {taxRow.taxPurposeCode ? ` | ${taxRow.taxPurposeCode}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {Array.isArray(line.stockLinks) && line.stockLinks.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-slate-600">
                        {line.stockLinks.map((stockLink) => (
                          <li
                            key={`detail-line-stock-${line.id || line.lineNo}-${stockLink.id || stockLink.stockImpactMode}`}
                          >
                            {l("Stock link", "Stok baglantisi")} |{" "}
                            {stockLink.stockImpactMode || line.stockImpactMode || "NONE"} |{" "}
                            {stockLink.linkStatus || "-"} | {l("Qty", "Miktar")}{" "}
                            {stockLink.requestedQuantity ?? "-"}
                            {stockLink.inventoryMovementId
                              ? ` | ${l("Movement", "Hareket")} #${stockLink.inventoryMovementId}`
                              : ""}
                            {stockLink.inventoryMovementType
                              ? ` | ${stockLink.inventoryMovementType}`
                              : ""}
                            {stockLink.inventoryValuationStatus
                              ? ` | ${stockLink.inventoryValuationStatus}`
                              : ""}
                            {stockLink.inventoryWarehouseCode
                              ? ` | ${l("Warehouse", "Depo")} ${stockLink.inventoryWarehouseCode}`
                              : ""}
                            {stockLink.reopenedFromStockLinkId
                              ? ` | ${l("Reopened from", "Yeniden acilan kaynak")} #${stockLink.reopenedFromStockLinkId}`
                              : ""}
                            {stockLink.supersededByStockLinkId
                              ? ` | ${l("Successor", "Devam baglantisi")} #${stockLink.supersededByStockLinkId}`
                              : ""}
                            {stockLink.inventoryMovementReversedAt
                              ? ` | ${l("Reversed", "Terslendi")} ${stockLink.inventoryMovementReversedAt}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            {l("Lifecycle Snapshot", "Yasam Dongusu Ozeti")}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {selectedDocumentLifecycleMeta?.label || selectedSnapshot.status || "-"}
          </p>
          {selectedDocumentLifecycleMeta?.description ? (
            <p className="mt-1 text-xs text-slate-600">
              {selectedDocumentLifecycleMeta.description}
            </p>
          ) : null}
          {selectedDocumentLifecycleActions.length > 0 ? (
            <p className="mt-1 text-xs text-slate-600">
              {l("Next allowed transitions:", "Siradaki izinli gecisler:")}{" "}
              {selectedDocumentLifecycleActions.map((row) => row.label).join(", ")}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              {l(
                "No further lifecycle transitions are defined from this status.",
                "Bu durumdan sonrasi icin tanimli bir yasam dongusu gecisi yok."
              )}
            </p>
          )}
          {canCopySelectedToDraft ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 disabled:opacity-60"
                onClick={onCopySelectedDocumentToCreateForm}
              >
                {l("Copy to Draft", "Taslaga Kopyala")}
              </button>
              {toPositiveInt(
                selectedSnapshot?.reversalOfDocumentId ??
                  selectedSnapshot?.reversal_of_document_id
              ) ? (
                <p className="text-[11px] text-slate-500">
                  {l(
                    "For reversal records, copy uses the original source document.",
                    "Ters kayit belgelerinde kopya, orijinal kaynak belgeden alinir."
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {postReverseSummaryPanel}
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p className="font-semibold text-slate-800">
            {l(
              "Related Panel (GL / Open Items / Exceptions / Audit)",
              "Iliskili Panel (GL / Acik Kalemler / Istisnalar / Denetim)"
            )}
          </p>
          <div className="mt-2 space-y-3 text-xs">
            {relatedPanel}
            {opsStatusPanel}
            {commentsPanel}
            {evidencePanel}
          </div>
        </div>
        <StatusTimeline
          className="mt-4"
          title={l("Document Lifecycle Timeline", "Belge Yasam Dongusu Zaman Cizelgesi")}
          steps={selectedDocumentLifecycleTimeline}
          emptyText={l(
            "No lifecycle history available for this document yet.",
            "Bu belge icin henuz yasam dongusu gecmisi yok."
          )}
        />
      </div>

      <div className="space-y-4">
        {draftActionsPanel}
        {postReverseActionsPanel}
      </div>
    </div>
  );
}
