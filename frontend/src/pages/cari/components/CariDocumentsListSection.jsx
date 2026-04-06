import { useCallback, useEffect, useMemo } from "react";
import Combobox from "../../../components/Combobox.jsx";
import MoneyText from "../../../components/MoneyText.jsx";
import {
  DOCUMENT_DIRECTIONS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
} from "../cariDocumentsUtils.js";
import {
  DOCUMENT_LIST_COLUMN_IDS,
  getDocumentLegalEntityLabel,
  DOCUMENT_TABLE_ROWS_PER_PAGE_OPTIONS,
  getDocumentOperatingUnitLabel,
  normalizeText,
  normalizeWorkflowGateState,
  toPositiveInt,
} from "../cariDocumentsPageHelpers.js";
import useCariDocumentsListController from "../hooks/useCariDocumentsListController.js";

export default function CariDocumentsListSection({
  fixedDirection = "",
  selectedDocumentId = null,
  onSelectDocument,
  listRefreshToken = 0,
}) {
  const controller = useCariDocumentsListController({
    fixedDirection,
    listRefreshToken,
    documentTableColumnIds: DOCUMENT_LIST_COLUMN_IDS,
  });
  const {
    l,
    canReadCards,
    canReadOrgTree,
    filters,
    setFilters,
    resetFilters,
    rows,
    totalRows,
    listLoading,
    listError,
    filterCounterpartyLookupOptions,
    filterCounterpartyLoading,
    filterLegalEntityLookupLoading,
    filterLegalEntityLookupOptions,
    filterOperatingUnitError,
    filterOperatingUnitLoading,
    filterOperatingUnitLookupOptions,
    workingContextError,
    hasFixedRouteDirection,
    documentTablePrefs,
    documentRowsPerPage,
    documentListPage,
    setDocumentListPage,
    documentListTotalPages,
    pagedDocumentRows,
    operatingUnitsById,
    savedViewsLoading,
    savedViewsSaving,
    savedViewsError,
    savedViewsMessage,
    savedViews,
    selectedSavedViewId,
    setSelectedSavedViewId,
    selectedSavedView,
    documentListToolbarRef,
    documentListAdvancedFiltersOpen,
    documentListSavedViewsOpen,
    documentListColumnsOpen,
    closeDocumentListPopover,
    toggleDocumentListPopover,
    loadDocuments,
    loadDocumentSavedViews,
    applyDocumentSavedView,
    handleCreateDocumentSavedView,
    handleUpdateDocumentSavedView,
    handleSetDefaultDocumentSavedView,
    handleDeleteDocumentSavedView,
    handleDocumentTableRowsPerPageChange,
    handleDocumentTableStickyHeaderChange,
    handleDocumentTableToggleColumn,
    handleDocumentTableSelectAllColumns,
    handleDocumentTableResetPrefs,
    handleExportDocumentListCsv,
    handleFilterDirectionChange,
    handleFilterLegalEntityChange,
  } = controller;

  const handleSelectRow = useCallback(
    (row) => {
      if (typeof onSelectDocument !== "function") {
        return;
      }
      onSelectDocument(toPositiveInt(row?.id) || null, row || null);
    },
    [onSelectDocument]
  );

  const documentTableColumns = useMemo(
    () => [
      {
        id: "id",
        label: "ID",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2 font-mono text-xs",
        render: (row) => row?.id || "-",
      },
      {
        id: "documentNo",
        label: "Document No",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.documentNo || "-",
      },
      {
        id: "legalEntity",
        label: "Legal Entity",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => getDocumentLegalEntityLabel(row),
      },
      {
        id: "operatingUnit",
        label: "Operating Unit",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => getDocumentOperatingUnitLabel(row, operatingUnitsById),
      },
      {
        id: "direction",
        label: "Direction",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.direction || "-",
      },
      {
        id: "documentType",
        label: "Type",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.documentType || "-",
      },
      {
        id: "status",
        label: "Status",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => (
          <div className="space-y-1">
            <div className="font-medium text-slate-800">{row?.status || "-"}</div>
            {String(row?.status || "").toUpperCase() === "RETURNED" ? (
              <div className="text-[11px] text-amber-700">
                {normalizeText(row?.returnReason || row?.return_reason) ||
                  l("Returned for correction", "Duzeltme icin iade edildi")}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "workflowGate",
        label: "Workflow Gate",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => {
          const gateState = normalizeWorkflowGateState(row?.workflowGate?.state);
          const gateMessage = normalizeText(row?.workflowGate?.message);
          const toneClass =
            gateState === "APPROVED"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : gateState === "RETURNED"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : gateState === "BLOCKED"
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : gateState === "PENDING"
                    ? "border-sky-200 bg-sky-50 text-sky-800"
                    : "border-slate-200 bg-slate-50 text-slate-600";
          const gateLabel =
            gateState === "APPROVED"
              ? l("Approved", "Onaylandi")
              : gateState === "RETURNED"
                ? l("Returned", "Iade edildi")
                : gateState === "BLOCKED"
                  ? l("Blocked", "Bloke")
                  : gateState === "PENDING"
                    ? l("Pending", "Beklemede")
                    : l("None", "Yok");
          return (
            <div className="space-y-1">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}
              >
                {gateLabel}
              </span>
              {gateMessage ? (
                <div className="max-w-xs text-[11px] text-slate-600">{gateMessage}</div>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "documentDate",
        label: "Document Date",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.documentDate || "-",
      },
      {
        id: "amountTxn",
        label: "Invoice Amount",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => (
          <MoneyText
            amount={row?.amountTxn}
            currencyCode={row?.currencyCode || row?.currencyCodeSnapshot || row?.currency_code}
            variant="stack"
          />
        ),
      },
      {
        id: "postedJournal",
        label: "Posted Journal",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.postedJournalEntryId || "-",
      },
      {
        id: "reversalOf",
        label: "Reversal Of",
        headerClassName: "px-3 py-2",
        cellClassName: "px-3 py-2",
        render: (row) => row?.reversalOfDocumentId || "-",
      },
      {
        id: "action",
        label: "Action",
        headerClassName: "px-3 py-2 text-right",
        cellClassName: "px-3 py-2 text-right",
        render: (row) => (
          <button
            type="button"
            className="cursor-pointer rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
            onClick={() => handleSelectRow(row)}
          >
            View / Actions
          </button>
        ),
      },
    ],
    [handleSelectRow, l, operatingUnitsById]
  );
  const documentVisibleColumns = useMemo(() => {
    const visibleIds = new Set(
      Array.isArray(documentTablePrefs.visibleColumnIds)
        ? documentTablePrefs.visibleColumnIds
        : DOCUMENT_LIST_COLUMN_IDS
    );
    return documentTableColumns.filter((column) => visibleIds.has(column.id));
  }, [documentTableColumns, documentTablePrefs.visibleColumnIds]);
  const documentVisibleColumnCount = Math.max(1, documentVisibleColumns.length);

  useEffect(() => {
    if (typeof onSelectDocument !== "function") {
      return;
    }
    const normalizedSelectedDocumentId = toPositiveInt(selectedDocumentId);
    if (!normalizedSelectedDocumentId) {
      return;
    }
    const selectedRowSnapshot =
      rows.find(
        (row) => Number(row?.id || 0) === Number(normalizedSelectedDocumentId || 0)
      ) || null;
    onSelectDocument(normalizedSelectedDocumentId, selectedRowSnapshot);
  }, [onSelectDocument, rows, selectedDocumentId]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        {l("Document List", "Belge Listesi")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {l("Total rows", "Toplam satir")}: {totalRows} | {l("Showing", "Gosterilen")}:{" "}
        {pagedDocumentRows.length} / {rows.length} | {l("Page", "Sayfa")}{" "}
        {documentListPage}/{documentListTotalPages}
      </p>
      <div ref={documentListToolbarRef} className="relative">
        {listError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {listError}
          </div>
        ) : null}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Search", "Ara")}
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                  value={filters.q}
                  onChange={(event) =>
                    setFilters((previous) => ({ ...previous, q: event.target.value }))
                  }
                  placeholder={l(
                    "documentNo / counterparty snapshot",
                    "documentNo / cari ozet"
                  )}
                />
              </label>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                <label className="block">
                  {l("Legal Entity", "Tuzel Kisilik")}
                  <Combobox
                    className="mt-1"
                    value={filters.legalEntityId}
                    options={filterLegalEntityLookupOptions}
                    loading={filterLegalEntityLookupLoading}
                    placeholder={
                      filterLegalEntityLookupOptions.length > 0
                        ? l("Search legal entity code/name", "Tuzel kisilik kodu/adi ara")
                        : l("No legal entities available", "Kullanilabilir tuzel kisilik yok")
                    }
                    noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                    onChange={(nextValue) => handleFilterLegalEntityChange(nextValue)}
                  />
                </label>
                {workingContextError ? (
                  <p className="mt-1 text-[11px] normal-case text-amber-700">
                    {workingContextError}
                  </p>
                ) : null}
              </div>
              {canReadCards ? (
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Counterparty Lookup", "Cari Arama")}
                  <Combobox
                    className="mt-1"
                    value={filters.counterpartyId}
                    options={filterCounterpartyLookupOptions}
                    loading={filterCounterpartyLoading}
                    disabled={!toPositiveInt(filters.legalEntityId)}
                    placeholder={
                      toPositiveInt(filters.legalEntityId)
                        ? l("Type code/name", "Kod/ad yazin")
                        : l("Select legal entity first", "Once tuzel kisilik secin")
                    }
                    noOptionsText={
                      toPositiveInt(filters.legalEntityId)
                        ? l("No counterparties found.", "Cari bulunamadi.")
                        : l(
                            "Set legalEntityId to load counterparties.",
                            "Carileri yuklemek icin legalEntityId secin."
                          )
                    }
                    onChange={(nextValue) =>
                      setFilters((previous) => ({
                        ...previous,
                        counterpartyId: nextValue ? String(nextValue) : "",
                      }))
                    }
                  />
                </label>
              ) : (
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Counterparty ID", "Cari ID")}
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                    value={filters.counterpartyId}
                    onChange={(event) =>
                      setFilters((previous) => ({
                        ...previous,
                        counterpartyId: event.target.value,
                      }))
                    }
                  />
                </label>
              )}
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Status", "Durum")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                  value={filters.status}
                  onChange={(event) =>
                    setFilters((previous) => ({
                      ...previous,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="">{l("ALL", "TUMU")}</option>
                  {DOCUMENT_STATUSES.map((status) => (
                    <option key={`filter-status-${status}`} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={documentListColumnsOpen}
                  aria-controls="document-list-columns-popover"
                  className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                    documentListColumnsOpen
                      ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                  onClick={() => toggleDocumentListPopover("columns")}
                >
                  {l("Columns", "Kolonlar")}
                </button>
                {documentListColumnsOpen ? (
                  <div
                    id="document-list-columns-popover"
                    className="absolute right-0 top-full z-20 mt-2 w-[min(92vw,36rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
                  >
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {l("Document table preferences", "Belge tablo tercihleri")}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {l(
                            "Choose visible columns and table behavior.",
                            "Gorunur kolonlari ve tablo davranisini secin."
                          )}
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Rows per page", "Sayfa basi satir")}
                          <select
                            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
                            value={documentRowsPerPage}
                            onChange={(event) =>
                              handleDocumentTableRowsPerPageChange(event.target.value)
                            }
                          >
                            {DOCUMENT_TABLE_ROWS_PER_PAGE_OPTIONS.map((optionValue) => (
                              <option
                                key={`document-rows-per-page-${optionValue}`}
                                value={optionValue}
                              >
                                {optionValue}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 sm:self-end">
                          <input
                            type="checkbox"
                            checked={Boolean(documentTablePrefs.stickyHeader)}
                            onChange={(event) =>
                              handleDocumentTableStickyHeaderChange(event.target.checked)
                            }
                          />
                          <span>{l("Sticky header", "Sabit baslik")}</span>
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-500">
                          {l("Visible columns", "Gorunen kolonlar")}:{" "}
                          {Array.isArray(documentTablePrefs.visibleColumnIds)
                            ? documentTablePrefs.visibleColumnIds.length
                            : 0}
                          /{documentTableColumns.length}
                        </span>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                          onClick={handleDocumentTableSelectAllColumns}
                        >
                          {l("Select all columns", "Tum kolonlari sec")}
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                          onClick={handleDocumentTableResetPrefs}
                        >
                          {l("Reset table prefs", "Tablo tercihlerini sifirla")}
                        </button>
                      </div>
                      <div className="grid max-h-72 gap-2 overflow-auto sm:grid-cols-2">
                        {documentTableColumns.map((column) => (
                          <label
                            key={`document-table-column-toggle-${column.id}`}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(
                                Array.isArray(documentTablePrefs.visibleColumnIds) &&
                                  documentTablePrefs.visibleColumnIds.includes(column.id)
                              )}
                              onChange={() => handleDocumentTableToggleColumn(column.id)}
                            />
                            <span>{column.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={documentListAdvancedFiltersOpen}
                  aria-controls="document-list-filters-popover"
                  className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                    documentListAdvancedFiltersOpen
                      ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                  onClick={() => toggleDocumentListPopover("filters")}
                >
                  {l("Filter", "Filtre")}
                </button>
                {documentListAdvancedFiltersOpen ? (
                  <div
                    id="document-list-filters-popover"
                    className="absolute right-0 top-full z-20 mt-2 w-[min(92vw,56rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
                  >
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {l("More Filters", "Daha Fazla Filtre")}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {l(
                            "Refine the document list without changing the page layout.",
                            "Sayfa duzenini bozmadan belge listesini daraltin."
                          )}
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {!hasFixedRouteDirection ? (
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            {l("Direction", "Yon")}
                            <select
                              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                              value={filters.direction}
                              onChange={(event) =>
                                handleFilterDirectionChange(event.target.value)
                              }
                            >
                              <option value="">{l("ALL", "TUMU")}</option>
                              {DOCUMENT_DIRECTIONS.map((entryDirection) => (
                                <option
                                  key={`filter-direction-${entryDirection}`}
                                  value={entryDirection}
                                >
                                  {entryDirection}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {canReadOrgTree ? (
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            <label className="block">
                              {l("Operating Unit", "Operasyon Birimi")}
                              <Combobox
                                className="mt-1"
                                value={filters.operatingUnitId}
                                options={filterOperatingUnitLookupOptions}
                                loading={filterOperatingUnitLoading}
                                disabled={!toPositiveInt(filters.legalEntityId)}
                                placeholder={
                                  toPositiveInt(filters.legalEntityId)
                                    ? l(
                                        "Search operating unit code/name",
                                        "Operasyon birimi kodu/adi ara"
                                      )
                                    : l("Select legal entity first", "Once tuzel kisilik secin")
                                }
                                noOptionsText={
                                  toPositiveInt(filters.legalEntityId)
                                    ? l(
                                        "No operating units found.",
                                        "Operasyon birimi bulunamadi."
                                      )
                                    : l(
                                        "Select legal entity first.",
                                        "Once tuzel kisilik secin."
                                      )
                                }
                                onChange={(nextValue) =>
                                  setFilters((previous) => ({
                                    ...previous,
                                    operatingUnitId: nextValue ? String(nextValue) : "",
                                  }))
                                }
                              />
                            </label>
                            {filterOperatingUnitError ? (
                              <p className="mt-1 text-[11px] normal-case text-amber-700">
                                {filterOperatingUnitError}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            {l("Operating Unit ID", "Operasyon Birimi ID")}
                            <input
                              type="number"
                              min="1"
                              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                              value={filters.operatingUnitId}
                              onChange={(event) =>
                                setFilters((previous) => ({
                                  ...previous,
                                  operatingUnitId: event.target.value,
                                }))
                              }
                            />
                          </label>
                        )}
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Counterparty ID", "Cari ID")}
                          <input
                            type="number"
                            min="1"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={filters.counterpartyId}
                            onChange={(event) =>
                              setFilters((previous) => ({
                                ...previous,
                                counterpartyId: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Document Type", "Belge Turu")}
                          <select
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={filters.documentType}
                            onChange={(event) =>
                              setFilters((previous) => ({
                                ...previous,
                                documentType: event.target.value,
                              }))
                            }
                          >
                            <option value="">{l("ALL", "TUMU")}</option>
                            {DOCUMENT_TYPES.map((documentType) => (
                              <option
                                key={`filter-document-type-${documentType}`}
                                value={documentType}
                              >
                                {documentType}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Date From", "Baslangic Tarihi")}
                          <input
                            type="date"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={filters.dateFrom}
                            onChange={(event) =>
                              setFilters((previous) => ({
                                ...previous,
                                dateFrom: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Date To", "Bitis Tarihi")}
                          <input
                            type="date"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={filters.dateTo}
                            onChange={(event) =>
                              setFilters((previous) => ({
                                ...previous,
                                dateTo: event.target.value,
                              }))
                            }
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
                          onClick={() => {
                            closeDocumentListPopover();
                            resetFilters();
                          }}
                        >
                          {l("Reset Filters", "Filtreleri Sifirla")}
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                          onClick={() => {
                            closeDocumentListPopover();
                            loadDocuments(filters);
                          }}
                          disabled={listLoading}
                        >
                          {listLoading
                            ? l("Loading...", "Yukleniyor...")
                            : l("Apply Filters", "Filtreleri Uygula")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={documentListSavedViewsOpen}
                  aria-controls="document-list-saved-views-popover"
                  className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                    documentListSavedViewsOpen
                      ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                  onClick={() => toggleDocumentListPopover("savedViews")}
                >
                  {l("Saved Views", "Kayitli Gorunumler")}
                </button>
                {documentListSavedViewsOpen ? (
                  <div
                    id="document-list-saved-views-popover"
                    className="absolute right-0 top-full z-20 mt-2 w-[min(92vw,34rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
                  >
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          {l("Saved Views", "Kayitli Gorunumler")}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {l(
                            "Apply or maintain server-side list presets.",
                            "Sunucu tarafli liste gorunumlerini uygulayin veya yonetin."
                          )}
                        </p>
                      </div>
                      <div className="space-y-3">
                        <select
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={selectedSavedViewId}
                          onChange={(event) => setSelectedSavedViewId(event.target.value)}
                          disabled={
                            savedViewsLoading || savedViewsSaving || savedViews.length === 0
                          }
                        >
                          <option value="">{l("Select saved view", "Kayitli gorunum secin")}</option>
                          {savedViews.map((row) => (
                            <option key={`document-saved-view-${row.id}`} value={row.id}>
                              {row.name}
                              {row.isDefault ? l(" (default)", " (varsayilan)") : ""}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                            onClick={() => {
                              applyDocumentSavedView(selectedSavedView);
                              closeDocumentListPopover();
                            }}
                            disabled={!selectedSavedView || savedViewsSaving}
                          >
                            {l("Apply", "Uygula")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-60"
                            onClick={handleCreateDocumentSavedView}
                            disabled={savedViewsSaving}
                          >
                            {l("Save Current", "Mevcutu Kaydet")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-700 disabled:opacity-60"
                            onClick={handleUpdateDocumentSavedView}
                            disabled={!selectedSavedView || savedViewsSaving}
                          >
                            {l("Update Selected", "Secileni Guncelle")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60"
                            onClick={handleSetDefaultDocumentSavedView}
                            disabled={!selectedSavedView || savedViewsSaving}
                          >
                            {l("Set Default", "Varsayilan Yap")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                            onClick={handleDeleteDocumentSavedView}
                            disabled={!selectedSavedView || savedViewsSaving}
                          >
                            {l("Delete", "Sil")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                            onClick={() =>
                              loadDocumentSavedViews({ preferredId: selectedSavedViewId })
                            }
                            disabled={savedViewsLoading || savedViewsSaving}
                          >
                            {savedViewsLoading
                              ? l("Loading...", "Yukleniyor...")
                              : l("Refresh Saved Views", "Kayitli Gorunumleri Yenile")}
                          </button>
                        </div>
                      </div>
                      {savedViewsError ? (
                        <p className="text-xs text-rose-700">{savedViewsError}</p>
                      ) : null}
                      {savedViewsMessage ? (
                        <p className="text-xs text-emerald-700">{savedViewsMessage}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => {
              closeDocumentListPopover();
              loadDocuments(filters);
            }}
            disabled={listLoading}
          >
            {listLoading ? l("Loading...", "Yukleniyor...") : l("Apply Filters", "Filtreleri Uygula")}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
            onClick={() => {
              closeDocumentListPopover();
              resetFilters();
            }}
            disabled={listLoading}
          >
            {l("Reset Filters", "Filtreleri Sifirla")}
          </button>
          <button
            type="button"
            className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 disabled:opacity-60"
            onClick={handleExportDocumentListCsv}
            disabled={listLoading || rows.length === 0}
          >
            {l("Export CSV", "CSV Disa Aktar")}
          </button>
        </div>
      </div>
      <div className="mt-4 max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead
            className={`bg-slate-50 text-left text-slate-600 ${
              documentTablePrefs.stickyHeader ? "sticky top-0 z-10" : ""
            }`}
          >
            <tr>
              {documentVisibleColumns.map((column) => (
                <th
                  key={`document-list-header-${column.id}`}
                  className={column.headerClassName || "px-3 py-2"}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedDocumentRows.map((row) => (
              <tr
                key={`doc-row-${row.id}`}
                className={`border-t border-slate-100 ${
                  Number(row.id) === Number(selectedDocumentId) ? "bg-cyan-50" : "bg-white"
                }`}
              >
                {documentVisibleColumns.map((column) => (
                  <td
                    key={`document-list-cell-${row.id}-${column.id}`}
                    className={column.cellClassName || "px-3 py-2"}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-slate-500" colSpan={documentVisibleColumnCount}>
                  {listLoading
                    ? l("Loading documents...", "Belgeler yukleniyor...")
                    : l(
                        "No documents found for current filters.",
                        "Mevcut filtreler icin belge bulunamadi."
                      )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
          onClick={() => setDocumentListPage((current) => Math.max(1, current - 1))}
          disabled={documentListPage <= 1}
        >
          {l("Previous", "Onceki")}
        </button>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
          onClick={() =>
            setDocumentListPage((current) =>
              Math.min(documentListTotalPages, current + 1)
            )
          }
          disabled={documentListPage >= documentListTotalPages}
        >
          {l("Next", "Sonraki")}
        </button>
      </div>
    </section>
  );
}
