
import Combobox from "../../../components/Combobox.jsx";
import DocumentLineWorkbench from "./DocumentLineWorkbench.jsx";
import InlineCounterpartyCreateModal from "./InlineCounterpartyCreateModal.jsx";
import { normalizeLookupQuery } from "../counterpartyInlineCreate.js";
import useCariDocumentCreateController from "../hooks/useCariDocumentCreateController.js";
export default function CariDocumentsCreateSection({
  fixedDirection = "",
  fixedAssetCategoryRefreshToken = 0,
  canCopySelectedToDraft = false,
  onCopySelectedDocumentToCreateForm,
  onDraftCreated,
  onOpenQuickCreateAsset,
  onOpenInlineFixedAssetCategoryCreate,
  onRequestFixedAssetCategorySetup,
  registerCreateBridgeApi,
  translateDocumentMutationError,
}) {
  const controller = useCariDocumentCreateController({
    fixedDirection,
    fixedAssetCategoryRefreshToken,
    onDraftCreated,
    onOpenQuickCreateAsset,
    onOpenInlineFixedAssetCategoryCreate,
    onRequestFixedAssetCategorySetup,
    registerCreateBridgeApi,
    translateDocumentMutationError,
  });
  const {
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
    onOpenInlineFixedAssetCategoryCreate: handleOpenInlineFixedAssetCategoryCreate,
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
  } = controller;
  if (!canCreate) {
    return null;
  }
  return (
    <>
      <section
        id="create-draft-document"
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {createDraftDocumentTitle}
        </h2>
        {createValidationSummary ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {createValidationSummary}
          </div>
        ) : null}
        {createError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {createError}
          </div>
        ) : null}
        {createMessage ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {createMessage}
          </div>
        ) : null}
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Clone + Recurring Templates", "Kopyala + Tekrarlayan Sablonlar")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              onClick={onCopySelectedDocumentToCreateForm}
              disabled={!canCopySelectedToDraft || createSaving}
            >
              {l("Clone Selected Document", "Secili Belgeyi Kopyala")}
            </button>
            <select
              className="min-w-[220px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={selectedDraftTemplateId}
              onChange={(event) => setSelectedDraftTemplateId(event.target.value)}
              disabled={
                draftTemplatesLoading ||
                draftTemplatesSaving ||
                draftTemplates.length === 0 ||
                createSaving
              }
            >
              <option value="">{l("Select recurring template", "Tekrarlayan sablon secin")}</option>
              {draftTemplates.map((row) => (
                <option key={`document-draft-template-${row.id}`} value={row.id}>
                  {row.name}
                  {row.isDefault ? l(" (default)", " (varsayilan)") : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              onClick={() => applyDocumentDraftTemplate(selectedDraftTemplate)}
              disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
            >
              {l("Apply Template", "Sablonu Uygula")}
            </button>
            <button
              type="button"
              className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
              onClick={handleCreateDocumentDraftTemplate}
              disabled={draftTemplatesSaving || createSaving}
            >
              {l("Save Current Template", "Mevcut Sablonu Kaydet")}
            </button>
            <button
              type="button"
              className="rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-60"
              onClick={handleUpdateDocumentDraftTemplate}
              disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
            >
              {l("Update Template", "Sablonu Guncelle")}
            </button>
            <button
              type="button"
              className="rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
              onClick={handleSetDefaultDocumentDraftTemplate}
              disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
            >
              {l("Set Default", "Varsayilan Yap")}
            </button>
            <button
              type="button"
              className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
              onClick={handleDeleteDocumentDraftTemplate}
              disabled={!selectedDraftTemplate || draftTemplatesSaving || createSaving}
            >
              {l("Delete", "Sil")}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
              onClick={() =>
                loadDocumentDraftTemplates({ preferredId: selectedDraftTemplateId })
              }
              disabled={draftTemplatesLoading || draftTemplatesSaving || createSaving}
            >
              {draftTemplatesLoading
                ? l("Loading...", "Yukleniyor...")
                : l("Refresh Templates", "Sablonlari Yenile")}
            </button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Recurring Cadence", "Tekrar Araligi")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={createRecurringRule.cadence}
                onChange={(event) =>
                  setCreateRecurringRule((prev) => ({
                    ...prev,
                    cadence: normalizeRecurringCadence(event.target.value),
                  }))
                }
                disabled={createSaving}
              >
                {DOCUMENT_RECURRING_TEMPLATE_CADENCES.map((cadence) => (
                  <option key={`create-recurring-cadence-${cadence}`} value={cadence}>
                    {cadence}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Repeat Every", "Her Tekrar")}
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={createRecurringRule.interval}
                onChange={(event) =>
                  setCreateRecurringRule((prev) => ({
                    ...prev,
                    interval: normalizeRecurringInterval(event.target.value),
                  }))
                }
                disabled={createSaving}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Anchor Day (optional)", "Sabit Gun (opsiyonel)")}
              <input
                type="number"
                min="1"
                max="31"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={createRecurringRule.anchorDay}
                onChange={(event) =>
                  setCreateRecurringRule((prev) => ({
                    ...prev,
                    anchorDay: normalizeRecurringAnchorDay(event.target.value),
                  }))
                }
                disabled={createSaving}
              />
            </label>
          </div>
          {draftTemplatesError ? (
            <p className="mt-2 text-xs text-rose-700">{draftTemplatesError}</p>
          ) : null}
          {draftTemplatesMessage ? (
            <p className="mt-2 text-xs text-emerald-700">{draftTemplatesMessage}</p>
          ) : null}
        </div>
        <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={handleCreateDraft}>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox
                className="mt-1"
                value={createForm.legalEntityId}
                options={createLegalEntityLookupOptions}
                loading={createLegalEntityLookupLoading}
                disabled={createSaving || createLegalEntityLookupOptions.length === 0}
                placeholder={
                  createLegalEntityLookupOptions.length > 0
                    ? l("Search legal entity code/name", "Tuzel kisilik kodu/adi ara")
                    : l("No legal entities available", "Kullanilabilir tuzel kisilik yok")
                }
                noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                onChange={(nextValue) => handleCreateLegalEntityChange(nextValue)}
              />
            </label>
            {workingContextError ? (
              <p className="mt-1 text-[11px] normal-case text-amber-700">
                {workingContextError}
              </p>
            ) : null}
          </div>
          {canReadOrgTree ? (
            createOperatingUnitDerivedFromCounterpartyPrimary ? (
              <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm text-cyan-950">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                  {l("Operating Unit", "Operasyon Birimi")}
                </p>
                <p className="mt-1 font-semibold">
                  {selectedCreateCounterpartyPrimaryOperatingUnitLabel}
                </p>
                <p className="mt-1 text-xs text-cyan-900">
                  {l(
                    "This counterparty has a primary operating unit. The document will use it automatically unless you choose another operating unit.",
                    "Bu carinin bir birincil operasyon birimi var. Siz baska bir operasyon birimi secmedikce belge bunu otomatik kullanir."
                  )}
                </p>
                <button
                  type="button"
                  className="mt-3 rounded-md border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-900 disabled:opacity-60"
                  onClick={() => setCreateOperatingUnitOverrideOpen(true)}
                  disabled={createSaving || !toPositiveInt(createForm.legalEntityId)}
                >
                  {l("Choose another operating unit", "Baska operasyon birimi sec")}
                </button>
              </div>
            ) : (
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                <label className="block">
                  {l("Operating Unit (optional)", "Operasyon Birimi (opsiyonel)")}
                  <Combobox
                    className="mt-1"
                    value={createForm.operatingUnitId}
                    options={createOperatingUnitLookupOptions}
                    loading={createOperatingUnitsLoading}
                    disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                    placeholder={
                      toPositiveInt(createForm.legalEntityId)
                        ? l("Search operating unit code/name", "Operasyon birimi kodu/adi ara")
                        : l("Select legal entity first", "Once tuzel kisilik secin")
                    }
                    noOptionsText={
                      toPositiveInt(createForm.legalEntityId)
                        ? l("No operating units found.", "Operasyon birimi bulunamadi.")
                        : l("Select legal entity first.", "Once tuzel kisilik secin.")
                    }
                    onChange={(nextValue) => {
                      const normalizedOperatingUnitId = nextValue ? String(nextValue) : "";
                      setCreateForm((prev) => ({
                        ...prev,
                        operatingUnitId: normalizedOperatingUnitId,
                      }));
                      setCreateOperatingUnitOverrideOpen(
                        Boolean(
                          normalizedOperatingUnitId &&
                            normalizedOperatingUnitId !==
                              selectedCreateCounterpartyPrimaryOperatingUnitId
                        )
                      );
                    }}
                  />
                </label>
                {selectedCreateCounterpartyPrimaryOperatingUnitId ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 normal-case text-[11px] text-slate-600">
                    <span>
                      {l("Counterparty primary operating unit:", "Cari birincil operasyon birimi:")}{" "}
                      <span className="font-semibold text-slate-800">
                        {selectedCreateCounterpartyPrimaryOperatingUnitLabel}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="font-semibold text-slate-700 underline underline-offset-2 disabled:no-underline disabled:opacity-60"
                      onClick={() => {
                        setCreateForm((prev) => ({ ...prev, operatingUnitId: "" }));
                        setCreateOperatingUnitOverrideOpen(false);
                      }}
                      disabled={createSaving}
                    >
                      {l("Use counterparty default", "Cari varsayilanini kullan")}
                    </button>
                  </div>
                ) : null}
                {createOperatingUnitsError ? (
                  <p className="mt-1 text-[11px] normal-case text-amber-700">
                    {createOperatingUnitsError}
                  </p>
                ) : null}
              </div>
            )
          ) : (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Operating Unit ID (optional)", "Operasyon Birimi ID (opsiyonel)")}
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={createForm.operatingUnitId}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    operatingUnitId: event.target.value,
                  }))
                }
                disabled={createSaving}
              />
            </label>
          )}
          {!hasFixedRouteDirection ? (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Direction", "Yon")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={createForm.direction}
                onChange={(event) => handleCreateDirectionChange(event.target.value)}
                required
              >
                {DOCUMENT_DIRECTIONS.map((entryDirection) => (
                  <option key={`create-direction-${entryDirection}`} value={entryDirection}>
                    {entryDirection}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canReadCards ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              <label className="block">
                {l("Counterparty", "Cari")}
                <Combobox
                  className="mt-1"
                  value={createForm.counterpartyId}
                  options={createCounterpartyLookupOptions}
                  loading={createCounterpartyLoading}
                  disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                  placeholder={
                    toPositiveInt(createForm.legalEntityId)
                      ? l("Search counterparty code/name", "Cari kodu/adi ara")
                      : l("Select legal entity first", "Once tuzel kisilik secin")
                  }
                  noOptionsText={
                    toPositiveInt(createForm.legalEntityId)
                      ? l("No counterparties found.", "Cari bulunamadi.")
                      : l("Select legal entity first.", "Once tuzel kisilik secin.")
                  }
                  onInputChange={(nextValue, meta) => {
                    setCreateInlineCounterpartyError("");
                    setCreateInlineCounterpartyMessage("");
                    const reason = String(meta?.reason || "").trim().toLowerCase();
                    if (reason === "select" || reason === "clear") {
                      setCreateCounterpartyLookupQuery("");
                      return;
                    }
                    setCreateCounterpartyLookupQuery(normalizeLookupQuery(nextValue));
                  }}
                  onChange={(nextValue) =>
                    setCreateForm((prev) => {
                      const normalizedCounterpartyId = nextValue ? String(nextValue) : "";
                      if (normalizeText(prev.counterpartyId) === normalizedCounterpartyId) {
                        return prev;
                      }
                      return {
                        ...prev,
                        counterpartyId: normalizedCounterpartyId,
                        operatingUnitId: "",
                      };
                    })
                  }
                />
              </label>
              {canUpsertCards ? (
                <button
                  type="button"
                  className="mt-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold normal-case text-slate-700 disabled:opacity-60"
                  onClick={handleInlineCreateCounterpartyForCreateForm}
                  disabled={!canInlineCreateCounterpartyInCreateForm || createSaving}
                >
                  {l(
                    `Create "${createInlineCounterpartyName || "new counterparty"}" with details`,
                    `"${createInlineCounterpartyName || "yeni cari"}" icin detayli kart ac`
                  )}
                </button>
              ) : null}
              {createInlineCounterpartyError ? (
                <p className="mt-1 text-[11px] normal-case text-rose-700">
                  {createInlineCounterpartyError}
                </p>
              ) : null}
              {createInlineCounterpartyMessage ? (
                <p className="mt-1 text-[11px] normal-case text-emerald-700">
                  {createInlineCounterpartyMessage}
                </p>
              ) : null}
            </div>
          ) : (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Counterparty ID", "Cari ID")}
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={createForm.counterpartyId}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    counterpartyId: event.target.value,
                  }))
                }
                required
              />
            </label>
          )}
          {canReadCards ? (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              <label className="block">
                {l("Payment Term (optional)", "Odeme Kosulu (opsiyonel)")}
                <Combobox
                  className="mt-1"
                  value={createForm.paymentTermId}
                  options={createPaymentTermLookupOptions}
                  loading={createPaymentTermsLoading}
                  disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                  placeholder={
                    toPositiveInt(createForm.legalEntityId)
                      ? l("Search payment term code/name", "Odeme kosulu kodu/adi ara")
                      : l("Select legal entity first", "Once tuzel kisilik secin")
                  }
                  noOptionsText={
                    toPositiveInt(createForm.legalEntityId)
                      ? l("No payment terms found.", "Odeme kosulu bulunamadi.")
                      : l("Select legal entity first.", "Once tuzel kisilik secin.")
                  }
                  onChange={(nextValue) => {
                    setCreatePaymentTermTouched(true);
                    setCreateForm((prev) => ({
                      ...prev,
                      paymentTermId: nextValue ? String(nextValue) : "",
                    }));
                  }}
                />
              </label>
              {createPaymentTermsError ? (
                <p className="mt-1 text-[11px] normal-case text-amber-700">
                  {createPaymentTermsError}
                </p>
              ) : null}
            </div>
          ) : (
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Payment Term ID (optional)", "Odeme Kosulu ID (opsiyonel)")}
              <input
                type="number"
                min="1"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={createForm.paymentTermId}
                onChange={(event) => {
                  setCreatePaymentTermTouched(true);
                  setCreateForm((prev) => ({ ...prev, paymentTermId: event.target.value }));
                }}
              />
            </label>
          )}
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Document Type", "Belge Turu")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.documentType}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, documentType: event.target.value }))
              }
              required
            >
              {DOCUMENT_TYPES.map((documentType) => (
                <option key={`create-document-type-${documentType}`} value={documentType}>
                  {documentType}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Document Date", "Belge Tarihi")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.documentDate}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, documentDate: event.target.value }))
              }
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Due Date", "Vade Tarihi")}{" "}
            {requiresDueDate(createForm.documentType)
              ? l("(required for this type)", "(bu tur icin zorunlu)")
              : l("(optional)", "(opsiyonel)")}
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createForm.dueDate}
              onChange={(event) => {
                const nextDueDate = event.target.value;
                setCreateDueDateTouched(Boolean(nextDueDate));
                setCreateForm((prev) => ({ ...prev, dueDate: nextDueDate }));
              }}
              disabled={createSaving || Boolean(createImmediateCashDueDate)}
              required={requiresDueDate(createForm.documentType)}
            />
            {createDueDateForcedByImmediateCash ? (
              <p className="mt-1 text-[11px] normal-case text-slate-500">
                {l(
                  "Immediate cash uses the document date as the due date.",
                  "Aninda nakit tahsilat/odeme, vade tarihi olarak belge tarihini kullanir."
                )}
              </p>
            ) : null}
            {createDueDateAutoDerived && selectedCreatePaymentTerm ? (
              <p className="mt-1 text-[11px] normal-case text-slate-500">
                {l(
                  `Auto-filled from payment term ${selectedCreatePaymentTerm.code || selectedCreatePaymentTerm.name || `#${selectedCreatePaymentTerm.id}`}. You can still override it.`,
                  `Odeme kosulu ${selectedCreatePaymentTerm.code || selectedCreatePaymentTerm.name || `#${selectedCreatePaymentTerm.id}`} ile otomatik dolduruldu. Isterseniz yine de degistirebilirsiniz.`
                )}
              </p>
            ) : null}
          </label>
          <div className="md:col-span-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
              {l("Payment", "Odeme")}
            </p>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Mode", "Mod")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                  value={normalizeDocumentSettlementMode(createForm.settlementMode)}
                  onChange={(event) => handleCreateSettlementModeChange(event.target.value)}
                  disabled={createSaving}
                >
                  <option value="ACCRUAL">
                    {l("On Credit (Accrual)", "Vadeli (Tahakkuk)")}
                  </option>
                  <option value="IMMEDIATE_CASH">{createImmediateCashLabel}</option>
                </select>
              </label>
              {createImmediateCashSelected ? (
                canReadCashRegisters ? (
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <label className="block">
                      {l("Cash Register", "Kasa")}
                      <Combobox
                        className="mt-1"
                        value={createForm.settlementCashRegisterId}
                        options={createCashRegisterLookupOptions}
                        loading={createCashRegistersLoading}
                        disabled={!toPositiveInt(createForm.legalEntityId) || createSaving}
                        placeholder={
                          toPositiveInt(createForm.legalEntityId)
                            ? l("Search cash register", "Kasa ara")
                            : l("Select legal entity first", "Once tuzel kisilik secin")
                        }
                        noOptionsText={
                          toPositiveInt(createForm.legalEntityId)
                            ? l("No cash registers found.", "Kasa bulunamadi.")
                            : l("Select legal entity first.", "Once tuzel kisilik secin.")
                        }
                        onChange={(nextValue) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            settlementCashRegisterId: nextValue ? String(nextValue) : "",
                          }))
                        }
                      />
                    </label>
                    {createCashRegistersError ? (
                      <p className="mt-1 text-[11px] normal-case text-amber-700">
                        {createCashRegistersError}
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
                      value={createForm.settlementCashRegisterId}
                      onChange={(event) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          settlementCashRegisterId: event.target.value,
                        }))
                      }
                      disabled={createSaving}
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
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Invoice Total (derived)", "Fatura Toplami (turetilmis)")}
            <input
              type="number"
              min="0.000001"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
              value={normalizeOptionalDecimalText(createDocumentFxComputation.resolvedAmountTxn)}
              readOnly
              disabled={createSaving}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Invoice Currency", "Fatura Para Birimi")}
            <input
              type="text"
              maxLength={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
              value={createForm.currencyCode}
              onChange={(event) => {
                setCreateCurrencyTouched(true);
                setCreateForm((prev) => ({ ...prev, currencyCode: event.target.value }));
              }}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Base Amount (calculated)", "Baz Tutar (otomatik hesaplanir)")}
            <input
              type="number"
              min="0.000001"
              step="0.000001"
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"
              value={createResolvedAmountBaseText}
              readOnly
              disabled={createSaving}
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {createDocumentFxComputation.fxRateRequired
              ? l("FX Rate (required)", "Kur (zorunlu)")
              : l("FX Rate", "Kur")}
            <input
              type="number"
              min="0.0000000001"
              step="0.0000000001"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={createDocumentFxComputation.isLocalCurrency ? "1" : createForm.fxRate || ""}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, fxRate: event.target.value }))
              }
              readOnly={createDocumentFxComputation.isLocalCurrency}
              required={createDocumentFxComputation.fxRateRequired}
            />
          </label>
          {createFunctionalCurrencyCode ? (
            <p className="md:col-span-4 -mt-1 text-[11px] text-slate-500">
              {createDocumentFxComputation.isLocalCurrency
                ? l(
                    `Functional currency is ${createFunctionalCurrencyCode}. FX rate is fixed to 1 and base amount follows the invoice amount.`,
                    `Fonksiyonel para birimi ${createFunctionalCurrencyCode}. Kur 1 olarak sabitlenir ve baz tutar fatura tutarindan gelir.`
                  )
                : l(
                    `Functional currency is ${createFunctionalCurrencyCode}. Base amount is calculated automatically from invoice amount x FX rate.`,
                    `Fonksiyonel para birimi ${createFunctionalCurrencyCode}. Baz tutar, fatura tutari x kur ile otomatik hesaplanir.`
                  )}
            </p>
          ) : null}
          <DocumentLineWorkbench
            l={l}
            title={l("Commercial Lines", "Ticari Satirlar")}
            form={createForm}
            saving={createSaving}
            currencyCode={createForm.currencyCode}
            functionalCurrencyCode={createFunctionalCurrencyCode}
            fxComputation={createDocumentFxComputation}
            canReadGlAccounts={canReadGlAccounts}
            lineAccountOptions={createLineAccountOptions}
            lineAccountsLoading={createLineAccountsLoading}
            lineAccountsError={createLineAccountsError}
            itemCardOptions={createItemCardOptions}
            itemCardsLoading={createItemCardsLoading}
            itemCardsError={createItemCardsError}
            warehouseOptions={createWarehouseOptions}
            warehouseLoading={createWarehousesLoading}
            warehouseError={createWarehousesError}
            warehouseInfoMessage={createWarehouseValidation.generalErrors[0] || ""}
            warehouseLineErrors={createWarehouseValidation.lineErrors}
            lineValidationMessages={createLineValidationMessages}
            taxCategoryOptions={createTaxCategoryOptions}
            taxCategoryLoading={taxCategoryLoading}
            taxCategoryError={taxCategoryError}
            previewLoading={createLinePreviewLoading}
            previewError={createLinePreviewError}
            previewMessage={createLinePreviewMessage}
            fixedAssetCategoryOptions={createFixedAssetCategoryOptions}
            fixedAssetCategoriesLoading={createFixedAssetCategoriesLoading}
            fixedAssetCategoriesError={createFixedAssetCategoriesError}
            fixedAssetCategoriesById={createFixedAssetCategoriesById}
            fixedAssetDraftOptions={createFixedAssetDraftOptions}
            fixedAssetDraftLoading={createFixedAssetDraftLoading}
            fixedAssetDraftError={createFixedAssetDraftError}
            fixedAssetDraftRowsById={createFixedAssetDraftRowsById}
            fixedAssetImprovementOptions={createFixedAssetImprovementOptions}
            fixedAssetSaleOptions={createFixedAssetSaleOptions}
            fixedAssetSaleLoading={createFixedAssetSaleLoading}
            fixedAssetSaleError={createFixedAssetSaleError}
            fixedAssetSaleRowsById={createFixedAssetSaleRowsById}
            fixedAssetOperatingUnitOptions={createFixedAssetOperatingUnitOptions}
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
          <div className="md:col-span-4 flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              disabled={createSaving}
            >
              {createSaving ? l("Creating...", "Olusturuluyor...") : createDraftDocumentTitle}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              onClick={resetCreateDraftFormWithSmartDefaults}
              disabled={createSaving}
            >
              {l("Reset Draft Form", "Taslak Formunu Sifirla")}
            </button>
          </div>
        </form>
      </section>
+
      <InlineCounterpartyCreateModal
        open={createInlineCounterpartyModalOpen}
        legalEntityId={createForm.legalEntityId}
        direction={createForm.direction}
        initialName={createCounterpartyLookupQuery}
        l={l}
        onClose={() => setCreateInlineCounterpartyModalOpen(false)}
        onCreated={handleInlineCounterpartyCreatedForCreateForm}
      />
    </>
  );}
