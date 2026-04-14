import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import MoneyText from "../../components/MoneyText.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { listOperatingUnits } from "../../api/orgAdmin.js";
import {
  listInventoryLandedCostVouchers,
  reverseInventoryLandedCostVoucher,
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

function mapLegalEntityOption(row) {
  const id = String(toPositiveInt(row?.id) || "");
  if (!id) {
    return null;
  }
  const code = normalizeText(row?.code);
  const name = normalizeText(row?.name);
  return {
    value: id,
    label: code && name ? `${code} - ${name}` : code || name || `#${id}`,
  };
}

function getStatusBadgeClass(value) {
  switch (String(value || "").trim().toUpperCase()) {
    case "POSTED":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    case "REVERSED":
      return "border border-rose-200 bg-rose-50 text-rose-800";
    case "REVERSAL_BLOCKED":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    case "DRAFT":
    default:
      return "border border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getStatusLabel(value, l) {
  switch (String(value || "").trim().toUpperCase()) {
    case "POSTED":
      return l("Posted", "Kaydedildi");
    case "REVERSED":
      return l("Reversed", "Ters kaydedildi");
    case "REVERSAL_BLOCKED":
      return l("Reversal Blocked", "Ters kayit bloklu");
    case "DRAFT":
    default:
      return l("Draft", "Taslak");
  }
}

function getOwnershipLabel(row, l) {
  const scope = String(row?.ownershipScope || "").trim().toUpperCase();
  if (scope === "OPERATING_UNIT") {
    const code = normalizeText(row?.operatingUnitCode);
    const name = normalizeText(row?.operatingUnitName);
    return code && name
      ? `${code} - ${name}`
      : code || name || `${l("Operating unit", "Isletme birimi")} #${row?.operatingUnitId || "-"}`;
  }
  return l("Central", "Merkez");
}

function createDefaultFilters(workingContext) {
  return {
    legalEntityId: String(toPositiveInt(workingContext?.legalEntityId) || ""),
    ownershipScope: "CENTRAL",
    operatingUnitId: "",
    status: "",
    postingDateFrom: "",
    postingDateTo: "",
    vendor: "",
    search: "",
  };
}

export default function InventoryLandedCostVouchersPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const { workingContext, legalEntities: workingContextLegalEntities } = useWorkingContext();
  const canRead = hasPermission("inventory.read");
  const canLandedCostUpsert = hasPermission("inventory.landed_cost.upsert");

  const [filters, setFilters] = useState(() => createDefaultFilters(workingContext));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [reverseState, setReverseState] = useState({
    open: false,
    voucher: null,
    reversalDate: todayDateOnly(),
    reverseReason: "",
    submitting: false,
    error: "",
  });

  const legalEntityOptions = useMemo(
    () =>
      (Array.isArray(workingContextLegalEntities) ? workingContextLegalEntities : [])
        .map(mapLegalEntityOption)
        .filter(Boolean),
    [workingContextLegalEntities]
  );

  useEffect(() => {
    setFilters((current) => ({
      ...current,
      legalEntityId:
        current.legalEntityId || String(toPositiveInt(workingContext?.legalEntityId) || ""),
      operatingUnitId:
        current.ownershipScope === "OPERATING_UNIT"
          ? current.operatingUnitId || String(toPositiveInt(workingContext?.operatingUnitId) || "")
          : "",
    }));
  }, [workingContext]);

  useEffect(() => {
    let active = true;

    async function loadOperatingUnitOptions() {
      if (!filters.legalEntityId) {
        setOperatingUnits([]);
        return;
      }
      try {
        const response = await listOperatingUnits({
          legalEntityId: filters.legalEntityId,
          limit: 500,
        });
        if (!active) {
          return;
        }
        setOperatingUnits(Array.isArray(response?.rows) ? response.rows : []);
      } catch {
        if (active) {
          setOperatingUnits([]);
        }
      }
    }

    void loadOperatingUnitOptions();
    return () => {
      active = false;
    };
  }, [filters.legalEntityId]);

  useEffect(() => {
    let active = true;

    async function loadRows() {
      if (!canRead) {
        setPageError(l("Missing permission: inventory.read", "Eksik yetki: inventory.read"));
        setRows([]);
        return;
      }

      setLoading(true);
      setPageError("");
      try {
        const response = await listInventoryLandedCostVouchers({
          legalEntityId: filters.legalEntityId || undefined,
          ownershipScope: filters.ownershipScope || undefined,
          operatingUnitId:
            filters.ownershipScope === "OPERATING_UNIT" ? filters.operatingUnitId || undefined : undefined,
          status: filters.status || undefined,
          postingDateFrom: filters.postingDateFrom || undefined,
          postingDateTo: filters.postingDateTo || undefined,
          vendor: filters.vendor || undefined,
          search: filters.search || undefined,
          limit: 150,
        });
        if (!active) {
          return;
        }
        setRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setPageError(
          normalizeApiError(
            error,
            l(
              "Failed to load landed-cost vouchers.",
              "Stok maliyet voucherleri yuklenemedi."
            )
          )
        );
        setRows([]);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadRows();
    return () => {
      active = false;
    };
  }, [canRead, filters, l]);

  function updateFilter(field, value) {
    setFilters((current) => {
      const next = { ...current, [field]: value };
      if (field === "ownershipScope" && value !== "OPERATING_UNIT") {
        next.operatingUnitId = "";
      }
      if (field === "legalEntityId" && value !== current.legalEntityId) {
        next.operatingUnitId = "";
      }
      return next;
    });
  }

  function openReverseDrawer(voucher) {
    setReverseState({
      open: true,
      voucher,
      reversalDate: todayDateOnly(),
      reverseReason: "",
      submitting: false,
      error: "",
    });
  }

  async function handleReverseConfirm() {
    if (!canLandedCostUpsert) {
      setReverseState((current) => ({
        ...current,
        error: l(
          "Missing permission: inventory.landed_cost.upsert",
          "Eksik yetki: inventory.landed_cost.upsert"
        ),
      }));
      return;
    }
    if (!reverseState.voucher?.voucherId) {
      return;
    }

    setReverseState((current) => ({
      ...current,
      submitting: true,
      error: "",
    }));
    try {
      await reverseInventoryLandedCostVoucher(reverseState.voucher.voucherId, {
        reversalDate: reverseState.reversalDate,
        reverseReason: reverseState.reverseReason,
      });
      setReverseState((current) => ({ ...current, open: false, submitting: false }));
      const response = await listInventoryLandedCostVouchers({
        legalEntityId: filters.legalEntityId || undefined,
        ownershipScope: filters.ownershipScope || undefined,
        operatingUnitId:
          filters.ownershipScope === "OPERATING_UNIT" ? filters.operatingUnitId || undefined : undefined,
        status: filters.status || undefined,
        postingDateFrom: filters.postingDateFrom || undefined,
        postingDateTo: filters.postingDateTo || undefined,
        vendor: filters.vendor || undefined,
        search: filters.search || undefined,
        limit: 150,
      });
      setRows(Array.isArray(response?.rows) ? response.rows : []);
    } catch (error) {
      setReverseState((current) => ({
        ...current,
        submitting: false,
        error: normalizeApiError(
          error,
          l("Failed to reverse voucher.", "Voucher ters kaydi yapilamadi.")
        ),
      }));
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            {l("Stock Landed Cost Vouchers", "Stok Maliyet Voucherleri")}
          </h1>
          <p className="text-sm text-slate-500">
            {l(
              "Allocate posted AP extra costs onto posted stock receipts.",
              "Kaydedilmis AP ek maliyetlerini kaydedilmis stok kabullerine dagitin."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!canLandedCostUpsert ? (
            <span className="text-sm text-amber-700">
              {l(
                "Missing permission: inventory.landed_cost.upsert",
                "Eksik yetki: inventory.landed_cost.upsert"
              )}
            </span>
          ) : null}
          <Link
            to="/app/stok-maliyet-voucherleri/yeni"
            className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold ${
              canLandedCostUpsert
                ? "bg-slate-900 text-white hover:bg-slate-700"
                : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
            }`}
            onClick={(event) => {
              if (!canLandedCostUpsert) {
                event.preventDefault();
              }
            }}
            title={
              !canLandedCostUpsert
                ? l(
                    "Missing permission: inventory.landed_cost.upsert",
                    "Eksik yetki: inventory.landed_cost.upsert"
                  )
                : ""
            }
          >
            {l("New Landed Cost Voucher", "Yeni stok maliyet voucheri")}
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {l("Legal Entity", "Tuzel kisilik")}
            </span>
            <select
              value={filters.legalEntityId}
              onChange={(event) => updateFilter("legalEntityId", event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
            >
              <option value="">{l("All legal entities", "Tum tuzel kisilikler")}</option>
              {legalEntityOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {l("Ownership Context", "Sahiplik baglami")}
            </span>
            <select
              value={filters.ownershipScope}
              onChange={(event) => updateFilter("ownershipScope", event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
            >
              <option value="CENTRAL">{l("Central", "Merkez")}</option>
              <option value="OPERATING_UNIT">{l("Operating Unit", "Isletme birimi")}</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {l("Operating Unit", "Isletme birimi")}
            </span>
            <select
              value={filters.operatingUnitId}
              disabled={filters.ownershipScope !== "OPERATING_UNIT"}
              onChange={(event) => updateFilter("operatingUnitId", event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">{l("All operating units", "Tum isletme birimleri")}</option>
              {(operatingUnits || []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code && row.name ? `${row.code} - ${row.name}` : row.code || row.name || `#${row.id}`}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {l("Status", "Durum")}
            </span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
            >
              <option value="">{l("All statuses", "Tum durumlar")}</option>
              <option value="DRAFT">{l("Draft", "Taslak")}</option>
              <option value="POSTED">{l("Posted", "Kaydedildi")}</option>
              <option value="REVERSED">{l("Reversed", "Ters kaydedildi")}</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {l("Posting Date From", "Kayit tarihi baslangic")}
            </span>
            <input
              type="date"
              value={filters.postingDateFrom}
              onChange={(event) => updateFilter("postingDateFrom", event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {l("Posting Date To", "Kayit tarihi bitis")}
            </span>
            <input
              type="date"
              value={filters.postingDateTo}
              onChange={(event) => updateFilter("postingDateTo", event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {l("Vendor", "Tedarikci")}
            </span>
            <input
              value={filters.vendor}
              onChange={(event) => updateFilter("vendor", event.target.value)}
              placeholder={l("Vendor name or code", "Tedarikci adi veya kodu")}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              {l("Search", "Arama")}
            </span>
            <input
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder={l("Voucher, bill, vendor, source line, receipt", "Voucher, fatura, tedarikci, kaynak satir, kabul")}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
            />
          </label>
        </div>
      </section>

      {pageError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {pageError}
        </div>
      ) : null}

      {!canRead ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {l("Missing permission: inventory.read", "Eksik yetki: inventory.read")}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Landed Cost Voucher List", "Stok maliyet voucher listesi")}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{l("Voucher No", "Voucher no")}</th>
                <th className="px-4 py-3">{l("Posting Date", "Kayit tarihi")}</th>
                <th className="px-4 py-3">{l("Legal Entity", "Tuzel kisilik")}</th>
                <th className="px-4 py-3">{l("Context", "Baglam")}</th>
                <th className="px-4 py-3 text-right">{l("Source Amount", "Kaynak tutari")}</th>
                <th className="px-4 py-3 text-right">{l("Capitalized", "Aktiflesen")}</th>
                <th className="px-4 py-3 text-right">{l("Consumed", "Tuketilen")}</th>
                <th className="px-4 py-3">{l("Status", "Durum")}</th>
                <th className="px-4 py-3 text-right">{l("Source Bills", "Kaynak fatura")}</th>
                <th className="px-4 py-3 text-right">{l("Targets", "Hedef")}</th>
                <th className="px-4 py-3">{l("Created By", "Olusturan")}</th>
                <th className="px-4 py-3 text-right">{l("Actions", "Islemler")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">
                    {l("Loading vouchers...", "Voucherler yukleniyor...")}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">
                    {l("No landed-cost vouchers found.", "Stok maliyet voucheri bulunamadi.")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const reverseBlocked =
                    row.hasReversalDependencies || String(row.status || "").toUpperCase() !== "POSTED";
                  return (
                    <tr
                      key={row.voucherId}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => navigate(`/app/stok-maliyet-voucherleri/${row.voucherId}`)}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">{row.voucherNo || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">{row.postingDate || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.legalEntityCode && row.legalEntityName
                          ? `${row.legalEntityCode} - ${row.legalEntityName}`
                          : row.legalEntityCode || row.legalEntityName || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{getOwnershipLabel(row, l)}</td>
                      <td className="px-4 py-3 text-right text-slate-900">
                        <MoneyText amount={row.sourceAmountBase} showCurrency={false} />
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        <MoneyText amount={row.capitalizedAmountBase} showCurrency={false} />
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">
                        <MoneyText amount={row.consumedAmountBase} showCurrency={false} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(
                            row.uiStatus || row.status
                          )}`}
                        >
                          {getStatusLabel(row.uiStatus || row.status, l)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.sourceBillCount || 0}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.targetCount || 0}</td>
                      <td className="px-4 py-3 text-slate-700">{row.createdByName || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/app/stok-maliyet-voucherleri/${row.voucherId}`);
                            }}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
                          >
                            {l("View", "Goruntule")}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openReverseDrawer(row);
                            }}
                            disabled={reverseBlocked || !canLandedCostUpsert}
                            title={
                              row.hasReversalDependencies
                                ? l("Blocked by downstream dependency", "Asagi bagimlilik nedeniyle bloklu")
                                : !canLandedCostUpsert
                                  ? l(
                                      "Missing permission: inventory.landed_cost.upsert",
                                      "Eksik yetki: inventory.landed_cost.upsert"
                                    )
                                  : ""
                            }
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              reverseBlocked || !canLandedCostUpsert
                                ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                                : "bg-rose-600 text-white hover:bg-rose-700"
                            }`}
                          >
                            {l("Reverse", "Ters kayit")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reverseState.open ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/20">
          <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Reverse Landed Cost Voucher", "Stok maliyet voucher ters kaydi")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{reverseState.voucher?.voucherNo || "-"}</p>
              </div>
              <button
                type="button"
                onClick={() => setReverseState((current) => ({ ...current, open: false }))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
              >
                {l("Close", "Kapat")}
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{l("Capitalized", "Aktiflesen")}</div>
                    <div className="mt-1 font-medium text-slate-900">
                      <MoneyText amount={reverseState.voucher?.capitalizedAmountBase || 0} showCurrency={false} />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{l("Consumed", "Tuketilen")}</div>
                    <div className="mt-1 font-medium text-slate-900">
                      <MoneyText amount={reverseState.voucher?.consumedAmountBase || 0} showCurrency={false} />
                    </div>
                  </div>
                </div>
              </div>

              {reverseState.voucher?.hasReversalDependencies ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
                  {l(
                    "Blocked because one or more capitalized landed-cost balances were later consumed or transferred.",
                    "Bir veya daha fazla aktifleştirilmis stok maliyet bakiyesi daha sonra tuketildigi veya transfer edildigi icin bloklu."
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                  {l(
                    "This voucher can be reversed because no downstream dependency was found on capitalized landed-cost balances.",
                    "Bu voucher ters kaydedilebilir; aktifleştirilmis stok maliyet bakiyelerinde asagi bagimlilik bulunmadi."
                  )}
                </div>
              )}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Reversal Date", "Ters kayit tarihi")}
                </span>
                <input
                  type="date"
                  value={reverseState.reversalDate}
                  onChange={(event) =>
                    setReverseState((current) => ({ ...current, reversalDate: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {l("Reason", "Neden")}
                </span>
                <textarea
                  rows={4}
                  value={reverseState.reverseReason}
                  onChange={(event) =>
                    setReverseState((current) => ({ ...current, reverseReason: event.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                />
              </label>

              {reverseState.error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700">
                  {reverseState.error}
                </div>
              ) : null}
            </div>
            <div className="mt-auto flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setReverseState((current) => ({ ...current, open: false }))}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              >
                {l("Cancel", "Vazgec")}
              </button>
              <button
                type="button"
                onClick={handleReverseConfirm}
                disabled={
                  !canLandedCostUpsert
                  || reverseState.submitting
                  || reverseState.voucher?.hasReversalDependencies
                }
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  canLandedCostUpsert
                  && !reverseState.submitting
                  && !reverseState.voucher?.hasReversalDependencies
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                }`}
              >
                {reverseState.submitting
                  ? l("Reversing...", "Ters kaydediliyor...")
                  : l("Confirm Reverse", "Ters kaydi onayla")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
