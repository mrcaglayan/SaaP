
import { useEffect, useMemo, useState } from "react";
import Combobox from "../../components/Combobox.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { listLegalEntities, listOperatingUnits } from "../../api/orgAdmin.js";
import {
  createInventoryWarehouse,
  listInventoryWarehouses,
  upsertInventoryWarehouse,
} from "../../api/inventory.js";
function normalizeText(value) {
  return String(value || "").trim();
}
function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
function createEditForm(row) {
  if (!row) {
    return {
      id: "",
      legalEntityId: "",
      code: "",
      name: "",
      status: "ACTIVE",
      inventoryReceiptPolicy: "ALLOW_INVOICE_BEFORE_RECEIPT",
      notes: "",
    };
  }
  return {
    id: String(row.id || ""),
    legalEntityId: String(row.legalEntityId || ""),
    code: normalizeText(row.code),
    name: normalizeText(row.name),
    status: normalizeText(row.status || "ACTIVE").toUpperCase(),
    inventoryReceiptPolicy: normalizeText(
      row.inventoryReceiptPolicy || "ALLOW_INVOICE_BEFORE_RECEIPT"
    ).toUpperCase(),
    notes: normalizeText(row.notes),
  };
}
export default function InventorySettingsPage() {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const { legalEntities: workingContextLegalEntities } = useWorkingContext();
  const canRead = hasPermission("inventory.read");
  const canWarehouseUpsert = hasPermission("inventory.warehouse.upsert");
  const canReadOrgTree = hasPermission("org.tree.read");
  const legalEntityOptions = useMemo(
    () =>
      (Array.isArray(workingContextLegalEntities) ? workingContextLegalEntities : [])
        .map(mapLegalEntityLookupOption)
        .filter(Boolean),
    [workingContextLegalEntities]
  );
  const [filters, setFilters] = useState({
    legalEntityId: "",
    ownershipScope: "",
    operatingUnitId: "",
    status: "",
  });
  const [warehouseRows, setWarehouseRows] = useState([]);
  const [warehouseOperatingUnits, setWarehouseOperatingUnits] = useState([]);
  const [warehouseOperatingUnitsLoading, setWarehouseOperatingUnitsLoading] = useState(false);
  const [warehouseOperatingUnitsError, setWarehouseOperatingUnitsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [warehouseForm, setWarehouseForm] = useState(() => createWarehouseForm());
  const [warehouseSaving, setWarehouseSaving] = useState(false);
  const [warehouseError, setWarehouseError] = useState("");
  const [warehouseMessage, setWarehouseMessage] = useState("");
  const [editWarehouseId, setEditWarehouseId] = useState("");
  const [editForm, setEditForm] = useState(() => createEditForm());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editMessage, setEditMessage] = useState("");
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
    }
  }, [filters.legalEntityId, legalEntityOptions]);
  useEffect(() => {
    if (!filters.legalEntityId || !canReadOrgTree) {
      setWarehouseOperatingUnits([]);
      return;
    }
    let active = true;
    setWarehouseOperatingUnitsLoading(true);
    setWarehouseOperatingUnitsError("");
    listOperatingUnits({
      legalEntityId: toPositiveInt(filters.legalEntityId),
      limit: 500,
      offset: 0,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setWarehouseOperatingUnits(Array.isArray(response?.rows) ? response.rows : []);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setWarehouseOperatingUnitsError(
          normalizeApiError(
            error,
            l("Failed to load operating units.", "Isletme birimleri yuklenemedi.")
          )
        );
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setWarehouseOperatingUnitsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canReadOrgTree, filters.legalEntityId, l]);
  useEffect(() => {
    if (!canRead) {
      setWarehouseRows([]);
      return;
    }
    let active = true;
    setLoading(true);
    setPageError("");
    listInventoryWarehouses({
      legalEntityId: toPositiveInt(filters.legalEntityId),
      ownershipScope: normalizeText(filters.ownershipScope) || undefined,
      operatingUnitId: toPositiveInt(filters.operatingUnitId),
      status: normalizeText(filters.status) || undefined,
      limit: 200,
      offset: 0,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setWarehouseRows(Array.isArray(response?.rows) ? response.rows : []);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setPageError(
          normalizeApiError(
            error,
            l("Failed to load warehouses.", "Depolar yuklenemedi.")
          )
        );
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canRead, filters.legalEntityId, filters.operatingUnitId, filters.ownershipScope, filters.status, l]);
  async function handleCreateWarehouse(event) {
    event.preventDefault();
    if (!canWarehouseUpsert) {
      setWarehouseError(
        l(
          "Missing permission: inventory.warehouse.upsert",
          "Eksik yetki: inventory.warehouse.upsert"
        )
      );
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
    } catch (error) {
      setWarehouseError(
        normalizeApiError(error, l("Warehouse create failed.", "Depo olusturma basarisiz."))
      );
    } finally {
      setWarehouseSaving(false);
    }
  }
  async function handleUpdateWarehouse(event) {
    event.preventDefault();
    if (!canWarehouseUpsert) {
      setEditError(
        l(
          "Missing permission: inventory.warehouse.upsert",
          "Eksik yetki: inventory.warehouse.upsert"
        )
      );
      return;
    }
    if (!editWarehouseId) {
      return;
    }
    setEditSaving(true);
    setEditError("");
    setEditMessage("");
    try {
      const response = await upsertInventoryWarehouse({
        id: toPositiveInt(editWarehouseId),
        legalEntityId: toPositiveInt(editForm.legalEntityId),
        code: normalizeText(editForm.code).toUpperCase(),
        name: normalizeText(editForm.name),
        status: normalizeText(editForm.status).toUpperCase() || "ACTIVE",
        inventoryReceiptPolicy:
          normalizeText(editForm.inventoryReceiptPolicy) || undefined,
        notes: normalizeText(editForm.notes) || undefined,
      });
      const updatedRow = response?.row || null;
      setEditMessage(
        l("Warehouse updated.", "Depo guncellendi.") +
        (updatedRow?.code ? ` ${updatedRow.code}` : "")
      );
      setWarehouseRows((previous) =>
        previous.map((row) => (row.id === updatedRow?.id ? updatedRow : row))
      );
    } catch (error) {
      setEditError(
        normalizeApiError(error, l("Warehouse update failed.", "Depo guncelleme basarisiz."))
      );
    } finally {
      setEditSaving(false);
    }
  }
  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {l("Inventory Settings", "Stok Ayarlari")}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Configure warehouse ownership and receipt policy per depot.",
                "Depo sahipligini ve mal kabul politikasini her depo icin ayarlayin."
              )}
            </p>
          </div>
        </div>
      </header>
      <section className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
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
                  "Create a new warehouse and define its receipt policy.",
                  "Yeni depo olusturun ve mal kabul politikasini belirleyin."
                )}
              </p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
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
              {l("Status", "Durum")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={warehouseForm.status}
                onChange={(event) =>
                  setWarehouseForm((previous) => ({
                    ...previous,
                    status: event.target.value,
                  }))
                }
                disabled={warehouseSaving || !canUpsert}
              >
                <option value="ACTIVE">{l("Active", "Aktif")}</option>
                <option value="INACTIVE">{l("Inactive", "Pasif")}</option>
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
                "Eksik yetki: org.tree.read. Isletme birimine ait depolar bu ekranda secilemez."
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
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
              {warehouseSaving ? l("Creating...", "Olusturuluyor...") : l("Create", "Olustur")}
            </button>
          </div>
        </form>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Warehouses", "Depolar")}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {l(
                  "Review and update warehouse receipt policies.",
                  "Depo mal kabul politikalarini inceleyin ve guncelleyin."
                )}
              </p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
              {warehouseRows.length}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox
                className="mt-1"
                value={filters.legalEntityId}
                options={legalEntityOptions}
                placeholder={l("All legal entities", "Tum tuzel kisilikler")}
                noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                onChange={(nextValue) =>
                  setFilters((previous) => ({
                    ...previous,
                    legalEntityId: nextValue ? String(nextValue) : "",
                  }))
                }
                disabled={loading}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Ownership Scope", "Sahiplik Kapsami")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.ownershipScope}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    ownershipScope: event.target.value,
                  }))
                }
                disabled={loading}
              >
                <option value="">{l("All scopes", "Tum kapsamlar")}</option>
                <option value="CENTRAL">{l("Central", "Merkez")}</option>
                <option value="OPERATING_UNIT">{l("Operating Unit", "Isletme Birimi")}</option>
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Operating Unit", "Isletme Birimi")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.operatingUnitId}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    operatingUnitId: event.target.value,
                  }))
                }
                disabled={loading || !canReadOrgTree}
              >
                <option value="">{l("All operating units", "Tum isletme birimleri")}</option>
                {warehouseOperatingUnitOptions.map((option) => (
                  <option key={`filter-ou-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {l("Status", "Durum")}
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={filters.status}
                onChange={(event) =>
                  setFilters((previous) => ({
                    ...previous,
                    status: event.target.value,
                  }))
                }
                disabled={loading}
              >
                <option value="">{l("All statuses", "Tum durumlar")}</option>
                <option value="ACTIVE">{l("Active", "Aktif")}</option>
                <option value="INACTIVE">{l("Inactive", "Pasif")}</option>
              </select>
            </label>
          </div>
          {pageError ? <p className="mt-3 text-sm text-rose-700">{pageError}</p> : null}
          {!canRead ? (
            <p className="mt-3 text-sm text-amber-700">
              {l("Missing permission: inventory.read", "Eksik yetki: inventory.read")}
            </p>
          ) : null}
          <div className="mt-4 space-y-3">
            {warehouseRows.map((row) => {
              const isEditing = String(row.id || "") === String(editWarehouseId || "");
              return (
                <div
                  key={`warehouse-row-${row.id}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
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
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                        {row.ownershipScope || "CENTRAL"}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                        {row.status || "ACTIVE"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {l("Owner Context", "Sahiplik Baglami")}:{" "}
                    {row.operatingUnitCode && row.operatingUnitName
                      ? `${row.operatingUnitCode} - ${row.operatingUnitName}`
                      : row.operatingUnitCode || row.operatingUnitName || l("Central", "Merkez")}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {l("Receipt Policy", "Mal Kabul Politikasi")}:{" "}
                    {describeReceiptPolicy(row.inventoryReceiptPolicy, l)}
                  </div>
                  {row.notes ? <div className="mt-1 text-sm text-slate-600">{row.notes}</div> : null}
                  {isEditing ? (
                    <form className="mt-3 grid gap-3" onSubmit={handleUpdateWarehouse}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Code", "Kod")}
                          <input
                            type="text"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                            value={editForm.code}
                            onChange={(event) =>
                              setEditForm((previous) => ({
                                ...previous,
                                code: event.target.value,
                              }))
                            }
                            disabled={!canUpsert || editSaving}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Name", "Ad")}
                          <input
                            type="text"
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={editForm.name}
                            onChange={(event) =>
                              setEditForm((previous) => ({
                                ...previous,
                                name: event.target.value,
                              }))
                            }
                            disabled={!canUpsert || editSaving}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Receipt Policy", "Mal Kabul Politikasi")}
                          <select
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={editForm.inventoryReceiptPolicy}
                            onChange={(event) =>
                              setEditForm((previous) => ({
                                ...previous,
                                inventoryReceiptPolicy: event.target.value,
                              }))
                            }
                            disabled={!canUpsert || editSaving}
                          >
                            <option value="ALLOW_INVOICE_BEFORE_RECEIPT">
                              {l(
                                "Allow invoice before receipt",
                                "Mal kabul olmadan fatura post edilebilir"
                              )}
                            </option>
                            <option value="REQUIRE_RECEIPT_BEFORE_INVOICE">
                              {l(
                                "Require receipt before invoice",
                                "Faturadan once mal kabul zorunlu"
                              )}
                            </option>
                          </select>
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {l("Status", "Durum")}
                          <select
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                            value={editForm.status}
                            onChange={(event) =>
                              setEditForm((previous) => ({
                                ...previous,
                                status: event.target.value,
                              }))
                            }
                            disabled={!canUpsert || editSaving}
                          >
                            <option value="ACTIVE">{l("Active", "Aktif")}</option>
                            <option value="INACTIVE">{l("Inactive", "Pasif")}</option>
                          </select>
                        </label>
                      </div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {l("Notes", "Notlar")}
                        <textarea
                          className="mt-1 min-h-16 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                          value={editForm.notes}
                          onChange={(event) =>
                            setEditForm((previous) => ({
                              ...previous,
                              notes: event.target.value,
                            }))
                          }
                          disabled={!canUpsert || editSaving}
                        />
                      </label>
                      {editError ? (
                        <p className="text-sm text-rose-700">{editError}</p>
                      ) : null}
                      {editMessage ? (
                        <p className="text-sm text-emerald-700">{editMessage}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700"
                          onClick={() => {
                            setEditWarehouseId("");
                            setEditForm(createEditForm());
                            setEditError("");
                            setEditMessage("");
                          }}
                          disabled={editSaving}
                        >
                          {l("Cancel", "Iptal")}
                        </button>
                        <button
                          type="submit"
                          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={
                            editSaving ||
                            !canUpsert ||
                            !normalizeText(editForm.code) ||
                            !normalizeText(editForm.name)
                          }
                        >
                          {editSaving
                            ? l("Saving...", "Kaydediliyor...")
                            : l("Save", "Kaydet")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700"
                        onClick={() => {
                          setEditWarehouseId(String(row.id || ""));
                          setEditForm(createEditForm(row));
                          setEditError("");
                          setEditMessage("");
                        }}
                        disabled={!canUpsert}
                      >
                        {l("Edit", "Duzenle")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {warehouseRows.length === 0 && !loading ? (
              <p className="text-sm text-slate-600">
                {l("No warehouses found.", "Depo bulunamadi.")}
              </p>
            ) : null}
          </div>
        </section>
      </section>
    </div>
  );
}
