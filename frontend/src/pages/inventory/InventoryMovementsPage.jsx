import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Combobox from "../../components/Combobox.jsx";
import MoneyText from "../../components/MoneyText.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { listOperatingUnits } from "../../api/orgAdmin.js";
import {
  createInventoryWarehouse,
  listInventoryCariStockLinks,
  listInventoryCostLayers,
  listInventoryMovements,
  listInventoryWarehouses,
  materializeInventoryCariStockLink,
  reverseInventoryMovement,
} from "../../api/inventory.js";

const STOCK_IMPACT_MODE_VALUES = new Set(["RECEIPT_PENDING", "ISSUE_PENDING"]);
const STOCK_LINK_QUEUE_SCOPE_VALUES = new Set(["ACTIONABLE", "COMPLETED", "VOID", "ALL"]);
const INVENTORY_TRANSFERS_ROUTE = "/app/stok-transferleri";

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
    inventoryReceiptPolicy: "ALLOW_INVOICE_BEFORE_RECEIPT",
    notes: "",
  };
}

function createMovementForm(legalEntityId = "") {
  return {
    legalEntityId: legalEntityId || "",
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

function getQueueStateBadgeClass(value) {
  switch (String(value || "").trim().toUpperCase()) {
    case "READY":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    case "BLOCKED":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    case "TRANSFER_REQUIRED":
      return "border border-sky-200 bg-sky-50 text-sky-800";
    case "REPAIR_REQUIRED":
      return "border border-rose-200 bg-rose-50 text-rose-800";
    case "COMPLETED":
    case "VOID":
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

function describeReceiptPolicy(value, translate = (en) => en) {
  switch (String(value || "").trim().toUpperCase()) {
    case "REQUIRE_RECEIPT_BEFORE_INVOICE":
      return translate(
        "Require receipt before invoice posting",
        "Faturadan once mal kabul zorunlu"
      );
    case "ALLOW_INVOICE_BEFORE_RECEIPT":
    default:
      return translate(
        "Allow invoice before receipt",
        "Mal kabul olmadan fatura post edilebilir"
      );
  }
}

function normalizeQueueScope(value, fallback = "ACTIONABLE") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return STOCK_LINK_QUEUE_SCOPE_VALUES.has(normalized) ? normalized : fallback;
}

function describeStockLinkOwnershipContext(row, translate = (en) => en) {
  const operatingUnitId = toPositiveInt(row?.documentOperatingUnitId);
  if (!operatingUnitId) {
    return translate("Central", "Merkez");
  }
  const code = normalizeText(row?.documentOperatingUnitCode);
  const name = normalizeText(row?.documentOperatingUnitName);
  return code && name
    ? `${translate("Branch", "Sube")} ${code} - ${name}`
    : code || name || `${translate("Branch", "Sube")} #${operatingUnitId}`;
}

function describeBoundWarehouse(row, translate = (en) => en) {
  const warehouseId = toPositiveInt(row?.boundWarehouseId);
  const code = normalizeText(row?.boundWarehouseCode);
  const name = normalizeText(row?.boundWarehouseName);
  if (!warehouseId) {
    return translate("Cleanup required", "Temizlik gerekli");
  }
  return code && name
    ? `${code} - ${name}`
    : code || name || `${translate("Warehouse", "Depo")} #${warehouseId}`;
}

function describeRepairReason(row, translate = (en) => en) {
  switch (String(row?.repairReasonCode || "").trim().toUpperCase()) {
    case "LEGACY_UNBOUND_STOCK_LINK":
      return translate(
        "This legacy stock link has no bound warehouse. In this rollout it is cleanup/reset-only and not actionable from the normal queue.",
        "Bu eski stok baglantisinin bagli deposu yoktur. Bu rolloutta yalnizca temizlik/reset kapsamindadir ve normal kuyruktan isleme alinmaz."
      );
    case "SUCCESSOR_WAREHOUSE_INHERITANCE_INVALID":
      return translate(
        "The reopened successor could not keep its original warehouse binding. In this rollout it must be cleaned up/reset, not handled as normal queue work.",
        "Yeniden acilan ardil satir ilk depo bagini koruyamadi. Bu rolloutta normal kuyruk isi gibi ele alinmaz; temizlenmeli/resetlenmelidir."
      );
    default:
      return "";
  }
}

function describeBlockedReason(row, translate = (en) => en) {
  switch (String(row?.blockedReasonCode || "").trim().toUpperCase()) {
    case "BOUND_WAREHOUSE_MISSING":
      return translate(
        "The bound warehouse record is missing. This row is invalid for strict execution until the underlying data is cleaned up or reset.",
        "Bagli depo kaydi bulunamadi. Alttaki veri temizlenene veya resetlenene kadar bu satir strict yurutme icin gecersizdir."
      );
    case "BOUND_WAREHOUSE_INACTIVE":
      return translate(
        "The bound warehouse is inactive. Reactivate the warehouse if valid, otherwise clean up/reset the invalid row before materializing.",
        "Bagli depo pasiftir. Gecerliyse depoyu yeniden etkinlestirin; degilse gerceklestirmeden once gecersiz satiri temizleyin/resetleyin."
      );
    case "BOUND_WAREHOUSE_CONTEXT_MISMATCH":
      return translate(
        "The bound warehouse no longer belongs to the same ownership context as the document.",
        "Bagli depo artik belge ile ayni sahiplik baglamina ait degildir."
      );
    case "INSUFFICIENT_BOUND_WAREHOUSE_STOCK":
      return translate(
        "The bound warehouse does not have enough available stock for this issue row.",
        "Bagli depoda bu cikis satiri icin yeterli kullanilabilir stok yok."
      );
    default:
      return "";
  }
}

function describeTransferSourceOwnershipContext(row, translate = (en) => en) {
  const scope = String(row?.transferSourceOwnershipScope || "").trim().toUpperCase();
  if (scope === "OPERATING_UNIT") {
    const code = normalizeText(row?.transferSourceOperatingUnitCode);
    const name = normalizeText(row?.transferSourceOperatingUnitName);
    return code && name
      ? `${translate("Branch", "Sube")} ${code} - ${name}`
      : code || name || translate("Operating unit", "Isletme birimi");
  }
  return translate("Central", "Merkez");
}

function describeTransferRequiredReason(row, translate = (en) => en) {
  if (String(row?.queueState || "").trim().toUpperCase() !== "TRANSFER_REQUIRED") {
    return "";
  }
  const sourceWarehouse =
    normalizeText(row?.transferSourceWarehouseCode) ||
    normalizeText(row?.transferSourceWarehouseName) ||
    (toPositiveInt(row?.transferSourceWarehouseId)
      ? `${translate("Warehouse", "Depo")} #${row.transferSourceWarehouseId}`
      : translate("another warehouse", "baska bir depo"));
  const sourceContext = describeTransferSourceOwnershipContext(row, translate);
  const requestedQuantity = formatQuantityValue(row?.remainingQuantity ?? row?.requestedQuantity);
  const boundAvailableQuantity = formatQuantityValue(row?.boundAvailableQuantity);
  const transferSourceAvailableQuantity = formatQuantityValue(row?.transferSourceAvailableQuantity);
  return translate(
    `Bound warehouse stock is short. Move stock from ${sourceWarehouse} in ${sourceContext}. Requested ${requestedQuantity}, bound available ${boundAvailableQuantity}, suggested source available ${transferSourceAvailableQuantity}.`,
    `Bagli depodaki stok yetersiz. ${sourceContext} baglamindaki ${sourceWarehouse} deposundan transfer yapin. Talep ${requestedQuantity}, bagli depoda mevcut ${boundAvailableQuantity}, onerilen kaynakta mevcut ${transferSourceAvailableQuantity}.`
  );
}

function buildInventoryTransferLink(row) {
  const params = new URLSearchParams();
  const legalEntityId = toPositiveInt(row?.legalEntityId);
  const operatingUnitId = toPositiveInt(row?.documentOperatingUnitId);
  const sourceWarehouseId = toPositiveInt(row?.transferSourceWarehouseId);
  const targetWarehouseId = toPositiveInt(row?.boundWarehouseId);
  const itemCardId = toPositiveInt(row?.itemCardId);
  const sourceEntityId = toPositiveInt(row?.id);
  const quantityRequested =
    normalizeText(row?.remainingQuantity ?? row?.requestedQuantity) ||
    normalizeText(row?.requestedQuantity);

  if (legalEntityId) {
    params.set("legalEntityId", String(legalEntityId));
  }
  if (operatingUnitId) {
    params.set("operatingUnitId", String(operatingUnitId));
  }
  if (sourceWarehouseId) {
    params.set("sourceWarehouseId", String(sourceWarehouseId));
  }
  if (targetWarehouseId) {
    params.set("targetWarehouseId", String(targetWarehouseId));
  }
  if (itemCardId) {
    params.set("itemCardId", String(itemCardId));
  }
  if (quantityRequested) {
    params.set("quantityRequested", quantityRequested);
  }
  if (sourceEntityId) {
    params.set("sourceModule", "CARI");
    params.set("sourceEntityType", "CARI_STOCK_LINK");
    params.set("sourceEntityId", String(sourceEntityId));
  }
  params.set("prefillReason", "TRANSFER_REQUIRED");
  const query = params.toString();
  return query ? `${INVENTORY_TRANSFERS_ROUTE}?${query}` : INVENTORY_TRANSFERS_ROUTE;
}

function describeSuccessorState(row, translate = (en) => en) {
  switch (String(row?.successorInheritanceStatus || "").trim().toUpperCase()) {
    case "INHERITED":
      return translate("Inherited warehouse", "Depo mirasi alindi");
    case "REPAIR_ONLY":
      return translate("Cleanup-required successor", "Temizlik gerektiren ardil");
    default:
      return "";
  }
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

function describeMovementSource(row, translate = (en) => en) {
  const sourceType = normalizeText(row?.sourceType).toUpperCase();
  const sourceDocumentNo = normalizeText(row?.sourceDocumentNo);
  const sourceTransferNo = normalizeText(row?.sourceTransferNo);

  if (sourceType === "INVENTORY_TRANSFER") {
    return {
      badgeLabel: translate("Inventory transfer", "Stok transferi"),
      badgeClass: "border border-sky-200 bg-sky-50 text-sky-800",
      primary:
        sourceTransferNo ||
        sourceDocumentNo ||
        `Transfer #${row?.sourceDocumentId || row?.sourceStockLinkId || "-"}`,
      secondary: [
        row?.sourceTransferStatus ? `${translate("Status", "Durum")}: ${row.sourceTransferStatus}` : "",
        row?.sourceDocumentLineId ? `${translate("Line", "Satir")} #${row.sourceDocumentLineId}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    };
  }

  if (row?.sourceStockLinkId) {
    return {
      badgeLabel: translate("Stock link", "Stok baglantisi"),
      badgeClass: "border border-emerald-200 bg-emerald-50 text-emerald-800",
      primary: sourceDocumentNo || `${translate("Stock link", "Stok baglantisi")} #${row.sourceStockLinkId}`,
      secondary: [
        sourceType || translate("Linked source", "Bagli kaynak"),
        `${translate("Link", "Baglanti")} #${row.sourceStockLinkId}`,
      ].join(" | "),
    };
  }

  if (sourceDocumentNo) {
    return {
      badgeLabel: translate("Document", "Belge"),
      badgeClass: "border border-slate-200 bg-slate-100 text-slate-700",
      primary: sourceDocumentNo,
      secondary: sourceType || translate("Document sourced", "Belge kaynakli"),
    };
  }

  return {
    badgeLabel: translate("Manual entry", "Manuel giris"),
    badgeClass: "border border-amber-200 bg-amber-50 text-amber-800",
    primary: sourceType || translate("Manual inventory movement", "Manuel stok hareketi"),
    secondary: translate(
      "No stock-link or transfer reference on this movement.",
      "Bu harekette stok baglantisi veya transfer referansi yok."
    ),
  };
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

/**
 * Render stock reflection operations with ownership-aware defaults so branch
 * users can open the page directly without losing OU-scoped read access.
 */
export default function InventoryMovementsPage() {
  const { entitlements, hasPermission } = useAuth();
  const { l } = useI18n();
  const { legalEntities: workingContextLegalEntities, workingContext } = useWorkingContext();
  const [searchParams] = useSearchParams();

  const canRead = hasPermission("inventory.read");
  const canUpsert = hasPermission("inventory.upsert");
  const canReadOrgTree = hasPermission("org.tree.read");
  const workingContextLegalEntityId = useMemo(
    () => String(toPositiveInt(workingContext?.legalEntityId) || ""),
    [workingContext?.legalEntityId]
  );
  const workingContextOperatingUnitId = useMemo(
    () => String(toPositiveInt(workingContext?.operatingUnitId) || ""),
    [workingContext?.operatingUnitId]
  );
  const deepLinkedLegalEntityId = useMemo(
    () => String(toPositiveInt(searchParams.get("legalEntityId")) || ""),
    [searchParams]
  );
  const deepLinkedOperatingUnitId = useMemo(
    () => String(toPositiveInt(searchParams.get("operatingUnitId")) || ""),
    [searchParams]
  );
  const deepLinkedMovementId = useMemo(
    () => String(toPositiveInt(searchParams.get("movementId")) || ""),
    [searchParams]
  );
  const deepLinkedStockImpactMode = useMemo(() => {
    const value = normalizeText(searchParams.get("stockImpactMode")).toUpperCase();
    return STOCK_IMPACT_MODE_VALUES.has(value) ? value : "";
  }, [searchParams]);
  const deepLinkedQueueScope = useMemo(
    () => normalizeQueueScope(searchParams.get("queueScope"), "ACTIONABLE"),
    [searchParams]
  );

  const legalEntityOptions = useMemo(
    () =>
      (Array.isArray(workingContextLegalEntities) ? workingContextLegalEntities : [])
        .map(mapLegalEntityLookupOption)
        .filter(Boolean),
    [workingContextLegalEntities]
  );
  const inventoryEntitlementOperatingUnitIds = useMemo(() => {
    const rows = Array.isArray(entitlements?.permissions) ? entitlements.permissions : [];
    return Array.from(
      new Set(
        rows
          .filter((row) => normalizeText(row?.code) === "inventory.read")
          .filter((row) => normalizeText(row?.scopeType).toUpperCase() === "OPERATING_UNIT")
          .flatMap((row) =>
            Array.isArray(row?.scopeIds)
              ? row.scopeIds.map((scopeId) => String(toPositiveInt(scopeId) || "")).filter(Boolean)
              : []
          )
      )
    );
  }, [entitlements?.permissions]);
  const singleInventoryEntitlementOperatingUnitId =
    inventoryEntitlementOperatingUnitIds.length === 1 ? inventoryEntitlementOperatingUnitIds[0] : "";

  const [filters, setFilters] = useState({
    legalEntityId: "",
    operatingUnitId: deepLinkedOperatingUnitId,
    warehouseId: "",
    queueScope: deepLinkedQueueScope,
    stockImpactMode: deepLinkedStockImpactMode || "",
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
  const [selectedStockLinkId, setSelectedStockLinkId] = useState("");
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
  const resolvedInventoryOperatingUnitId = useMemo(() => {
    if (deepLinkedOperatingUnitId) {
      return deepLinkedOperatingUnitId;
    }
    // This page does not expose an OU picker. Use the current context, or the
    // user's only inventory-read OU, so direct opens do not fall back to LE scope.
    if (
      workingContextOperatingUnitId &&
      (!filters.legalEntityId ||
        (workingContextLegalEntityId && filters.legalEntityId === workingContextLegalEntityId))
    ) {
      return workingContextOperatingUnitId;
    }
    if (singleInventoryEntitlementOperatingUnitId && (!filters.legalEntityId || legalEntityOptions.length === 1)) {
      return singleInventoryEntitlementOperatingUnitId;
    }
    return "";
  }, [
    deepLinkedOperatingUnitId,
    filters.legalEntityId,
    legalEntityOptions.length,
    singleInventoryEntitlementOperatingUnitId,
    workingContextLegalEntityId,
    workingContextOperatingUnitId,
  ]);

  useEffect(() => {
    if (deepLinkedLegalEntityId || filters.legalEntityId) {
      return;
    }
    const defaultLegalEntityId =
      workingContextLegalEntityId ||
      (legalEntityOptions.length === 1 ? legalEntityOptions[0]?.value || "" : "");
    if (defaultLegalEntityId) {
      setFilters((previous) => ({
        ...previous,
        legalEntityId: defaultLegalEntityId,
      }));
      setWarehouseForm((previous) => ({
        ...previous,
        legalEntityId: defaultLegalEntityId,
      }));
      setMovementForm((previous) => ({
        ...previous,
        legalEntityId: defaultLegalEntityId,
      }));
    }
  }, [deepLinkedLegalEntityId, filters.legalEntityId, legalEntityOptions, workingContextLegalEntityId]);

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
          }
    );
  }, [deepLinkedLegalEntityId]);

  useEffect(() => {
    setFilters((previous) =>
      previous.operatingUnitId === deepLinkedOperatingUnitId
        ? previous
        : {
            ...previous,
            operatingUnitId: deepLinkedOperatingUnitId,
            warehouseId: "",
          }
    );
  }, [deepLinkedOperatingUnitId]);

  useEffect(() => {
    setFilters((previous) =>
      previous.queueScope === deepLinkedQueueScope &&
      previous.stockImpactMode === (deepLinkedStockImpactMode || "")
        ? previous
        : {
            ...previous,
            queueScope: deepLinkedQueueScope,
            stockImpactMode: deepLinkedStockImpactMode || "",
          }
    );
  }, [deepLinkedQueueScope, deepLinkedStockImpactMode]);

  useEffect(() => {
    setWarehouseForm((previous) => ({
      ...previous,
      legalEntityId: filters.legalEntityId || previous.legalEntityId || "",
    }));
    setMovementForm((previous) => ({
      ...previous,
      legalEntityId: filters.legalEntityId || previous.legalEntityId || "",
    }));
  }, [filters.legalEntityId]);

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
    const operatingUnitId = toPositiveInt(filters.operatingUnitId || resolvedInventoryOperatingUnitId);
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
            operatingUnitId: operatingUnitId || undefined,
            limit: 200,
            offset: 0,
          }),
          listInventoryCariStockLinks({
            legalEntityId,
            operatingUnitId: operatingUnitId || undefined,
            queueScope: filters.queueScope || "ACTIONABLE",
            stockImpactMode: filters.stockImpactMode || undefined,
            warehouseId: filters.warehouseId || undefined,
            limit: 200,
            offset: 0,
          }),
          listInventoryMovements({
            legalEntityId,
            operatingUnitId: operatingUnitId || undefined,
            warehouseId: filters.warehouseId || undefined,
            limit: 200,
            offset: 0,
          }),
          listInventoryCostLayers({
            legalEntityId,
            operatingUnitId: operatingUnitId || undefined,
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
  }, [
    canRead,
    filters.legalEntityId,
    filters.operatingUnitId,
    filters.queueScope,
    filters.stockImpactMode,
    filters.warehouseId,
    l,
    resolvedInventoryOperatingUnitId,
  ]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  useEffect(() => {
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
  }, [warehouseRows]);

  useEffect(() => {
    const validStockLinkIds = new Set(
      stockLinkRows
        .map((row) => String(toPositiveInt(row?.id) || ""))
        .filter(Boolean)
    );
    setSelectedStockLinkId((previous) =>
      previous && !validStockLinkIds.has(previous) ? "" : previous
    );
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
        (row) => toPositiveInt(row?.id) === toPositiveInt(selectedStockLinkId)
      ) || null,
    [selectedStockLinkId, stockLinkRows]
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
        inventoryReceiptPolicy:
          normalizeText(warehouseForm.inventoryReceiptPolicy) || undefined,
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
    if (!selectedPendingLink) {
      setMovementError(
        l(
          "Select one queue row to materialize.",
          "Gerceklestirmek icin bir kuyruk satiri secin."
        )
      );
      return;
    }
    if (String(selectedPendingLink.queueState || "").toUpperCase() === "REPAIR_REQUIRED") {
      setMovementError(
        describeRepairReason(selectedPendingLink, l) ||
          l(
            "This row is cleanup/reset-only in the current rollout and cannot be materialized from the normal queue.",
            "Bu satir mevcut rolloutta yalnizca temizlik/reset kapsamindadir ve normal kuyruktan gerceklestirilemez."
          )
      );
      return;
    }
    if (String(selectedPendingLink.queueState || "").toUpperCase() === "TRANSFER_REQUIRED") {
      setMovementError(
        describeTransferRequiredReason(selectedPendingLink, l) ||
          l(
            "This issue row requires an explicit cross-context transfer before materialization.",
            "Bu cikis satiri gerceklestirmeden once acik bir contextler arasi transfer gerektirir."
          )
      );
      return;
    }
    if (!selectedPendingLink.canMaterialize) {
      setMovementError(
        describeTransferRequiredReason(selectedPendingLink, l) ||
        describeBlockedReason(selectedPendingLink, l) ||
          l(
            "This queue row is not currently materializable from the normal queue.",
            "Bu kuyruk satiri su anda normal kuyruktan gerceklestirilemez."
          )
      );
      return;
    }
    setMovementSaving(true);
    setMovementError("");
    setMovementMessage("");
    try {
      const stockLinkId = toPositiveInt(selectedPendingLink.id);
      const response = await materializeInventoryCariStockLink(stockLinkId, {
        legalEntityId: toPositiveInt(movementForm.legalEntityId),
        movementDate: movementForm.movementDate,
        note: normalizeText(movementForm.note) || undefined,
      });
      setMovementMessage(
        l("Stock link materialized.", "Stok baglantisi gerceklestirildi.") +
          (response?.row?.id ? ` #${response.row.id}` : "")
      );
      setMovementForm((previous) => ({
        ...createMovementForm(previous.legalEntityId),
      }));
      setSelectedStockLinkId("");
      await loadPageData();
    } catch (error) {
      setMovementError(
        normalizeApiError(
          error,
          l("Stock-link materialization failed.", "Stok baglantisi gerceklestirme basarisiz.")
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
                "Execute strict stock-link queue work, review warehouse context, and inspect movements plus receipt cost layers.",
                "Strict stok baglantisi kuyruk islerini yurutun, depo baglamini inceleyin ve hareketler ile alim maliyet katmanlarini gozetin."
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

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
            {l("Queue Scope", "Kuyruk Kapsami")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.queueScope}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  queueScope: normalizeQueueScope(event.target.value, "ACTIONABLE"),
                }))
              }
              disabled={!filters.legalEntityId}
            >
              <option value="ACTIONABLE">{l("Actionable", "Aksiyonluk")}</option>
              <option value="COMPLETED">{l("Completed", "Tamamlanan")}</option>
              <option value="VOID">{l("Void", "Hukumden Dusen")}</option>
              <option value="ALL">{l("All Rows", "Tum Satirlar")}</option>
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Impact Filter", "Etki Filtresi")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.stockImpactMode}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  stockImpactMode: event.target.value,
                }))
              }
              disabled={!filters.legalEntityId}
            >
              <option value="">{l("All impacts", "Tum etkiler")}</option>
              <option value="RECEIPT_PENDING">{l("Receipt Pending", "Alim Bekliyor")}</option>
              <option value="ISSUE_PENDING">{l("Issue Pending", "Cikis Bekliyor")}</option>
            </select>
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
                {l("Queue Rows", "Kuyruk Satirlari")}
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
                {l("Receipt Policy", "Mal Kabul Politikasi")}
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                  value={warehouseForm.inventoryReceiptPolicy}
                  onChange={(event) =>
                    setWarehouseForm((previous) => ({
                      ...previous,
                      inventoryReceiptPolicy: event.target.value,
                    }))
                  }
                  disabled={warehouseSaving || !canUpsert}
                >
                  <option value="ALLOW_INVOICE_BEFORE_RECEIPT">
                    {l("Allow invoice before receipt", "Mal kabul olmadan fatura post edilebilir")}
                  </option>
                  <option value="REQUIRE_RECEIPT_BEFORE_INVOICE">
                    {l("Require receipt before invoice", "Faturadan once mal kabul zorunlu")}
                  </option>
                </select>
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
                            {l("Legal entity", "Tuzel kisilik")} |{" "}
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
                      <div className="mt-1 text-sm text-slate-700">
                        {l("Receipt Policy", "Mal Kabul Politikasi")}:{" "}
                        {describeReceiptPolicy(row.inventoryReceiptPolicy, l)}
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
                    "Review one explicit queue row, confirm its bound warehouse, then materialize it without choosing a warehouse here.",
                    "Bir kuyruk satirini acikca inceleyin, bagli deposunu dogrulayin ve burada depo secmeden gerceklestirin."
                  )}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getQueueStateBadgeClass(
                  selectedPendingLink?.queueState || "READY"
                )}`}
              >
                {selectedPendingLink?.queueState || l("No selection", "Secim yok")}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {l("Selected Queue Row", "Secilen Kuyruk Satiri")}
                </div>
                {selectedPendingLink ? (
                  <div className="mt-2 text-sm text-slate-800">
                    <div className="font-semibold text-slate-900">
                      {selectedPendingLink.documentNo ||
                        `Doc #${selectedPendingLink.documentId || "-"}`}
                    </div>
                    <div className="mt-1">
                      {selectedPendingLink.itemCardCode ||
                        selectedPendingLink.itemCardName ||
                        "-"}{" "}
                      | {selectedPendingLink.direction || "-"} | {selectedPendingLink.stockImpactMode || "-"} |{" "}
                      {l("Requested", "Talep")}{" "}
                      {formatQuantityValue(selectedPendingLink.requestedQuantity)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {l("Lifecycle", "Yasam Dongusu")}: {selectedPendingLink.linkStatus || "-"} |{" "}
                      #{selectedPendingLink.id || "-"}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-600">
                    {l(
                      "Select one row from the queue table below. The queue no longer auto-selects the first pending link.",
                      "Asagidaki kuyruk tablosundan bir satir secin. Kuyruk artik ilk bekleyen baglantiyi otomatik secmez."
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {l("Ownership Context", "Sahiplik Baglami")}
                  </div>
                  <div className="mt-1 text-sm text-slate-800">
                    {selectedPendingLink
                      ? describeStockLinkOwnershipContext(selectedPendingLink, l)
                      : l("Select a queue row first.", "Once bir kuyruk satiri secin.")}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {l("Bound Warehouse", "Bagli Depo")}
                  </div>
                  <div className="mt-1 text-sm text-slate-800">
                    {selectedPendingLink
                      ? describeBoundWarehouse(selectedPendingLink, l)
                      : l("Select a queue row first.", "Once bir kuyruk satiri secin.")}
                  </div>
                </div>
              </div>
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
                  {selectedPendingLink.itemCardCode || selectedPendingLink.itemCardName || "-"} |{" "}
                  {selectedPendingLink.direction || "-"} |{" "}
                  {selectedPendingLink.stockImpactMode || "NONE"} |{" "}
                  {l("Requested", "Talep")} {formatQuantityValue(selectedPendingLink.requestedQuantity)} |{" "}
                  {l("Materialized", "Gerceklesti")} {formatQuantityValue(selectedPendingLink.materializedQuantity)} |{" "}
                  {l("Remaining", "Kalan")} {formatQuantityValue(selectedPendingLink.remainingQuantity)}
                </div>
                <div className="mt-1">
                  {l("Ownership Context", "Sahiplik Baglami")}:{" "}
                  {describeStockLinkOwnershipContext(selectedPendingLink, l)} |{" "}
                  {l("Bound Warehouse", "Bagli Depo")}: {describeBoundWarehouse(selectedPendingLink, l)}
                </div>
                <div className="mt-1">
                  {l("Queue State", "Kuyruk Durumu")}: {selectedPendingLink.queueState || "-"}
                  {selectedPendingLink.blockedReasonCode
                    ? ` | ${l("Blocked Reason", "Bloke Nedeni")}: ${selectedPendingLink.blockedReasonCode}`
                    : ""}
                  {selectedPendingLink.repairReasonCode
                    ? ` | ${l("Cleanup Reason", "Temizlik Nedeni")}: ${selectedPendingLink.repairReasonCode}`
                    : ""}
                  {describeSuccessorState(selectedPendingLink, l)
                    ? ` | ${describeSuccessorState(selectedPendingLink, l)}`
                    : ""}
                </div>
                <div className="mt-1">
                  {selectedPendingLink.lineDescription || l("No line description.", "Satir aciklamasi yok.")}
                </div>
                {describeRepairReason(selectedPendingLink, l) ? (
                  <div className="mt-1 text-xs text-rose-700">
                    {describeRepairReason(selectedPendingLink, l)}
                  </div>
                ) : null}
                {describeBlockedReason(selectedPendingLink, l) ? (
                  <div className="mt-1 text-xs text-amber-700">
                    {describeBlockedReason(selectedPendingLink, l)}
                  </div>
                ) : null}
                {describeTransferRequiredReason(selectedPendingLink, l) ? (
                  <div className="mt-1 text-xs text-sky-700">
                    {describeTransferRequiredReason(selectedPendingLink, l)}
                  </div>
                ) : null}
                {String(selectedPendingLink.queueState || "").trim().toUpperCase() ===
                "TRANSFER_REQUIRED" ? (
                  <div className="mt-2 text-xs text-sky-900">
                    <Link
                      to={buildInventoryTransferLink(selectedPendingLink)}
                      className="font-semibold underline underline-offset-2"
                    >
                      {l("Create transfer", "Transfer olustur")}
                    </Link>{" "}
                    {l(
                      "opens the existing inventory transfer workflow with suggested source and target warehouses.",
                      "onerilen kaynak ve hedef depolarla mevcut stok transferi akisina gider."
                    )}
                  </div>
                ) : null}
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
                !toPositiveInt(selectedPendingLink?.id) ||
                !selectedPendingLink?.canMaterialize
              }
            >
              {movementSaving
                ? l("Materializing stock link...", "Stok baglantisi gerceklestiriliyor...")
                : l("Materialize Selected Row", "Secilen Satiri Gerceklestir")}
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
                      } | ${row.quantity | "-"} | ${row.sourceDocumentNo || "-"}`}
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
                    "-"} |{" "}
                  | {l("Qty", "Miktar")} {selectedReversibleIssue.quantity | "-"}
                </div>
                <div className="mt-1">
                  {describeMovementSource(selectedReversibleIssue, l).badgeLabel}:{" "}
                  {describeMovementSource(selectedReversibleIssue, l).primary}
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
                      } | ${row.quantity | "-"} | ${row.sourceDocumentNo || "-"}`}
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
                    "-"} |{" "}
                  | {l("Qty", "Miktar")} {selectedReversibleReceipt.quantity | "-"}
                </div>
                <div className="mt-1">
                  {describeMovementSource(selectedReversibleReceipt, l).badgeLabel}:{" "}
                  {describeMovementSource(selectedReversibleReceipt, l).primary}
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
                {l("CARI Stock Link Queue", "CARI Stok Baglantisi Kuyrugu")}
              </h2>
              <span className="text-sm text-slate-500">{stockLinkRows.length}</span>
            </div>
            {stockLinkRows.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                {l(
                  "No stock-link rows match the selected queue scope and filters.",
                  "Secilen kuyruk kapsami ve filtrelere uyan stok baglantisi satiri yok."
                )}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">{l("Document", "Belge")}</th>
                      <th className="px-3 py-2">{l("Ownership Context", "Sahiplik Baglami")}</th>
                      <th className="px-3 py-2">{l("Bound Warehouse", "Bagli Depo")}</th>
                      <th className="px-3 py-2">{l("Item", "Kalem")}</th>
                      <th className="px-3 py-2">{l("Direction", "Yon")}</th>
                      <th className="px-3 py-2">{l("Qty State", "Miktar Durumu")}</th>
                      <th className="px-3 py-2">{l("Impact", "Etki")}</th>
                      <th className="px-3 py-2">{l("Status", "Durum")}</th>
                      <th className="px-3 py-2 text-right">{l("Action", "Islem")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockLinkRows.map((row) => (
                      <tr
                        key={`stock-link-row-${row.id}`}
                        className={`align-top ${
                          toPositiveInt(selectedStockLinkId) === toPositiveInt(row?.id)
                            ? "bg-sky-50"
                            : ""
                        }`}
                      >
                        <td className="px-3 py-2 text-slate-700">
                          <div className="font-medium text-slate-900">{row.documentNo || "-"}</div>
                          <div className="text-xs text-slate-500">{row.documentDate || "-"}</div>
                          <div className="text-xs text-slate-500">#{row.documentLineId || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{describeStockLinkOwnershipContext(row, l)}</div>
                          <div className="text-xs text-slate-500">{row.legalEntityCode || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{describeBoundWarehouse(row, l)}</div>
                          <div className="text-xs text-slate-500">#{row.boundWarehouseId || "-"}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{row.itemCardCode || row.itemCardName || "-"}</div>
                          <div className="text-xs text-slate-500">{row.lineDescription || "-"}</div>
                          {row.reopenedFromStockLinkId ? (
                            <div className="text-xs text-sky-600">
                              {l("Reopened from", "Yeniden acildigi link")} #{row.reopenedFromStockLinkId}
                            </div>
                          ) : null}
                          {describeSuccessorState(row, l) ? (
                            <div className="text-xs text-slate-500">{describeSuccessorState(row, l)}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClass(
                              row.direction
                            )}`}
                          >
                            {row.direction || "-"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>
                            {l("Requested", "Talep")}: {formatQuantityValue(row.requestedQuantity)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {l("Materialized", "Gerceklesti")}: {formatQuantityValue(row.materializedQuantity)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {l("Remaining", "Kalan")}: {formatQuantityValue(row.remainingQuantity)}
                          </div>
                        </td>
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
                          <div>
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${getQueueStateBadgeClass(
                                row.queueState
                              )}`}
                            >
                              {row.queueState || row.linkStatus || "-"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {l("Lifecycle", "Yasam Dongusu")}: {row.linkStatus || "-"}
                          </div>
                          {describeRepairReason(row, l) ? (
                            <div className="mt-1 text-xs text-rose-700">
                              {describeRepairReason(row, l)}
                            </div>
                          ) : null}
                          {describeBlockedReason(row, l) ? (
                            <div className="mt-1 text-xs text-amber-700">
                              {describeBlockedReason(row, l)}
                            </div>
                          ) : null}
                          {describeTransferRequiredReason(row, l) ? (
                            <div className="mt-1 text-xs text-sky-700">
                              {describeTransferRequiredReason(row, l)}
                            </div>
                          ) : null}
                          {String(row.queueState || "").trim().toUpperCase() ===
                          "TRANSFER_REQUIRED" ? (
                            <div className="mt-1 text-xs text-sky-900">
                              <Link
                                to={buildInventoryTransferLink(row)}
                                className="font-semibold underline underline-offset-2"
                              >
                                {l("Create transfer", "Transfer olustur")}
                              </Link>
                            </div>
                          ) : null}
                          <div className="mt-1 text-xs text-slate-500">
                            {row.postedNetAmountTxn === null || row.postedNetAmountTxn === undefined ? (
                              "-"
                            ) : (
                              <MoneyText amount={row.postedNetAmountTxn} currencyCode={row.currencyCode} />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            onClick={() => setSelectedStockLinkId(String(row.id || ""))}
                          >
                            {toPositiveInt(selectedStockLinkId) === toPositiveInt(row?.id)
                              ? l("Selected", "Secildi")
                              : l("Review", "Incele")}
                          </button>
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
                {l("Focused from CARI reverse blocker:", "CARI ters kayit engelinden odaklandi:")} |{" "}
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
                      const sourceSummary = describeMovementSource(row, l);
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
                        <td className="px-3 py-2 text-slate-700">{row.quantity | "-"}</td>
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
                                    {l("Layer", "Katman")} #{consumption.costLayerId || "-"} |{" "}{l("Qty", "Miktar")} {formatQuantityValue(consumption.quantityConsumed)}
                                  </div>
                                  <div>
                                    {l("Source receipt", "Kaynak alim")} #
                                    {consumption.sourceMovementId || "-"}
                                    {consumption.sourceStockLinkId ? ` | ${l("Link", "Baglanti")} #${consumption.sourceStockLinkId}` : ""}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${sourceSummary.badgeClass}`}
                            >
                              {sourceSummary.badgeLabel}
                            </span>
                            <span className="font-medium text-slate-900">{sourceSummary.primary}</span>
                          </div>
                          <div className="text-xs text-slate-500">{sourceSummary.secondary || "-"}</div>
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
                                {row.postedJournalEntryId ? ` | #${row.postedJournalEntryId}` : ""}
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
                                  {l("Unit", "Birim")} |{" "}
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
                            )} |{" "}
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
                        <td className="px-3 py-2 text-slate-700">{row.quantityIn | "-"}</td>
                        <td className="px-3 py-2 text-slate-700">{row.quantityRemaining | "-"}</td>
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
