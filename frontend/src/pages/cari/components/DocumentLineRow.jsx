import { memo, useCallback, useMemo } from "react";
import Combobox from "../../../components/Combobox.jsx";
import MoneyText from "../../../components/MoneyText.jsx";
import { Link } from "react-router-dom";
import BufferedDraftLineTextInput from "./BufferedDraftLineTextInput.jsx";
import {
  computeDocumentLineAmounts,
  DOCUMENT_LINE_CHARGE_ALLOCATION_METHODS,
  DOCUMENT_LINE_FIXED_ASSET_MODES,
  DOCUMENT_LINE_KINDS,
  DOCUMENT_LINE_STOCK_IMPACT_MODES,
  DOCUMENT_LINE_SUBLEDGER_TYPES,
} from "../cariDocumentsUtils.js";
import {
  buildFixedAssetCategorySetupIssue,
  DOCUMENT_LINE_EXPANSION_LIMIT,
  FIXED_ASSET_AP_MODE_OPTIONS,
  FIXED_ASSET_SETTINGS_PATH,
  formatFixedAssetCategoryDisplay,
  formatFixedAssetCategoryDisplayFromAssetRow,
  formatFixedAssetCategorySetupRequirementList,
  formatFixedAssetLifeMonths,
  formatFixedAssetStatusLabel,
  formatPostableAccountDisplay,
  formatWarehouseDisplay,
  normalizeChargeAllocationMethod,
  normalizeCurrencyCode,
  normalizeText,
  resolveFixedAssetDisplayAccountId,
  roundDocumentUiAmount,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";


const EMPTY_CHARGE_TARGETS = [];
const EMPTY_LINE_VALIDATION_ROWS = [];
const DOCUMENT_LINE_ROW_REFERENCE_PROP_KEYS = [
  "l",
  "line",
  "index",
  "lineCount",
  "saving",
  "legalEntityId",
  "documentDate",
  "currencyCode",
  "documentDirection",
  "lineAccountsById",
  "lineWarehouseError",
  "fixedAssetCategoriesById",
  "fixedAssetDraftRowsById",
  "fixedAssetSaleRowsById",
  "canReadGlAccounts",
  "lineAccountOptions",
  "lineAccountsLoading",
  "itemCardOptions",
  "itemCardsLoading",
  "warehouseOptions",
  "warehouseLoading",
  "taxCategoryOptions",
  "taxCategoryLoading",
  "fixedAssetCategoryOptions",
  "fixedAssetCategoriesLoading",
  "fixedAssetDraftOptions",
  "fixedAssetDraftLoading",
  "fixedAssetImprovementOptions",
  "fixedAssetSaleOptions",
  "fixedAssetSaleLoading",
  "fixedAssetOperatingUnitOptions",
  "previewLoading",
  "canQuickCreateFixedAsset",
  "canReadFixedAssetSettings",
  "canUpsertFixedAssetSettings",
  "onOpenInlineFixedAssetCategoryCreate",
  "onMoveLine",
  "onRemoveLine",
  "onPatchLine",
  "onPatchTaxSensitiveLine",
  "onChangeSubledgerType",
  "onChangeFixedAssetMode",
  "onChangeChargeAllocationMethod",
  "onToggleChargeTarget",
  "onChangeChargeTargetAmount",
  "onSelectFixedAssetCategory",
  "onSelectTargetFixedAsset",
  "onSelectItemCard",
  "onChangeStockImpactMode",
  "onSelectWarehouse",
  "onExpandFixedAssetLine",
  "onOpenQuickCreateFixedAsset",
  "onPreviewRow",
];

/**
 * Renders a single commercial line row inside the document workbench.
 */
function DocumentLineRow({
  l,
  line,
  index,
  lineCount,
  saving,
  legalEntityId,
  documentDate,
  currencyCode,
  documentDirection,
  lineAccountsById,
  chargeLinePreview,
  chargeTargetSummary,
  eligibleChargeTargets = EMPTY_CHARGE_TARGETS,
  lineValidationRows = EMPTY_LINE_VALIDATION_ROWS,
  lineWarehouseError = "",
  fixedAssetCategoriesById,
  fixedAssetDraftRowsById,
  fixedAssetSaleRowsById,
  canReadGlAccounts,
  lineAccountOptions,
  lineAccountsLoading,
  itemCardOptions,
  itemCardsLoading,
  warehouseOptions,
  warehouseLoading,
  taxCategoryOptions,
  taxCategoryLoading,
  fixedAssetCategoryOptions,
  fixedAssetCategoriesLoading,
  fixedAssetDraftOptions,
  fixedAssetDraftLoading,
  fixedAssetImprovementOptions,
  fixedAssetSaleOptions,
  fixedAssetSaleLoading,
  fixedAssetOperatingUnitOptions,
  previewLoading,
  canQuickCreateFixedAsset,
  canReadFixedAssetSettings,
  canUpsertFixedAssetSettings,
  onOpenInlineFixedAssetCategoryCreate,
  onMoveLine,
  onRemoveLine,
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
  onPreviewRow,
}) {
  const fixedAssetRowsById = useMemo(
    () =>
      new Map([
        ...(fixedAssetDraftRowsById instanceof Map
          ? [...fixedAssetDraftRowsById.entries()]
          : []),
        ...(fixedAssetSaleRowsById instanceof Map
          ? [...fixedAssetSaleRowsById.entries()]
          : []),
      ]),
    [fixedAssetDraftRowsById, fixedAssetSaleRowsById]
  );
  const handleMoveLineUp = useCallback(() => onMoveLine(line.rowId, -1), [line.rowId, onMoveLine]);
  const handleMoveLineDown = useCallback(() => onMoveLine(line.rowId, 1), [line.rowId, onMoveLine]);
  const handlePreviewRow = useCallback(() => onPreviewRow(line.rowId), [line.rowId, onPreviewRow]);
  const handleRemoveLine = useCallback(() => onRemoveLine(line.rowId), [line.rowId, onRemoveLine]);
          const lineCurrencyCode = normalizeCurrencyCode(currencyCode) || currencyCode || "USD";
          const hasTaxCategory = Boolean(normalizeText(line.taxCategoryCode));
          const isStockAffectingLine =
            normalizeText(line.stockImpactMode).toUpperCase() !== "NONE";
          const isFixedAssetLine = line.subledgerType === "FIXED_ASSET";
          const isStockLine = line.subledgerType === "STOCK";
          const isNoneLine = !isFixedAssetLine && !isStockLine;
          const isApDocument = documentDirection === "AP";
          const isArDocument = documentDirection === "AR";
          const chargeAllocationMethod = normalizeChargeAllocationMethod(
            line.chargeAllocationMethod
          );
          const isChargeLine = chargeAllocationMethod !== "NONE";
          const selectedChargeTargetRowIds = new Set(
            Array.isArray(line.chargeTargets)
              ? line.chargeTargets
                  .map((target) => String(target?.targetRowId || "").trim())
                  .filter(Boolean)
              : []
          );
          const activeFixedAssetMode =
            isFixedAssetLine && isApDocument
              ? line.fixedAssetMode || "AUTO_CREATE"
              : "LINK_EXISTING";
          const isAutoCreateMode =
            isFixedAssetLine && isApDocument && activeFixedAssetMode === "AUTO_CREATE";
          const isLinkExistingMode =
            isFixedAssetLine &&
            ((isApDocument && activeFixedAssetMode === "LINK_EXISTING") || isArDocument);
          const isImproveExistingMode =
            isFixedAssetLine && isApDocument && activeFixedAssetMode === "IMPROVE_EXISTING";
          const lockedQuantity = Boolean(
            (
              isApDocument
              && (
                activeFixedAssetMode === "LINK_EXISTING"
                || activeFixedAssetMode === "IMPROVE_EXISTING"
              )
            )
            || isArDocument
          );
          const unitCount = toPositiveInt(line.quantity);
          const canExpandAutoCreate = Boolean(
            isAutoCreateMode && unitCount && unitCount > 1
          );
          const expansionWouldExceedLimit = Boolean(
            canExpandAutoCreate && lineCount + unitCount - 1 > DOCUMENT_LINE_EXPANSION_LIMIT
          );
          const selectedCategory = fixedAssetCategoriesById.get(
            toPositiveInt(line.fixedAssetCategoryId)
          ) || null;
          const selectedCategoryLabel = selectedCategory
            ? formatFixedAssetCategoryDisplay(
                selectedCategory,
                toPositiveInt(line.fixedAssetCategoryId)
              )
            : "";
          const selectedCategorySetupIssue =
            isAutoCreateMode && selectedCategory
              ? buildFixedAssetCategorySetupIssue(selectedCategory)
              : null;
          const selectedCategorySetupRequirementList = selectedCategorySetupIssue
            ? formatFixedAssetCategorySetupRequirementList(
                selectedCategorySetupIssue.missingRequirements,
                l
              )
            : "";
          const selectedTargetAsset = fixedAssetRowsById.get(
            toPositiveInt(line.targetFixedAssetId)
          ) || null;
          const selectedTargetAssetNo = normalizeText(
            selectedTargetAsset?.assetNo || selectedTargetAsset?.asset_no
          );
          const selectedTargetAssetName = normalizeText(selectedTargetAsset?.name);
          const selectedTargetAssetLabel = selectedTargetAsset
            ? selectedTargetAssetNo && selectedTargetAssetName
              ? `${selectedTargetAssetNo} - ${selectedTargetAssetName}`
              : selectedTargetAssetNo
                || selectedTargetAssetName
                || `#${toPositiveInt(line.targetFixedAssetId)}`
            : toPositiveInt(line.targetFixedAssetId)
              ? `#${toPositiveInt(line.targetFixedAssetId)}`
              : "";
          const selectedTargetAssetCategoryLabel = selectedTargetAsset
            ? formatFixedAssetCategoryDisplayFromAssetRow(
                selectedTargetAsset,
                fixedAssetCategoriesById
              )
            : "-";
          const selectedTargetAssetCurrencyCode =
            normalizeCurrencyCode(
              selectedTargetAsset?.currencyCode || selectedTargetAsset?.currency_code
            ) || lineCurrencyCode;
          const selectedTargetAssetStatusLabel = formatFixedAssetStatusLabel(
            selectedTargetAsset?.status,
            l
          );
          const selectedTargetAssetStatus =
            normalizeText(selectedTargetAsset?.status).toUpperCase();
          const selectedTargetAssetUsefulLifeText = formatFixedAssetLifeMonths(
            selectedTargetAsset?.usefulLifeMonths ?? selectedTargetAsset?.useful_life_months,
            l
          );
          const selectedTargetAssetRemainingLifeText = formatFixedAssetLifeMonths(
            selectedTargetAsset?.remainingUsefulLifeMonths
              ?? selectedTargetAsset?.remaining_useful_life_months,
            l
          );
          const hasRevisedUsefulLifeValue = Boolean(
            normalizeText(line.revisedUsefulLifeMonths)
          );
          const hasLifeExtensionValue = Boolean(
            normalizeText(line.lifeExtensionMonths)
          );
          const fixedAssetAccountId = resolveFixedAssetDisplayAccountId(
            line,
            fixedAssetCategoriesById,
            fixedAssetRowsById
          );
          const fixedAssetAccount = lineAccountsById.get(fixedAssetAccountId) || null;
          const fixedAssetPreviewAmounts = computeDocumentLineAmounts(line);
          const effectiveLineNetAmountTxn =
            chargeTargetSummary?.effectiveAmountTxn
            ?? fixedAssetPreviewAmounts.lineNetAmountTxn;
          const allocatedChargeAmountTxn =
            chargeTargetSummary?.allocatedChargeAmountTxn || 0;
          const perUnitAmount =
            isAutoCreateMode && unitCount
              ? roundDocumentUiAmount(
                  Number(effectiveLineNetAmountTxn || 0) / unitCount
                )
              : null;
          const chargeManualDifference =
            isChargeLine && chargeAllocationMethod === "MANUAL"
              ? roundDocumentUiAmount(
                  Number(line.lineNetAmountTxn || 0)
                    - Number(chargeLinePreview?.manualTotalTxn || 0)
                )
              : null;
          const showPerUnitMetadata = Boolean(isAutoCreateMode && unitCount === 1);
          const previewStatus = normalizeText(line.previewStatus).toUpperCase();
          const previewReady =
            previewStatus === "READY" ||
            (Array.isArray(line.taxes) && line.taxes.length > 0) ||
            (hasTaxCategory && Number(line.lineTaxAmountTxn || 0) > 0);
          const warehouseLabel = formatWarehouseDisplay(
            line.warehouseId,
            line.warehouseCode,
            line.warehouseName
          );

          return (
            <div
              key={line.rowId}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {l("Line", "Satir")} {index + 1}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                    onClick={handleMoveLineUp}
                    disabled={saving || index === 0}
                  >
                    {l("Move up", "Yukari al")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                    onClick={handleMoveLineDown}
                    disabled={saving || index === lineCount - 1}
                  >
                    {l("Move down", "Asagi al")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-cyan-300 px-2 py-1 text-[11px] font-semibold text-cyan-800 disabled:opacity-60"
                    onClick={handlePreviewRow}
                    disabled={saving || previewLoading || !hasTaxCategory}
                  >
                    {l("Preview tax", "Vergiyi onizle")}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-60"
                    onClick={handleRemoveLine}
                    disabled={saving || lineCount <= 1}
                  >
                    {l("Remove", "Kaldir")}
                  </button>
                </div>
              </div>

              {lineValidationRows.length > 0 ? (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <ul className="space-y-1">
                    {lineValidationRows.map((message, messageIndex) => (
                      <li key={`${line.rowId}-validation-${messageIndex}`}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Line Type", "Satir Tipi")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={line.subledgerType}
                    onChange={(event) =>
                      onChangeSubledgerType(line.rowId, event.target.value)
                    }
                    disabled={saving}
                  >
                    {DOCUMENT_LINE_SUBLEDGER_TYPES.map((subledgerType) => (
                      <option
                        key={`line-subledger-${line.rowId}-${subledgerType}`}
                        value={subledgerType}
                      >
                        {subledgerType === "NONE"
                          ? l("General", "Genel")
                          : subledgerType === "STOCK"
                            ? l("Stock", "Stok")
                            : l("Fixed Asset", "Duran Varlik")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                  {l("Description", "Aciklama")}
                  <BufferedDraftLineTextInput
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={line.description}
                    onCommit={(nextValue) =>
                      onPatchLine(line.rowId, { description: nextValue })
                    }
                    disabled={saving}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Line Kind", "Satir Turu")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={line.lineKind}
                    onChange={(event) =>
                      onPatchTaxSensitiveLine(line.rowId, {
                        lineKind: event.target.value,
                      })
                    }
                    disabled={saving}
                  >
                    {DOCUMENT_LINE_KINDS.map((lineKind) => (
                      <option key={`line-kind-${line.rowId}-${lineKind}`} value={lineKind}>
                        {lineKind}
                      </option>
                    ))}
                  </select>
                </label>

                {isFixedAssetLine && isApDocument ? (
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {l("Asset Mode", "Varlik Modu")}
                    <select
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                      value={activeFixedAssetMode}
                      onChange={(event) =>
                        onChangeFixedAssetMode(line.rowId, event.target.value)
                      }
                      disabled={saving}
                    >
                      {FIXED_ASSET_AP_MODE_OPTIONS.map((mode) => (
                        <option key={`fa-mode-${line.rowId}-${mode}`} value={mode}>
                          {mode === "AUTO_CREATE"
                            ? l("Auto-Create", "Otomatik Olustur")
                            : mode === "LINK_EXISTING"
                              ? l("Link Existing", "Mevcut Taslagi Bagla")
                              : l("Improve Existing", "Mevcut Varligi Iyilestir")}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {(isNoneLine || isStockLine) ? (
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <label className="block">
                      {isStockLine
                        ? l("Item Card", "Urun Karti")
                        : l("Item Card (optional)", "Urun Karti (opsiyonel)")}
                      <Combobox
                        className="mt-1"
                        value={line.itemCardId}
                        options={itemCardOptions}
                        loading={itemCardsLoading}
                        disabled={saving}
                        placeholder={l("Search item card", "Urun karti ara")}
                        noOptionsText={l("No item cards found.", "Urun karti bulunamadi.")}
                        onChange={(nextValue) => onSelectItemCard(line.rowId, nextValue)}
                      />
                    </label>
                  </div>
                ) : null}

                {isFixedAssetLine && isAutoCreateMode ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <div className="flex items-center justify-between gap-3">
                        <span>{l("Asset Category", "Varlik Kategorisi")}</span>
                        {canUpsertFixedAssetSettings ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold normal-case text-cyan-700 underline underline-offset-2 disabled:opacity-60"
                            onClick={() =>
                              onOpenInlineFixedAssetCategoryCreate?.(line.rowId)
                            }
                            disabled={saving || !toPositiveInt(legalEntityId)}
                          >
                            {l("Create Category", "Kategori Olustur")}
                          </button>
                        ) : canReadFixedAssetSettings ? (
                          <a
                            href={FIXED_ASSET_SETTINGS_PATH}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-semibold normal-case text-cyan-700 underline underline-offset-2"
                          >
                            {l("Open Settings", "Ayarlari Ac")}
                          </a>
                        ) : null}
                      </div>
                      <Combobox
                        className="mt-1"
                        value={line.fixedAssetCategoryId}
                        options={fixedAssetCategoryOptions}
                        loading={fixedAssetCategoriesLoading}
                        disabled={saving}
                        placeholder={l("Search category", "Kategori ara")}
                        noOptionsText={l("No categories found.", "Kategori bulunamadi.")}
                        onChange={(nextValue) =>
                          onSelectFixedAssetCategory(line.rowId, nextValue)
                        }
                      />
                    </div>
                    {selectedCategorySetupIssue ? (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 md:col-span-4">
                        <p className="font-semibold">
                          {l(
                            "Auto-Create is blocked for this category.",
                            "Bu kategori icin Otomatik Olustur kullanilamaz."
                          )}
                        </p>
                        <p className="mt-1">
                          {l(
                            `"${selectedCategoryLabel}" is missing required defaults: ${selectedCategorySetupRequirementList}. Configure them in Fixed Asset Settings, then select the category again.`,
                            `"${selectedCategoryLabel}" kategorisinde gerekli varsayilanlar eksik: ${selectedCategorySetupRequirementList}. Demirbas Ayarlarinda yapilandirin, sonra kategoriyi yeniden secin.`
                          )}
                        </p>
                        {canReadFixedAssetSettings ? (
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <a
                              href={FIXED_ASSET_SETTINGS_PATH}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold underline underline-offset-2"
                            >
                              {l(
                                "Open Fixed Asset Settings",
                                "Demirbas Ayarlarini Ac"
                              )}
                            </a>
                            {!canUpsertFixedAssetSettings ? (
                              <span className="text-xs text-amber-800">
                                {l(
                                  "You can open the page, but you need fixed_assets.settings.upsert to update the category.",
                                  "Sayfayi acabilirsiniz ancak kategoriyi guncellemek icin fixed_assets.settings.upsert gerekir."
                                )}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-amber-800">
                            {l(
                              "Missing permission: fixed_assets.settings.read",
                              "Eksik yetki: fixed_assets.settings.read"
                            )}
                          </p>
                        )}
                      </div>
                    ) : null}
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        {l("Owner OU", "Sahip OB")}
                        <Combobox
                          className="mt-1"
                          value={line.fixedAssetOwnerOperatingUnitId}
                          options={fixedAssetOperatingUnitOptions}
                          disabled={saving}
                          placeholder={l("Search operating unit", "Operasyon birimi ara")}
                          noOptionsText={l("No operating units found.", "Operasyon birimi bulunamadi.")}
                          onChange={(nextValue) =>
                            onPatchLine(line.rowId, {
                              fixedAssetOwnerOperatingUnitId: nextValue ? String(nextValue) : "",
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <label className="block">
                        {l("Location OU", "Konum OB")}
                        <Combobox
                          className="mt-1"
                          value={line.fixedAssetLocationOperatingUnitId}
                          options={fixedAssetOperatingUnitOptions}
                          disabled={saving}
                          placeholder={l("Search operating unit", "Operasyon birimi ara")}
                          noOptionsText={l("No operating units found.", "Operasyon birimi bulunamadi.")}
                          onChange={(nextValue) =>
                            onPatchLine(line.rowId, {
                              fixedAssetLocationOperatingUnitId: nextValue
                                ? String(nextValue)
                                : "",
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.quantity}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            quantity: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                      <p>{l("Resolved Asset Account", "Cozumlenen Varlik Hesabi")}</p>
                      <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700">
                        {formatPostableAccountDisplay(fixedAssetAccount, fixedAssetAccountId)}
                      </div>
                    </div>
                    <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-950 md:col-span-4">
                      <p className="font-medium">
                        {l("Posting this line will create", "Bu satir kayda alindiginda")}{" "}
                        <span className="font-semibold">{unitCount || line.quantity || 0}</span>{" "}
                        {l("assets at", "adet varlik olusturur, birim basina")}{" "}
                        <MoneyText
                          amount={perUnitAmount}
                          currencyCode={lineCurrencyCode}
                          className="inline font-semibold"
                        />{" "}
                        {l("each.", "olacak.")}
                        {allocatedChargeAmountTxn > 0 ? (
                          <>
                            {" "}
                            {l("(includes", "(icerir")}{" "}
                            <MoneyText
                              amount={allocatedChargeAmountTxn}
                              currencyCode={lineCurrencyCode}
                              className="inline font-semibold"
                            />{" "}
                            {l("allocated charges)", "dagitilan masraf)")}
                          </>
                        ) : null}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800 disabled:opacity-60"
                          onClick={() => onExpandFixedAssetLine(line.rowId)}
                          disabled={saving || !canExpandAutoCreate || expansionWouldExceedLimit}
                        >
                          {l(
                            "Expand into individual asset lines",
                            "Tekil varlik satirlarina genislet"
                          )}
                        </button>
                        {expansionWouldExceedLimit ? (
                          <span className="text-xs text-amber-800">
                            {l(
                              `Expanding ${unitCount} units would exceed the 500-line document limit. Reduce quantity or split into separate documents.`,
                              `${unitCount} adetlik genisletme 500 satir belge sinirini asar. Miktari azaltin veya ayri belgelere bolun.`
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {showPerUnitMetadata ? (
                      <>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Asset Name Override", "Varlik Adi Gecersiz Kilma")}
                          <input
                            type="text"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={line.fixedAssetNameOverride}
                            onChange={(event) =>
                              onPatchLine(line.rowId, {
                                fixedAssetNameOverride: event.target.value,
                              })
                            }
                            disabled={saving}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Serial No", "Seri No")}
                          <input
                            type="text"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={line.fixedAssetSerialNo}
                            onChange={(event) =>
                              onPatchLine(line.rowId, {
                                fixedAssetSerialNo: event.target.value,
                              })
                            }
                            disabled={saving}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Asset Tag", "Varlik Etiketi")}
                          <input
                            type="text"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={line.fixedAssetTag}
                            onChange={(event) =>
                              onPatchLine(line.rowId, {
                                fixedAssetTag: event.target.value,
                              })
                            }
                            disabled={saving}
                          />
                        </label>
                      </>
                    ) : null}
                  </>
                ) : null}

                {isFixedAssetLine && isLinkExistingMode ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                      <label className="block">
                        {isApDocument
                          ? l("Draft Asset", "Taslak Varlik")
                          : l("Asset", "Varlik")}
                        <Combobox
                          className="mt-1"
                          value={line.targetFixedAssetId}
                          options={isApDocument ? fixedAssetDraftOptions : fixedAssetSaleOptions}
                          loading={isApDocument ? fixedAssetDraftLoading : fixedAssetSaleLoading}
                          disabled={saving}
                          placeholder={
                            isApDocument
                              ? l("Search draft asset", "Taslak varlik ara")
                              : l("Search eligible asset", "Uygun varlik ara")
                          }
                          noOptionsText={
                            isApDocument
                              ? l("No draft assets found.", "Taslak varlik bulunamadi.")
                              : l("No eligible assets found.", "Uygun varlik bulunamadi.")
                          }
                          onChange={(nextValue) =>
                            onSelectTargetFixedAsset(line.rowId, nextValue)
                          }
                        />
                      </label>
                    </div>
                    {isApDocument ? (
                      <div className="flex items-end">
                        <button
                          type="button"
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                          onClick={() => onOpenQuickCreateFixedAsset(line.rowId)}
                          disabled={saving || !canQuickCreateFixedAsset}
                        >
                          {l("+ New Asset", "+ Yeni Varlik")}
                        </button>
                      </div>
                    ) : null}
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
                        value={lockedQuantity ? "1" : line.quantity}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            quantity: event.target.value,
                          })
                        }
                        disabled={saving || lockedQuantity}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    {isApDocument ? (
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        <p>{l("Resolved Asset Account", "Cozumlenen Varlik Hesabi")}</p>
                        <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700">
                          {formatPostableAccountDisplay(fixedAssetAccount, fixedAssetAccountId)}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {isFixedAssetLine && isImproveExistingMode ? (
                  <>
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 md:col-span-4">
                      <p className="font-semibold">
                        {l(
                          "Improvement uses the line effective date. Open unposted months are day-prorated from that date; already-posted historical periods book an automatic current-period catch-up instead of rewriting history.",
                          "Iyilestirme satir bazli etkinlik tarihini kullanir. Acik ve henuz kayda alinmamis aylarda bu tarihten itibaren gun esasli dagitilir; daha once kayda alinmis tarihsel donemler ise gecmisi degistirmek yerine cari donemde otomatik catch-up kaydi olusturur."
                        )}
                      </p>
                      <p className="mt-1 text-xs text-amber-900">
                        {l(
                          "Document date remains the posting date. If the effective date is earlier than the document date, the system may post a separate catch-up depreciation journal in the current period for already-posted months.",
                          "Belge tarihi kayit tarihi olarak kalir. Etkinlik tarihi belge tarihinden daha erkense, sistem daha once kayda alinmis aylar icin cari donemde ayri bir catch-up amortisman yevmiyesi olusturabilir."
                        )}
                      </p>
                      {allocatedChargeAmountTxn > 0 ? (
                        <p className="mt-2 text-xs text-amber-900">
                          {l(
                            "This improvement amount already includes allocated charges before the effective-date and catch-up logic runs.",
                            "Bu iyilestirme tutari, etkinlik tarihi ve catch-up mantigi calismadan once dagitilan masraflari zaten icerir."
                          )}{" "}
                          <MoneyText
                            amount={allocatedChargeAmountTxn}
                            currencyCode={lineCurrencyCode}
                            className="inline font-semibold"
                          />
                        </p>
                      ) : null}
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                      <label className="block">
                        {l("Target Asset", "Hedef Varlik")}
                        <Combobox
                          className="mt-1"
                          value={line.targetFixedAssetId}
                          options={fixedAssetImprovementOptions}
                          loading={fixedAssetSaleLoading}
                          disabled={saving}
                          placeholder={l(
                            "Search improvement-eligible asset",
                            "Iyilestirmeye uygun varlik ara"
                          )}
                          noOptionsText={l(
                            "No improvement-eligible assets found.",
                            "Iyilestirmeye uygun varlik bulunamadi."
                          )}
                          onChange={(nextValue) =>
                            onSelectTargetFixedAsset(line.rowId, nextValue)
                          }
                        />
                      </label>
                    </div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
                        value="1"
                        disabled
                        readOnly
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Improvement Effective Date", "Iyilestirme Etkinlik Tarihi")}
                      <input
                        type="date"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.improvementEffectiveDate}
                        onChange={(event) =>
                          onPatchLine(line.rowId, {
                            improvementEffectiveDate: event.target.value,
                          })
                        }
                        disabled={saving}
                        max={documentDate || undefined}
                      />
                      <span className="mt-1 block normal-case tracking-normal text-[11px] text-slate-500">
                        {l(
                          "Defaults to the bill document date. Use an earlier date only when the economic improvement happened before the bill was entered.",
                          "Varsayilan olarak belge tarihini kullanir. Yalnizca ekonomik iyilestirme fatura girilmeden once gerceklesmisse daha erken bir tarih kullanin."
                        )}
                      </span>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                      <p>{l("Resolved Asset Account", "Cozumlenen Varlik Hesabi")}</p>
                      <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700">
                        {formatPostableAccountDisplay(fixedAssetAccount, fixedAssetAccountId)}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {l("Target Context", "Hedef Baglam")}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {selectedTargetAssetLabel || l("Select an asset", "Bir varlik secin")}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {l(
                              "The selected asset category controls the capitalization account shown above.",
                              "Secilen varlik kategorisi yukarida gosterilen aktiflestirme hesabini belirler."
                            )}
                          </p>
                        </div>
                        {selectedTargetAssetStatus === "FULLY_DEPRECIATED" ? (
                          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                            {l(
                              "Life change required to reactivate",
                              "Yeniden aktiflestirme icin omur degisikligi gerekli"
                            )}
                          </span>
                        ) : null}
                      </div>
                      {selectedTargetAsset ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {l("Asset No", "Varlik No")}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">
                              {normalizeText(
                                selectedTargetAsset.assetNo || selectedTargetAsset.asset_no
                              ) || "-"}
                            </p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {l("Asset Name", "Varlik Adi")}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">
                              {normalizeText(selectedTargetAsset.name) || "-"}
                            </p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {l("Status", "Durum")}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">
                              {selectedTargetAssetStatusLabel}
                            </p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {l("Category", "Kategori")}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">
                              {selectedTargetAssetCategoryLabel}
                            </p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {l("Current Cost", "Mevcut Maliyet")}
                            </p>
                            <div className="mt-1 text-sm font-semibold text-slate-800">
                              <MoneyText
                                amount={
                                  selectedTargetAsset.originalCostTxn
                                  ?? selectedTargetAsset.original_cost_txn
                                }
                                currencyCode={selectedTargetAssetCurrencyCode}
                              />
                            </div>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {l("Useful Life", "Faydali Omur")}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">
                              {selectedTargetAssetUsefulLifeText}
                            </p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 md:col-span-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {l("Remaining Life", "Kalan Omur")}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">
                              {selectedTargetAssetRemainingLifeText}
                            </p>
                          </div>
                        </div>
                      ) : line.targetFixedAssetId ? (
                        <p className="mt-3 text-xs text-amber-700">
                          {l(
                            "The selected asset is outside the current lookup scope. Re-select the target asset to refresh its context.",
                            "Secili varlik guncel arama kapsaminda degil. Baglami yenilemek icin hedef varligi yeniden secin."
                          )}
                        </p>
                      ) : (
                        <p className="mt-3 text-xs text-slate-600">
                          {l(
                            "Select an ACTIVE, SUSPENDED, or FULLY_DEPRECIATED asset to review its current cost, life, and status before posting.",
                            "Kayit oncesinde mevcut maliyet, omur ve durumu incelemek icin ACTIVE, SUSPENDED veya FULLY_DEPRECIATED bir varlik secin."
                          )}
                        </p>
                      )}
                    </div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Revised Useful Life (months)", "Revize Faydali Omur (ay)")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-50"
                        value={line.revisedUsefulLifeMonths}
                        onChange={(event) =>
                          onPatchLine(line.rowId, {
                            revisedUsefulLifeMonths: event.target.value,
                            lifeExtensionMonths: event.target.value ? "" : line.lifeExtensionMonths,
                          })
                        }
                        disabled={saving || hasLifeExtensionValue}
                        placeholder={l("Leave blank to keep current life", "Mevcut omru korumak icin bos birakin")}
                      />
                      <span className="mt-1 block normal-case tracking-normal text-[11px] text-slate-500">
                        {l(
                          "Use this for an absolute total life revision. Leave blank if you want to extend life instead.",
                          "Toplam omru mutlak olarak revize etmek icin bunu kullanin. Bunun yerine omur uzatacaksaniz bos birakin."
                        )}
                      </span>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Life Extension (months)", "Omur Uzatimi (ay)")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-50"
                        value={line.lifeExtensionMonths}
                        onChange={(event) =>
                          onPatchLine(line.rowId, {
                            lifeExtensionMonths: event.target.value,
                            revisedUsefulLifeMonths: event.target.value ? "" : line.revisedUsefulLifeMonths,
                          })
                        }
                        disabled={saving || hasRevisedUsefulLifeValue}
                        placeholder={l("Leave blank to keep current life", "Mevcut omru korumak icin bos birakin")}
                      />
                      <span className="mt-1 block normal-case tracking-normal text-[11px] text-slate-500">
                        {l(
                          "Use this for a relative extension on top of the current remaining life.",
                          "Bunu mevcut kalan omrun uzerine goreli bir uzatma icin kullanin."
                        )}
                      </span>
                    </label>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700 md:col-span-2">
                      <p className="font-semibold text-slate-800">
                        {l("Life Input Rule", "Omur Giris Kurali")}
                      </p>
                      <p className="mt-1">
                        {l(
                          "Enter only one life field. Leave both blank to keep the current useful life and remaining life unchanged.",
                          "Yalnizca bir omur alani girin. Mevcut faydali omru ve kalan omru degistirmemek icin ikisini de bos birakin."
                        )}
                      </p>
                    </div>
                  </>
                ) : null}

                {isStockLine ? (
                  <>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {isStockAffectingLine
                        ? l("Warehouse (required)", "Depo (zorunlu)")
                        : l("Warehouse", "Depo")}
                      <Combobox
                        className="mt-1"
                        value={line.warehouseId}
                        options={warehouseOptions}
                        loading={warehouseLoading}
                        disabled={saving || !isStockAffectingLine}
                        clearable
                        placeholder={
                          isStockAffectingLine
                            ? l("Search warehouse", "Depo ara")
                            : l("Select stock impact first", "Once stok etkisini secin")
                        }
                        noOptionsText={l("No warehouses found.", "Depo bulunamadi.")}
                        onChange={(nextValue) => onSelectWarehouse(line.rowId, nextValue)}
                      />
                      {lineWarehouseError ? (
                        <span className="mt-1 block normal-case tracking-normal text-[11px] text-amber-700">
                          {lineWarehouseError}
                        </span>
                      ) : null}
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Stock Impact", "Stok Etkisi")}
                      <select
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.stockImpactMode}
                        onChange={(event) =>
                          onChangeStockImpactMode(line.rowId, event.target.value)
                        }
                        disabled={saving}
                      >
                        {DOCUMENT_LINE_STOCK_IMPACT_MODES.map((mode) => (
                          <option key={`stock-impact-${line.rowId}-${mode}`} value={mode}>
                            {mode === "NONE"
                              ? l("None", "Yok")
                              : mode === "RECEIPT_PENDING"
                                ? l("Receipt Pending", "Giris Bekliyor")
                                : l("Issue Pending", "Cikis Bekliyor")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.quantity}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            quantity: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    {canReadGlAccounts ? (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {l("Posting Account (optional)", "Kayit Hesabi (opsiyonel)")}
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving || lineAccountsLoading}
                        >
                          <option value="">
                            {l(
                              "Use purpose/default mapping",
                              "Amac/varsayilan eslemeyi kullan"
                            )}
                          </option>
                          {lineAccountOptions.map((row) => (
                            <option key={`line-account-${line.rowId}-${row.id}`} value={String(row.id)}>
                              {row.code} - {row.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {l("Posting Account ID (optional)", "Kayit Hesabi ID (opsiyonel)")}
                        <input
                          type="number"
                          min="1"
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving}
                        />
                      </label>
                    )}
                  </>
                ) : null}

                {isNoneLine ? (
                  <>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Quantity", "Miktar")}
                      <input
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.quantity}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            quantity: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Unit Price", "Birim Fiyat")}
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                        value={line.unitPriceTxn}
                        onChange={(event) =>
                          onPatchTaxSensitiveLine(line.rowId, {
                            unitPriceTxn: event.target.value,
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Tax Category", "Vergi Kategorisi")}
                      {taxCategoryOptions.length > 0 ? (
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving || taxCategoryLoading}
                        >
                          <option value="">{l("Optional", "Opsiyonel")}</option>
                          {taxCategoryOptions.map((option) => (
                            <option
                              key={`line-tax-category-${line.rowId}-${option.value}`}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          maxLength={60}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                          value={line.taxCategoryCode}
                          onChange={(event) =>
                            onPatchTaxSensitiveLine(line.rowId, {
                              taxCategoryCode: event.target.value,
                            })
                          }
                          disabled={saving}
                          placeholder={l("Optional", "Opsiyonel")}
                        />
                      )}
                    </label>
                    {isApDocument ? (
                      <div className="rounded-md border border-slate-200 bg-white px-3 py-3 md:col-span-2">
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-slate-300"
                            checked={isChargeLine}
                            onChange={(event) =>
                              onChangeChargeAllocationMethod(
                                line.rowId,
                                event.target.checked ? "EQUAL" : "NONE"
                              )
                            }
                            disabled={saving}
                          />
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                              {l("Distribute as Charge", "Masraf Olarak Dagit")}
                            </p>
                            <p className="mt-1 text-xs font-normal normal-case text-slate-600">
                              {l(
                                "Charge lines do not post their own debit. Their net amount is absorbed into the selected target lines at posting time.",
                                "Masraf satirlari kendi borc kaydini olusturmaz. Net tutar, kayit aninda secilen hedef satirlara dagitilir."
                              )}
                            </p>
                          </div>
                        </label>
                      </div>
                    ) : null}
                    {isChargeLine ? (
                      <>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                          {l("Charge Allocation Method", "Masraf Dagitim Metodu")}
                          <select
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={chargeAllocationMethod}
                            onChange={(event) =>
                              onChangeChargeAllocationMethod(line.rowId, event.target.value)
                            }
                            disabled={saving}
                          >
                            {DOCUMENT_LINE_CHARGE_ALLOCATION_METHODS.filter(
                              (value) => value !== "NONE"
                            ).map((method) => (
                              <option
                                key={`line-charge-method-${line.rowId}-${method}`}
                                value={method}
                              >
                                {method === "EQUAL"
                                  ? l("Equal", "Esit")
                                  : method === "BY_AMOUNT"
                                    ? l("By Amount", "Tutara Gore")
                                    : method === "BY_QTY"
                                      ? l("By Quantity", "Miktara Gore")
                                      : l("Manual", "Manuel")}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-950 md:col-span-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                                {l("Charge Targets", "Masraf Hedefleri")}
                              </p>
                              <p className="mt-1 text-xs text-cyan-900">
                                {l(
                                  "Pick one or more non-charge STANDARD lines on this bill.",
                                  "Bu faturadaki charge olmayan STANDARD satirlardan bir veya daha fazlasini secin."
                                )}
                              </p>
                            </div>
                            <p className="text-xs text-cyan-900">
                              {l(
                                "Tax still posts normally on the charge line.",
                                "Masraf satirinin vergisi normal sekilde kayda gider."
                              )}
                            </p>
                          </div>
                          {eligibleChargeTargets.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {eligibleChargeTargets.map((target) => {
                                const targetRowId = String(target.rowId || "");
                                const isTargetSelected = selectedChargeTargetRowIds.has(targetRowId);
                                const previewAllocation =
                                  chargeLinePreview?.allocations?.find(
                                    (entry) =>
                                      String(entry?.targetRowId || "") === targetRowId
                                  ) || null;
                                return (
                                  <div
                                    key={`charge-target-${line.rowId}-${targetRowId}`}
                                    className={`rounded-md border px-3 py-3 ${
                                      isTargetSelected
                                        ? "border-cyan-300 bg-white"
                                        : "border-cyan-100 bg-cyan-25"
                                    }`}
                                  >
                                    <label className="flex items-start gap-3">
                                      <input
                                        type="checkbox"
                                        className="mt-1 h-4 w-4 rounded border-slate-300"
                                        checked={isTargetSelected}
                                        onChange={() =>
                                          onToggleChargeTarget(line.rowId, targetRowId)
                                        }
                                        disabled={saving}
                                      />
                                      <div className="flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            {l("Line", "Satir")} {target.lineNo}
                                          </span>
                                          <span className="text-sm font-semibold text-slate-900">
                                            {target.description || l("No description", "Aciklama yok")}
                                          </span>
                                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                            {target.subledgerType === "FIXED_ASSET"
                                              ? l("Fixed Asset", "Duran Varlik")
                                              : target.subledgerType === "STOCK"
                                                ? l("Stock", "Stok")
                                                : l("General", "Genel")}
                                          </span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-600">
                                          <span>
                                            {l("Original", "Orijinal")}:{" "}
                                            <MoneyText
                                              amount={target.lineNetAmountTxn}
                                              currencyCode={lineCurrencyCode}
                                              className="inline"
                                            />
                                          </span>
                                          {previewAllocation ? (
                                            <span>
                                              {chargeAllocationMethod === "MANUAL"
                                                ? l("Manual split", "Manuel dagitim")
                                                : l("Computed split", "Hesaplanan dagitim")}
                                              :{" "}
                                              <MoneyText
                                                amount={previewAllocation.allocatedAmountTxn}
                                                currencyCode={lineCurrencyCode}
                                                className="inline"
                                              />
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                    </label>
                                    {isTargetSelected && chargeAllocationMethod === "MANUAL" ? (
                                      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                                        {l("Allocated Amount", "Dagitilan Tutar")}
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.000001"
                                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                                          value={
                                            Array.isArray(line.chargeTargets)
                                              ? line.chargeTargets.find(
                                                  (targetRow) =>
                                                    String(targetRow?.targetRowId || "")
                                                      === targetRowId
                                                )?.allocatedAmountTxn || ""
                                              : ""
                                          }
                                          onChange={(event) =>
                                            onChangeChargeTargetAmount(
                                              line.rowId,
                                              targetRowId,
                                              event.target.value
                                            )
                                          }
                                          disabled={saving}
                                        />
                                      </label>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-3 text-xs text-amber-800">
                              {l(
                                "No eligible STANDARD target lines are available yet. Add another non-charge line first.",
                                "Henuz uygun STANDARD hedef satir yok. Once charge olmayan baska bir satir ekleyin."
                              )}
                            </p>
                          )}
                          {chargeAllocationMethod === "MANUAL" ? (
                            <p className="mt-3 text-xs text-cyan-900">
                              {l("Allocated total", "Dagitilan toplam")}:{" "}
                              <MoneyText
                                amount={chargeLinePreview?.manualTotalTxn || 0}
                                currencyCode={lineCurrencyCode}
                                className="inline font-semibold"
                              />{" "}
                              | {l("Difference", "Fark")}:{" "}
                              <MoneyText
                                amount={chargeManualDifference}
                                currencyCode={lineCurrencyCode}
                                className={`inline font-semibold ${
                                  Math.abs(Number(chargeManualDifference || 0)) > 0.01
                                    ? "text-rose-700"
                                    : "text-emerald-700"
                                }`}
                              />
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                    {canReadGlAccounts ? (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {isChargeLine
                          ? l(
                              "Posting Account (ignored for charge lines)",
                              "Kayit Hesabi (masraf satirinda yok sayilir)"
                            )
                          : l("Posting Account (optional)", "Kayit Hesabi (opsiyonel)")}
                        <select
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving || lineAccountsLoading || isChargeLine}
                        >
                          <option value="">
                            {l(
                              "Use purpose/default mapping",
                              "Amac/varsayilan eslemeyi kullan"
                            )}
                          </option>
                          {lineAccountOptions.map((row) => (
                            <option key={`line-account-${line.rowId}-${row.id}`} value={String(row.id)}>
                              {row.code} - {row.name}
                            </option>
                          ))}
                        </select>
                        {isChargeLine ? (
                          <span className="mt-1 block normal-case tracking-normal text-[11px] text-slate-500">
                            {l(
                              "The charge line debit is absorbed into its selected target lines.",
                              "Masraf satirinin borc kaydi secilen hedef satirlara dagitilir."
                            )}
                          </span>
                        ) : null}
                      </label>
                    ) : (
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                        {isChargeLine
                          ? l(
                              "Posting Account ID (ignored for charge lines)",
                              "Kayit Hesabi ID (masraf satirinda yok sayilir)"
                            )
                          : l("Posting Account ID (optional)", "Kayit Hesabi ID (opsiyonel)")}
                        <input
                          type="number"
                          min="1"
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={line.postingAccountId}
                          onChange={(event) =>
                            onPatchLine(line.rowId, {
                              postingAccountId: event.target.value,
                            })
                          }
                          disabled={saving || isChargeLine}
                        />
                        {isChargeLine ? (
                          <span className="mt-1 block normal-case tracking-normal text-[11px] text-slate-500">
                            {l(
                              "The charge line debit is absorbed into its selected target lines.",
                              "Masraf satirinin borc kaydi secilen hedef satirlara dagitilir."
                            )}
                          </span>
                        ) : null}
                      </label>
                    )}
                  </>
                ) : null}

              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {l("Net", "Net")}
                  </p>
                  <MoneyText
                    amount={line.lineNetAmountTxn}
                    currencyCode={lineCurrencyCode}
                    className="mt-1 text-sm font-semibold text-slate-800"
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {l("Tax", "Vergi")}
                  </p>
                  <MoneyText
                    amount={line.lineTaxAmountTxn}
                    currencyCode={lineCurrencyCode}
                    className="mt-1 text-sm font-semibold text-slate-800"
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {l("Gross", "Brut")}
                  </p>
                  <MoneyText
                    amount={line.lineGrossAmountTxn}
                    currencyCode={lineCurrencyCode}
                    className="mt-1 text-sm font-semibold text-slate-800"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                {isFixedAssetLine ? (
                  <>
                    <span>
                      {l("Asset mode", "Varlik modu")}:{" "}
                      {isApDocument
                        ? activeFixedAssetMode || "-"
                        : l("Existing asset", "Mevcut varlik")}
                    </span>
                    <span>
                      {l("Target asset", "Hedef varlik")}:{" "}
                      {selectedTargetAsset?.assetNo ||
                        selectedTargetAsset?.name ||
                        line.targetFixedAssetId ||
                        "-"}
                    </span>
                    <span>
                      {l("Category", "Kategori")}:{" "}
                      {selectedCategory?.code ||
                        selectedCategory?.name ||
                        line.fixedAssetCategoryId ||
                        selectedTargetAsset?.categoryCode ||
                        selectedTargetAsset?.categoryName ||
                        "-"}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      {isChargeLine
                        ? l("Charge method", "Masraf metodu")
                        : l("Stock impact", "Stok etkisi")}
                      :{" "}
                      {isChargeLine ? chargeAllocationMethod : line.stockImpactMode || "NONE"}
                    </span>
                    <span>
                      {isChargeLine
                        ? l("Charge targets", "Masraf hedefleri")
                        : l("Item card", "Urun karti")}
                      :{" "}
                      {isChargeLine
                        ? chargeLinePreview?.allocations?.length || 0
                        : line.itemCardId || "-"}
                    </span>
                    <span>
                      {isChargeLine
                        ? l("Absorbed debit", "Dagitilan borc")
                        : l("Warehouse", "Depo")}
                      :{" "}
                      {isChargeLine ? l("Yes", "Evet") : warehouseLabel}
                    </span>
                  </>
                )}
              </div>

              {line.previewError ? (
                <p className="mt-2 text-xs text-rose-700">{line.previewError}</p>
              ) : null}
              {!line.previewError && hasTaxCategory && !previewReady ? (
                <p className="mt-2 text-xs text-amber-700">
                  {l(
                    "Tax category is set. Refresh preview to update invoice totals before saving.",
                    "Vergi kategorisi secili. Kaydetmeden once fatura toplamlarini guncellemek icin onizlemeyi yenileyin."
                  )}
                </p>
              ) : null}
              {previewReady && Array.isArray(line.taxes) && line.taxes.length > 0 ? (
                <div className="mt-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                    {l("Tax preview", "Vergi onizlemesi")}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-cyan-950">
                    {line.taxes.map((taxRow, taxIndex) => (
                      <li key={`line-tax-${line.rowId}-${taxRow.componentNo || taxIndex}`}>
                        {(taxRow.taxCode || l("Tax", "Vergi"))} | {taxRow.ratePct ?? 0}% |{" "}
                        <MoneyText
                          amount={taxRow.taxAmountTxn}
                          currencyCode={lineCurrencyCode}
                          className="inline"
                        />
                        {taxRow.taxPurposeCode ? ` | ${taxRow.taxPurposeCode}` : ""}
                        {taxRow.accountId ? ` | account #${taxRow.accountId}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
}

function areStringListsEqual(previousRows, nextRows) {
  if (previousRows === nextRows) {
    return true;
  }
  if (!Array.isArray(previousRows) || !Array.isArray(nextRows)) {
    return previousRows === nextRows;
  }
  if (previousRows.length !== nextRows.length) {
    return false;
  }
  for (let index = 0; index < previousRows.length; index += 1) {
    if (previousRows[index] !== nextRows[index]) {
      return false;
    }
  }
  return true;
}

function areEligibleChargeTargetsEqual(previousTargets, nextTargets) {
  if (previousTargets === nextTargets) {
    return true;
  }
  if (!Array.isArray(previousTargets) || !Array.isArray(nextTargets)) {
    return previousTargets === nextTargets;
  }
  if (previousTargets.length !== nextTargets.length) {
    return false;
  }
  for (let index = 0; index < previousTargets.length; index += 1) {
    const previousTarget = previousTargets[index] || null;
    const nextTarget = nextTargets[index] || null;
    if (
      String(previousTarget?.rowId || "") !== String(nextTarget?.rowId || "")
      || Number(previousTarget?.lineNo || 0) !== Number(nextTarget?.lineNo || 0)
      || String(previousTarget?.description || "") !== String(nextTarget?.description || "")
      || String(previousTarget?.subledgerType || "") !== String(nextTarget?.subledgerType || "")
      || Number(previousTarget?.lineNetAmountTxn || 0) !== Number(nextTarget?.lineNetAmountTxn || 0)
    ) {
      return false;
    }
  }
  return true;
}

function areChargeAllocationsEqual(previousAllocations, nextAllocations) {
  if (previousAllocations === nextAllocations) {
    return true;
  }
  if (!Array.isArray(previousAllocations) || !Array.isArray(nextAllocations)) {
    return previousAllocations === nextAllocations;
  }
  if (previousAllocations.length !== nextAllocations.length) {
    return false;
  }
  for (let index = 0; index < previousAllocations.length; index += 1) {
    const previousAllocation = previousAllocations[index] || null;
    const nextAllocation = nextAllocations[index] || null;
    if (
      String(previousAllocation?.targetRowId || "") !== String(nextAllocation?.targetRowId || "")
      || Number(previousAllocation?.targetLineNo || 0) !== Number(nextAllocation?.targetLineNo || 0)
      || String(previousAllocation?.targetDescription || "")
        !== String(nextAllocation?.targetDescription || "")
      || String(previousAllocation?.targetSubledgerType || "")
        !== String(nextAllocation?.targetSubledgerType || "")
      || Number(previousAllocation?.allocatedAmountTxn || 0)
        !== Number(nextAllocation?.allocatedAmountTxn || 0)
    ) {
      return false;
    }
  }
  return true;
}

function areChargeLinePreviewsEqual(previousPreview, nextPreview) {
  if (previousPreview === nextPreview) {
    return true;
  }
  if (!previousPreview || !nextPreview) {
    return previousPreview === nextPreview;
  }
  return (
    String(previousPreview.chargeLineRowId || "") === String(nextPreview.chargeLineRowId || "")
    && Number(previousPreview.chargeLineNo || 0) === Number(nextPreview.chargeLineNo || 0)
    && String(previousPreview.chargeLineDescription || "")
      === String(nextPreview.chargeLineDescription || "")
    && String(previousPreview.chargeAllocationMethod || "")
      === String(nextPreview.chargeAllocationMethod || "")
    && Number(previousPreview.chargeLineNetAmountTxn || 0)
      === Number(nextPreview.chargeLineNetAmountTxn || 0)
    && Number(previousPreview.manualTotalTxn || 0) === Number(nextPreview.manualTotalTxn || 0)
    && areChargeAllocationsEqual(previousPreview.allocations, nextPreview.allocations)
  );
}

function areChargeTargetSummariesEqual(previousSummary, nextSummary) {
  if (previousSummary === nextSummary) {
    return true;
  }
  if (!previousSummary || !nextSummary) {
    return previousSummary === nextSummary;
  }
  return (
    String(previousSummary.rowId || "") === String(nextSummary.rowId || "")
    && Number(previousSummary.lineNo || 0) === Number(nextSummary.lineNo || 0)
    && String(previousSummary.description || "") === String(nextSummary.description || "")
    && String(previousSummary.subledgerType || "") === String(nextSummary.subledgerType || "")
    && String(previousSummary.fixedAssetMode || "") === String(nextSummary.fixedAssetMode || "")
    && Number(previousSummary.quantity || 0) === Number(nextSummary.quantity || 0)
    && Number(previousSummary.originalAmountTxn || 0) === Number(nextSummary.originalAmountTxn || 0)
    && Number(previousSummary.allocatedChargeAmountTxn || 0)
      === Number(nextSummary.allocatedChargeAmountTxn || 0)
    && Number(previousSummary.effectiveAmountTxn || 0) === Number(nextSummary.effectiveAmountTxn || 0)
    && Number(previousSummary.effectiveUnitAmountTxn || 0)
      === Number(nextSummary.effectiveUnitAmountTxn || 0)
  );
}

function areDocumentLineRowPropsEqual(previousProps, nextProps) {
  for (const key of DOCUMENT_LINE_ROW_REFERENCE_PROP_KEYS) {
    if (previousProps[key] !== nextProps[key]) {
      return false;
    }
  }

  return (
    areChargeLinePreviewsEqual(previousProps.chargeLinePreview, nextProps.chargeLinePreview)
    && areChargeTargetSummariesEqual(
      previousProps.chargeTargetSummary,
      nextProps.chargeTargetSummary
    )
    && areEligibleChargeTargetsEqual(
      previousProps.eligibleChargeTargets,
      nextProps.eligibleChargeTargets
    )
    && areStringListsEqual(previousProps.lineValidationRows, nextProps.lineValidationRows)
  );
}

DocumentLineRow.displayName = "DocumentLineRow";

export default memo(DocumentLineRow, areDocumentLineRowPropsEqual);
