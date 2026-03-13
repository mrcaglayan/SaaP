import { useEffect, useMemo, useState } from "react";
import Combobox from "../../components/Combobox.jsx";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import {
  createItemCard,
  listItemCards,
  updateItemCard,
} from "../../api/itemCards.js";
import { listAccounts } from "../../api/glAdmin.js";
import { listTaxRules } from "../../api/taxAdmin.js";

const ITEM_TYPES = ["SERVICE", "NON_STOCK_GOOD", "STOCK_ITEM"];
const STATUS_VALUES = ["ACTIVE", "INACTIVE"];

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

function createInitialForm() {
  return {
    legalEntityId: "",
    code: "",
    name: "",
    itemType: "SERVICE",
    defaultSalesAccountId: "",
    defaultPurchaseAccountId: "",
    inventoryAssetAccountId: "",
    inventoryTransitAccountId: "",
    defaultCogsAccountId: "",
    taxCategoryCode: "",
    status: "ACTIVE",
  };
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

function mapAccountRows(responseRows = []) {
  return (Array.isArray(responseRows) ? responseRows : [])
    .filter((row) => {
      const isActive = row?.is_active === true || Number(row?.is_active) === 1;
      const allowPosting = row?.allow_posting === true || Number(row?.allow_posting) === 1;
      return isActive && allowPosting;
    })
    .map((row) => ({
      id: Number(row?.id || 0),
      code: String(row?.code || "").trim(),
      name: String(row?.name || "").trim(),
      accountType: String(row?.account_type || "").trim().toUpperCase(),
    }))
    .filter((row) => row.id > 0 && row.code)
    .sort((left, right) =>
      String(left.code || "").localeCompare(String(right.code || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
}

function mapItemCardRowToForm(row) {
  return {
    legalEntityId: String(row?.legalEntityId || ""),
    code: String(row?.code || ""),
    name: String(row?.name || ""),
    itemType: String(row?.itemType || "SERVICE"),
    defaultSalesAccountId: String(row?.defaultSalesAccountId || ""),
    defaultPurchaseAccountId: String(row?.defaultPurchaseAccountId || ""),
    inventoryAssetAccountId: String(row?.inventoryAssetAccountId || ""),
    inventoryTransitAccountId: String(row?.inventoryTransitAccountId || ""),
    defaultCogsAccountId: String(row?.defaultCogsAccountId || ""),
    taxCategoryCode: String(row?.taxCategoryCode || ""),
    status: String(row?.status || "ACTIVE"),
  };
}

function buildPayload(form) {
  return {
    legalEntityId: toPositiveInt(form.legalEntityId) || undefined,
    code: normalizeText(form.code).toUpperCase(),
    name: normalizeText(form.name),
    itemType: normalizeText(form.itemType).toUpperCase(),
    defaultSalesAccountId: toPositiveInt(form.defaultSalesAccountId) || undefined,
    defaultPurchaseAccountId: toPositiveInt(form.defaultPurchaseAccountId) || undefined,
    inventoryAssetAccountId: toPositiveInt(form.inventoryAssetAccountId) || undefined,
    inventoryTransitAccountId: toPositiveInt(form.inventoryTransitAccountId) || undefined,
    defaultCogsAccountId: toPositiveInt(form.defaultCogsAccountId) || undefined,
    taxCategoryCode: normalizeText(form.taxCategoryCode).toUpperCase() || undefined,
    status: normalizeText(form.status).toUpperCase(),
  };
}

export default function ItemCardsPage({ pageKey = "list" }) {
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const { legalEntities: workingContextLegalEntities } = useWorkingContext();

  const canRead = hasPermission("item.card.read");
  const canUpsert = hasPermission("item.card.upsert");
  const canReadGlAccounts = hasPermission("gl.account.read");
  const canReadTaxSetup = hasPermission("org.tree.read");

  const legalEntityOptions = useMemo(
    () =>
      (Array.isArray(workingContextLegalEntities) ? workingContextLegalEntities : [])
        .map(mapLegalEntityLookupOption)
        .filter(Boolean),
    [workingContextLegalEntities]
  );

  const [filters, setFilters] = useState({
    legalEntityId: "",
    status: "ACTIVE",
    itemType: "",
    q: "",
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [form, setForm] = useState(() => createInitialForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [accountRows, setAccountRows] = useState([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [taxRuleRows, setTaxRuleRows] = useState([]);
  const [taxCategoryError, setTaxCategoryError] = useState("");

  useEffect(() => {
    if (pageKey === "create" && !filters.legalEntityId && legalEntityOptions.length === 1) {
      const onlyValue = legalEntityOptions[0]?.value || "";
      setFilters((previous) => ({ ...previous, legalEntityId: onlyValue }));
      setForm((previous) => ({ ...previous, legalEntityId: onlyValue }));
    }
  }, [legalEntityOptions, pageKey, filters.legalEntityId]);

  useEffect(() => {
    if (!canRead) {
      setRows([]);
      setLoading(false);
      setListError(l("Missing permission: item.card.read", "Eksik yetki: item.card.read"));
      return;
    }

    let active = true;
    async function loadRows() {
      setLoading(true);
      setListError("");
      try {
        const response = await listItemCards({
          legalEntityId: filters.legalEntityId || undefined,
          status: filters.status || undefined,
          itemType: filters.itemType || undefined,
          q: filters.q || undefined,
          limit: 200,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setRows([]);
        setListError(
          normalizeApiError(
            error,
            l("Failed to load item cards.", "Urun kartlari yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadRows();
    return () => {
      active = false;
    };
  }, [canRead, filters, l]);

  useEffect(() => {
    const legalEntityId = toPositiveInt(form.legalEntityId);
    setAccountError("");
    if (!canReadGlAccounts || !legalEntityId) {
      setAccountRows([]);
      setAccountLoading(false);
      return;
    }

    let active = true;
    async function loadAccounts() {
      setAccountLoading(true);
      try {
        const response = await listAccounts({
          legalEntityId,
          includeInactive: false,
          limit: 1000,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setAccountRows(mapAccountRows(response?.rows));
      } catch (error) {
        if (!active) {
          return;
        }
        setAccountRows([]);
        setAccountError(
          normalizeApiError(
            error,
            l("Failed to load account options.", "Hesap secenekleri yuklenemedi.")
          )
        );
      } finally {
        if (active) {
          setAccountLoading(false);
        }
      }
    }

    loadAccounts();
    return () => {
      active = false;
    };
  }, [canReadGlAccounts, form.legalEntityId, l]);

  useEffect(() => {
    setTaxCategoryError("");
    if (!canReadTaxSetup) {
      setTaxRuleRows([]);
      return;
    }

    let active = true;
    async function loadTaxRules() {
      try {
        const response = await listTaxRules({
          moduleCode: "CARI",
          status: "ACTIVE",
          limit: 500,
          offset: 0,
        });
        if (!active) {
          return;
        }
        setTaxRuleRows(Array.isArray(response?.rows) ? response.rows : []);
      } catch (error) {
        if (!active) {
          return;
        }
        setTaxRuleRows([]);
        setTaxCategoryError(
          normalizeApiError(
            error,
            l("Failed to load tax category options.", "Vergi kategori secenekleri yuklenemedi.")
          )
        );
      }
    }

    loadTaxRules();
    return () => {
      active = false;
    };
  }, [canReadTaxSetup, l]);

  const accountOptions = useMemo(() => {
    const optionIds = new Set(accountRows.map((row) => Number(row.id || 0)));
    const selectedIds = [
      form.defaultSalesAccountId,
      form.defaultPurchaseAccountId,
      form.inventoryAssetAccountId,
      form.inventoryTransitAccountId,
      form.defaultCogsAccountId,
    ]
      .map((value) => Number(value || 0))
      .filter((id) => Number.isInteger(id) && id > 0);
    const nextRows = [...accountRows];
    selectedIds.forEach((id) => {
      if (!optionIds.has(id)) {
        nextRows.unshift({
          id,
          code: `#${id}`,
          name: "Selected account is outside current lookup scope.",
          accountType: "",
        });
        optionIds.add(id);
      }
    });
    return nextRows;
  }, [
    accountRows,
    form.defaultCogsAccountId,
    form.defaultPurchaseAccountId,
    form.defaultSalesAccountId,
    form.inventoryAssetAccountId,
    form.inventoryTransitAccountId,
  ]);

  const taxCategoryOptions = useMemo(() => {
    const selectedLegalEntityId = toPositiveInt(form.legalEntityId);
    const values = new Set();
    for (const row of taxRuleRows) {
      const taxCategoryCode = normalizeText(row?.taxCategoryCode).toUpperCase();
      if (!taxCategoryCode) {
        continue;
      }
      const regimeLegalEntityId = toPositiveInt(row?.regimeLegalEntityId);
      if (
        selectedLegalEntityId &&
        regimeLegalEntityId &&
        regimeLegalEntityId !== selectedLegalEntityId
      ) {
        continue;
      }
      values.add(taxCategoryCode);
    }

    const selectedValue = normalizeText(form.taxCategoryCode).toUpperCase();
    if (selectedValue) {
      values.add(selectedValue);
    }

    return Array.from(values)
      .sort((left, right) =>
        left.localeCompare(right, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      )
      .map((value) => ({ value, label: value }));
  }, [form.legalEntityId, form.taxCategoryCode, taxRuleRows]);

  function resetForm(nextLegalEntityId = form.legalEntityId) {
    setSelectedRow(null);
    setForm({
      ...createInitialForm(),
      legalEntityId: nextLegalEntityId || "",
    });
    setFormError("");
    setFormMessage("");
  }

  function validateForm() {
    const payload = buildPayload(form);
    const errors = [];
    if (!payload.code) {
      errors.push(l("Code is required.", "Kod zorunludur."));
    }
    if (!payload.name) {
      errors.push(l("Name is required.", "Ad zorunludur."));
    }
    if (!ITEM_TYPES.includes(payload.itemType)) {
      errors.push(l("Item type is invalid.", "Urun tipi gecersiz."));
    }
    if (!STATUS_VALUES.includes(payload.status)) {
      errors.push(l("Status is invalid.", "Durum gecersiz."));
    }
    return { payload, errors };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canUpsert) {
      setFormError(l("Missing permission: item.card.upsert", "Eksik yetki: item.card.upsert"));
      return;
    }
    const { payload, errors } = validateForm();
    if (errors.length > 0) {
      setFormError(errors.join(" "));
      return;
    }
    setSaving(true);
    setFormError("");
    setFormMessage("");
    try {
      const response = selectedRow?.id
        ? await updateItemCard(selectedRow.id, payload)
        : await createItemCard(payload);
      const nextRow = response?.row || null;
      setFormMessage(
        selectedRow?.id
          ? l("Item card updated.", "Urun karti guncellendi.")
          : l("Item card created.", "Urun karti olusturuldu.")
      );
      if (nextRow) {
        setSelectedRow(nextRow);
        setForm(mapItemCardRowToForm(nextRow));
      }
      const refreshed = await listItemCards({
        legalEntityId: filters.legalEntityId || undefined,
        status: filters.status || undefined,
        itemType: filters.itemType || undefined,
        q: filters.q || undefined,
        limit: 200,
        offset: 0,
      });
      setRows(Array.isArray(refreshed?.rows) ? refreshed.rows : []);
    } catch (error) {
      setFormError(
        normalizeApiError(
          error,
          l("Failed to save item card.", "Urun karti kaydedilemedi.")
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {l("Item Cards", "Urun Kartlari")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "Reusable finance-first item masters for CARI lines. They can default tax and account mappings before full inventory exists.",
            "Tam envanter gelmeden once CARI satirlari icin vergi ve hesap varsayilanlari verebilen finans odakli urun kartlari."
          )}
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Filters", "Filtreler")}
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity", "Tuzel Kisilik")}
              <Combobox
                className="mt-1"
                value={filters.legalEntityId}
                options={legalEntityOptions}
                placeholder={l("Search legal entity", "Tuzel kisilik ara")}
                noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                onChange={(nextValue) =>
                  setFilters((previous) => ({
                    ...previous,
                    legalEntityId: nextValue ? String(nextValue) : "",
                  }))
                }
              />
            </label>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Item Type", "Urun Tipi")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.itemType}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, itemType: event.target.value }))
              }
            >
              <option value="">{l("All", "Tumleri")}</option>
              {ITEM_TYPES.map((itemType) => (
                <option key={`filter-item-type-${itemType}`} value={itemType}>
                  {itemType}
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
                setFilters((previous) => ({ ...previous, status: event.target.value }))
              }
            >
              <option value="">{l("All", "Tumleri")}</option>
              {STATUS_VALUES.map((status) => (
                <option key={`filter-item-status-${status}`} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Search", "Ara")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={filters.q}
              onChange={(event) =>
                setFilters((previous) => ({ ...previous, q: event.target.value }))
              }
              placeholder={l("code / name", "kod / ad")}
            />
          </label>
        </div>
        {listError ? <p className="mt-3 text-sm text-rose-700">{listError}</p> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {selectedRow?.id
              ? l("Edit Item Card", "Urun Kartini Duzenle")
              : l("Create Item Card", "Urun Karti Olustur")}
          </h2>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
            onClick={() => resetForm()}
            disabled={saving}
          >
            {l("Reset", "Sifirla")}
          </button>
        </div>
        {formError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</div> : null}
        {formMessage ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{formMessage}</div> : null}
        {accountError ? <p className="mt-3 text-sm text-amber-700">{accountError}</p> : null}
        {taxCategoryError ? <p className="mt-3 text-sm text-amber-700">{taxCategoryError}</p> : null}
        <form className="mt-3 grid gap-3 md:grid-cols-4" onSubmit={handleSubmit}>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            <label className="block">
              {l("Legal Entity (optional)", "Tuzel Kisilik (opsiyonel)")}
              <Combobox
                className="mt-1"
                value={form.legalEntityId}
                options={legalEntityOptions}
                placeholder={l("Search legal entity", "Tuzel kisilik ara")}
                noOptionsText={l("No legal entities found.", "Tuzel kisilik bulunamadi.")}
                onChange={(nextValue) =>
                  setForm((previous) => ({
                    ...previous,
                    legalEntityId: nextValue ? String(nextValue) : "",
                  }))
                }
                disabled={saving}
              />
            </label>
          </div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Code", "Kod")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
              value={form.code}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, code: event.target.value }))
              }
              disabled={saving}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Name", "Ad")}
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.name}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, name: event.target.value }))
              }
              disabled={saving}
              required
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Item Type", "Urun Tipi")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.itemType}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, itemType: event.target.value }))
              }
              disabled={saving}
            >
              {ITEM_TYPES.map((itemType) => (
                <option key={`form-item-type-${itemType}`} value={itemType}>
                  {itemType}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Sales Account (optional)", "Satis Hesabi (opsiyonel)")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.defaultSalesAccountId}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  defaultSalesAccountId: event.target.value,
                }))
              }
              disabled={saving || accountLoading || !canReadGlAccounts}
            >
              <option value="">{l("None", "Yok")}</option>
              {accountOptions.map((row) => (
                <option key={`sales-account-${row.id}`} value={String(row.id)}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Purchase Account (optional)", "Alim Hesabi (opsiyonel)")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.defaultPurchaseAccountId}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  defaultPurchaseAccountId: event.target.value,
                }))
              }
              disabled={saving || accountLoading || !canReadGlAccounts}
            >
              <option value="">{l("None", "Yok")}</option>
              {accountOptions.map((row) => (
                <option key={`purchase-account-${row.id}`} value={String(row.id)}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Inventory Asset Account (optional)", "Stok Varlik Hesabi (opsiyonel)")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.inventoryAssetAccountId}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  inventoryAssetAccountId: event.target.value,
                }))
              }
              disabled={saving || accountLoading || !canReadGlAccounts}
            >
              <option value="">{l("None", "Yok")}</option>
              {accountOptions.map((row) => (
                <option key={`inventory-account-${row.id}`} value={String(row.id)}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Inventory Transit Account (optional)", "Stok Transit Hesabi (opsiyonel)")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.inventoryTransitAccountId}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  inventoryTransitAccountId: event.target.value,
                }))
              }
              disabled={saving || accountLoading || !canReadGlAccounts}
            >
              <option value="">{l("None", "Yok")}</option>
              {accountOptions.map((row) => (
                <option key={`inventory-transit-account-${row.id}`} value={String(row.id)}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("COGS Account (optional)", "Maliyet Hesabi (opsiyonel)")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.defaultCogsAccountId}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  defaultCogsAccountId: event.target.value,
                }))
              }
              disabled={saving || accountLoading || !canReadGlAccounts}
            >
              <option value="">{l("None", "Yok")}</option>
              {accountOptions.map((row) => (
                <option key={`cogs-account-${row.id}`} value={String(row.id)}>
                  {row.code} - {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Tax Category Code (optional)", "Vergi Kategori Kodu (opsiyonel)")}
            {taxCategoryOptions.length > 0 ? (
              <select
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
                value={form.taxCategoryCode}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    taxCategoryCode: event.target.value,
                  }))
                }
                disabled={saving}
              >
                <option value="">{l("None", "Yok")}</option>
                {taxCategoryOptions.map((option) => (
                  <option key={`tax-category-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal uppercase"
                value={form.taxCategoryCode}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    taxCategoryCode: event.target.value,
                  }))
                }
                disabled={saving}
              />
            )}
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {l("Status", "Durum")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
              value={form.status}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, status: event.target.value }))
              }
              disabled={saving}
            >
              {STATUS_VALUES.map((status) => (
                <option key={`form-status-${status}`} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <div className="md:col-span-4 flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={!canUpsert || saving}
            >
              {saving
                ? l("Saving...", "Kaydediliyor...")
                : selectedRow?.id
                  ? l("Update Item Card", "Urun Kartini Guncelle")
                  : l("Create Item Card", "Urun Karti Olustur")}
            </button>
            {!canUpsert ? (
              <p className="self-center text-sm text-slate-500">
                {l("Missing permission: item.card.upsert", "Eksik yetki: item.card.upsert")}
              </p>
            ) : null}
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Item Card List", "Urun Karti Listesi")}
        </h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-600">
            {l("Loading item cards...", "Urun kartlari yukleniyor...")}
          </p>
        ) : null}
        {!loading && rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            {l("No item cards found for the current filters.", "Guncel filtrelerde urun karti bulunamadi.")}
          </p>
        ) : null}
        {!loading && rows.length > 0 ? (
          <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">{l("Code", "Kod")}</th>
                  <th className="px-3 py-2">{l("Name", "Ad")}</th>
                  <th className="px-3 py-2">{l("Type", "Tip")}</th>
                  <th className="px-3 py-2">{l("Entity", "Tuzel Kisilik")}</th>
                  <th className="px-3 py-2">{l("Tax Category", "Vergi Kategorisi")}</th>
                  <th className="px-3 py-2">{l("Status", "Durum")}</th>
                  <th className="px-3 py-2 text-right">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`item-card-row-${row.id}`} className="border-t border-slate-100">
                    <td className="px-3 py-2">{row.code || "-"}</td>
                    <td className="px-3 py-2">{row.name || "-"}</td>
                    <td className="px-3 py-2">{row.itemType || "-"}</td>
                    <td className="px-3 py-2">{row.legalEntityId || "-"}</td>
                    <td className="px-3 py-2">{row.taxCategoryCode || "-"}</td>
                    <td className="px-3 py-2">{row.status || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-60"
                        onClick={() => {
                          setSelectedRow(row);
                          setForm(mapItemCardRowToForm(row));
                          setFormError("");
                          setFormMessage("");
                        }}
                        disabled={!canUpsert}
                      >
                        {l("Edit", "Duzenle")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
