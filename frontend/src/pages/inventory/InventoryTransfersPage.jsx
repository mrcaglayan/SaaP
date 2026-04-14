
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  approveInventoryTransfer,
  cancelInventoryTransfer,
  createInventoryTransfer,
  createInventoryTransferEvidence,
  deleteInventoryTransferEvidence,
  downloadInventoryTransferEvidence,
  getInventoryTransfer,
  listInventoryTransferEvidence,
  listInventoryTransfers,
  listInventoryWarehouses,
  receiveInventoryTransfer,
  reverseInventoryTransfer,
  shipInventoryTransfer,
  uploadInventoryTransferEvidenceContent,
} from "../../api/inventory.js";
import { listItemCards } from "../../api/itemCards.js";

const TRANSFER_STATUS_VALUES = [
  "INITIATED",
  "APPROVED",
  "IN_TRANSIT",
  "RECEIVED",
  "CANCELLED",
  "REVERSED",
];

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

function triggerBrowserDownload(blob, fileName) {
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

function normalizeApiError(error, fallback) {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function mapLegalEntityLookupOption(row) {
  const value = String(toPositiveInt(row?.id) || "");
  if (!value) {
    return null;
  }
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value,
    label: code && name ? `${code} - ${name}` : code || name || `Legal entity #${value}`,
  };
}

function createTransferLine() {
  return {
    itemCardId: "",
    quantityRequested: "1",
    note: "",
  };
}

function createTransferForm(legalEntityId = "") {
  return {
    legalEntityId,
    transferDate: todayDateOnly(),
    sourceWarehouseId: "",
    targetWarehouseId: "",
    note: "",
    lines: [createTransferLine()],
  };
}

function normalizeQuantityPrefill(value) {
  const normalized = String(value ?? "").trim();
  return /^\d+(\.\d{1,6})?$/.test(normalized) && Number(normalized) > 0
    ? normalized
    : "1";
}

function getStatusBadgeClass(value) {
  switch (String(value || "").trim().toUpperCase()) {
    case "INITIATED":
      return "border border-slate-200 bg-slate-100 text-slate-700";
    case "APPROVED":
      return "border border-sky-200 bg-sky-50 text-sky-800";
    case "IN_TRANSIT":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    case "RECEIVED":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    case "CANCELLED":
    case "REVERSED":
      return "border border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getTransferStatusLabel(value, translate = (en) => en) {
  switch (String(value || "").trim().toUpperCase()) {
    case "INITIATED":
      return translate("Initiated", "Baslatildi");
    case "APPROVED":
      return translate("Approved", "Onaylandi");
    case "IN_TRANSIT":
      return translate("In transit", "Yolda");
    case "RECEIVED":
      return translate("Received", "Teslim alindi");
    case "CANCELLED":
      return translate("Cancelled", "Iptal edildi");
    case "REVERSED":
      return translate("Reversed", "Ters kaydedildi");
    default:
      return normalizeText(value) || "-";
  }
}

function canApprove(row) {
  return String(row?.status || "").toUpperCase() === "INITIATED";
}

function canShip(row) {
  return String(row?.status || "").toUpperCase() === "APPROVED";
}

function canReceive(row) {
  return String(row?.status || "").toUpperCase() === "IN_TRANSIT";
}

function canCancel(row) {
  return ["INITIATED", "APPROVED"].includes(String(row?.status || "").toUpperCase());
}

function canReverse(row) {
  return ["IN_TRANSIT", "RECEIVED"].includes(String(row?.status || "").toUpperCase());
}

function getOwnershipLabel(row, translate = (en) => en) {
  const scope = String(row?.ownershipScope || "").trim().toUpperCase();
  if (scope === "OPERATING_UNIT") {
    const code = normalizeText(row?.operatingUnitCode);
    const name = normalizeText(row?.operatingUnitName);
    const ouPrefix = translate("OU", "OU");
    if (code && name) {
      return `${ouPrefix} | ${code} - ${name}`;
    }
    return code || name ? `${ouPrefix} | ${code || name}` : ouPrefix;
  }
  return translate("Central", "Merkez");
}

function formatWarehouseOptionLabel(row, translate = (en) => en) {
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  const warehouseLabel =
    (code && name ? `${code} - ${name}` : code || name) || `Warehouse #${row?.id || "-"}`;
  return `${warehouseLabel} | ${getOwnershipLabel(
    {
      ownershipScope: row?.ownershipScope || row?.ownership_scope,
      operatingUnitCode: row?.operatingUnitCode || row?.operating_unit_code,
      operatingUnitName: row?.operatingUnitName || row?.operating_unit_name,
    },
    translate
  )}`;
}

function formatJournalReference(journalNo, journalEntryId) {
  return normalizeText(journalNo) || (toPositiveInt(journalEntryId) ? `JRN #${journalEntryId}` : "");
}

function formatLifecycleValue(at, userId, translate = (en) => en) {
  if (!at && !userId) {
    return translate("Pending", "Bekliyor");
  }
  const parts = [];
  if (at) {
    parts.push(at);
  }
  if (userId) {
    parts.push(`${translate("User", "Kullanici")} #${userId}`);
  }
  return parts.join(" | ");
}

function getMissingPermissionMessage(permissionCode, l) {
  return l(`Missing permission: ${permissionCode}`, `Eksik yetki: ${permissionCode}`);
}

export default function InventoryTransfersPage() {
  const { entitlements, hasPermission } = useAuth();
  const { l } = useI18n();
  const { legalEntities: workingContextLegalEntities, workingContext } = useWorkingContext();
  const [searchParams] = useSearchParams();
  const canRead = hasPermission("inventory.read");
  const canCreateTransfer = hasPermission("inventory.transfer.create");
  const canApproveTransfer = hasPermission("inventory.transfer.approve");
  const canShipTransfer = hasPermission("inventory.transfer.ship");
  const canReceiveTransfer = hasPermission("inventory.transfer.receive");
  const canCancelTransfer = hasPermission("inventory.transfer.cancel");
  const canReverseTransfer = hasPermission("inventory.transfer.reverse");
  const canTransferEvidenceUpsert = hasPermission("inventory.transfer.evidence.upsert");
  const canReadItemCards = hasPermission("item.card.read");
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
  const deepLinkedStatus = useMemo(() => {
    const value = normalizeText(searchParams.get("status")).toUpperCase();
    return TRANSFER_STATUS_VALUES.includes(value) ? value : "";
  }, [searchParams]);
  const deepLinkedTransferPrefill = useMemo(() => {
    const legalEntityId = String(toPositiveInt(searchParams.get("legalEntityId")) || "");
    const sourceWarehouseId = String(toPositiveInt(searchParams.get("sourceWarehouseId")) || "");
    const targetWarehouseId = String(toPositiveInt(searchParams.get("targetWarehouseId")) || "");
    const itemCardId = String(toPositiveInt(searchParams.get("itemCardId")) || "");
    const sourceEntityId = String(toPositiveInt(searchParams.get("sourceEntityId")) || "");
    const sourceModule = normalizeText(searchParams.get("sourceModule")).toUpperCase();
    const sourceEntityType = normalizeText(searchParams.get("sourceEntityType")).toUpperCase();
    const prefillReason = normalizeText(searchParams.get("prefillReason")).toUpperCase();
    if (
      !legalEntityId &&
      !sourceWarehouseId &&
      !targetWarehouseId &&
      !itemCardId &&
      !sourceEntityId &&
      !prefillReason
    ) {
      return null;
    }
    return {
      legalEntityId,
      sourceWarehouseId,
      targetWarehouseId,
      itemCardId,
      quantityRequested: normalizeQuantityPrefill(searchParams.get("quantityRequested")),
      sourceModule: sourceModule || "CARI",
      sourceEntityType: sourceEntityType || null,
      sourceEntityId,
      prefillReason: prefillReason || null,
    };
  }, [searchParams]);
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
    status: "",
    sourceWarehouseId: "",
    targetWarehouseId: "",
    q: "",
  });
  const resolvedInventoryOperatingUnitId = useMemo(() => {
    if (deepLinkedOperatingUnitId) {
      return deepLinkedOperatingUnitId;
    }
    if (
      workingContextOperatingUnitId &&
      (!filters.legalEntityId
        || (workingContextLegalEntityId && filters.legalEntityId === workingContextLegalEntityId))
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
  const effectiveOperatingUnitId = filters.operatingUnitId || resolvedInventoryOperatingUnitId;
  const activeTransferScopeParams = useMemo(
    () => ({
      legalEntityId: filters.legalEntityId || undefined,
      operatingUnitId: effectiveOperatingUnitId || undefined,
    }),
    [effectiveOperatingUnitId, filters.legalEntityId]
  );
  const [form, setForm] = useState(() => createTransferForm());
  const [warehouseRows, setWarehouseRows] = useState([]);
  const [itemCardRows, setItemCardRows] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedTransferId, setSelectedTransferId] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [evidenceRows, setEvidenceRows] = useState([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceMessage, setEvidenceMessage] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceUploadFile, setEvidenceUploadFile] = useState(null);
  const [evidenceUploadInputKey, setEvidenceUploadInputKey] = useState(0);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [evidenceDeletingId, setEvidenceDeletingId] = useState(null);
  const [evidenceDownloadingId, setEvidenceDownloadingId] = useState(null);
  useEffect(() => {
    if (deepLinkedLegalEntityId || filters.legalEntityId) {
      return;
    }
    const onlyValue =
      workingContextLegalEntityId ||
      (legalEntityOptions.length === 1 ? legalEntityOptions[0]?.value || "" : "");
    if (!onlyValue) {
      return;
    }
    setFilters((previous) => ({
      ...previous,
      legalEntityId: onlyValue,
    }));
    setForm((previous) => ({
      ...previous,
      legalEntityId: onlyValue,
    }));
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
          }
    );
    setForm((previous) =>
      previous.legalEntityId === deepLinkedLegalEntityId
        ? previous
        : {
            ...previous,
            legalEntityId: deepLinkedLegalEntityId,
            sourceWarehouseId: "",
            targetWarehouseId: "",
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
            sourceWarehouseId: "",
            targetWarehouseId: "",
          }
    );
  }, [deepLinkedOperatingUnitId]);
  useEffect(() => {
    if (!deepLinkedStatus) {
      return;
    }
    setFilters((previous) =>
      previous.status === deepLinkedStatus
        ? previous
        : {
            ...previous,
            status: deepLinkedStatus,
      }
    );
  }, [deepLinkedStatus]);
  useEffect(() => {
    if (!deepLinkedTransferPrefill) {
      return;
    }
    setForm((previous) => ({
      ...createTransferForm(
        deepLinkedTransferPrefill.legalEntityId || previous.legalEntityId || ""
      ),
      legalEntityId: deepLinkedTransferPrefill.legalEntityId || previous.legalEntityId || "",
      sourceWarehouseId: deepLinkedTransferPrefill.sourceWarehouseId || "",
      targetWarehouseId: deepLinkedTransferPrefill.targetWarehouseId || "",
      lines: [
        {
          ...createTransferLine(),
          itemCardId: deepLinkedTransferPrefill.itemCardId || "",
          quantityRequested: deepLinkedTransferPrefill.quantityRequested || "1",
        },
      ],
    }));
  }, [deepLinkedTransferPrefill]);
  useEffect(() => {
    setForm((previous) => {
      const nextLegalEntityId = filters.legalEntityId || previous.legalEntityId || "";
      if (previous.legalEntityId === nextLegalEntityId) {
        return previous;
      }
      return {
        ...previous,
        legalEntityId: nextLegalEntityId,
        sourceWarehouseId: "",
        targetWarehouseId: "",
      };
    });
  }, [filters.legalEntityId]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(filters.legalEntityId);
    const operatingUnitId = toPositiveInt(effectiveOperatingUnitId);
    if (!canRead || !legalEntityId) {
      setWarehouseRows([]);
      setItemCardRows([]);
      return;
    }
    let active = true;
    async function loadDependencies() {
      try {
        const [warehouseResponse, itemCardResponse] = await Promise.all([
          listInventoryWarehouses({
            legalEntityId,
            operatingUnitId: operatingUnitId || undefined,
            status: "ACTIVE",
            limit: 500,
            offset: 0,
          }),
          canReadItemCards
            ? listItemCards({
                legalEntityId,
                status: "ACTIVE",
                limit: 500,
                offset: 0,
              })
            : Promise.resolve({ rows: [] }),
        ]);
        if (!active) {
          return;
        }
        setWarehouseRows(Array.isArray(warehouseResponse?.rows) ? warehouseResponse.rows : []);
        setItemCardRows(Array.isArray(itemCardResponse?.rows) ? itemCardResponse.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setWarehouseRows([]);
        setItemCardRows([]);
        setPageError(
          normalizeApiError(
            error,
            l("Failed to load transfer dependencies.", "Transfer bagimliliklari yuklenemedi.")
          )
        );
      }
    }
    loadDependencies();
    return () => {
      active = false;
    };
  }, [canRead, canReadItemCards, effectiveOperatingUnitId, filters.legalEntityId, l]);
  useEffect(() => {
    if (!canRead) {
      setRows([]);
      setLoading(false);
      setPageError(l("Missing permission: inventory.read", "Eksik yetki: inventory.read"));
      return;
    }
    let active = true;
    async function loadTransfers() {
      setLoading(true);
      setPageError("");
      try {
        const response = await listInventoryTransfers({
          legalEntityId: filters.legalEntityId || undefined,
          operatingUnitId: effectiveOperatingUnitId || undefined,
          status: filters.status || undefined,
          sourceWarehouseId: filters.sourceWarehouseId || undefined,
          targetWarehouseId: filters.targetWarehouseId || undefined,
          q: filters.q || undefined,
          limit: 200,
          offset: 0,
        });
        if (!active) {
          return;
        }
        const nextRows = Array.isArray(response?.rows) ? response.rows : [];
        setRows(nextRows);
        setSelectedTransferId((previous) => {
          if (previous && nextRows.some((row) => String(row.id) === previous)) {
            return previous;
          }
          return nextRows[0] ? String(nextRows[0].id) : "";
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setRows([]);
        setSelectedTransferId("");
        setPageError(
          normalizeApiError(
            error,
            l("Failed to load inventory transfers.", "Stok transferleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    loadTransfers();
    return () => {
      active = false;
    };
  }, [canRead, effectiveOperatingUnitId, filters, l]);
  useEffect(() => {
    const transferId = toPositiveInt(selectedTransferId);
    if (!canRead || !transferId) {
      setSelectedRow(null);
      setDetailLoading(false);
      setDetailError("");
      return;
    }
    let active = true;
    async function loadDetail() {
      setDetailLoading(true);
      setDetailError("");
      try {
        const response = await getInventoryTransfer(transferId, activeTransferScopeParams);
        if (!active) {
          return;
        }
        setSelectedRow(response?.row || null);
      } catch (error) {
        if (!active) {
          return;
        }
        setSelectedRow(null);
        setDetailError(
          normalizeApiError(
            error,
            l("Failed to load transfer detail.", "Transfer detayi yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    }
    loadDetail();
    return () => {
      active = false;
    };
  }, [activeTransferScopeParams, canRead, selectedTransferId, l]);
  useEffect(() => {
    setEvidenceError("");
    setEvidenceMessage("");
    setEvidenceNote("");
    setEvidenceUploadFile(null);
    setEvidenceUploadInputKey((previous) => previous + 1);
    setEvidenceDeletingId(null);
    setEvidenceDownloadingId(null);
  }, [selectedTransferId]);
  useEffect(() => {
    const transferId = toPositiveInt(selectedTransferId);
    if (!canRead || !transferId) {
      setEvidenceRows([]);
      setEvidenceLoading(false);
      setEvidenceError("");
      return;
    }
    let active = true;
    async function loadEvidence() {
      setEvidenceLoading(true);
      setEvidenceError("");
      try {
        const response = await listInventoryTransferEvidence(transferId, activeTransferScopeParams);
        if (!active) {
          return;
        }
        setEvidenceRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setEvidenceRows([]);
        setEvidenceError(
          normalizeApiError(
            error,
            l("Failed to load evidence attachments.", "Kanit ekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setEvidenceLoading(false);
        }
      }
    }
    loadEvidence();
    return () => {
      active = false;
    };
  }, [activeTransferScopeParams, canRead, selectedTransferId, l]);
  const activeWarehouseOptions = useMemo(
    () =>
      warehouseRows
        .filter((row) => String(row?.status || "").toUpperCase() === "ACTIVE")
        .map((row) => ({
          value: String(row.id || ""),
          label: formatWarehouseOptionLabel(row, l),
        })),
    [warehouseRows, l]
  );
  const itemCardOptions = useMemo(
    () =>
      itemCardRows.map((row) => ({
        value: String(row.id || ""),
        label:
          row.code && row.name
            ? `${row.code} - ${row.name}`
            : row.code || row.name || `Item #${row.id}`,
      })),
    [itemCardRows]
  );
  const transferActionPermissions = useMemo(
    () => ({
      approve: {
        allowed: canApproveTransfer,
        permissionCode: "inventory.transfer.approve",
      },
      ship: {
        allowed: canShipTransfer,
        permissionCode: "inventory.transfer.ship",
      },
      receive: {
        allowed: canReceiveTransfer,
        permissionCode: "inventory.transfer.receive",
      },
      cancel: {
        allowed: canCancelTransfer,
        permissionCode: "inventory.transfer.cancel",
      },
      reverse: {
        allowed: canReverseTransfer,
        permissionCode: "inventory.transfer.reverse",
      },
    }),
    [
      canApproveTransfer,
      canCancelTransfer,
      canReceiveTransfer,
      canReverseTransfer,
      canShipTransfer,
    ]
  );
  const selectedTransferLifecycleRows = selectedRow
    ? [
        {
          key: "initiated",
          label: l("Initiated", "Baslatildi"),
          value: formatLifecycleValue(selectedRow.initiatedAt, selectedRow.initiatedByUserId, l),
        },
        {
          key: "approved",
          label: l("Approved", "Onaylandi"),
          value: formatLifecycleValue(selectedRow.approvedAt, selectedRow.approvedByUserId, l),
        },
        {
          key: "in-transit",
          label: l("In transit", "Yolda"),
          value: formatLifecycleValue(selectedRow.inTransitAt, selectedRow.shippedByUserId, l),
        },
        {
          key: "received",
          label: l("Received", "Teslim alindi"),
          value: formatLifecycleValue(selectedRow.receivedAt, selectedRow.receivedByUserId, l),
        },
        {
          key: "canceled",
          label: l("Cancelled", "Iptal edildi"),
          value: formatLifecycleValue(selectedRow.canceledAt, selectedRow.canceledByUserId, l),
        },
        {
          key: "reversed",
          label: l("Reversed", "Ters kaydedildi"),
          value: formatLifecycleValue(selectedRow.reversedAt, selectedRow.reversedByUserId, l),
        },
      ]
    : [];
  const selectedTransferJournalRows = selectedRow
    ? [
        {
          key: "shipment",
          label: l("Shipment journal", "Sevkiyat yevmiyesi"),
          reference: formatJournalReference(
            selectedRow.shipmentJournalNo,
            selectedRow.shipmentJournalEntryId
          ),
          detail: selectedRow.shipmentJournalEntryId
            ? `#${selectedRow.shipmentJournalEntryId}`
            : l("Posts when shipment moves to in transit.", "Sevkiyat yola cikinca olusur."),
        },
        {
          key: "receipt",
          label: l("Receipt journal", "Tesellum yevmiyesi"),
          reference: formatJournalReference(
            selectedRow.receiptJournalNo,
            selectedRow.receiptJournalEntryId
          ),
          detail: selectedRow.receiptJournalEntryId
            ? `#${selectedRow.receiptJournalEntryId}`
            : l("Posts when target warehouse receives the transfer.", "Hedef depo transferi teslim alinca olusur."),
        },
        {
          key: "reversal",
          label: l("Reversal journal", "Ters kayit yevmiyesi"),
          reference: formatJournalReference(
            selectedRow.reversalJournalNo,
            selectedRow.reversalJournalEntryId
          ),
          detail: selectedRow.reversalJournalEntryId
            ? `#${selectedRow.reversalJournalEntryId}`
            : l("Created only when a shipped or received transfer is reversed.", "Sadece sevk edilen veya teslim alinan transfer terslenince olusur."),
        },
      ]
    : [];
  const selectedTransferActions = [
    {
      key: "approve",
      label: l("Approve", "Onayla"),
      enabled: Boolean(selectedRow) && canApprove(selectedRow),
      ...transferActionPermissions.approve,
      className: "rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60",
    },
    {
      key: "ship",
      label: l("Ship", "Sevk et"),
      enabled: Boolean(selectedRow) && canShip(selectedRow),
      ...transferActionPermissions.ship,
      className: "rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60",
    },
    {
      key: "receive",
      label: l("Receive", "Teslim al"),
      enabled: Boolean(selectedRow) && canReceive(selectedRow),
      ...transferActionPermissions.receive,
      className: "rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60",
    },
    {
      key: "cancel",
      label: l("Cancel", "Iptal et"),
      enabled: Boolean(selectedRow) && canCancel(selectedRow),
      ...transferActionPermissions.cancel,
      className: "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60",
    },
    {
      key: "reverse",
      label: l("Reverse", "Ters kaydet"),
      enabled: Boolean(selectedRow) && canReverse(selectedRow),
      ...transferActionPermissions.reverse,
      className: "rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60",
    },
  ];
  async function reloadTransfers(nextSelectedTransferId = selectedTransferId) {
    const response = await listInventoryTransfers({
      legalEntityId: filters.legalEntityId || undefined,
      operatingUnitId: effectiveOperatingUnitId || undefined,
      status: filters.status || undefined,
      sourceWarehouseId: filters.sourceWarehouseId || undefined,
      targetWarehouseId: filters.targetWarehouseId || undefined,
      q: filters.q || undefined,
      limit: 200,
      offset: 0,
    });
    const nextRows = Array.isArray(response?.rows) ? response.rows : [];
    setRows(nextRows);
    const normalizedSelectedId = String(nextSelectedTransferId || "");
    const resolvedSelection =
      normalizedSelectedId && nextRows.some((row) => String(row.id) === normalizedSelectedId)
        ? normalizedSelectedId
        : nextRows[0]
          ? String(nextRows[0].id)
          : "";
    setSelectedTransferId(resolvedSelection);
    return resolvedSelection;
  }
  async function reloadTransferEvidence(nextTransferId = selectedTransferId) {
    const transferId = toPositiveInt(nextTransferId);
    if (!transferId) {
      setEvidenceRows([]);
      return [];
    }
    const response = await listInventoryTransferEvidence(transferId, activeTransferScopeParams);
    const nextRows = Array.isArray(response?.rows) ? response.rows : [];
    setEvidenceRows(nextRows);
    return nextRows;
  }
  function updateTransferLine(index, field, value) {
    setForm((previous) => ({
      ...previous,
      lines: previous.lines.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              [field]: value,
            }
          : line
      ),
    }));
  }
  function addTransferLine() {
    setForm((previous) => ({
      ...previous,
      lines: [...previous.lines, createTransferLine()],
    }));
  }
  function removeTransferLine(index) {
    setForm((previous) => {
      const nextLines = previous.lines.filter((_, lineIndex) => lineIndex !== index);
      return {
        ...previous,
        lines: nextLines.length > 0 ? nextLines : [createTransferLine()],
      };
    });
  }
  async function handleCreateTransfer(event) {
    event.preventDefault();
    if (!canCreateTransfer) {
      setFormError(getMissingPermissionMessage("inventory.transfer.create", l));
      return;
    }
    setSaving(true);
    setFormError("");
    setFormMessage("");
    setActionError("");
    setActionMessage("");
    try {
      const payload = {
        legalEntityId: toPositiveInt(form.legalEntityId),
        transferDate: normalizeText(form.transferDate),
        sourceWarehouseId: toPositiveInt(form.sourceWarehouseId),
        targetWarehouseId: toPositiveInt(form.targetWarehouseId),
        note: normalizeText(form.note) || undefined,
        lines: form.lines.map((line) => ({
          itemCardId: toPositiveInt(line.itemCardId),
          quantityRequested: normalizeText(line.quantityRequested),
          note: normalizeText(line.note) || undefined,
        })),
      };
      if (normalizeText(deepLinkedTransferPrefill?.sourceModule)) {
        payload.sourceModule = normalizeText(deepLinkedTransferPrefill.sourceModule).toUpperCase();
      }
      if (normalizeText(deepLinkedTransferPrefill?.sourceEntityType)) {
        payload.sourceEntityType = normalizeText(deepLinkedTransferPrefill.sourceEntityType).toUpperCase();
      }
      if (toPositiveInt(deepLinkedTransferPrefill?.sourceEntityId)) {
        payload.sourceEntityId = toPositiveInt(deepLinkedTransferPrefill.sourceEntityId);
      }
      const response = await createInventoryTransfer(payload);
      const createdId = String(toPositiveInt(response?.row?.id) || "");
      await reloadTransfers(createdId);
      setForm((previous) => createTransferForm(previous.legalEntityId || ""));
      setFormMessage(
        l("Inventory transfer created.", "Stok transferi olusturuldu.")
      );
    } catch (error) {
      setFormError(
        normalizeApiError(
          error,
          l("Failed to create inventory transfer.", "Stok transferi olusturulamadi.")
        )
      );
    } finally {
      setSaving(false);
    }
  }
  async function runTransferAction(actionKey) {
    if (!selectedRow?.id) {
      return;
    }
    const transferId = Number(selectedRow.id);
    const actionMap = {
      approve: {
        run: () => approveInventoryTransfer(transferId),
        message: l("Transfer approved.", "Transfer onaylandi."),
      },
      ship: {
        run: () => shipInventoryTransfer(transferId),
        message: l("Transfer shipped.", "Transfer sevk edildi."),
      },
      receive: {
        run: () => receiveInventoryTransfer(transferId),
        message: l("Transfer received.", "Transfer teslim alindi."),
      },
      cancel: {
        run: () => {
          const cancelReason =
            window.prompt(
              l("Optional cancel reason", "Istege bagli iptal nedeni"),
              ""
            ) || "";
          return cancelInventoryTransfer(transferId, {
            cancelReason: normalizeText(cancelReason) || undefined,
          });
        },
        message: l("Transfer cancelled.", "Transfer iptal edildi."),
      },
      reverse: {
        run: () => {
          const reverseReason =
            window.prompt(
              l("Optional reverse reason", "Istege bagli ters kayit nedeni"),
              ""
            ) || "";
          return reverseInventoryTransfer(transferId, {
            reverseReason: normalizeText(reverseReason) || undefined,
          });
        },
        message: l("Transfer reversed.", "Transfer ters kaydedildi."),
      },
    };
    const action = actionMap[actionKey];
    if (!action) {
      return;
    }
    const permissionState = transferActionPermissions[actionKey];
    if (!permissionState?.allowed) {
      setActionError(getMissingPermissionMessage(permissionState?.permissionCode || "", l));
      return;
    }
    setActionLoading(true);
    setActionError("");
    setActionMessage("");
    try {
      const response = await action.run();
      const refreshedSelection = String(toPositiveInt(response?.row?.id) || transferId);
      await reloadTransfers(refreshedSelection);
      setActionMessage(action.message);
    } catch (error) {
      setActionError(
        normalizeApiError(
          error,
          l("Transfer action failed.", "Transfer aksiyonu basarisiz.")
        )
      );
    } finally {
      setActionLoading(false);
    }
  }
  async function handleAttachEvidence() {
    const transferId = toPositiveInt(selectedRow?.id);
    if (!transferId || !canTransferEvidenceUpsert) {
      setEvidenceError(
        l(
          "Evidence attach requires a selected transfer and inventory.transfer.evidence.upsert permission.",
          "Kanit ekleme icin secili transfer ve inventory.transfer.evidence.upsert yetkisi gerekir."
        )
      );
      return;
    }
    if (!evidenceUploadFile) {
      setEvidenceError(
        l("Select a file before attaching evidence.", "Kanit eklemeden once dosya secin.")
      );
      return;
    }

    setEvidenceUploading(true);
    setEvidenceError("");
    setEvidenceMessage("");
    try {
      const draftResponse = await createInventoryTransferEvidence(transferId, {
        fileName: evidenceUploadFile.name || "evidence.bin",
        contentType: evidenceUploadFile.type || undefined,
        displayName: evidenceUploadFile.name || undefined,
        note: normalizeText(evidenceNote) || undefined,
      });
      const evidenceId = toPositiveInt(draftResponse?.row?.id);
      if (!evidenceId) {
        throw new Error("Evidence draft creation did not return a valid id");
      }
      await uploadInventoryTransferEvidenceContent(transferId, evidenceId, evidenceUploadFile, {
        contentType: evidenceUploadFile.type || "application/octet-stream",
      });
      await reloadTransferEvidence(transferId);
      setEvidenceNote("");
      setEvidenceUploadFile(null);
      setEvidenceUploadInputKey((previous) => previous + 1);
      setEvidenceMessage(
        l(`Evidence attached. id=${evidenceId}`, `Kanit eklendi. id=${evidenceId}`)
      );
    } catch (error) {
      setEvidenceError(
        normalizeApiError(error, l("Failed to attach evidence.", "Kanit eklenemedi."))
      );
    } finally {
      setEvidenceUploading(false);
    }
  }
  async function handleDownloadEvidence(row) {
    const transferId = toPositiveInt(selectedRow?.id);
    const evidenceId = toPositiveInt(row?.id);
    if (!transferId || !evidenceId) {
      return;
    }

    setEvidenceDownloadingId(evidenceId);
    setEvidenceError("");
    setEvidenceMessage("");
    try {
      const response = await downloadInventoryTransferEvidence(
        transferId,
        evidenceId,
        activeTransferScopeParams
      );
      const fileName =
        normalizeText(response?.fileName) ||
        normalizeText(row?.fileName) ||
        `transfer-evidence-${evidenceId}.bin`;
      triggerBrowserDownload(response.blob, fileName);
      setEvidenceMessage(
        l(`Evidence downloaded. id=${evidenceId}`, `Kanit indirildi. id=${evidenceId}`)
      );
    } catch (error) {
      setEvidenceError(
        normalizeApiError(error, l("Failed to download evidence.", "Kanit indirilemedi."))
      );
    } finally {
      setEvidenceDownloadingId(null);
    }
  }
  async function handleDeleteEvidence(evidenceIdRaw) {
    const transferId = toPositiveInt(selectedRow?.id);
    const evidenceId = toPositiveInt(evidenceIdRaw);
    if (!transferId || !evidenceId || !canTransferEvidenceUpsert) {
      setEvidenceError(
        l(
          "Evidence delete requires a selected transfer, valid evidence id, and inventory.transfer.evidence.upsert permission.",
          "Kanit silme icin secili transfer, gecerli kanit kimligi ve inventory.transfer.evidence.upsert yetkisi gerekir."
        )
      );
      return;
    }
    const confirmed = window.confirm(
      l("Delete this evidence attachment?", "Bu kanit ekini silmek istiyor musunuz?")
    );
    if (!confirmed) {
      return;
    }

    setEvidenceDeletingId(evidenceId);
    setEvidenceError("");
    setEvidenceMessage("");
    try {
      await deleteInventoryTransferEvidence(transferId, evidenceId);
      await reloadTransferEvidence(transferId);
      setEvidenceMessage(
        l(`Evidence deleted. id=${evidenceId}`, `Kanit silindi. id=${evidenceId}`)
      );
    } catch (error) {
      setEvidenceError(
        normalizeApiError(error, l("Failed to delete evidence.", "Kanit silinemedi."))
      );
    } finally {
      setEvidenceDeletingId(null);
    }
  }
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              {l("Inventory Transfers", "Stok Transferleri")}
            </h1>
            <p className="text-sm text-slate-500">
              {l(
                "Cross-context transfer foundation with approval and detail tracking.",
                "Onayli ve detay izlemeli contextler arasi transfer temeli."
              )}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="grid gap-1 text-sm text-slate-600">
              <span>{l("Legal entity", "Legal entity")}</span>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={filters.legalEntityId}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    legalEntityId: event.target.value,
                    operatingUnitId: "",
                    sourceWarehouseId: "",
                    targetWarehouseId: "",
                  }))
                }
              >
                <option value="">{l("All", "Tum")}</option>
                {legalEntityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-slate-600">
              <span>{l("Status", "Durum")}</span>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={filters.status}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    status: event.target.value,
                  }))
                }
              >
                <option value="">{l("All", "Tum")}</option>
                {TRANSFER_STATUS_VALUES.map((status) => (
                  <option key={`transfer-status-filter-${status}`} value={status}>
                    {getTransferStatusLabel(status, l)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-slate-600">
              <span>{l("Source warehouse", "Kaynak depo")}</span>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={filters.sourceWarehouseId}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    sourceWarehouseId: event.target.value,
                  }))
                }
                disabled={!filters.legalEntityId}
              >
                <option value="">{l("All", "Tum")}</option>
                {activeWarehouseOptions.map((option) => (
                  <option key={`filter-source-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-slate-600">
              <span>{l("Target warehouse", "Hedef depo")}</span>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={filters.targetWarehouseId}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    targetWarehouseId: event.target.value,
                  }))
                }
                disabled={!filters.legalEntityId}
              >
                <option value="">{l("All", "Tum")}</option>
                {activeWarehouseOptions.map((option) => (
                  <option key={`filter-target-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-slate-600">
              <span>{l("Search", "Ara")}</span>
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={filters.q}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    q: event.target.value,
                  }))
                }
                placeholder={l("Transfer no or warehouse", "Transfer no veya depo")}
              />
            </label>
          </div>
        </div>
        {pageError ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {pageError}
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.3fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Create transfer", "Transfer olustur")}
              </h2>
              <p className="text-sm text-slate-500">
                {l(
                  "Only cross-context source and target combinations are valid in this slice.",
                  "Bu slice icin yalnizca contextler arasi kaynak ve hedef kombinasyonlari gecerlidir."
                )}
              </p>
            </div>
          </div>

          {deepLinkedTransferPrefill ? (
            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-900">
              <div className="font-semibold">
                {l(
                  "Transfer-required prefill applied.",
                  "Transfer gerekli on dolumu uygulandi."
                )}
              </div>
              <div className="mt-1 text-xs text-sky-800">
                {deepLinkedTransferPrefill.sourceEntityType === "CARI_STOCK_LINK" &&
                deepLinkedTransferPrefill.sourceEntityId
                  ? l(
                      `Source stock link #${deepLinkedTransferPrefill.sourceEntityId} requested a cross-context replenishment.`,
                      `Kaynak stok baglantisi #${deepLinkedTransferPrefill.sourceEntityId} contextler arasi ikmal talep etti.`
                    )
                  : l(
                      "This form was prefilled from transfer-required guidance.",
                      "Bu form transfer-gerekli yonlendirmesinden on dolduruldu."
                    )}
              </div>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleCreateTransfer}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-slate-600">
                <span>{l("Legal entity", "Legal entity")}</span>
                <select
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  value={form.legalEntityId}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      legalEntityId: event.target.value,
                      sourceWarehouseId: "",
                      targetWarehouseId: "",
                    }))
                  }
                >
                  <option value="">{l("Select", "Sec")}</option>
                  {legalEntityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm text-slate-600">
                <span>{l("Transfer date", "Transfer tarihi")}</span>
                <input
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  type="date"
                  value={form.transferDate}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      transferDate: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-600">
                <span>{l("Source warehouse", "Kaynak depo")}</span>
                <select
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  value={form.sourceWarehouseId}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      sourceWarehouseId: event.target.value,
                    }))
                  }
                >
                  <option value="">{l("Select", "Sec")}</option>
                  {activeWarehouseOptions.map((option) => (
                    <option key={`source-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm text-slate-600">
                <span>{l("Target warehouse", "Hedef depo")}</span>
                <select
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  value={form.targetWarehouseId}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      targetWarehouseId: event.target.value,
                    }))
                  }
                >
                  <option value="">{l("Select", "Sec")}</option>
                  {activeWarehouseOptions.map((option) => (
                    <option key={`target-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="grid gap-1 text-sm text-slate-600">
              <span>{l("Note", "Not")}</span>
              <textarea
                className="min-h-24 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={form.note}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    note: event.target.value,
                  }))
                }
                placeholder={l("Optional transfer note", "Istege bagli transfer notu")}
              />
            </label>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  {l("Lines", "Satirlar")}
                </h3>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  onClick={addTransferLine}
                >
                  {l("Add line", "Satir ekle")}
                </button>
              </div>

              {form.lines.map((line, index) => (
                <div
                  key={`transfer-line-${index}`}
                  className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1.2fr)_180px_minmax(0,1fr)_auto]"
                >
                  <label className="grid gap-1 text-sm text-slate-600">
                    <span>{l("Item card", "Stok karti")}</span>
                    <select
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      value={line.itemCardId}
                      onChange={(event) =>
                        updateTransferLine(index, "itemCardId", event.target.value)
                      }
                    >
                      <option value="">{l("Select", "Sec")}</option>
                      {itemCardOptions.map((option) => (
                        <option key={`${index}-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm text-slate-600">
                    <span>{l("Quantity", "Miktar")}</span>
                    <input
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      value={line.quantityRequested}
                      onChange={(event) =>
                        updateTransferLine(index, "quantityRequested", event.target.value)
                      }
                      placeholder="1.000000"
                    />
                  </label>

                  <label className="grid gap-1 text-sm text-slate-600">
                    <span>{l("Line note", "Satir notu")}</span>
                    <input
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      value={line.note}
                      onChange={(event) => updateTransferLine(index, "note", event.target.value)}
                      placeholder={l("Optional", "Istege bagli")}
                    />
                  </label>

                  <div className="flex items-end">
                    <button
                      type="button"
                      className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
                      onClick={() => removeTransferLine(index)}
                    >
                      {l("Remove", "Sil")}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {formError ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {formError}
              </p>
            ) : null}
            {formMessage ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {formMessage}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving || !canCreateTransfer}
                title={!canCreateTransfer ? getMissingPermissionMessage("inventory.transfer.create", l) : ""}
              >
                {saving
                  ? l("Creating...", "Olusturuluyor...")
                  : l("Create transfer", "Transfer olustur")}
              </button>
            </div>
            {!canCreateTransfer ? (
              <p className="text-xs text-slate-500">
                {getMissingPermissionMessage("inventory.transfer.create", l)}
              </p>
            ) : null}
          </form>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Transfer list", "Transfer listesi")}
              </h2>
              <p className="text-sm text-slate-500">
                {loading
                  ? l("Loading transfers...", "Transferler yukleniyor...")
                  : l("Select a row to inspect the stored foundation.", "Kayitli temeli incelemek icin bir satir secin.")}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                void reloadTransfers();
              }}
            >
              {l("Refresh", "Yenile")}
            </button>
          </div>

          <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{l("Transfer", "Transfer")}</th>
                  <th className="px-3 py-2 font-medium">{l("Route", "Rota")}</th>
                  <th className="px-3 py-2 font-medium">{l("Date", "Tarih")}</th>
                  <th className="px-3 py-2 font-medium">{l("Status", "Durum")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={4}>
                      {l("No transfers found.", "Transfer kaydi bulunamadi.")}
                    </td>
                  </tr>
                ) : null}
                {rows.map((row) => {
                  const isSelected = String(row.id) === String(selectedTransferId || "");
                  return (
                    <tr
                      key={row.id}
                      className={isSelected ? "bg-sky-50" : ""}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left text-slate-900 hover:text-sky-700"
                          onClick={() => setSelectedTransferId(String(row.id))}
                        >
                          <div className="font-medium">{row.transferNo}</div>
                          <div className="text-xs text-slate-500">
                            {row.sourceWarehouseCode} {"->"} {row.targetWarehouseCode}
                          </div>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <div className="font-medium text-slate-900">
                          {(row.sourceWarehouseCode || row.sourceWarehouseName || "-")} {"->"}{" "}
                          {(row.targetWarehouseCode || row.targetWarehouseName || "-")}
                        </div>
                        <div className="text-xs text-slate-500">
                          {getOwnershipLabel(
                            {
                              ownershipScope: row.sourceOwnershipScope,
                              operatingUnitCode: row.sourceOperatingUnitCode,
                              operatingUnitName: row.sourceOperatingUnitName,
                            },
                            l
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {getOwnershipLabel(
                            {
                              ownershipScope: row.targetOwnershipScope,
                              operatingUnitCode: row.targetOperatingUnitCode,
                              operatingUnitName: row.targetOperatingUnitName,
                            },
                            l
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <div>{row.transferDate || "-"}</div>
                        <div className="text-xs text-slate-500">
                          {row.createdAt || l("Created in this batch", "Bu batch'te olustu")}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(row.status)}`}
                        >
                          {getTransferStatusLabel(row.status, l)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {l("Transfer detail", "Transfer detayi")}
              </h3>
              {selectedRow?.status ? (
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(selectedRow.status)}`}
                >
                  {getTransferStatusLabel(selectedRow.status, l)}
                </span>
              ) : null}
            </div>

            {detailError ? (
              <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {detailError}
              </p>
            ) : null}
            {actionError ? (
              <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {actionError}
              </p>
            ) : null}
            {actionMessage ? (
              <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {actionMessage}
              </p>
            ) : null}
            {detailLoading ? (
              <p className="text-sm text-slate-500">
                {l("Loading detail...", "Detay yukleniyor...")}
              </p>
            ) : null}
            {!detailLoading && !selectedRow ? (
              <p className="text-sm text-slate-500">
                {l("Select a transfer from the list.", "Listeden bir transfer secin.")}
              </p>
            ) : null}
            {!detailLoading && selectedRow ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {l("Source context", "Kaynak context")}
                    </div>
                    <div className="mt-1 font-medium text-slate-900">
                      {selectedRow.sourceWarehouseCode} - {selectedRow.sourceWarehouseName}
                    </div>
                    <div className="text-sm text-slate-600">
                      {getOwnershipLabel({
                        ownershipScope: selectedRow.sourceOwnershipScope,
                        operatingUnitCode: selectedRow.sourceOperatingUnitCode,
                        operatingUnitName: selectedRow.sourceOperatingUnitName,
                      }, l)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {l("Target context", "Hedef context")}
                    </div>
                    <div className="mt-1 font-medium text-slate-900">
                      {selectedRow.targetWarehouseCode} - {selectedRow.targetWarehouseName}
                    </div>
                    <div className="text-sm text-slate-600">
                      {getOwnershipLabel({
                        ownershipScope: selectedRow.targetOwnershipScope,
                        operatingUnitCode: selectedRow.targetOperatingUnitCode,
                        operatingUnitName: selectedRow.targetOperatingUnitName,
                      }, l)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 md:col-span-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {l("Transfer summary", "Transfer ozeti")}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{selectedRow.transferNo || "-"}</span>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(selectedRow.status)}`}
                      >
                        {getTransferStatusLabel(selectedRow.status, l)}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                      <div>
                        {l("Legal entity", "Legal entity")}: {selectedRow.legalEntityCode || selectedRow.legalEntityId || "-"}
                      </div>
                      <div>
                        {l("Date", "Tarih")}: {selectedRow.transferDate || "-"}
                      </div>
                      <div>
                        {l("Line count", "Satir adedi")}: {Array.isArray(selectedRow.lines) ? selectedRow.lines.length : 0}
                      </div>
                      <div>
                        {l("Created", "Olusturma")}: {selectedRow.createdAt || "-"}
                      </div>
                    </div>
                    {selectedRow.note ? (
                      <div className="mt-2 text-sm text-slate-600">
                        {l("Note", "Not")}: {selectedRow.note}
                      </div>
                    ) : null}
                    {selectedRow.sourceModule || selectedRow.sourceEntityType || selectedRow.sourceEntityId ? (
                      <div className="mt-2 text-sm text-slate-600">
                        {l("Source evidence", "Kaynak kaniti")}:{" "}
                        {[
                          normalizeText(selectedRow.sourceModule) || null,
                          normalizeText(selectedRow.sourceEntityType) || null,
                          toPositiveInt(selectedRow.sourceEntityId)
                            ? `#${selectedRow.sourceEntityId}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" | ") || "-"}
                      </div>
                    ) : null}
                    {selectedRow.cancelReason ? (
                      <div className="mt-2 text-sm text-rose-700">
                        {l("Cancel reason", "Iptal nedeni")}: {selectedRow.cancelReason}
                      </div>
                    ) : null}
                    {selectedRow.reverseReason ? (
                      <div className="mt-2 text-sm text-rose-700">
                        {l("Reverse reason", "Ters kayit nedeni")}: {selectedRow.reverseReason}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {l("Transfer lifecycle", "Transfer yasam dongusu")}
                      </div>
                      <div className="text-xs text-slate-500">
                        {l(
                          "Approval, shipment, receipt, and reversal stamps stay visible on the transfer header.",
                          "Onay, sevkiyat, teslim alma ve ters kayit damgalari transfer basliginda gorunur."
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {selectedTransferLifecycleRows.map((entry) => (
                      <div
                        key={`transfer-lifecycle-${entry.key}`}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                      >
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          {entry.label}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">{entry.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {l("Transfer journals", "Transfer yevmiyeleri")}
                      </div>
                      <div className="text-xs text-slate-500">
                        {l(
                          "Shipment, receipt, and reversal journals remain attached on the transfer header.",
                          "Sevkiyat, teslim alma ve ters kayit yevmiyeleri transfer basligina bagli kalir."
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {selectedTransferJournalRows.map((entry) => (
                      <div
                        key={`transfer-journal-${entry.key}`}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                      >
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          {entry.label}
                        </div>
                        <div className="mt-1 font-medium text-slate-900">
                          {entry.reference || l("Not posted yet", "Henuz olusmadi")}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{entry.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900">
                      {l("Stored lines", "Kayitli satirlar")}
                    </div>
                    <div className="text-xs text-slate-500">
                      {l("Count", "Adet")}: {Array.isArray(selectedRow.lines) ? selectedRow.lines.length : 0}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {(Array.isArray(selectedRow.lines) ? selectedRow.lines : []).map((line) => (
                      <div
                        key={line.id}
                        className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 md:grid-cols-[100px_minmax(0,1fr)_220px]"
                      >
                        <div className="text-xs text-slate-500">#{line.lineNo}</div>
                        <div>
                          <div className="font-medium text-slate-900">
                            {line.itemCardCode || line.itemCardName || "-"}
                            {line.itemCardCode && line.itemCardName ? ` - ${line.itemCardName}` : ""}
                          </div>
                          <div className="text-xs text-slate-500">{line.note || l("No line note", "Satir notu yok")}</div>
                        </div>
                        <div className="space-y-1 text-sm text-slate-700">
                          <div>
                            {l("Requested", "Istenen")}: {line.quantityRequested ?? "-"}
                          </div>
                          <div>
                            {l("Shipped", "Sevk edilen")}: {line.quantityShipped ?? "-"}
                          </div>
                          <div>
                            {l("Received", "Teslim alinan")}: {line.quantityReceived ?? "-"}
                          </div>
                          {line.shippedTotalCostTxn === null || line.shippedTotalCostTxn === undefined ? null : (
                            <div className="text-xs text-slate-500">
                              {l("Shipment cost", "Sevkiyat maliyeti")}: {line.shippedTotalCostTxn} {line.shippedCurrencyCode || ""}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-3">
                    <div className="text-sm font-semibold text-slate-900">
                      {l("Available actions", "Kullanilabilir aksiyonlar")}
                    </div>
                    <div className="text-xs text-slate-500">
                      {l(
                        "Only actions valid for the current lifecycle are enabled.",
                        "Sadece mevcut yasam dongusune uygun aksiyonlar etkinlestirilir."
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTransferActions.map((action) => (
                      <button
                        key={`transfer-action-${action.key}`}
                        type="button"
                        className={action.className}
                        disabled={actionLoading || !action.allowed || !action.enabled}
                        title={!action.allowed ? getMissingPermissionMessage(action.permissionCode, l) : ""}
                        onClick={() => void runTransferAction(action.key)}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                  {selectedTransferActions.some((action) => action.enabled && !action.allowed) ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {selectedTransferActions
                        .filter((action) => action.enabled && !action.allowed)
                        .map((action) => getMissingPermissionMessage(action.permissionCode, l))
                        .join(" | ")}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {l("Evidence attachments", "Kanit ekleri")}
                      </div>
                      <div className="text-xs text-slate-500">
                        {l(
                          "Attach shipment slips, approvals, or receiving proof to this transfer.",
                          "Sevk fisleri, onaylar veya teslim alma kanitlarini bu transfere ekleyin."
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {l("Count", "Adet")}: {evidenceRows.length}
                    </div>
                  </div>

                  {evidenceError ? (
                    <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {evidenceError}
                    </p>
                  ) : null}
                  {evidenceMessage ? (
                    <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {evidenceMessage}
                    </p>
                  ) : null}

                  <div className="grid gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span>{l("File", "Dosya")}</span>
                      <input
                        key={evidenceUploadInputKey}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        type="file"
                        onChange={(event) =>
                          setEvidenceUploadFile(event.target.files?.[0] || null)
                        }
                        disabled={evidenceUploading || !canTransferEvidenceUpsert}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span>{l("Note", "Not")}</span>
                      <input
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        value={evidenceNote}
                        onChange={(event) => setEvidenceNote(event.target.value)}
                        disabled={evidenceUploading || !canTransferEvidenceUpsert}
                        placeholder={l("Optional evidence note", "Istege bagli kanit notu")}
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={
                          !evidenceUploadFile
                          || evidenceUploading
                          || !canTransferEvidenceUpsert
                        }
                        onClick={() => void handleAttachEvidence()}
                      >
                        {evidenceUploading
                          ? l("Attaching...", "Ekleniyor...")
                          : l("Attach Evidence", "Kanit ekle")}
                      </button>
                    </div>
                  </div>

                  {!canTransferEvidenceUpsert ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {getMissingPermissionMessage("inventory.transfer.evidence.upsert", l)}
                    </p>
                  ) : null}
                  {evidenceLoading ? (
                    <p className="mt-3 text-sm text-slate-600">
                      {l("Loading evidence...", "Kanitlar yukleniyor...")}
                    </p>
                  ) : null}
                  {!evidenceLoading && evidenceRows.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-600">
                      {l(
                        "No evidence attached to this transfer.",
                        "Bu transfere ekli kanit yok."
                      )}
                    </p>
                  ) : null}
                  {!evidenceLoading && evidenceRows.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {evidenceRows.map((row) => {
                        const evidenceId = toPositiveInt(row?.id);
                        const isDownloading =
                          evidenceId && Number(evidenceDownloadingId) === Number(evidenceId);
                        const isDeleting =
                          evidenceId && Number(evidenceDeletingId) === Number(evidenceId);
                        return (
                          <div
                            key={`transfer-evidence-${row.id}`}
                            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 md:flex-row md:items-start md:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900">
                                {row.displayName || row.fileName || `Evidence #${row.id}`}
                              </div>
                              <div className="text-xs text-slate-500">
                                {row.fileName || "-"} | {row.contentType || "application/octet-stream"}
                              </div>
                              <div className="text-xs text-slate-500">
                                {l("Status", "Durum")}: {row.status || "-"}
                                {row.uploadedAt ? ` | ${row.uploadedAt}` : ""}
                              </div>
                              <div className="text-sm text-slate-600">
                                {row.note || l("No note", "Not yok")}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isDownloading}
                                onClick={() => void handleDownloadEvidence(row)}
                              >
                                {isDownloading
                                  ? l("Downloading...", "Indiriliyor...")
                                  : l("Download", "Indir")}
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={!canTransferEvidenceUpsert || isDeleting}
                                title={
                                  !canTransferEvidenceUpsert
                                    ? getMissingPermissionMessage("inventory.transfer.evidence.upsert", l)
                                    : ""
                                }
                                onClick={() => void handleDeleteEvidence(row.id)}
                              >
                                {isDeleting
                                  ? l("Deleting...", "Siliniyor...")
                                  : l("Delete", "Sil")}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
