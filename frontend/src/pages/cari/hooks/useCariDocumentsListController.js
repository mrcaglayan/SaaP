import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listCariDocuments } from "../../../api/cariDocuments.js";
import { listCariCounterparties } from "../../../api/cariCounterparty.js";
import {
  createMeSavedView,
  deleteMeSavedView,
  listMeSavedViews,
  updateMeSavedView,
} from "../../../api/me.js";
import { listOperatingUnits } from "../../../api/orgAdmin.js";
import { useAuth } from "../../../auth/useAuth.js";
import { useWorkingContext } from "../../../context/useWorkingContext.js";
import { useWorkingContextDefaults } from "../../../context/useWorkingContextDefaults.js";
import { usePersistedFilters } from "../../../hooks/usePersistedFilters.js";
import { usePersistedTablePrefs } from "../../../hooks/usePersistedTablePrefs.js";
import { useI18n } from "../../../i18n/useI18n.js";
import { exportRowsAsCsv } from "../../../utils/csvExport.js";
import { buildDocumentListQuery, DOCUMENT_DIRECTIONS } from "../cariDocumentsUtils.js";
import {
  buildDocumentSavedViewDefinition,
  buildOperatingUnitsById,
  DEFAULT_FILTERS,
  DOCUMENT_EXPORT_COLUMNS,
  DOCUMENT_FILTER_CONTEXT_MAPPINGS,
  DOCUMENT_FILTERS_STORAGE_SCOPE,
  DOCUMENT_LIST_COLUMN_IDS,
  DOCUMENT_SAVED_VIEW_MODULE_CODE,
  DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
  DOCUMENT_TABLE_PREFS_STORAGE_SCOPE,
  mapCounterpartyLookupOption,
  mapLegalEntityLookupOption,
  mapOperatingUnitLookupOption,
  normalizeApiError,
  normalizeDirection,
  normalizeText,
  resolveCounterpartyRoleFromDirection,
  resolveDocumentSavedViewState,
  toPositiveInt,
  todayIsoDate,
} from "../cariDocumentsPageHelpers.js";

export default function useCariDocumentsListController({
  fixedDirection = "",
  listRefreshToken = 0,
  documentTableColumnIds = DOCUMENT_LIST_COLUMN_IDS,
}) {
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const { legalEntities: workingContextLegalEntities, loadingBase: workingContextBaseLoading, error: workingContextError } =
    useWorkingContext();
  const l = useCallback((en, tr) => (language === "tr" ? tr : en), [language]);
  const canRead = hasPermission("cari.doc.read");
  const canReadCards = hasPermission("cari.card.read");
  const canReadOrgTree = hasPermission("org.tree.read");
  const fixedRouteDirection = normalizeDirection(fixedDirection);
  const hasFixedRouteDirection = Boolean(fixedRouteDirection);
  const resolvedDocumentTableColumnIds = useMemo(
    () =>
      Array.isArray(documentTableColumnIds) && documentTableColumnIds.length > 0
        ? documentTableColumnIds
        : DOCUMENT_LIST_COLUMN_IDS,
    [documentTableColumnIds]
  );

  const [filters, setFilters, resetFilters] = usePersistedFilters(
    DOCUMENT_FILTERS_STORAGE_SCOPE,
    () => ({ ...DEFAULT_FILTERS })
  );
  const [filterContextDefaultsSuspended, setFilterContextDefaultsSuspended] = useState(false);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [filterOperatingUnitOptions, setFilterOperatingUnitOptions] = useState([]);
  const [filterOperatingUnitLoading, setFilterOperatingUnitLoading] = useState(false);
  const [filterOperatingUnitError, setFilterOperatingUnitError] = useState("");
  const [filterCounterpartyOptions, setFilterCounterpartyOptions] = useState([]);
  const [filterCounterpartyLoading, setFilterCounterpartyLoading] = useState(false);
  const [documentListPage, setDocumentListPage] = useState(1);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [savedViewsSaving, setSavedViewsSaving] = useState(false);
  const [savedViewsError, setSavedViewsError] = useState("");
  const [savedViewsMessage, setSavedViewsMessage] = useState("");
  const [savedViews, setSavedViews] = useState([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [defaultSavedViewHydrated, setDefaultSavedViewHydrated] = useState(false);
  const [documentListActivePopover, setDocumentListActivePopover] = useState("");
  const documentListToolbarRef = useRef(null);

  const closeDocumentListPopover = useCallback(() => {
    setDocumentListActivePopover("");
  }, []);

  const toggleDocumentListPopover = useCallback((popoverKey) => {
    setDocumentListActivePopover((previous) => (previous === popoverKey ? "" : popoverKey));
  }, []);

  const [documentTablePrefs, setDocumentTablePrefs, resetDocumentTablePrefs] =
    usePersistedTablePrefs(
      DOCUMENT_TABLE_PREFS_STORAGE_SCOPE,
      {
        rowsPerPage: DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
        stickyHeader: false,
        visibleColumnIds: resolvedDocumentTableColumnIds,
      },
      resolvedDocumentTableColumnIds
    );

  useWorkingContextDefaults(
    setFilters,
    filterContextDefaultsSuspended ? [] : DOCUMENT_FILTER_CONTEXT_MAPPINGS,
    [
      filterContextDefaultsSuspended,
      filters.legalEntityId,
      filters.dateFrom,
      filters.dateTo,
    ]
  );

  const filterCounterpartyLookupOptions = useMemo(
    () =>
      (filterCounterpartyOptions || [])
        .map(mapCounterpartyLookupOption)
        .filter((row) => row.value),
    [filterCounterpartyOptions]
  );
  const filterOperatingUnitLookupOptions = useMemo(() => {
    const selectedOperatingUnitId = normalizeText(filters.operatingUnitId);
    const nextRows = (filterOperatingUnitOptions || [])
      .map(mapOperatingUnitLookupOption)
      .filter((row) => row.value);
    if (
      selectedOperatingUnitId &&
      !nextRows.some((row) => String(row.value) === selectedOperatingUnitId)
    ) {
      nextRows.unshift({
        value: selectedOperatingUnitId,
        label: `Operating unit #${selectedOperatingUnitId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return nextRows;
  }, [filterOperatingUnitOptions, filters.operatingUnitId]);
  const legalEntityLookupOptions = useMemo(
    () =>
      (workingContextLegalEntities || [])
        .map(mapLegalEntityLookupOption)
        .filter((row) => row.value),
    [workingContextLegalEntities]
  );
  const filterLegalEntityLookupOptions = useMemo(() => {
    const selectedLegalEntityId = normalizeText(filters.legalEntityId);
    const nextRows = [...legalEntityLookupOptions];
    if (
      selectedLegalEntityId &&
      !nextRows.some((row) => String(row.value) === selectedLegalEntityId)
    ) {
      nextRows.unshift({
        value: selectedLegalEntityId,
        label: `Legal entity #${selectedLegalEntityId}`,
        description: "Selected value is outside current lookup scope.",
      });
    }
    return nextRows;
  }, [filters.legalEntityId, legalEntityLookupOptions]);
  const filterLegalEntityLookupLoading = Boolean(
    workingContextBaseLoading && filterLegalEntityLookupOptions.length === 0
  );
  const operatingUnitsById = useMemo(
    () => buildOperatingUnitsById(filterOperatingUnitOptions),
    [filterOperatingUnitOptions]
  );
  const documentRowsPerPage = useMemo(
    () =>
      toPositiveInt(documentTablePrefs.rowsPerPage) ||
      DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
    [documentTablePrefs.rowsPerPage]
  );
  const documentListTotalPages = useMemo(() => {
    if (!rows.length) {
      return 1;
    }
    return Math.max(1, Math.ceil(rows.length / documentRowsPerPage));
  }, [rows.length, documentRowsPerPage]);
  const pagedDocumentRows = useMemo(() => {
    const startIndex = Math.max(0, (documentListPage - 1) * documentRowsPerPage);
    return rows.slice(startIndex, startIndex + documentRowsPerPage);
  }, [documentListPage, documentRowsPerPage, rows]);
  const selectedSavedView = useMemo(
    () =>
      savedViews.find(
        (row) => Number(row?.id || 0) === Number(selectedSavedViewId || 0)
      ) || null,
    [savedViews, selectedSavedViewId]
  );
  const documentListAdvancedFiltersOpen = documentListActivePopover === "filters";
  const documentListSavedViewsOpen = documentListActivePopover === "savedViews";
  const documentListColumnsOpen = documentListActivePopover === "columns";

  const loadDocuments = useCallback(
    async (nextFilters = filters) => {
      if (!canRead) {
        setRows([]);
        setTotalRows(0);
        setListError(l("Missing permission: cari.doc.read", "Eksik yetki: cari.doc.read"));
        return;
      }
      const resolvedFilters = hasFixedRouteDirection
        ? {
            ...(nextFilters && typeof nextFilters === "object" ? nextFilters : {}),
            direction: fixedRouteDirection,
          }
        : nextFilters;
      setListLoading(true);
      setListError("");
      try {
        const response = await listCariDocuments(buildDocumentListQuery(resolvedFilters));
        setRows(Array.isArray(response?.rows) ? response.rows : []);
        setTotalRows(Number(response?.total || 0));
      } catch (error) {
        setRows([]);
        setTotalRows(0);
        setListError(
          normalizeApiError(error, l("Failed to load documents.", "Belgeler yuklenemedi."))
        );
      } finally {
        setListLoading(false);
      }
    },
    [canRead, filters, fixedRouteDirection, hasFixedRouteDirection, l]
  );

  const handleFilterDirectionChange = useCallback((nextDirection) => {
    const normalizedDirection = normalizeText(nextDirection).toUpperCase();
    setFilters((previous) => ({
      ...previous,
      direction: DOCUMENT_DIRECTIONS.includes(normalizedDirection)
        ? normalizedDirection
        : "",
      counterpartyId: "",
    }));
  }, [setFilters]);

  const handleFilterLegalEntityChange = useCallback((nextValue) => {
    const normalizedLegalEntityId = nextValue ? String(nextValue) : "";
    setFilterContextDefaultsSuspended(true);
    setFilters((previous) => {
      if (normalizeText(previous.legalEntityId) === normalizedLegalEntityId) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: normalizedLegalEntityId,
        operatingUnitId: "",
        counterpartyId: "",
      };
    });
  }, [setFilters]);

  const loadDocumentSavedViews = useCallback(
    async (options = {}) => {
      if (!canRead) {
        setSavedViews([]);
        setSelectedSavedViewId("");
        setSavedViewsLoading(false);
        return;
      }
      const preferredId = toPositiveInt(options.preferredId);
      setSavedViewsLoading(true);
      setSavedViewsError("");
      try {
        const response = await listMeSavedViews({
          moduleCode: DOCUMENT_SAVED_VIEW_MODULE_CODE,
        });
        const nextRows = Array.isArray(response?.rows) ? response.rows : [];
        setSavedViews(nextRows);
        setSelectedSavedViewId((current) => {
          const currentId = toPositiveInt(current);
          if (preferredId && nextRows.some((row) => Number(row?.id) === preferredId)) {
            return String(preferredId);
          }
          if (currentId && nextRows.some((row) => Number(row?.id) === currentId)) {
            return String(currentId);
          }
          return nextRows[0]?.id ? String(nextRows[0].id) : "";
        });
      } catch (error) {
        setSavedViews([]);
        setSelectedSavedViewId("");
        setSavedViewsError(
          normalizeApiError(
            error,
            l("Failed to load saved views.", "Kayitli gorunumler yuklenemedi.")
          )
        );
      } finally {
        setSavedViewsLoading(false);
      }
    },
    [canRead, l]
  );

  const applyDocumentSavedView = useCallback(
    (savedView, options = {}) => {
      const targetView = savedView && typeof savedView === "object" ? savedView : null;
      if (!targetView) {
        setSavedViewsError(l("Saved view not found.", "Kayitli gorunum bulunamadi."));
        return;
      }
      const resolvedState = resolveDocumentSavedViewState(
        targetView,
        resolvedDocumentTableColumnIds
      );
      setFilters(resolvedState.filters);
      setDocumentTablePrefs((previous) => ({
        ...previous,
        ...resolvedState.tablePrefs,
      }));
      setDocumentListPage(1);
      setSelectedSavedViewId(String(targetView.id));
      if (!options.silent) {
        setSavedViewsMessage(
          l(
            `Saved view applied: ${targetView.name || targetView.id}`,
            `Kayitli gorunum uygulandi: ${targetView.name || targetView.id}`
          )
        );
        setSavedViewsError("");
      }
    },
    [l, resolvedDocumentTableColumnIds, setDocumentTablePrefs, setFilters]
  );

  const handleCreateDocumentSavedView = useCallback(async () => {
    const rawName = window.prompt(l("Saved view name", "Kayitli gorunum adi"), "");
    const name = String(rawName || "").trim();
    if (!name) {
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      const response = await createMeSavedView({
        moduleCode: DOCUMENT_SAVED_VIEW_MODULE_CODE,
        name,
        definition: buildDocumentSavedViewDefinition({
          filters,
          tablePrefs: documentTablePrefs,
          columnIds: resolvedDocumentTableColumnIds,
        }),
      });
      const createdId = toPositiveInt(response?.row?.id);
      await loadDocumentSavedViews({ preferredId: createdId });
      setSavedViewsMessage(
        l(`Saved view created: ${name}`, `Kayitli gorunum olusturuldu: ${name}`)
      );
    } catch (error) {
      setSavedViewsError(
        normalizeApiError(
          error,
          l("Failed to create saved view.", "Kayitli gorunum olusturulamadi.")
        )
      );
    } finally {
      setSavedViewsSaving(false);
    }
  }, [
    documentTablePrefs,
    filters,
    l,
    loadDocumentSavedViews,
    resolvedDocumentTableColumnIds,
  ]);

  const handleUpdateDocumentSavedView = useCallback(async () => {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        l("Select a saved view to update.", "Guncellemek icin bir kayitli gorunum secin.")
      );
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await updateMeSavedView(savedViewId, {
        definition: buildDocumentSavedViewDefinition({
          filters,
          tablePrefs: documentTablePrefs,
          columnIds: resolvedDocumentTableColumnIds,
        }),
      });
      await loadDocumentSavedViews({ preferredId: savedViewId });
      setSavedViewsMessage(
        l(
          `Saved view updated: ${selectedSavedView?.name || savedViewId}`,
          `Kayitli gorunum guncellendi: ${selectedSavedView?.name || savedViewId}`
        )
      );
    } catch (error) {
      setSavedViewsError(
        normalizeApiError(
          error,
          l("Failed to update saved view.", "Kayitli gorunum guncellenemedi.")
        )
      );
    } finally {
      setSavedViewsSaving(false);
    }
  }, [
    documentTablePrefs,
    filters,
    l,
    loadDocumentSavedViews,
    resolvedDocumentTableColumnIds,
    selectedSavedView,
  ]);

  const handleSetDefaultDocumentSavedView = useCallback(async () => {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        l(
          "Select a saved view to set as default.",
          "Varsayilan yapmak icin bir kayitli gorunum secin."
        )
      );
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await updateMeSavedView(savedViewId, { isDefault: true });
      await loadDocumentSavedViews({ preferredId: savedViewId });
      setSavedViewsMessage(
        l(
          `Saved view marked as default: ${selectedSavedView?.name || savedViewId}`,
          `Kayitli gorunum varsayilan yapildi: ${selectedSavedView?.name || savedViewId}`
        )
      );
    } catch (error) {
      setSavedViewsError(
        normalizeApiError(
          error,
          l("Failed to set default saved view.", "Varsayilan kayitli gorunum ayarlanamadi.")
        )
      );
    } finally {
      setSavedViewsSaving(false);
    }
  }, [l, loadDocumentSavedViews, selectedSavedView]);

  const handleDeleteDocumentSavedView = useCallback(async () => {
    const savedViewId = toPositiveInt(selectedSavedView?.id);
    if (!savedViewId) {
      setSavedViewsError(
        l("Select a saved view to delete.", "Silmek icin bir kayitli gorunum secin.")
      );
      return;
    }
    const confirmed = window.confirm(
      l(
        `Delete saved view "${selectedSavedView?.name || savedViewId}"?`,
        `"${selectedSavedView?.name || savedViewId}" kayitli gorunumu silinsin mi?`
      )
    );
    if (!confirmed) {
      return;
    }
    setSavedViewsSaving(true);
    setSavedViewsError("");
    setSavedViewsMessage("");
    try {
      await deleteMeSavedView(savedViewId);
      await loadDocumentSavedViews();
      setSavedViewsMessage(l("Saved view deleted.", "Kayitli gorunum silindi."));
    } catch (error) {
      setSavedViewsError(
        normalizeApiError(
          error,
          l("Failed to delete saved view.", "Kayitli gorunum silinemedi.")
        )
      );
    } finally {
      setSavedViewsSaving(false);
    }
  }, [l, loadDocumentSavedViews, selectedSavedView]);

  const handleDocumentTableRowsPerPageChange = useCallback((value) => {
    const nextRowsPerPage = toPositiveInt(value);
    if (!nextRowsPerPage) {
      return;
    }
    setDocumentTablePrefs((previous) => ({
      ...previous,
      rowsPerPage: nextRowsPerPage,
    }));
    setDocumentListPage(1);
  }, [setDocumentTablePrefs]);

  const handleDocumentTableStickyHeaderChange = useCallback((nextValue) => {
    setDocumentTablePrefs((previous) => ({
      ...previous,
      stickyHeader: Boolean(nextValue),
    }));
  }, [setDocumentTablePrefs]);

  const handleDocumentTableToggleColumn = useCallback((columnId) => {
    const normalizedId = String(columnId || "").trim();
    if (!normalizedId) {
      return;
    }
    setDocumentTablePrefs((previous) => {
      const currentVisibleIds = Array.isArray(previous?.visibleColumnIds)
        ? previous.visibleColumnIds
        : [];
      const hasColumn = currentVisibleIds.includes(normalizedId);
      if (hasColumn && currentVisibleIds.length <= 1) {
        return previous;
      }
      return {
        ...previous,
        visibleColumnIds: hasColumn
          ? currentVisibleIds.filter((id) => id !== normalizedId)
          : [...currentVisibleIds, normalizedId],
      };
    });
  }, [setDocumentTablePrefs]);

  const handleDocumentTableSelectAllColumns = useCallback(() => {
    setDocumentTablePrefs((previous) => ({
      ...previous,
      visibleColumnIds: resolvedDocumentTableColumnIds,
    }));
  }, [resolvedDocumentTableColumnIds, setDocumentTablePrefs]);

  const handleDocumentTableResetPrefs = useCallback(() => {
    resetDocumentTablePrefs({
      rowsPerPage: DOCUMENT_TABLE_DEFAULT_ROWS_PER_PAGE,
      stickyHeader: false,
      visibleColumnIds: resolvedDocumentTableColumnIds,
    });
    setDocumentListPage(1);
  }, [resetDocumentTablePrefs, resolvedDocumentTableColumnIds]);

  const handleExportDocumentListCsv = useCallback(() => {
    setListError("");
    const exported = exportRowsAsCsv({
      rows,
      columns: DOCUMENT_EXPORT_COLUMNS,
      fileName: `cari-documents-${todayIsoDate()}.csv`,
    });
    if (!exported) {
      setListError(
        l(
          "CSV export is only available in browser sessions.",
          "CSV disa aktarma yalnizca tarayici oturumlarinda kullanilabilir."
        )
      );
    }
  }, [l, rows]);

  useEffect(() => {
    if (!documentListActivePopover) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (documentListToolbarRef.current?.contains(event.target)) {
        return;
      }
      closeDocumentListPopover();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeDocumentListPopover();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDocumentListPopover, documentListActivePopover]);

  useEffect(() => {
    if (!hasFixedRouteDirection) {
      return;
    }
    setFilters((previous) => {
      if (normalizeDirection(previous?.direction) === fixedRouteDirection) {
        return previous;
      }
      return {
        ...previous,
        direction: fixedRouteDirection,
        counterpartyId: "",
      };
    });
  }, [fixedRouteDirection, hasFixedRouteDirection, setFilters]);

  useEffect(() => {
    if (workingContextBaseLoading) {
      return;
    }
    const selectedLegalEntityId = normalizeText(filters.legalEntityId);
    if (!selectedLegalEntityId) {
      return;
    }
    const selectedStillVisible = legalEntityLookupOptions.some(
      (row) => String(row.value) === selectedLegalEntityId
    );
    if (selectedStillVisible) {
      return;
    }
    const fallbackLegalEntityId = normalizeText(legalEntityLookupOptions[0]?.value);
    setFilters((previous) => {
      const previousLegalEntityId = normalizeText(previous.legalEntityId);
      if (!previousLegalEntityId) {
        return previous;
      }
      const previousStillVisible = legalEntityLookupOptions.some(
        (row) => String(row.value) === previousLegalEntityId
      );
      if (previousStillVisible) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: fallbackLegalEntityId,
        counterpartyId: "",
      };
    });
  }, [
    filters.legalEntityId,
    legalEntityLookupOptions,
    setFilters,
    workingContextBaseLoading,
  ]);

  useEffect(() => {
    loadDocuments(filters);
  }, [filters, listRefreshToken, loadDocuments]);

  useEffect(() => {
    if (!canRead) {
      setSavedViews([]);
      setSelectedSavedViewId("");
      setDefaultSavedViewHydrated(false);
      return;
    }
    loadDocumentSavedViews();
  }, [canRead, loadDocumentSavedViews]);

  useEffect(() => {
    if (!canRead || defaultSavedViewHydrated || savedViewsLoading) {
      return;
    }
    const defaultView = savedViews.find((row) => Boolean(row?.isDefault));
    if (defaultView) {
      applyDocumentSavedView(defaultView, { silent: true });
    }
    setDefaultSavedViewHydrated(true);
  }, [
    applyDocumentSavedView,
    canRead,
    defaultSavedViewHydrated,
    savedViews,
    savedViewsLoading,
  ]);

  useEffect(() => {
    if (!canReadOrgTree) {
      setFilterOperatingUnitOptions([]);
      setFilterOperatingUnitLoading(false);
      setFilterOperatingUnitError("");
      return;
    }
    const legalEntityId = toPositiveInt(filters.legalEntityId);
    if (!legalEntityId) {
      setFilterOperatingUnitOptions([]);
      setFilterOperatingUnitLoading(false);
      setFilterOperatingUnitError("");
      return;
    }
    let active = true;
    async function loadFilterOperatingUnits() {
      setFilterOperatingUnitLoading(true);
      setFilterOperatingUnitError("");
      try {
        const response = await listOperatingUnits({
          legalEntityId,
          limit: 500,
          includeInactive: true,
        });
        if (!active) {
          return;
        }
        const nextRows = Array.isArray(response?.rows) ? response.rows : [];
        setFilterOperatingUnitOptions(nextRows);
        setFilters((previous) => {
          const selectedOperatingUnitId = normalizeText(previous.operatingUnitId);
          if (!selectedOperatingUnitId) {
            return previous;
          }
          const selectedStillVisible = nextRows.some(
            (row) => String(toPositiveInt(row?.id) || "") === selectedOperatingUnitId
          );
          return selectedStillVisible
            ? previous
            : { ...previous, operatingUnitId: "" };
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setFilterOperatingUnitOptions([]);
        setFilterOperatingUnitError(
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
          setFilterOperatingUnitLoading(false);
        }
      }
    }
    loadFilterOperatingUnits();
    return () => {
      active = false;
    };
  }, [canReadOrgTree, filters.legalEntityId, l, setFilters]);

  useEffect(() => {
    if (!canReadCards) {
      setFilterCounterpartyOptions([]);
      setFilterCounterpartyLoading(false);
      return;
    }
    const legalEntityId = toPositiveInt(filters.legalEntityId);
    if (!legalEntityId) {
      setFilterCounterpartyOptions([]);
      setFilterCounterpartyLoading(false);
      return;
    }
    const role = resolveCounterpartyRoleFromDirection(filters.direction);
    let active = true;
    async function loadFilterCounterparties() {
      setFilterCounterpartyLoading(true);
      try {
        const response = await listCariCounterparties({
          legalEntityId,
          allowedOperatingUnitId: toPositiveInt(filters.operatingUnitId) || undefined,
          role,
          sortBy: "NAME",
          sortDir: "ASC",
          limit: 300,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setFilterCounterpartyOptions(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (!active) {
          return;
        }
        setFilterCounterpartyOptions([]);
      } finally {
        if (active) {
          setFilterCounterpartyLoading(false);
        }
      }
    }
    loadFilterCounterparties();
    return () => {
      active = false;
    };
  }, [canReadCards, filters.direction, filters.legalEntityId, filters.operatingUnitId]);

  return {
    l,
    canRead,
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
  };
}
