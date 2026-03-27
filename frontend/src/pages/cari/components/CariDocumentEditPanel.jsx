import Combobox from "../../../components/Combobox.jsx";
import DocumentLineWorkbench from "./DocumentLineWorkbench.jsx";
import InlineCounterpartyCreateModal from "./InlineCounterpartyCreateModal.jsx";
import { normalizeLookupQuery } from "../counterpartyInlineCreate.js";
import useCariDocumentEditController from "../hooks/useCariDocumentEditController.js";

export default function CariDocumentEditPanel({
  selectedDetail = null,
  selectedSnapshot = null,
  fixedDirection = "",
  fixedAssetCategoryRefreshToken = 0,
  workingContextLegalEntities = [],
  onDocumentUpdated,
  onCancelDraft,
  onCancelAndCopyDraft,
  cancelSaving = false,
  cancelError = "",
  onOpenQuickCreateAsset,
  onOpenInlineFixedAssetCategoryCreate,
  onRequestFixedAssetCategorySetup,
  registerEditBridgeApi,
  translateDocumentMutationError,
  l,
}) {
  const controller = useCariDocumentEditController({
    selectedDetail,
    selectedSnapshot,
    fixedDirection,
    fixedAssetCategoryRefreshToken,
    workingContextLegalEntities,
    onDocumentUpdated,
    onOpenQuickCreateAsset,
    onOpenInlineFixedAssetCategoryCreate,
    onRequestFixedAssetCategorySetup,
    registerEditBridgeApi,
    translateDocumentMutationError,
    l,
  });

  const {
    canCreate,
    canReadCards,
    canUpsertCards,
    canReadCashRegisters,
    canReadGlAccounts,
    canReadOrgTree,
    canReadFixedAssetSettings,
    canUpsertFixedAssetSettings,
    canUpsertFixedAssets,
    canEditOrCancelSelected,
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
    onOpenInlineFixedAssetCategoryCreate: handleOpenInlineFixedAssetCategoryCreate,
    onPreviewAll,
    onPreviewRow,
  } = controller;

  return (
    <>
      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {l("Draft Actions", "Taslak Islemleri")}
        </h3>
        {editValidationSummary ? (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {editValidationSummary}
          </div>
        ) : null}
        {editError ? (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {editError}
          </div>
        ) : null}
        {editMessage ? (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {editMessage}
          </div>
        ) : null}
        <form className="mt-3 grid gap-2 md:grid-cols-2" onSubmit={handleUpdateDraft}>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Legal Entity ID", "Tuzel Kisilik ID")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={editForm.legalEntityId}
              onChange={(event) => handleEditLegalEntityChange(event.target.value)}
              disabled={!canEditOrCancelSelected || editSaving}
            />
          </label>
          {canReadOrgTree ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              <label className="block">
                {l("Operating Unit (optional)", "Operasyon Birimi (opsiyonel)")}
                <Combobox
                  className="mt-1"
                  value={editForm.operatingUnitId}
                  options={editOperatingUnitLookupOptions}
                  loading={editOperatingUnitsLoading}
                  disabled={!canEditOrCancelSelected || !toPositiveInt(editForm.legalEntityId) || editSaving}
                  placeholder={
                    toPositiveInt(editForm.legalEntityId)
                      ? l("Search operating unit code/name", "Operasyon birimi kodu/adi ara")
                      : l("Select legal entity first", "Once tuzel kisilik secin")
                  }
                  noOptionsText={
                    toPositiveInt(editForm.legalEntityId)
                      ? l("No operating units found.", "Operasyon birimi bulunamadi.")
                      : l("Select legal entity first.", "Once tuzel kisilik secin.")
                  }
                  onChange={(nextValue) =>
                    setEditForm((prev) => ({
                      ...prev,
                      operatingUnitId: nextValue ? String(nextValue) : "",
                    }))
                  }
                />
              </label>
              {editOperatingUnitsError ? (
                <p className="mt-1 text-[11px] normal-case text-amber-700">
                  {editOperatingUnitsError}
                </p>
              ) : null}
            </div>
          ) : (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Operating Unit ID (optional)", "Operasyon Birimi ID (opsiyonel)")}
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={editForm.operatingUnitId}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, operatingUnitId: event.target.value }))
                }
                disabled={!canEditOrCancelSelected || editSaving}
              />
            </label>
          )}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Counterparty ID", "Cari ID")}
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={editForm.counterpartyId}
              onChange={(event) =>
                setEditForm((prev) => ({ ...prev, counterpartyId: event.target.value }))
              }
              disabled={!canEditOrCancelSelected || editSaving}
            />
          </label>
          {canReadCards ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              <label className="block">
                {l("Counterparty Lookup", "Cari Arama")}
                <Combobox
                  className="mt-1"
                  value={editForm.counterpartyId}
                  options={editCounterpartyLookupOptions}
                  loading={editCounterpartyLoading}
                  disabled={!canEditOrCancelSelected || !toPositiveInt(editForm.legalEntityId) || editSaving}
                  placeholder={
                    toPositiveInt(editForm.legalEntityId)
                      ? l("Type code/name", "Kod/ad yazin")
                      : l("Select legal entity first", "Once tuzel kisilik secin")
                  }
                  noOptionsText={
                    toPositiveInt(editForm.legalEntityId)
                      ? l("No counterparties found.", "Cari bulunamadi.")
                      : l("Set legalEntityId to load counterparties.", "Carileri yuklemek icin legalEntityId secin.")
                  }
                  onInputChange={(nextValue, meta) => {
                    setEditInlineCounterpartyError("");
                    setEditInlineCounterpartyMessage("");
                    const reason = String(meta?.reason || "").trim().toLowerCase();
                    if (reason === "select" || reason === "clear") {
                      setEditCounterpartyLookupQuery("");
                      return;
                    }
                    setEditCounterpartyLookupQuery(normalizeLookupQuery(nextValue));
                  }}
                  onChange={(nextValue) =>
                    setEditForm((prev) => ({
                      ...prev,
                      counterpartyId: nextValue ? String(nextValue) : "",
                    }))
                  }
                />
              </label>
              {canUpsertCards ? (
                <button
                  type="button"
                  className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold normal-case text-slate-700 disabled:opacity-60"
                  onClick={handleInlineCreateCounterpartyForEditForm}
                  disabled={!canInlineCreateCounterpartyInEditForm || editSaving}
                >
                  {l(
                    `Create "${editInlineCounterpartyName || "new counterparty"}" with details`,
                    `"${editInlineCounterpartyName || "yeni cari"}" icin detayli kart ac`
                  )}
                </button>
              ) : null}
              {editInlineCounterpartyError ? (
                <p className="mt-1 text-[11px] normal-case text-rose-700">
                  {editInlineCounterpartyError}
                </p>
              ) : null}
              {editInlineCounterpartyMessage ? (
                <p className="mt-1 text-[11px] normal-case text-emerald-700">
                  {editInlineCounterpartyMessage}
                </p>
              ) : null}
            </div>
          ) : null}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Document Type", "Belge Turu")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={editForm.documentType}
              onChange={(event) =>
                setEditForm((prev) => ({ ...prev, documentType: event.target.value }))
              }
              disabled={!canEditOrCancelSelected || editSaving}
            >
              {DOCUMENT_TYPES.map((documentType) => (
                <option key={`edit-document-type-${documentType}`} value={documentType}>
                  {documentType}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Due Date", "Vade Tarihi")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={editForm.dueDate}
              onChange={(event) => {
                const nextDueDate = event.target.value;
                setEditDueDateTouched(Boolean(nextDueDate));
                setEditForm((prev) => ({ ...prev, dueDate: nextDueDate }));
              }}
              disabled={!canEditOrCancelSelected || editSaving || Boolean(editImmediateCashDueDate)}
              required={requiresDueDate(editForm.documentType)}
            />
            {editImmediateCashDueDate ? (
              <p className="mt-1 text-[11px] normal-case text-slate-500">
                {l(
                  "Immediate cash uses the document date as the due date.",
                  "Aninda nakit tahsilat/odeme, vade tarihi olarak belge tarihini kullanir."
                )}
              </p>
            ) : null}
          </label>
          <div className="md:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
              {l("Payment", "Odeme")}
            </p>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Mode", "Mod")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                  value={normalizeDocumentSettlementMode(editForm.settlementMode)}
                  onChange={(event) => handleEditSettlementModeChange(event.target.value)}
                  disabled={!canEditOrCancelSelected || editSaving}
                >
                  <option value="ACCRUAL">{l("On Credit (Accrual)", "Vadeli (Tahakkuk)")}</option>
                  <option value="IMMEDIATE_CASH">{editImmediateCashLabel}</option>
                </select>
              </label>
              {editImmediateCashSelected ? (
                canReadCashRegisters ? (
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <label className="block">
                      {l("Cash Register", "Kasa")}
                      <Combobox
                        className="mt-1"
                        value={editForm.settlementCashRegisterId}
                        options={editCashRegisterLookupOptions}
                        loading={editCashRegistersLoading}
                        disabled={!canEditOrCancelSelected || !toPositiveInt(editForm.legalEntityId) || editSaving}
                        placeholder={
                          toPositiveInt(editForm.legalEntityId)
                            ? l("Search cash register", "Kasa ara")
                            : l("Select legal entity first", "Once tuzel kisilik secin")
                        }
                        noOptionsText={
                          toPositiveInt(editForm.legalEntityId)
                            ? l("No cash registers found.", "Kasa bulunamadi.")
                            : l("Select legal entity first.", "Once tuzel kisilik secin.")
                        }
                        onChange={(nextValue) =>
                          setEditForm((prev) => ({
                            ...prev,
                            settlementCashRegisterId: nextValue ? String(nextValue) : "",
                          }))
                        }
                      />
                    </label>
                    {editCashRegistersError ? (
                      <p className="mt-1 text-[11px] normal-case text-amber-700">
                        {editCashRegistersError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {l("Cash Register ID", "Kasa ID")}
                    <input
                      type="number"
                      min="1"
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                      value={editForm.settlementCashRegisterId}
                      onChange={(event) =>
                        setEditForm((prev) => ({
                          ...prev,
                          settlementCashRegisterId: event.target.value,
                        }))
                      }
                      disabled={!canEditOrCancelSelected || editSaving}
                    />
                  </label>
                )
              ) : (
                <p className="text-xs font-normal normal-case text-slate-500 md:self-end">
                  {l(
                    "Accrual keeps the current flow: post the document now and settle it later from CARI Settlements.",
                    "Tahakkuk mevcut akisi korur: belgeyi simdi kayda alin, sonra CARI mahsuplastirmadan kapatin."
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="md:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
              {l("Amounts + Currency", "Tutar + Para Birimi")}
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Invoice Total (derived)", "Fatura Toplami (turetilmis)")}
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                  value={normalizeOptionalDecimalText(editDocumentFxComputation.resolvedAmountTxn)}
                  readOnly
                  disabled={!canEditOrCancelSelected || editSaving}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Invoice Currency", "Fatura Para Birimi")}
                <input
                  type="text"
                  maxLength={3}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                  value={editForm.currencyCode}
                  onChange={(event) =>
                    setEditForm((prev) => ({ ...prev, currencyCode: event.target.value }))
                  }
                  disabled={!canEditOrCancelSelected || editSaving}
                  required
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Base Amount (calculated)", "Baz Tutar (otomatik hesaplanir)")}
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                  value={editResolvedAmountBaseText}
                  readOnly
                  disabled={!canEditOrCancelSelected || editSaving}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {editDocumentFxComputation.fxRateRequired
                  ? l("FX Rate (required)", "Kur (zorunlu)")
                  : l("FX Rate", "Kur")}
                <input
                  type="number"
                  min="0.0000000001"
                  step="0.0000000001"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={editDocumentFxComputation.isLocalCurrency ? "1" : editForm.fxRate || ""}
                  onChange={(event) =>
                    setEditForm((prev) => ({ ...prev, fxRate: event.target.value }))
                  }
                  readOnly={editDocumentFxComputation.isLocalCurrency}
                  disabled={!canEditOrCancelSelected || editSaving}
                  required={editDocumentFxComputation.fxRateRequired}
                />
              </label>
            </div>
            {editFunctionalCurrencyCode ? (
              <p className="mt-2 text-[11px] text-slate-500">
                {editDocumentFxComputation.isLocalCurrency
                  ? l(
                      `Functional currency is ${editFunctionalCurrencyCode}. FX rate is fixed to 1 and base amount follows the invoice amount.`,
                      `Fonksiyonel para birimi ${editFunctionalCurrencyCode}. Kur 1 olarak sabitlenir ve baz tutar fatura tutarindan gelir.`
                    )
                  : l(
                      `Functional currency is ${editFunctionalCurrencyCode}. Base amount is calculated automatically from invoice amount x FX rate.`,
                      `Fonksiyonel para birimi ${editFunctionalCurrencyCode}. Baz tutar, fatura tutari x kur ile otomatik hesaplanir.`
                    )}
              </p>
            ) : null}
          </div>
          <DocumentLineWorkbench
            l={l}
            title={l("Commercial Lines", "Ticari Satirlar")}
            form={editForm}
            saving={!canEditOrCancelSelected || editSaving}
            gridSpanClass="md:col-span-2"
            currencyCode={editForm.currencyCode}
            functionalCurrencyCode={editFunctionalCurrencyCode}
            fxComputation={editDocumentFxComputation}
            canReadGlAccounts={canReadGlAccounts}
            lineAccountOptions={editLineAccountOptions}
            lineAccountsLoading={editLineAccountsLoading}
            lineAccountsError={editLineAccountsError}
            itemCardOptions={editItemCardOptions}
            itemCardsLoading={editItemCardsLoading}
            itemCardsError={editItemCardsError}
            warehouseOptions={editWarehouseOptions}
            warehouseLoading={editWarehousesLoading}
            warehouseError={editWarehousesError}
            warehouseInfoMessage={editWarehouseValidation.generalErrors[0] || ""}
            warehouseLineErrors={editWarehouseValidation.lineErrors}
            lineValidationMessages={editLineValidationMessages}
            taxCategoryOptions={editTaxCategoryOptions}
            taxCategoryLoading={taxCategoryLoading}
            taxCategoryError={taxCategoryError}
            previewLoading={editLinePreviewLoading}
            previewError={editLinePreviewError}
            previewMessage={editLinePreviewMessage}
            fixedAssetCategoryOptions={editFixedAssetCategoryOptions}
            fixedAssetCategoriesLoading={editFixedAssetCategoriesLoading}
            fixedAssetCategoriesError={editFixedAssetCategoriesError}
            fixedAssetCategoriesById={editFixedAssetCategoriesById}
            fixedAssetDraftOptions={editFixedAssetDraftOptions}
            fixedAssetDraftLoading={editFixedAssetDraftLoading}
            fixedAssetDraftError={editFixedAssetDraftError}
            fixedAssetDraftRowsById={editFixedAssetDraftRowsById}
            fixedAssetImprovementOptions={editFixedAssetImprovementOptions}
            fixedAssetSaleOptions={editFixedAssetSaleOptions}
            fixedAssetSaleLoading={editFixedAssetSaleLoading}
            fixedAssetSaleError={editFixedAssetSaleError}
            fixedAssetSaleRowsById={editFixedAssetSaleRowsById}
            fixedAssetOperatingUnitOptions={editFixedAssetOperatingUnitOptions}
            canReadFixedAssetSettings={canReadFixedAssetSettings}
            canUpsertFixedAssetSettings={canUpsertFixedAssetSettings}
            onOpenInlineFixedAssetCategoryCreate={handleOpenInlineFixedAssetCategoryCreate}
            onAddLine={onAddLine}
            onRemoveLine={onRemoveLine}
            onMoveLine={onMoveLine}
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
            canQuickCreateFixedAsset={canUpsertFixedAssets}
            onPreviewAll={onPreviewAll}
            onPreviewRow={onPreviewRow}
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!canEditOrCancelSelected || editSaving}
          >
            {editSaving ? l("Saving...", "Kaydediliyor...") : l("Update Draft Document", "Taslak Belgeyi Guncelle")}
          </button>
          <button
            type="button"
            className="rounded-md border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
            onClick={onCancelDraft}
            disabled={!canEditOrCancelSelected || cancelSaving}
          >
            {cancelSaving ? l("Cancelling...", "Iptal ediliyor...") : l("Cancel Draft", "Taslagi Iptal Et")}
          </button>
          {canCreate ? (
            <button
              type="button"
              className="rounded-md border border-sky-300 px-4 py-2 text-sm font-semibold text-sky-700 disabled:opacity-50"
              onClick={onCancelAndCopyDraft}
              disabled={!canEditOrCancelSelected || cancelSaving}
            >
              {cancelSaving
                ? l("Cancelling...", "Iptal ediliyor...")
                : l("Cancel + Copy to Draft", "Iptal Et + Taslaga Kopyala")}
            </button>
          ) : null}
        </form>
        {cancelError ? (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {cancelError}
          </div>
        ) : null}
      </div>

      <InlineCounterpartyCreateModal
        open={editInlineCounterpartyModalOpen}
        legalEntityId={editForm.legalEntityId}
        direction={editForm.direction}
        initialName={editCounterpartyLookupQuery}
        l={l}
        onClose={() => setEditInlineCounterpartyModalOpen(false)}
        onCreated={handleInlineCounterpartyCreatedForEditForm}
      />
    </>
  );
}
