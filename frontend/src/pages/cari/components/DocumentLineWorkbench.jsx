import { useMemo } from "react";
import MoneyText from "../../../components/MoneyText.jsx";
import DocumentLineRow from "./DocumentLineRow.jsx";
import {
  computeDocumentChargeAllocationPreview,
  createDocumentLineDraft,
  getDocumentLineTotals,
  listEligibleChargeTargetLines,
} from "../cariDocumentsUtils.js";
import {
  normalizeCurrencyCode,
  normalizeDirection,
  normalizeOptionalDecimalText,
  roundDocumentUiAmount,
} from "../cariDocumentsPageHelpers.js";

const EMPTY_CHARGE_TARGETS = [];
const EMPTY_LINE_VALIDATION_ROWS = [];
const EMPTY_ROW_ID_MAP = new Map();

/**
 * Renders the shared create/edit commercial line workbench and isolates per-row rerenders.
 */
function DocumentLineWorkbench({
  l,
  title,
  form,
  saving,
  gridSpanClass = "md:col-span-4",
  currencyCode,
  functionalCurrencyCode,
  fxComputation,
  canReadGlAccounts,
  lineAccountOptions,
  lineAccountsLoading,
  lineAccountsError,
  itemCardOptions,
  itemCardsLoading,
  itemCardsError,
  warehouseOptions,
  warehouseLoading,
  warehouseError,
  warehouseInfoMessage,
  warehouseLineErrors,
  lineValidationMessages,
  taxCategoryOptions,
  taxCategoryLoading,
  taxCategoryError,
  previewLoading,
  previewError,
  previewMessage,
  fixedAssetCategoryOptions,
  fixedAssetCategoriesLoading,
  fixedAssetCategoriesError,
  fixedAssetCategoriesById,
  fixedAssetDraftOptions,
  fixedAssetDraftLoading,
  fixedAssetDraftError,
  fixedAssetDraftRowsById,
  fixedAssetImprovementOptions,
  fixedAssetSaleOptions,
  fixedAssetSaleLoading,
  fixedAssetSaleError,
  fixedAssetSaleRowsById,
  fixedAssetOperatingUnitOptions,
  canQuickCreateFixedAsset,
  canReadFixedAssetSettings,
  canUpsertFixedAssetSettings,
  onOpenInlineFixedAssetCategoryCreate,
  onAddLine,
  onRemoveLine,
  onMoveLine,
  onPatchLine,
  onPatchTaxSensitiveLine,
  onChangeSubledgerType,
  onChangeFixedAssetMode,
  onChangeChargeAllocationMethod,
  onToggleChargeTarget,
  onChangeChargeTargetAmount,
  onSelectFixedAssetCategory,
  onSelectTargetFixedAsset,
  onSelectItemCard,
  onChangeStockImpactMode,
  onSelectWarehouse,
  onExpandFixedAssetLine,
  onOpenQuickCreateFixedAsset,
  onPreviewAll,
  onPreviewRow,
}) {
  const sourceLines = form?.lines;

  // Preserve untouched row object identity so memoized row children can skip rerenders.
  const lines = useMemo(
    () =>
      Array.isArray(sourceLines)
        ? sourceLines.map((row) => (row?.rowId ? row : createDocumentLineDraft(row)))
        : [],
    [sourceLines]
  );
  const documentDirection = normalizeDirection(form?.direction);
  const totals = fxComputation?.lineTotals || getDocumentLineTotals(lines);
  const resolvedAmountBaseText = normalizeOptionalDecimalText(
    fxComputation?.resolvedAmountBase
  );
  const resolvedAmountTxnText = normalizeOptionalDecimalText(
    fxComputation?.resolvedAmountTxn
  );
  const chargeAllocationPreview = useMemo(
    () => computeDocumentChargeAllocationPreview(lines),
    [lines]
  );
  const lineAccountsById = useMemo(
    () =>
      new Map(
        (Array.isArray(lineAccountOptions) ? lineAccountOptions : [])
          .map((row) => [Number(row?.id || 0), row])
          .filter(([id]) => id > 0)
      ),
    [lineAccountOptions]
  );
  const targetChargeSummaryByRowId =
    chargeAllocationPreview?.targetSummaryByRowId instanceof Map
      ? chargeAllocationPreview.targetSummaryByRowId
      : EMPTY_ROW_ID_MAP;
  const chargeLinePreviewByRowId =
    chargeAllocationPreview?.chargeLinesByRowId instanceof Map
      ? chargeAllocationPreview.chargeLinesByRowId
      : EMPTY_ROW_ID_MAP;

  return (
    <div className={`${gridSpanClass} rounded-md border border-slate-200 bg-slate-50 px-3 py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
            {title}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {l(
              "Net is derived from quantity x unit price. Refresh tax preview after changing tax-sensitive fields.",
              "Net tutar miktar x birim fiyattan turetilir. Vergiyle ilgili alanlar degisirse vergi onizlemesini yenileyin."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            onClick={onPreviewAll}
            disabled={saving || previewLoading || lines.length === 0}
          >
            {previewLoading
              ? l("Refreshing taxes...", "Vergiler yenileniyor...")
              : l("Preview all line taxes", "Tum satir vergilerini onizle")}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
            onClick={onAddLine}
            disabled={saving}
          >
            {l("Add line", "Satir ekle")}
          </button>
        </div>
      </div>

      {lineAccountsLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l(
            "Loading postable accounts for lines...",
            "Satirlar icin kaydedilebilir hesaplar yukleniyor..."
          )}
        </p>
      ) : null}
      {lineAccountsError ? (
        <p className="mt-2 text-xs text-amber-700">{lineAccountsError}</p>
      ) : null}
      {itemCardsLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading item cards...", "Urun kartlari yukleniyor...")}
        </p>
      ) : null}
      {itemCardsError ? <p className="mt-2 text-xs text-amber-700">{itemCardsError}</p> : null}
      {warehouseLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading warehouses...", "Depolar yukleniyor...")}
        </p>
      ) : null}
      {warehouseError ? (
        <p className="mt-2 text-xs text-amber-700">{warehouseError}</p>
      ) : null}
      {!warehouseError && !warehouseLoading && warehouseInfoMessage ? (
        <p className="mt-2 text-xs text-amber-700">{warehouseInfoMessage}</p>
      ) : null}
      {taxCategoryLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading tax categories...", "Vergi kategorileri yukleniyor...")}
        </p>
      ) : null}
      {taxCategoryError ? (
        <p className="mt-2 text-xs text-amber-700">{taxCategoryError}</p>
      ) : null}
      {fixedAssetCategoriesLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading fixed asset categories...", "Duran varlik kategorileri yukleniyor...")}
        </p>
      ) : null}
      {fixedAssetCategoriesError ? (
        <p className="mt-2 text-xs text-amber-700">{fixedAssetCategoriesError}</p>
      ) : null}
      {fixedAssetDraftLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l("Loading draft fixed assets...", "Taslak duran varliklar yukleniyor...")}
        </p>
      ) : null}
      {fixedAssetDraftError ? (
        <p className="mt-2 text-xs text-amber-700">{fixedAssetDraftError}</p>
      ) : null}
      {fixedAssetSaleLoading ? (
        <p className="mt-2 text-xs text-slate-600">
          {l(
            "Loading target fixed assets...",
            "Hedef duran varliklar yukleniyor..."
          )}
        </p>
      ) : null}
      {fixedAssetSaleError ? (
        <p className="mt-2 text-xs text-amber-700">{fixedAssetSaleError}</p>
      ) : null}
      {previewError ? <p className="mt-2 text-xs text-rose-700">{previewError}</p> : null}
      {previewMessage ? (
        <p className="mt-2 text-xs text-emerald-700">{previewMessage}</p>
      ) : null}

      <div className="mt-3 space-y-3">
        {lines.map((line, index) => {
          const isFixedAssetLine = line.subledgerType === "FIXED_ASSET";
          const isStockLine = line.subledgerType === "STOCK";
          const isNoneLine = !isFixedAssetLine && !isStockLine;
          const isApDocument = documentDirection === "AP";
          const lineRowId = String(line?.rowId || `line-${index}`);
          const eligibleChargeTargets =
            isApDocument && isNoneLine
              ? listEligibleChargeTargetLines(lines, line.rowId)
              : EMPTY_CHARGE_TARGETS;
          const chargeLinePreview = chargeLinePreviewByRowId.get(lineRowId) || null;
          const chargeTargetSummary =
            targetChargeSummaryByRowId.get(lineRowId) || null;
          const lineWarehouseError =
            warehouseLineErrors instanceof Map
              ? warehouseLineErrors.get(lineRowId) || ""
              : "";
          const lineValidationRows =
            lineValidationMessages instanceof Map
              ? lineValidationMessages.get(lineRowId) || EMPTY_LINE_VALIDATION_ROWS
              : EMPTY_LINE_VALIDATION_ROWS;

          return (
            <DocumentLineRow
              key={line.rowId || lineRowId}
              l={l}
              line={line}
              index={index}
              lineCount={lines.length}
              saving={saving}
              legalEntityId={form?.legalEntityId}
              documentDate={form?.documentDate}
              currencyCode={currencyCode}
              documentDirection={documentDirection}
              lineAccountsById={lineAccountsById}
              chargeLinePreview={chargeLinePreview}
              chargeTargetSummary={chargeTargetSummary}
              eligibleChargeTargets={eligibleChargeTargets}
              lineValidationRows={lineValidationRows}
              lineWarehouseError={lineWarehouseError}
              fixedAssetCategoriesById={fixedAssetCategoriesById}
              fixedAssetDraftRowsById={fixedAssetDraftRowsById}
              fixedAssetSaleRowsById={fixedAssetSaleRowsById}
              canReadGlAccounts={canReadGlAccounts}
              lineAccountOptions={lineAccountOptions}
              lineAccountsLoading={lineAccountsLoading}
              itemCardOptions={itemCardOptions}
              itemCardsLoading={itemCardsLoading}
              warehouseOptions={warehouseOptions}
              warehouseLoading={warehouseLoading}
              taxCategoryOptions={taxCategoryOptions}
              taxCategoryLoading={taxCategoryLoading}
              fixedAssetCategoryOptions={fixedAssetCategoryOptions}
              fixedAssetCategoriesLoading={fixedAssetCategoriesLoading}
              fixedAssetDraftOptions={fixedAssetDraftOptions}
              fixedAssetDraftLoading={fixedAssetDraftLoading}
              fixedAssetImprovementOptions={fixedAssetImprovementOptions}
              fixedAssetSaleOptions={fixedAssetSaleOptions}
              fixedAssetSaleLoading={fixedAssetSaleLoading}
              fixedAssetOperatingUnitOptions={fixedAssetOperatingUnitOptions}
              previewLoading={previewLoading}
              canQuickCreateFixedAsset={canQuickCreateFixedAsset}
              canReadFixedAssetSettings={canReadFixedAssetSettings}
              canUpsertFixedAssetSettings={canUpsertFixedAssetSettings}
              onOpenInlineFixedAssetCategoryCreate={onOpenInlineFixedAssetCategoryCreate}
              onMoveLine={onMoveLine}
              onRemoveLine={onRemoveLine}
              onPatchLine={onPatchLine}
              onPatchTaxSensitiveLine={onPatchTaxSensitiveLine}
              onChangeSubledgerType={onChangeSubledgerType}
              onChangeFixedAssetMode={onChangeFixedAssetMode}
              onChangeChargeAllocationMethod={onChangeChargeAllocationMethod}
              onToggleChargeTarget={onToggleChargeTarget}
              onChangeChargeTargetAmount={onChangeChargeTargetAmount}
              onSelectFixedAssetCategory={onSelectFixedAssetCategory}
              onSelectTargetFixedAsset={onSelectTargetFixedAsset}
              onSelectItemCard={onSelectItemCard}
              onChangeStockImpactMode={onChangeStockImpactMode}
              onSelectWarehouse={onSelectWarehouse}
              onExpandFixedAssetLine={onExpandFixedAssetLine}
              onOpenQuickCreateFixedAsset={onOpenQuickCreateFixedAsset}
              onPreviewRow={onPreviewRow}
            />
          );
        })}
      </div>

      {chargeAllocationPreview.hasChargeLines ? (
        <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                {l("Charge Allocation Summary", "Masraf Dagitim Ozeti")}
              </p>
              <p className="mt-1 text-xs text-cyan-900">
                {l(
                  "Effective amounts below already include the allocated charge lines.",
                  "Asagidaki efektif tutarlar, dagitilan masraf satirlarini zaten icerir."
                )}
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {chargeAllocationPreview.targetSummaries.map((summary) => (
              <div
                key={`charge-summary-target-${summary.rowId}`}
                className="rounded-md border border-cyan-100 bg-white px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {l("Line", "Satir")} {summary.lineNo}:{" "}
                      {summary.description || l("No description", "Aciklama yok")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {summary.subledgerType === "FIXED_ASSET"
                        ? l("Fixed Asset", "Duran Varlik")
                        : summary.subledgerType === "STOCK"
                          ? l("Stock", "Stok")
                          : l("General", "Genel")}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-600">
                    <p>
                      {l("Original", "Orijinal")}:{" "}
                      <MoneyText
                        amount={summary.originalAmountTxn}
                        currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
                        className="inline font-semibold"
                      />
                    </p>
                    <p className="mt-1">
                      {l("Allocated Charges", "Dagitilan Masraf")}:{" "}
                      <MoneyText
                        amount={summary.allocatedChargeAmountTxn}
                        currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
                        className="inline font-semibold"
                      />
                    </p>
                    <p className="mt-1">
                      {l("Effective", "Efektif")}:{" "}
                      <MoneyText
                        amount={summary.effectiveAmountTxn}
                        currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
                        className="inline font-semibold"
                      />
                    </p>
                    {summary.effectiveUnitAmountTxn !== null ? (
                      <p className="mt-1">
                        {l("Per Unit", "Birim Basina")}:{" "}
                        <MoneyText
                          amount={summary.effectiveUnitAmountTxn}
                          currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
                          className="inline font-semibold"
                        />
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {chargeAllocationPreview.chargeLines.map((chargeLine) => (
              <div
                key={`charge-summary-flow-${chargeLine.chargeLineRowId}`}
                className="rounded-md border border-cyan-100 bg-white px-3 py-3 text-xs text-slate-700"
              >
                <p className="font-semibold text-slate-900">
                  {l("Line", "Satir")} {chargeLine.chargeLineNo}:{" "}
                  {chargeLine.chargeLineDescription || l("Charge line", "Masraf satiri")}
                </p>
                <p className="mt-1">
                  <MoneyText
                    amount={chargeLine.chargeLineNetAmountTxn}
                    currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
                    className="inline font-semibold"
                  />{" "}
                  {l("flows to", "su satirlara dagilir")}:{" "}
                  {chargeLine.allocations.length > 0
                    ? chargeLine.allocations
                        .map((allocation) =>
                          `${l("Line", "Satir")} ${allocation.targetLineNo}: ${
                            allocation.targetDescription || "-"
                          } (${roundDocumentUiAmount(allocation.allocatedAmountTxn || 0)})`
                        )
                        .join(" | ")
                    : l("No targets selected yet.", "Henuz hedef secilmedi.")}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {l("Subtotal", "Ara Toplam")}
          </p>
          <MoneyText
            amount={totals.netAmountTxn}
            currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
            className="mt-1 text-sm font-semibold text-slate-800"
          />
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {l("Tax Total", "Vergi Toplami")}
          </p>
          <MoneyText
            amount={totals.taxAmountTxn}
            currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
            className="mt-1 text-sm font-semibold text-slate-800"
          />
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {l("Gross Total", "Brut Toplam")}
          </p>
          <MoneyText
            amount={totals.grossAmountTxn}
            currencyCode={normalizeCurrencyCode(currencyCode) || currencyCode || "USD"}
            className="mt-1 text-sm font-semibold text-slate-800"
          />
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {l("Base Total", "Baz Toplam")}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {resolvedAmountBaseText || "-"} {functionalCurrencyCode || ""}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        {l("Derived invoice total:", "Turetilmis fatura toplami:")}{" "}
        {resolvedAmountTxnText || "-"} {normalizeCurrencyCode(currencyCode) || currencyCode || ""}
      </p>
    </div>
  );
}

export default DocumentLineWorkbench;


