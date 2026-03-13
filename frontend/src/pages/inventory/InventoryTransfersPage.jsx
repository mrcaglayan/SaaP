
import { useEffect, useMemo, useState } from "react";
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
function normalizeText(value) {
  return String(value || "").trim();
}function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}function triggerBrowserDownload(blob, fileName) {
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
}function normalizeApiError(error, fallback) {
  const message = String(error?.response?.data?.message || error?.message || fallback).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}function mapLegalEntityLookupOption(row) {
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
}function createTransferLine() {
  return {
    itemCardId: "",
    quantityRequested: "1",
    note: "",
  };
}function createTransferForm(legalEntityId = "") {
  return {
    legalEntityId,
    transferDate: todayDateOnly(),
    sourceWarehouseId: "",
    targetWarehouseId: "",
    note: "",
    lines: [createTransferLine()],
  };
}function getStatusBadgeClass(value) {
  switch (String(value || "").trim().toUpperCase()) {
    case "INITIATED":
      return "border border-slate-200 bg-slate-100 text-slate-700";
    case "APPROVED":
      return "border border-sky-200 bg-sky-50 text-sky-800";
    case "IN_TRANSIT":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    case "RECEIVED":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    case "CANCELED":
    case "REVERSED":
      return "border border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border border-slate-200 bg-slate-100 text-slate-700";
  }
}function getOwnershipLabel(row) {
  const scope = String(row?.ownershipScope || "").trim().toUpperCase();
  if (scope === "OPERATING_UNIT") {
    const code = normalizeText(row?.operatingUnitCode);
    const name = normalizeText(row?.operatingUnitName);
    if (code && name) {
      return `OU • ${code} - ${name}`;
    }
    return code || name ? `OU • ${code || name}` : "OU";
  }
  return "Central";
}function canApprove(row) {
  return String(row?.status || "").toUpperCase() === "INITIATED";
}function canShip(row) {
  return String(row?.status || "").toUpperCase() === "APPROVED";
}function canReceive(row) {
  return String(row?.status || "").toUpperCase() === "IN_TRANSIT";
}function canCancel(row) {
  return ["INITIATED", "APPROVED"].includes(String(row?.status || "").toUpperCase());
}function canReverse(row) {
  return ["IN_TRANSIT", "RECEIVED"].includes(String(row?.status || "").toUpperCase());
}export default function InventoryTransfersPage() {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const { legalEntities: workingContextLegalEntities } = useWorkingContext();
  const canRead = hasPermission("inventory.read");
  const canUpsert = hasPermission("inventory.upsert");
  const canReadItemCards = hasPermission("item.card.read");
  const legalEntityOptions = useMemo(
    () =>
      (Array.isArray(workingContextLegalEntities) ? workingContextLegalEntities : [])
        .map(mapLegalEntityLookupOption)
        .filter(Boolean),
    [workingContextLegalEntities]
  );
  const [filters, setFilters] = useState({
    legalEntityId: "",
    status: "",
    q: "",
  });
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
    if (filters.legalEntityId || legalEntityOptions.length !== 1) {
      return;
    }
    const onlyValue = legalEntityOptions[0]?.value || "";
    setFilters((previous) => ({
      ...previous,
      legalEntityId: onlyValue,
    }));
    setForm((previous) => ({
      ...previous,
      legalEntityId: onlyValue,
    }));
  }, [filters.legalEntityId, legalEntityOptions]);
  useEffect(() => {
    setForm((previous) => ({
      ...previous,
      legalEntityId: filters.legalEntityId || previous.legalEntityId || "",
    }));
  }, [filters.legalEntityId]);
  useEffect(() => {
    const legalEntityId = toPositiveInt(filters.legalEntityId);
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
  }, [canRead, canReadItemCards, filters.legalEntityId, l]);
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
          status: filters.status || undefined,
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
  }, [canRead, filters, l]);
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
        const response = await getInventoryTransfer(transferId);
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
  }, [canRead, selectedTransferId, l]);
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
        const response = await listInventoryTransferEvidence(transferId);
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
  }, [canRead, selectedTransferId, l]);
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
  async function reloadTransfers(nextSelectedTransferId = selectedTransferId) {
    const response = await listInventoryTransfers({
      legalEntityId: filters.legalEntityId || undefined,
      status: filters.status || undefined,
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
    const response = await listInventoryTransferEvidence(transferId);
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
    if (!canUpsert) {
      setFormError(l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert"));
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
    if (!canUpsert) {
      setActionError(l("Missing permission: inventory.upsert", "Eksik yetki: inventory.upsert"));
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
        message: l("Transfer canceled.", "Transfer iptal edildi."),
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
    if (!transferId || !canUpsert) {
      setEvidenceError(
        l(
          "Evidence attach requires a selected transfer and inventory.upsert permission.",
          "Kanit ekleme icin secili transfer ve inventory.upsert yetkisi gerekir."
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
      const response = await downloadInventoryTransferEvidence(transferId, evidenceId);
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
    if (!transferId || !evidenceId || !canUpsert) {
      setEvidenceError(
        l(
          "Evidence delete requires a selected transfer, valid evidence id, and inventory.upsert permission.",
          "Kanit silme icin secili transfer, gecerli kanit kimligi ve inventory.upsert yetkisi gerekir."
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
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-sm text-slate-600">
              <span>{l("Legal entity", "Legal entity")}</span>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                value={filters.legalEntityId}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    legalEntityId: event.target.value,
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
                <option value="INITIATED">INITIATED</option>
                <option value="APPROVED">APPROVED</option>
                <option value="IN_TRANSIT">IN_TRANSIT</option>
                <option value="RECEIVED">RECEIVED</option>
                <option value="CANCELED">CANCELED</option>
                <option value="REVERSED">REVERSED</option>
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
                disabled={saving}
              >
                {saving
                  ? l("Creating...", "Olusturuluyor...")
                  : l("Create transfer", "Transfer olustur")}
              </button>
            </div>
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
                  <th className="px-3 py-2 font-medium">{l("Date", "Tarih")}</th>
                  <th className="px-3 py-2 font-medium">{l("Status", "Durum")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-slate-500" colSpan={3}>
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
                            {row.sourceWarehouseCode} → {row.targetWarehouseCode}
                          </div>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.transferDate || "-"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(row.status)}`}
                        >
                          {row.status}
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
                  {selectedRow.status}
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
                      })}
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
                      })}
                    </div>
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
                        className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 md:grid-cols-[90px_minmax(0,1fr)_140px]"
                      >
                        <div className="text-xs text-slate-500">
                          #{line.lineNo}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">
                            {line.itemCardCode} - {line.itemCardName}
                          </div>
                          <div className="text-xs text-slate-500">{line.note || "—"}</div>
                        </div>
                        <div className="text-sm text-slate-700">
                          {l("Requested", "Istenen")}: {line.quantityRequested}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canApprove(selectedRow) ? (
                    <button
                      type="button"
                      className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={actionLoading}
                      onClick={() => void runTransferAction("approve")}
                    >
                      {l("Approve", "Onayla")}
                    </button>
                  ) : null}
                  {canShip(selectedRow) ? (
                    <button
                      type="button"
                      className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={actionLoading}
                      onClick={() => void runTransferAction("ship")}
                    >
                      {l("Ship", "Sevk et")}
                    </button>
                  ) : null}
                  {canReceive(selectedRow) ? (
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={actionLoading}
                      onClick={() => void runTransferAction("receive")}
                    >
                      {l("Receive", "Teslim al")}
                    </button>
                  ) : null}
                  {canCancel(selectedRow) ? (
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={actionLoading}
                      onClick={() => void runTransferAction("cancel")}
                    >
                      {l("Cancel", "Iptal et")}
                    </button>
                  ) : null}
                  {canReverse(selectedRow) ? (
                    <button
                      type="button"
                      className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={actionLoading}
                      onClick={() => void runTransferAction("reverse")}
                    >
                      {l("Reverse", "Ters kaydet")}
                    </button>
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
                        disabled={evidenceUploading || !canUpsert}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-600">
                      <span>{l("Note", "Not")}</span>
                      <input
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        value={evidenceNote}
                        onChange={(event) => setEvidenceNote(event.target.value)}
                        disabled={evidenceUploading || !canUpsert}
                        placeholder={l("Optional evidence note", "Istege bagli kanit notu")}
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!evidenceUploadFile || evidenceUploading || !canUpsert}
                        onClick={() => void handleAttachEvidence()}
                      >
                        {evidenceUploading
                          ? l("Attaching...", "Ekleniyor...")
                          : l("Attach Evidence", "Kanit ekle")}
                      </button>
                    </div>
                  </div>

                  {!canUpsert ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {l(
                        "Missing permission: inventory.upsert",
                        "Eksik yetki: inventory.upsert"
                      )}
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
                                disabled={!canUpsert || isDeleting}
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
