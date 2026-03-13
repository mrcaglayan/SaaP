import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Combobox from "../../components/Combobox.jsx";
import MoneyText from "../../components/MoneyText.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { listOperatingUnits } from "../../api/orgAdmin.js";
import {
  createInventoryMovement,
  createInventoryWarehouse,
  listInventoryCariStockLinks,
  listInventoryCostLayers,
  listInventoryMovements,
  listInventoryWarehouses,
  reverseInventoryMovement,
} from "../../api/inventory.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeApiError(error, fallback) {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function mapLegalEntityLookupOption(row) {
  const value = String(toPositiveInt(row?.id) || "").trim();
  if (!value) {
    return null;
  }
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `Legal entity #${value}`,
    description: normalizeText(row?.functional_currency_code || row?.functionalCurrencyCode),
  };
}

function createWarehouseForm(legalEntityId = "") {
  return {
    legalEntityId: legalEntityId || "",
    ownershipScope: "CENTRAL",
    operatingUnitId: "",
    code: "",
    name: "",
    status: "ACTIVE",
    notes: "",
  };
}

function createMovementForm(legalEntityId = "", warehouseId = "") {
  return {
    legalEntityId: legalEntityId || "",
    sourceStockLinkId: "",
    warehouseId: warehouseId || "",
    movementDate: todayDateOnly(),
    note: "",
  };
}

function getStatusBadgeClass(value) {
  switch (String(value || "").trim().toUpperCase()) {
    case "PENDING":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    case "LINKED":
    case "VALUED":
    case "OPEN":
    case "ACTIVE":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    case "VOID":
    case "CLOSED":
    case "INACTIVE":
      return "border border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border border-sky-200 bg-sky-50 text-sky-800";
  }
}

function getOwnershipBadgeClass(value) {
  switch (String(value || "").trim().toUpperCase()) {
    case "OPERATING_UNIT":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    case "CENTRAL":
    default:
      return "border border-slate-200 bg-slate-100 text-slate-700";
  }
}

function stockLinkOptionLabel(row) {
  const parts = [
    row?.documentNo || `Doc #${row?.documentId || "-"}`,
    row?.itemCardCode || row?.itemCardName || `Item #${row?.itemCardId || "-"}`,
    `${row?.stockImpactMode || "NONE"} x ${row?.requestedQuantity ?? "-"}`,
    row?.reopenedFromStockLinkId ? `reopened #${row.reopenedFromStockLinkId}` : "",
  ];
  return parts.filter(Boolean).join(" | ");
}

function formatQuantityValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function collectConsumptionCurrencyCodes(row) {
  return Array.from(
    new Set(
      (Array.isArray(row?.layerConsumptions) ? row.layerConsumptions : [])
        .map((entry) => normalizeText(entry?.currencyCode).toUpperCase())
        .filter(Boolean)
    )
  );
}

function createInventoryMovementAnchorId(movementId) {
  const normalizedMovementId = toPositiveInt(movementId);
  return normalizedMovementId ? `inventory-movement-${normalizedMovementId}` : "";
}

export default function InventoryMovementsPage() {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const { legalEntities: workingContextLegalEntities } = useWorkingContext();
  const [searchParams] = useSearchParams();

  const canRead = hasPermission("inventory.read");
  const canUpsert = hasPermission("inventory.upsert");
  const canReadOrgTree = hasPermission("org.tree.read");
  const deepLinkedLegalEntityId = useMemo(
    () => String(toPositiveInt(searchParams.get("legalEntityId")) || ""),
    [searchParams]
  );
  const deepLinkedMovementId = useMemo(
    () => String(toPositiveInt(searchParams.get("movementId")) || ""),
    [searchParams]
  );

  const legalEntityOptions = useMemo(
    () =>
      (Array.isArray(workingContextLegalEntities) ? workingContextLegalEntities : [])
        .map(mapLegalEntityLookupOption)
        .filter(Boolean),
    [workingContextLegalEntities]
  );

  const [filters, setFilters] = useState({
    legalEntityId: "",
    warehouseId: "",
  });
  const [warehouseRows, setWarehouseRows] = useState([]);
  const [warehouseOperatingUnits, setWarehouseOperatingUnits] = useState([]);
  const [warehouseOperatingUnitsLoading, setWarehouseOperatingUnitsLoading] = useState(false);
  const [warehouseOperatingUnitsError, setWarehouseOperatingUnitsError] = useState("");
  const [stockLinkRows, setStockLinkRows] = useState([]);
  const [movementRows, setMovementRows] = useState([]);
  const [costLayerRows, setCostLayerRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  const [warehouseForm, setWarehouseForm] = useState(() => createWarehouseForm());
  const [warehouseSaving, setWarehouseSaving] = useState(false);
  const [warehouseError, setWarehouseError] = useState("");
  const [warehouseMessage, setWarehouseMessage] = useState("");

  const [movementForm, setMovementForm] = useState(() => createMovementForm());
  const [movementSaving, setMovementSaving] = useState(false);
  const [movementError, setMovementError] = useState("");
  const [movementMessage, setMovementMessage] = useState("");
  const [reverseForm, setReverseForm] = useState({
    movementId: "",
    reversalDate: todayDateOnly(),
  });
  const [receiptReverseForm, setReceiptReverseForm] = useState({
    movementId: "",
    reversalDate: todayDateOnly(),
  });
  const [reversingMovementId, setReversingMovementId] = useState(null);
  const [reverseError, setReverseError] = useState("");
  const [reverseMessage, setReverseMessage] = useState("");
  const deepLinkedMovementRow = useMemo(
    () =>
      movementRows.find(
        (row) => String(toPositiveInt(row?.id) || "") === String(deepLinkedMovementId || "")
      ) || null,
    [deepLinkedMovementId, movementRows]
  );
  const warehouseOptions = useMemo(
    () =>
      warehouseRows.map((row) => ({
        value: String(row.id || ""),
        label:
          row.code && row.name
            ? `${row.code} - ${row.name}`
            : row.code || row.name || `Warehouse #${row.id}`,
      })),
    [warehouseRows]
  );
  const activeWarehouseOptions = useMemo(
    () =>
      warehouseRows
        .filter((row) => String(row?.status || "").toUpperCase() === "ACTIVE")
        .map((row) => ({
          value: String(row.id || ""),
          label:
            row.code && row.name
              ? `${row.code} - ${row.name}`
              : row.code || row.name || `Warehouse #${row.id}`,
        })),
    [warehouseRows]
  );
  const warehouseOperatingUnitOptions = useMemo(
    () =>
      warehouseOperatingUnits
        .map((row) => {
          const value = String(toPositiveInt(row?.id) || "");
          if (!value) {
            return null;
          }
          const code = normalizeText(row?.code);
          const name = normalizeText(row?.name);
          return {
            value,
            label: code && name ? `${code} - ${name}` : code || name || `OU #${value}`,
          };
        })
        .filter(Boolean),
    [warehouseOperatingUnits]
  );

  useEffect(() => {
    if (!filters.legalEntityId && legalEntityOptions.length === 1) {
      const onlyValue = legalEntityOptions[0]?.value || "";
      setFilters((previous) => ({
        ...previous,
        legalEntityId: onlyValue,
      }));
      setWarehouseForm((previous) => ({
        ...previous,
        legalEntityId: onlyValue,
      }));
      setMovementForm((previous) => ({
        ...previous,
        legalEntityId: onlyValue,
      }));
    }
  }, [filters.legalEntityId, legalEntityOptions]);

  useEffect(() => {
    if (!deepLinkedLegalEntityId) {
      return;
    }
    setFilters((previous) =>
      previous.legalEntityId === deepLinkedLegalEntityId
        ? previous
        : {
            ...previous,
            legalEntityId: deepLinkedLegalEntityId,
            warehouseId: "",
          }
    );
    setWarehouseForm((previous) =>
      previous.legalEntityId === deepLinkedLegalEntityId
        ? previous
        : {
            ...previous,
            legalEntityId: deepLinkedLegalEntityId,
          }
    );
    setMovementForm((previous) =>
      previous.legalEntityId === deepLinkedLegalEntityId
        ? previous
        : {
            ...previous,
            legalEntityId: deepLinkedLegalEntityId,
            warehouseId: "",
            sourceStockLinkId: "",
          }
    );
  }, [deepLinkedLegalEntityId]);

  useEffect(() => {
    setWarehouseForm((previous) => ({
      ...previous,
      legalEntityId: filters.legalEntityId || previous.legalEntityId || "",
    }));
    setMovementForm((previous) => ({
      ...previous,
      legalEntityId: filters.legalEntityId || previous.legalEntityId || "",
      warehouseId:
        filters.warehouseId && filters.warehouseId !== previous.warehouseId
          ? filters.warehouseId
          : previous.warehouseId,
    }));
  }, [filters.legalEntityId, filters.warehouseId]);

  useEffect(() => {
    if (warehouseForm.ownershipScope !== "OPERATING_UNIT" && warehouseForm.operatingUnitId) {
      setWarehouseForm((previous) => ({
        ...previous,
        operatingUnitId: "",
      }));
    }
  }, [warehouseForm.operatingUnitId, warehouseForm.ownershipScope]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(warehouseForm.legalEntityId);
    if (
      warehouseForm.ownershipScope !== "OPERATING_UNIT" ||
      !canReadOrgTree ||
      !legalEntityId
    ) {
      setWarehouseOperatingUnits([]);
      setWarehouseOperatingUnitsError("");
      setWarehouseOperatingUnitsLoading(false);
      setWarehouseForm((previous) =>
        previous.operatingUnitId
          ? {
              ...previous,
              operatingUnitId: "",
            }
          : previous
      );
      return;
    }

    let cancelled = false;
    setWarehouseOperatingUnitsLoading(true);
    setWarehouseOperatingUnitsError("");
    void listOperatingUnits({
      legalEntityId,
      limit: 500,
      includeInactive: true,
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        setWarehouseOperatingUnits(rows);
        const validIds = new Set(
          rows.map((row) => String(toPositiveInt(row?.id) || "")).filter(Boolean)
        );
        setWarehouseForm((previous) =>
          previous.operatingUnitId && !validIds.has(previous.operatingUnitId)
            ? {
                ...previous,
                operatingUnitId: "",
              }
            : previous
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setWarehouseOperatingUnits([]);
        setWarehouseOperatingUnitsError(
          normalizeApiError(
            error,
            l("Operating units could not be loaded.", "Isletme birimleri yuklenemedi.")
          )
        );
      })
      .finally(() => {
        if (!cancelled) {
          setWarehouseOperatingUnitsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canReadOrgTree, l, warehouseForm.legalEntityId, warehouseForm.ownershipScope]);

  const loadPageData = useCallback(async () => {
    const legalEntityId = toPositiveInt(filters.legalEntityId);
    if (!canRead) {
      setWarehouseRows([]);
      setStockLinkRows([]);
      setMovementRows([]);
      setCostLayerRows([]);
      setPageError(l("Missing permission: inventory.read", "Eksik yetki: inventory.read"));
      setLoading(false);
      return;
    }
    if (!legalEntityId) {
      setWarehouseRows([]);
      setStockLinkRows([]);
      setMovementRows([]);
      setCostLayerRows([]);
      setPageError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setPageError("");
    try {
      const [warehousesResponse, stockLinksResponse, movementsResponse, costLayersResponse] =
        await Promise.all([
          listInventoryWarehouses({
            legalEntityId,
            limit: 200,
            offset: 0,
          }),
          listInventoryCariStockLinks({
            legalEntityId,
            linkStatus: "PENDING",
            limit: 200,
            offset: 0,
          }),
          listInventoryMovements({
            legalEntityId,
            warehouseId: filters.warehouseId || undefined,
            limit: 200,
            offset: 0,
          }),
          listInventoryCostLayers({
            legalEntityId,
            warehouseId: filters.warehouseId || undefined,
            limit: 200,
            offset: 0,
          }),
        ]);

      setWarehouseRows(Array.isArray(warehousesResponse?.rows) ? warehousesResponse.rows : []);
      setStockLinkRows(Array.isArray(stockLinksResponse?.rows) ? stockLinksResponse.rows : []);
      setMovementRows(Array.isArray(movementsResponse?.rows) ? movementsResponse.rows : []);
      setCostLayerRows(Array.isArray(costLayersResponse?.rows) ? costLayersResponse.rows : []);
    } catch (error) {
      setWarehouseRows([]);
      setStockLinkRows([]);
      setMovementRows([]);
      setCostLayerRows([]);
      setPageError(
        normalizeApiError(
          error,
          l("Failed to load inventory operations.", "Stok operasyonlari yuklenemedi.")
        )
      );
    } finally {
      setLoading(false);
    }
  }, [canRead, filters.legalEntityId, filters.warehouseId, l]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  useEffect(() => {
    const warehouseIds = new Set(
      activeWarehouseOptions
        .map((row) => String(row.value || ""))
        .filter(Boolean)
    );
    const filterWarehouseIds = new Set(
      warehouseRows
        .map((row) => String(toPositiveInt(row?.id) || ""))
        .filter(Boolean)
    );
    setFilters((previous) => {
      if (previous.warehouseId && !filterWarehouseIds.has(previous.warehouseId)) {
        return { ...previous, warehouseId: "" };
      }
      return previous;
    });
    setMovementForm((previous) => {
      if (previous.warehouseId && !warehouseIds.has(previous.warehouseId)) {
        return { ...previous, warehouseId: "" };
      }
      if (!previous.warehouseId && activeWarehouseOptions.length === 1) {
        return {
          ...previous,
          warehouseId: String(activeWarehouseOptions[0].value || ""),
        };
      }
      return previous;
    });
  }, [activeWarehouseOptions, warehouseRows]);

  useEffect(() => {
    const validStockLinkIds = new Set(
      stockLinkRows
        .map((row) => String(toPositiveInt(row?.id) || ""))
        .filter(Boolean)
    );
    setMovementForm((previous) => {
      if (previous.sourceStockLinkId && !validStockLinkIds.has(previous.sourceStockLinkId)) {
        return { ...previous, sourceStockLinkId: "" };
      }
      if (!previous.sourceStockLinkId && stockLinkRows.length > 0) {
        return {
          ...previous,
          sourceStockLinkId: String(stockLinkRows[0].id || ""),
        };
      }
      return previous;
    });
  }, [stockLinkRows]);

  const reversibleIssueRows = useMemo(
    () =>
      movementRows.filter(
        (row) =>
          String(row?.movementType || "").toUpperCase() === "ISSUE" &&
          String(row?.valuationStatus || "").toUpperCase() === "VALUED" &&
          !toPositiveInt(row?.reversalJournalEntryId) &&
          !normalizeText(row?.reversedAt)
      ),
    [movementRows]
  );
  const reversibleReceiptRows = useMemo(
    () =>
      movementRows.filter(
        (row) =>
          String(row?.movementType || "").toUpperCase() === "RECEIPT" &&
          String(row?.valuationStatus || "").toUpperCase() === "VALUED" &&
          !toPositiveInt(row?.reversalJournalEntryId) &&
          !normalizeText(row?.reversedAt)
      ),
    [movementRows]
  );
  const reversedIssueRows = useMemo(
    () =>
      movementRows.filter(
        (row) =>
          String(row?.movementType || "").toUpperCase() === "ISSUE" &&
          (toPositiveInt(row?.reversalJournalEntryId) || normalizeText(row?.reversedAt))
      ),
    [movementRows]
  );
  const reversedReceiptRows = useMemo(
    () =>
      movementRows.filter(
        (row) =>
          String(row?.movementType || "").toUpperCase() === "RECEIPT" &&
          normalizeText(row?.reversedAt)
      ),
    [movementRows]
  );
  const mixedCurrencyIssueRows = useMemo(
    () =>
      movementRows.filter(
        (row) =>
          String(row?.movementType || "").toUpperCase() === "ISSUE" &&
          collectConsumptionCurrencyCodes(row).length > 1
      ),
    [movementRows]
  );

  useEffect(() => {
    const validMovementIds = new Set(
      reversibleIssueRows
        .map((row) => String(toPositiveInt(row?.id) || ""))
        .filter(Boolean)
    );
    setReverseForm((previous) => {
      if (previous.movementId && !validMovementIds.has(previous.movementId)) {
        return {
          ...previous,
          movementId: "",
        };
      }
      if (!previous.movementId && reversibleIssueRows.length > 0) {
        return {
          ...previous,
          movementId: String(reversibleIssueRows[0].id || ""),
        };
      }
      return previous;
    });
  }, [reversibleIssueRows]);
  useEffect(() => {
    const validMovementIds = new Set(
      reversibleReceiptRows
        .map((row) => String(toPositiveInt(row?.id) || ""))
        .filter(Boolean)
    );
    setReceiptReverseForm((previous) => {
      if (previous.movementId && !validMovementIds.has(previous.movementId)) {
        return {
          ...previous,
          movementId: "",
        };
      }
      if (!previous.movementId && reversibleReceiptRows.length > 0) {
        return {
          ...previous,
          movementId: String(reversibleReceiptRows[0].id || ""),
        };
      }
      return previous;
    });
  }, [reversibleReceiptRows]);

  const selectedPendingLink = useMemo(
    () =>
      stockLinkRows.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(movementForm.sourceStockLinkId)
      ) || null,
    [movementForm.sourceStockLinkId, stockLinkRows]
  );
  const selectedReversibleIssue = useMemo(
    () =>
      reversibleIssueRows.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(reverseForm.movementId)
      ) || null,
    [reverseForm.movementId, reversibleIssueRows]
  );
  const selectedReversibleReceipt = useMemo(
    () =>
      reversibleReceiptRows.find(
        (row) => toPositiveInt(row?.id) === toPositiveInt(receiptReverseForm.movementId)
      ) || null,
    [receiptReverseForm.movementId, reversibleReceiptRows]
  );

  useEffect(() => {
    if (!deepLinkedMovementId || !deepLinkedMovementRow) {
      return;
    }
    const targetMovementType = normalizeText(deepLinkedMovementRow?.movementType).toUpperCase();
    if (targetMovementType === "ISSUE") {
      setReverseForm((previous) =>
        previous.movementId === deepLinkedMovementId
          ? previous
          : {
              ...previous,
              movementId: deepLinkedMovementId,
            }
      );
    }
    if (targetMovementType === "RECEIPT") {
      setReceiptReverseForm((previous) =>
        previous.movementId === deepLinkedMovementId
          ? previous
          : {
              ...previous,
              movementId: deepLinkedMovementId,
            }
      );
    }
    if (typeof document !== "undefined") {
      const anchorId = createInventoryMovementAnchorId(deepLinkedMovementId);
      const targetElement = anchorId ? document.getElementById(anchorId) : null;
      if (targetElement) {
        targetElement.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }, [deepLinkedMovementId, deepLinkedMovementRow]);

  async function handleCreateWarehouse(event) {
    event.preventDefault();
    if (!canUpsert) {
      setWarehouseError(l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert"));
      return;
    }
    setWarehouseSaving(true);
    setWarehouseError("");
    setWarehouseMessage("");
    try {
      const response = await createInventoryWarehouse({
        legalEntityId: toPositiveInt(warehouseForm.legalEntityId),
        ownershipScope: warehouseForm.ownershipScope,
        operatingUnitId:
          warehouseForm.ownershipScope === "OPERATING_UNIT"
            ? toPositiveInt(warehouseForm.operatingUnitId)
            : undefined,
        code: normalizeText(warehouseForm.code).toUpperCase(),
        name: normalizeText(warehouseForm.name),
        status: normalizeText(warehouseForm.status).toUpperCase() || "ACTIVE",
        notes: normalizeText(warehouseForm.notes) || undefined,
      });
      const createdRow = response?.row || null;
      setWarehouseMessage(
        l("Warehouse created.", "Depo olusturuldu.") +
          (createdRow?.code ? ` ${createdRow.code}` : "")
      );
      setWarehouseForm(createWarehouseForm(warehouseForm.legalEntityId));
      if (createdRow?.id) {
        setFilters((previous) => ({
          ...previous,
          warehouseId: String(createdRow.id),
        }));
        setMovementForm((previous) => ({
          ...previous,
          warehouseId: String(createdRow.id),
        }));
      }
      await loadPageData();
    } catch (error) {
      setWarehouseError(
        normalizeApiError(error, l("Warehouse create failed.", "Depo olusturma basarisiz."))
      );
    } finally {
      setWarehouseSaving(false);
    }
  }

  async function handleCreateMovement(event) {
    event.preventDefault();
    if (!canUpsert) {
      setMovementError(l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert"));
      return;
    }
    setMovementSaving(true);
    setMovementError("");
    setMovementMessage("");
    try {
      const response = await createInventoryMovement({
        legalEntityId: toPositiveInt(movementForm.legalEntityId),
        warehouseId: toPositiveInt(movementForm.warehouseId),
        sourceStockLinkId: toPositiveInt(movementForm.sourceStockLinkId),
        movementDate: movementForm.movementDate,
        note: normalizeText(movementForm.note) || undefined,
      });
      setMovementMessage(
        l("Inventory movement created.", "Stok hareketi olusturuldu.") +
          (response?.row?.id ? ` #${response.row.id}` : "")
      );
      setMovementForm((previous) => ({
        ...createMovementForm(previous.legalEntityId, previous.warehouseId),
      }));
      await loadPageData();
    } catch (error) {
      setMovementError(
        normalizeApiError(
          error,
          l("Inventory movement create failed.", "Stok hareketi olusturma basarisiz.")
        )
      );
    } finally {
      setMovementSaving(false);
    }
  }

  async function handleReverseMovement(row, overrides = {}) {
    const movementId = toPositiveInt(row?.id);
    if (!canUpsert || !movementId) {
      setReverseError(l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert"));
      return;
    }
    const confirmed = window.confirm(
      l(
        "Reverse this valued issue movement and restore its consumed layers?",
        "Bu degerlenmis cikis hareketi terslenip tuketilen katmanlari geri yüklensin mi?"
      )
    );
    if (!confirmed) {
      return;
    }

    setReversingMovementId(movementId);
    setReverseError("");
    setReverseMessage("");
    try {
      const response = await reverseInventoryMovement(movementId, {
        reversalDate: overrides.reversalDate || todayDateOnly(),
        reason:
          normalizeText(overrides.reason) ||
          `Manual inventory issue reversal for movement ${movementId}`.slice(0, 255),
      });
      const reversedRow = response?.row || null;
      setReverseMessage(
        l("Issue movement reversed.", "Cikis hareketi terslendi.") +
          (reversedRow?.reversalJournalNo
            ? ` ${reversedRow.reversalJournalNo}`
            : reversedRow?.reversedAt
              ? ` #${movementId}`
              : "")
      );
      await loadPageData();
    } catch (error) {
      setReverseError(
        normalizeApiError(
          error,
          l("Inventory issue reverse failed.", "Stok cikisi tersleme basarisiz.")
        )
      );
    } finally {
      setReversingMovementId(null);
    }
  }

  async function handleReverseIssueSubmit(event) {
    event.preventDefault();
    if (!selectedReversibleIssue) {
      setReverseError(
        l(
          "Select one valued issue movement to reverse.",
          "Terslemek icin bir degerlenmis cikis hareketi secin."
        )
      );
      return;
    }
    await handleReverseMovement(selectedReversibleIssue, {
      reversalDate: reverseForm.reversalDate,
      reason: `Manual inventory issue reversal for movement ${selectedReversibleIssue.id}`.slice(
        0,
        255
      ),
    });
  }

  async function handleReverseReceiptSubmit(event) {
    event.preventDefault();
    if (!selectedReversibleReceipt) {
      setReverseError(
        l(
          "Select one materialized receipt movement to undo.",
          "Geri almak icin bir gerceklestirilmis alim hareketi secin."
        )
      );
      return;
    }

    const movementId = toPositiveInt(selectedReversibleReceipt.id);
    if (!canUpsert || !movementId) {
      setReverseError(l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert"));
      return;
    }

    const confirmed = window.confirm(
      l(
        "Undo this materialized receipt and close its open receipt layer?",
        "Bu gerceklestirilmis alim yansitmasi geri alinip acik alim katmani kapatilsin mi?"
      )
    );
    if (!confirmed) {
      return;
    }

    setReversingMovementId(movementId);
    setReverseError("");
    setReverseMessage("");
    try {
      const response = await reverseInventoryMovement(movementId, {
        reversalDate: receiptReverseForm.reversalDate || todayDateOnly(),
        reason: `Manual inventory receipt undo for movement ${movementId}`.slice(0, 255),
      });
      const reversedRow = response?.row || null;
      setReverseMessage(
        l("Receipt materialization undone.", "Alim yansitmasi geri alindi.") +
          (reversedRow?.reversalMovementId
            ? ` #${reversedRow.reversalMovementId}`
            : reversedRow?.reversedAt
              ? ` #${movementId}`
              : "")
      );
      await loadPageData();
    } catch (error) {
      setReverseError(
        normalizeApiError(
          error,
          l(
            "Inventory receipt undo failed.",
            "Stok alim yansitmasini geri alma basarisiz."
          )
        )
      );
    } finally {
      setReversingMovementId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              {l("Stock Reflection Transactions", "Stok Yansitma Islemleri")}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Link pending CARI stock lines to warehouses, movements, and receipt cost layers.",
                "Bekleyen CARI stok satirlarini depolar, hareketler ve alim maliyet katmanlari ile baglayin."
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={() => void loadPageData()}
            disabled={loading}
          >
            {loading ? l("Refreshing...", "Yenileniyor...") : l("Refresh", "Yenile")}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(240px,1fr)_220px]">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Legal Entity", "Tuzel Kisilik")}
            <Combobox
              className="mt-1"
              value={filters.legalEntityId}
              options={legalEntityOptions}
              placeholder={l("Select legal entity", "Tuzel kisilik secin")}
              noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
              onChange={(nextValue) =>
                setFilters((previous) => ({
                  ...previous,
                  legalEntityId: nextValue ? String(nextValue) : "",
                  warehouseId: "",
                }))
              }
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Warehouse Filter", "Depo Filtresi")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.warehouseId}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  warehouseId: event.target.value,
                }))
              }
              disabled={!filters.legalEntityId}
            >
              <option value="">{l("All warehouses", "Tum depolar")}</option>
              {warehouseOptions.map((option) => (
                <option key={`warehouse-filter-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {pageError ? <p className="mt-3 text-sm text-rose-700">{pageError}</p> : null}
        {!pageError && !filters.legalEntityId ? (
          <p className="mt-3 text-sm text-slate-600">
            {l(
              "Select a legal entity to load inventory foundations.",
              "Stok temelini yuklemek icin bir tuzel kisilik secin."
            )}
          </p>
        ) : null}

        {filters.legalEntityId ? (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Warehouses", "Depolar")}
              </div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{warehouseRows.length}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                {l("Pending Links", "Bekleyen Baglantilar")}
              </div>
              <div className="mt-1 text-2xl font-semibold text-amber-900">{stockLinkRows.length}</div>
            </div>
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                {l("Movements", "Hareketler")}
              </div>
              <div className="mt-1 text-2xl font-semibold text-sky-900">{movementRows.length}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                {l("Cost Layers", "Maliyet Katmanlari")}
              </div>
              <div className="mt-1 text-2xl font-semibold text-emerald-900">{costLayerRows.length}</div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <form
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={handleCreateWarehouse}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Create Warehouse", "Depo Olustur")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {l(
                    "Warehouses are the first real inventory ownership scope in this flow.",
                    "Depolar bu akista ilk gercek stok sahiplik kapsamidir."
                  )}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                  warehouseForm.status
                )}`}
              >
                {warehouseForm.status || "ACTIVE"}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Legal Entity", "Tuzel Kisilik")}
                <Combobox
                  className="mt-1"
                  value={warehouseForm.legalEntityId}
                  options={legalEntityOptions}
                  placeholder={l("Select legal entity", "Tuzel kisilik secin")}
                  noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                  onChange={(nextValue) =>
                    setWarehouseForm((previous) => ({
                      ...previous,
                      legalEntityId: nextValue ? String(nextValue) : "",
                    }))
                  }
                  disabled={warehouseSaving}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Ownership Scope", "Sahiplik Kapsami")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={warehouseForm.ownershipScope}
                  onChange={(event) =>
                    setWarehouseForm((previous) => ({
                      ...previous,
                      ownershipScope: event.target.value,
                    }))
                  }
                  disabled={warehouseSaving || !canUpsert}
                >
                  <option value="CENTRAL">{l("Central", "Merkez")}</option>
                  <option value="OPERATING_UNIT">{l("Operating Unit", "Isletme Birimi")}</option>
                </select>
              </label>
              {warehouseForm.ownershipScope === "OPERATING_UNIT" ? (
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {l("Operating Unit", "Isletme Birimi")}
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                    value={warehouseForm.operatingUnitId}
                    onChange={(event) =>
                      setWarehouseForm((previous) => ({
                        ...previous,
                        operatingUnitId: event.target.value,
                      }))
                    }
                    disabled={
                      warehouseSaving ||
                      !canUpsert ||
                      !warehouseForm.legalEntityId ||
                      !canReadOrgTree ||
                      warehouseOperatingUnitsLoading
                    }
                  >
                    <option value="">{l("Select operating unit", "Isletme birimi secin")}</option>
                    {warehouseOperatingUnitOptions.map((option) => (
                      <option key={`warehouse-ou-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Code", "Kod")}
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                  value={warehouseForm.code}
                  onChange={(event) =>
                    setWarehouseForm((previous) => ({
                      ...previous,
                      code: event.target.value,
                    }))
                  }
                  disabled={warehouseSaving || !canUpsert}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Name", "Ad")}
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={warehouseForm.name}
                  onChange={(event) =>
                    setWarehouseForm((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  disabled={warehouseSaving || !canUpsert}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Notes", "Notlar")}
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={warehouseForm.notes}
                  onChange={(event) =>
                    setWarehouseForm((previous) => ({
                      ...previous,
                      notes: event.target.value,
                    }))
                  }
                  disabled={warehouseSaving || !canUpsert}
                />
              </label>
            </div>

            {warehouseForm.ownershipScope === "OPERATING_UNIT" && !canReadOrgTree ? (
              <p className="mt-3 text-sm text-amber-700">
                {l(
                  "Missing permission: org.tree.read. Operating-unit-owned warehouses cannot be selected from this screen.",
                  "Eksik yetki: org.tree.read. Bu ekranda isletme birimine ait depo secimi yapilamaz."
                )}
              </p>
            ) : null}
            {warehouseOperatingUnitsError ? (
              <p className="mt-3 text-sm text-rose-700">{warehouseOperatingUnitsError}</p>
            ) : null}
            {warehouseError ? <p className="mt-3 text-sm text-rose-700">{warehouseError}</p> : null}
            {warehouseMessage ? (
              <p className="mt-3 text-sm text-emerald-700">{warehouseMessage}</p>
            ) : null}

            <button
              type="submit"
              className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                warehouseSaving ||
                !canUpsert ||
                !toPositiveInt(warehouseForm.legalEntityId) ||
                !normalizeText(warehouseForm.code) ||
                !normalizeText(warehouseForm.name) ||
                (warehouseForm.ownershipScope === "OPERATING_UNIT" &&
                  (!canReadOrgTree || !toPositiveInt(warehouseForm.operatingUnitId)))
              }
            >
              {warehouseSaving ? l("Creating...", "Olusturuluyor...") : l("Create Warehouse", "Depo Olustur")}
            </button>
          </form>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Warehouse List", "Depo Listesi")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {l(
                    "Review central and operating-unit-owned warehouse scope before stock activity starts.",
                    "Stok hareketi baslamadan once merkez ve isletme birimi sahipligindeki depolari gozden gecirin."
                  )}
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                {warehouseRows.length}
              </span>
            </div>

            {warehouseRows.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">
                {l("No warehouses found for this legal entity.", "Bu tuzel kisilik icin depo bulunamadi.")}
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {warehouseRows.map((row) => {
                  const ownershipScope = String(row?.ownershipScope || "CENTRAL").toUpperCase();
                  const ownershipLabel =
                    ownershipScope === "OPERATING_UNIT"
                      ? l("Operating Unit", "Isletme Birimi")
                      : l("Central", "Merkez");
                  const operatingUnitLabel =
                    ownershipScope === "OPERATING_UNIT"
                      ? row?.operatingUnitCode && row?.operatingUnitName
                        ? `${row.operatingUnitCode} - ${row.operatingUnitName}`
                        : row?.operatingUnitCode || row?.operatingUnitName || l("Unknown OU", "Bilinmeyen IB")
                      : l("Central", "Merkez");
                  return (
                    <div
                      key={`warehouse-row-${row.id}`}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900">
                            {row.code && row.name
                              ? `${row.code} - ${row.name}`
                              : row.code || row.name || `Warehouse #${row.id}`}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {l("Legal entity", "Tuzel kisilik")}{" "}
                            {row.legalEntityCode || row.legalEntityId || "-"}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getOwnershipBadgeClass(
                              ownershipScope
                            )}`}
                          >
                            {ownershipLabel}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                              row.status
                            )}`}
                          >
                            {row.status || "ACTIVE"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-slate-700">
                        {l("Owner Context", "Sahiplik Baglami")}: {operatingUnitLabel}
                      </div>
                      {row.notes ? (
                        <div className="mt-1 text-sm text-slate-600">{row.notes}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <form
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={handleCreateMovement}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Materialize Stock Link", "Stok Baglantisini Gerceklestir")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {l(
                    "Create a warehouse movement from a pending CARI stock-impact row.",
                    "Bekleyen CARI stok etkisi satirindan depo hareketi olusturun."
                  )}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                  selectedPendingLink?.stockImpactMode || "PENDING"
                )}`}
              >
                {selectedPendingLink?.stockImpactMode || l("Pending", "Bekliyor")}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Pending Stock Link", "Bekleyen Stok Baglantisi")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={movementForm.sourceStockLinkId}
                  onChange={(event) =>
                    setMovementForm((previous) => ({
                      ...previous,
                      sourceStockLinkId: event.target.value,
                    }))
                  }
                  disabled={movementSaving || !canUpsert || stockLinkRows.length === 0}
                >
                  <option value="">{l("Select pending link", "Bekleyen baglanti secin")}</option>
                  {stockLinkRows.map((row) => (
                    <option key={`pending-link-${row.id}`} value={String(row.id || "")}>
                      {stockLinkOptionLabel(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Warehouse", "Depo")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={movementForm.warehouseId}
                  onChange={(event) =>
                    setMovementForm((previous) => ({
                      ...previous,
                      warehouseId: event.target.value,
                    }))
                  }
                  disabled={movementSaving || !canUpsert || activeWarehouseOptions.length === 0}
                >
                  <option value="">{l("Select warehouse", "Depo secin")}</option>
                  {activeWarehouseOptions.map((option) => (
                    <option key={`movement-warehouse-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Movement Date", "Hareket Tarihi")}
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={movementForm.movementDate}
                  onChange={(event) =>
                    setMovementForm((previous) => ({
                      ...previous,
                      movementDate: event.target.value,
                    }))
                  }
                  disabled={movementSaving || !canUpsert}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Note", "Not")}
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={movementForm.note}
                  onChange={(event) =>
                    setMovementForm((previous) => ({
                      ...previous,
                      note: event.target.value,
                    }))
                  }
                  disabled={movementSaving || !canUpsert}
                />
              </label>
            </div>

            {selectedPendingLink ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">
                  {selectedPendingLink.documentNo || `Doc #${selectedPendingLink.documentId || "-"}`}
                </div>
                <div className="mt-1">
                  {(selectedPendingLink.itemCardCode || selectedPendingLink.itemCardName || "-")} |{" "}
                  {selectedPendingLink.stockImpactMode || "NONE"} |{" "}
                  {l("Qty", "Miktar")} {selectedPendingLink.requestedQuantity ?? "-"}
                </div>
                <div className="mt-1">
                  {selectedPendingLink.lineDescription || l("No line description.", "Satir aciklamasi yok.")}
                </div>
                {selectedPendingLink.reopenedFromStockLinkId ? (
                  <div className="mt-1 text-xs text-slate-500">
                    {l("Reopened from stock link", "Stok baglantisindan yeniden acildi")} #
                    {selectedPendingLink.reopenedFromStockLinkId}
                  </div>
                ) : null}
              </div>
            ) : null}

            {movementError ? <p className="mt-3 text-sm text-rose-700">{movementError}</p> : null}
            {movementMessage ? (
              <p className="mt-3 text-sm text-emerald-700">{movementMessage}</p>
            ) : null}

            <button
              type="submit"
              className="mt-4 rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                movementSaving ||
                !canUpsert ||
                !toPositiveInt(movementForm.sourceStockLinkId) ||
                !toPositiveInt(movementForm.warehouseId)
              }
            >
              {movementSaving
                ? l("Creating movement...", "Hareket olusturuluyor...")
                : l("Create Movement", "Hareket Olustur")}
            </button>
          </form>

          <form
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={handleReverseIssueSubmit}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Reverse Valued Issue", "Degerlenmis Cikisi Tersle")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {l(
                    "Reverse one valued outbound issue, restore its FIFO layers, and create the inventory-side reversal journal.",
                    "Bir degerlenmis cikis hareketini tersleyin, FIFO katmanlarini geri yukleyin ve stok tarafindaki ters yevmiyeyi olusturun."
                  )}
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                {reversibleIssueRows.length}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Valued Issue", "Degerlenmis Cikis")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={reverseForm.movementId}
                  onChange={(event) =>
                    setReverseForm((previous) => ({
                      ...previous,
                      movementId: event.target.value,
                    }))
                  }
                  disabled={reversingMovementId !== null || !canUpsert || reversibleIssueRows.length === 0}
                >
                  <option value="">{l("Select issue movement", "Cikis hareketi secin")}</option>
                  {reversibleIssueRows.map((row) => (
                    <option key={`reverse-movement-${row.id}`} value={String(row.id || "")}>
                      {`#${row.id || "-"} | ${row.itemCardCode || row.itemCardName || "-"} | ${
                        row.warehouseCode || row.warehouseName || "-"
                      } | ${row.quantity ?? "-"} | ${row.sourceDocumentNo || "-"}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Reversal Date", "Ters Tarihi")}
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={reverseForm.reversalDate}
                  onChange={(event) =>
                    setReverseForm((previous) => ({
                      ...previous,
                      reversalDate: event.target.value,
                    }))
                  }
                  disabled={reversingMovementId !== null || !canUpsert}
                />
              </label>
            </div>

            {selectedReversibleIssue ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">
                  #{selectedReversibleIssue.id || "-"} |{" "}
                  {selectedReversibleIssue.itemCardCode ||
                    selectedReversibleIssue.itemCardName ||
                    "-"}
                </div>
                <div className="mt-1">
                  {selectedReversibleIssue.warehouseCode ||
                    selectedReversibleIssue.warehouseName ||
                    "-"}{" "}
                  | {l("Qty", "Miktar")} {selectedReversibleIssue.quantity ?? "-"}
                </div>
                <div className="mt-1">
                  {selectedReversibleIssue.sourceDocumentNo || selectedReversibleIssue.sourceType || "-"}
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              className="mt-4 rounded-md bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !canUpsert ||
                reversingMovementId !== null ||
                !toPositiveInt(reverseForm.movementId)
              }
            >
              {reversingMovementId !== null
                ? l("Reversing...", "Tersleniyor...")
                : l("Reverse Valued Issue", "Degerlenmis Cikisi Tersle")}
            </button>
          </form>

          <form
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={handleReverseReceiptSubmit}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Undo Materialized Receipt", "Gerceklestirilmis Alimi Geri Al")}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {l(
                    "Undo one fully available receipt materialization without creating a duplicate inventory journal.",
                    "Tamamen musait bir alim yansitmasini, tekrar stok yevmiyesi olusturmadan geri alin."
                  )}
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                {reversibleReceiptRows.length}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Materialized Receipt", "Gerceklestirilmis Alim")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={receiptReverseForm.movementId}
                  onChange={(event) =>
                    setReceiptReverseForm((previous) => ({
                      ...previous,
                      movementId: event.target.value,
                    }))
                  }
                  disabled={
                    reversingMovementId !== null ||
                    !canUpsert ||
                    reversibleReceiptRows.length === 0
                  }
                >
                  <option value="">{l("Select receipt movement", "Alim hareketi secin")}</option>
                  {reversibleReceiptRows.map((row) => (
                    <option key={`reverse-receipt-${row.id}`} value={String(row.id || "")}>
                      {`#${row.id || "-"} | ${row.itemCardCode || row.itemCardName || "-"} | ${
                        row.warehouseCode || row.warehouseName || "-"
                      } | ${row.quantity ?? "-"} | ${row.sourceDocumentNo || "-"}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {l("Undo Date", "Geri Alma Tarihi")}
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={receiptReverseForm.reversalDate}
                  onChange={(event) =>
                    setReceiptReverseForm((previous) => ({
                      ...previous,
                      reversalDate: event.target.value,
                    }))
                  }
                  disabled={reversingMovementId !== null || !canUpsert}
                />
              </label>
            </div>

            {selectedReversibleReceipt ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">
                  #{selectedReversibleReceipt.id || "-"} |{" "}
                  {selectedReversibleReceipt.itemCardCode ||
                    selectedReversibleReceipt.itemCardName ||
                    "-"}
                </div>
                <div className="mt-1">
                  {selectedReversibleReceipt.warehouseCode ||
                    selectedReversibleReceipt.warehouseName ||
                    "-"}{" "}
                  | {l("Qty", "Miktar")} {selectedReversibleReceipt.quantity ?? "-"}
                </div>
                <div className="mt-1">
                  {selectedReversibleReceipt.sourceDocumentNo ||
                    selectedReversibleReceipt.sourceType ||
                    "-"}
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              className="mt-4 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !canUpsert ||
                reversingMovementId !== null ||
                !toPositiveInt(receiptReverseForm.movementId)
              }
            >
              {reversingMovementId !== null
                ? l("Undoing...", "Geri aliniyor...")
                : l("Undo Materialized Receipt", "Gerceklestirilmis Alimi Geri Al")}
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Pending CARI Stock Links", "Bekleyen CARI Stok Baglantilari")}
              </h2>
              <span className="text-sm text-slate-500">{stockLinkRows.length}</span>
            </div>
            {stockLinkRows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                {l(
                  "No pending stock links for the selected legal entity.",
                  "Secili tuzel kisilik icin bekleyen stok baglantisi yok."
                )}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">{l("Document", "Belge")}</th>
                      <th className="px-3 py-2">{l("Item", "Kalem")}</th>
                      <th className="px-3 py-2">{l("Qty", "Miktar")}</th>
                      <th className="px-3 py-2">{l("Impact", "Etki")}</th>
                      <th className="px-3 py-2">{l("Net", "Net")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockLinkRows.map((row) => (
                      <tr key={`stock-link-row-${row.id}`} className="align-top">
                        <td className="px-3 py-2 text-slate-700">
                          <div className="font-medium text-slate-900">{row.documentNo || "-"}</div>
                          <div className="text-xs text-slate-500">{row.documentDate || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{row.itemCardCode || row.itemCardName || "-"}</div>
                          <div className="text-xs text-slate-500">{row.lineDescription || "-"}</div>
                          {row.reopenedFromStockLinkId ? (
                            <div className="text-xs text-sky-600">
                              {l("Reopened from", "Yeniden acildigi link")} #{row.reopenedFromStockLinkId}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{row.requestedQuantity ?? "-"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                              row.stockImpactMode
                            )}`}
                          >
                            {row.stockImpactMode || "NONE"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.postedNetAmountTxn === null || row.postedNetAmountTxn === undefined ? (
                            "-"
                          ) : (
                            <MoneyText amount={row.postedNetAmountTxn} currencyCode={row.currencyCode} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Inventory Movements", "Stok Hareketleri")}
              </h2>
              <span className="text-sm text-slate-500">{movementRows.length}</span>
            </div>
            {deepLinkedMovementRow ? (
              <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                {l("Focused from CARI reverse blocker:", "CARI ters kayit engelinden odaklandi:")}{" "}
                {`#${deepLinkedMovementRow.id || "-"} | ${
                  deepLinkedMovementRow.itemCardCode ||
                  deepLinkedMovementRow.itemCardName ||
                  "-"
                } | ${deepLinkedMovementRow.warehouseCode || deepLinkedMovementRow.warehouseName || "-"} | ${
                  deepLinkedMovementRow.movementType || "-"
                }`}
              </p>
            ) : null}
            {reverseError ? <p className="mt-3 text-sm text-rose-700">{reverseError}</p> : null}
            {reverseMessage ? (
              <p className="mt-3 text-sm text-emerald-700">{reverseMessage}</p>
            ) : null}
            {movementRows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                {l(
                  "No inventory movements found for the selected filters.",
                  "Secili filtreler icin stok hareketi bulunamadi."
                )}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">{l("Date", "Tarih")}</th>
                      <th className="px-3 py-2">{l("Warehouse", "Depo")}</th>
                      <th className="px-3 py-2">{l("Item", "Kalem")}</th>
                      <th className="px-3 py-2">{l("Type", "Tur")}</th>
                      <th className="px-3 py-2">{l("Qty", "Miktar")}</th>
                      <th className="px-3 py-2">{l("Valuation", "Degerleme")}</th>
                      <th className="px-3 py-2">{l("Source", "Kaynak")}</th>
                      <th className="px-3 py-2">{l("Total Cost", "Toplam Maliyet")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movementRows.map((row) => {
                      const movementAnchorId = createInventoryMovementAnchorId(row?.id);
                      const isDeepLinkedMovement =
                        String(toPositiveInt(row?.id) || "") === deepLinkedMovementId;
                      return (
                      <tr
                        key={`movement-row-${row.id}`}
                        id={movementAnchorId || undefined}
                        className={`align-top ${isDeepLinkedMovement ? "bg-sky-50" : ""}`}
                      >
                        <td className="px-3 py-2 text-slate-700">
                          <div className="font-medium text-slate-900">{row.movementDate || "-"}</div>
                          <div className="text-xs text-slate-500">#{row.id || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{row.warehouseCode || row.warehouseName || "-"}</div>
                          <div className="text-xs text-slate-500">{row.warehouseName || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{row.itemCardCode || row.itemCardName || "-"}</div>
                          <div className="text-xs text-slate-500">{row.itemCardName || "-"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                              row.movementType
                            )}`}
                          >
                            {row.movementType || "-"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{row.quantity ?? "-"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                              row.valuationStatus
                            )}`}
                          >
                            {row.valuationStatus || "-"}
                          </span>
                          {Array.isArray(row.layerConsumptions) && row.layerConsumptions.length > 0 ? (
                            <div className="mt-2 space-y-1 text-xs text-slate-500">
                              {row.layerConsumptions.map((consumption) => (
                                <div
                                  key={`movement-row-consumption-${row.id}-${consumption.consumptionNo}`}
                                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1"
                                >
                                  <div className="font-medium text-slate-700">
                                    {l("Layer", "Katman")} #{consumption.costLayerId || "-"} ·{" "}
                                    {l("Qty", "Miktar")} {formatQuantityValue(consumption.quantityConsumed)}
                                  </div>
                                  <div>
                                    {l("Source receipt", "Kaynak alim")} #
                                    {consumption.sourceMovementId || "-"}
                                    {consumption.sourceStockLinkId
                                      ? ` · ${l("Link", "Baglanti")} #${consumption.sourceStockLinkId}`
                                      : ""}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{row.sourceDocumentNo || row.sourceType || "-"}</div>
                          <div className="text-xs text-slate-500">
                            {row.sourceType || "-"} {row.sourceStockLinkId ? `#${row.sourceStockLinkId}` : ""}
                          </div>
                          {row.reversalOfMovementId ? (
                            <div className="mt-1 text-xs text-amber-700">
                              {l("Reversal of movement", "Ters kayit hareketi")} #
                              {row.reversalOfMovementId}
                            </div>
                          ) : null}
                          {row.reversalMovementId ? (
                            <div className="mt-1 text-xs text-sky-700">
                              {l("Reversed by movement", "Hareket ile geri alindi")} #
                              {row.reversalMovementId}
                            </div>
                          ) : null}
                          {row.postedJournalEntryId ? (
                            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                              <div className="font-medium">
                                {l("COGS Journal", "Satilan Malin Maliyeti Yevmiyesi")}
                              </div>
                              <div>
                                {row.postedJournalNo || `JRN #${row.postedJournalEntryId}`}
                                {row.postedJournalEntryId ? ` · #${row.postedJournalEntryId}` : ""}
                              </div>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.totalCostTxn === null || row.totalCostTxn === undefined ? (
                            "-"
                          ) : (
                            <div className="space-y-1">
                              <MoneyText amount={row.totalCostTxn} currencyCode={row.currencyCode} />
                              {row.unitCostTxn === null || row.unitCostTxn === undefined ? null : (
                                <div className="text-xs text-slate-500">
                                  {l("Unit", "Birim")}{" "}
                                  <MoneyText amount={row.unitCostTxn} currencyCode={row.currencyCode} />
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Issue Highlights", "Cikis Ozeti")}
              </h2>
              <span className="text-sm text-slate-500">
                {`${reversedIssueRows.length} / ${reversedReceiptRows.length} / ${mixedCurrencyIssueRows.length}`}
              </span>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Reversed Issues", "Terslenen Cikislar")}
                </div>
                {reversedIssueRows.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {l(
                      "No reversed valued issue movements yet.",
                      "Henuz terslenen degerlenmis cikis hareketi yok."
                    )}
                  </p>
                ) : (
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {reversedIssueRows.map((row) => (
                      (() => {
                        const reopenedPendingLink =
                          stockLinkRows.find(
                            (stockLinkRow) =>
                              toPositiveInt(stockLinkRow?.reopenedFromStockLinkId) ===
                              toPositiveInt(row?.sourceStockLinkId)
                          ) || null;
                        return (
                          <div
                            key={`reversed-issue-summary-${row.id}`}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2"
                          >
                            <div className="font-medium text-slate-900">
                              #{row.id || "-"} | {row.itemCardCode || row.itemCardName || "-"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {row.reversalJournalNo || `JRN #${row.reversalJournalEntryId || "-"}`}
                              {row.reversedAt ? ` | ${row.reversedAt}` : ""}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {l("Original stock link", "Orijinal stok baglantisi")} #
                              {row.sourceStockLinkId || "-"}
                            </div>
                            {reopenedPendingLink ? (
                              <div className="mt-1 text-xs text-sky-600">
                                {l("Reopened pending link", "Yeniden acilan bekleyen baglanti")} #
                                {reopenedPendingLink.id || "-"}
                              </div>
                            ) : null}
                          </div>
                        );
                      })()
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Undone Receipts", "Geri Alinan Alimlar")}
                </div>
                {reversedReceiptRows.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {l(
                      "No undone receipt materialization rows yet.",
                      "Henuz geri alinan alim yansitma satiri yok."
                    )}
                  </p>
                ) : (
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {reversedReceiptRows.map((row) => (
                      <div
                        key={`reversed-receipt-summary-${row.id}`}
                        className="rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="font-medium text-slate-900">
                          #{row.id || "-"} | {row.itemCardCode || row.itemCardName || "-"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.reversalMovementId
                            ? `${l("Undo movement", "Geri alma hareketi")} #${row.reversalMovementId}`
                            : l("Undo evidence recorded.", "Geri alma kaniti kaydedildi.")}
                          {row.reversedAt ? ` | ${row.reversedAt}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Mixed-Currency Valuation", "Coklu Para Birimi Degerleme")}
                </div>
                {mixedCurrencyIssueRows.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {l(
                      "No mixed-currency issue valuation rows yet.",
                      "Henuz karisik para birimli cikis degerleme satiri yok."
                    )}
                  </p>
                ) : (
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {mixedCurrencyIssueRows.map((row) => {
                      const currencyCodes = collectConsumptionCurrencyCodes(row);
                      return (
                        <div
                          key={`mixed-issue-summary-${row.id}`}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="font-medium text-slate-900">
                            #{row.id || "-"} | {row.itemCardCode || row.itemCardName || "-"}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {l(
                              "Posted in base currency",
                              "Baz para biriminde kaydedildi"
                            )}{" "}
                            {row.currencyCode || "-"} | {currencyCodes.join(", ")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Receipt Cost Layers", "Alim Maliyet Katmanlari")}
              </h2>
              <span className="text-sm text-slate-500">{costLayerRows.length}</span>
            </div>
            {costLayerRows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                {l(
                  "No receipt cost layers found for the selected filters.",
                  "Secili filtreler icin alim maliyet katmani bulunamadi."
                )}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">{l("Warehouse", "Depo")}</th>
                      <th className="px-3 py-2">{l("Item", "Kalem")}</th>
                      <th className="px-3 py-2">{l("Method", "Yontem")}</th>
                      <th className="px-3 py-2">{l("Qty In", "Giren Miktar")}</th>
                      <th className="px-3 py-2">{l("Qty Remaining", "Kalan Miktar")}</th>
                      <th className="px-3 py-2">{l("Unit Cost", "Birim Maliyet")}</th>
                      <th className="px-3 py-2">{l("Total Cost", "Toplam Maliyet")}</th>
                      <th className="px-3 py-2">{l("Status", "Durum")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {costLayerRows.map((row) => (
                      <tr key={`cost-layer-row-${row.id}`} className="align-top">
                        <td className="px-3 py-2 text-slate-700">
                          <div>{row.warehouseCode || row.warehouseName || "-"}</div>
                          <div className="text-xs text-slate-500">#{row.warehouseId || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{row.itemCardCode || row.itemCardName || "-"}</div>
                          <div className="text-xs text-slate-500">#{row.itemCardId || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{row.valuationMethod || "-"}</td>
                        <td className="px-3 py-2 text-slate-700">{row.quantityIn ?? "-"}</td>
                        <td className="px-3 py-2 text-slate-700">{row.quantityRemaining ?? "-"}</td>
                        <td className="px-3 py-2 text-slate-700">
                          <MoneyText amount={row.unitCostTxn} currencyCode={row.currencyCode} />
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <MoneyText amount={row.totalCostTxn} currencyCode={row.currencyCode} />
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                              row.layerStatus
                            )}`}
                          >
                            {row.layerStatus || "-"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
