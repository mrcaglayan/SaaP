import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Combobox from "../components/Combobox.jsx";
import { listBooks } from "../api/glAdmin.js";
import { createLocalClosePack, listLocalClosePacks } from "../api/localClosePacks.js";
import { listFiscalPeriods, listLegalEntities, listOperatingUnits } from "../api/orgAdmin.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";

const STATUS_OPTIONS = Object.freeze([
  ["", "All statuses"],
  ["NOT_OPENED", "Not opened"],
  ["OPEN", "Open"],
  ["IN_PROGRESS", "In progress"],
  ["READY_FOR_REVIEW", "Ready for review"],
  ["RETURNED", "Returned"],
  ["APPROVED", "Approved"],
  ["LOCKED", "Locked"],
  ["REOPENED", "Reopened"],
]);

const SCOPE_OPTIONS = Object.freeze([
  ["", "All scopes"],
  ["CENTRAL", "HQ / Central"],
  ["OPERATING_UNIT", "Operating unit"],
]);

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function formatPeriodLabel(row) {
  if (!row) {
    return "-";
  }
  return `FY${row.fiscal_year} P${String(row.period_no).padStart(2, "0")} - ${row.period_name}`;
}

function hasRowId(rows, id) {
  return rows.some((row) => Number(row?.id) === Number(id));
}

function normalizeScopeType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return SCOPE_OPTIONS.some(([optionValue]) => optionValue === normalized)
    ? normalized
    : "";
}

function normalizeStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return STATUS_OPTIONS.some(([optionValue]) => optionValue === normalized)
    ? normalized
    : "";
}

function createInitialFilters(searchParams) {
  const params = searchParams || new URLSearchParams();
  return {
    legalEntityId: String(toPositiveInt(params.get("legalEntityId")) || ""),
    bookId: String(toPositiveInt(params.get("bookId")) || ""),
    fiscalPeriodId: String(toPositiveInt(params.get("fiscalPeriodId")) || ""),
    closeScopeType: normalizeScopeType(params.get("closeScopeType")),
    status: normalizeStatus(params.get("status")),
    q: String(params.get("q") || "").trim(),
  };
}

function buildWorkspaceSearchParams(filters) {
  const nextParams = new URLSearchParams();
  if (toPositiveInt(filters?.legalEntityId)) {
    nextParams.set("legalEntityId", String(toPositiveInt(filters.legalEntityId)));
  }
  if (toPositiveInt(filters?.bookId)) {
    nextParams.set("bookId", String(toPositiveInt(filters.bookId)));
  }
  if (toPositiveInt(filters?.fiscalPeriodId)) {
    nextParams.set("fiscalPeriodId", String(toPositiveInt(filters.fiscalPeriodId)));
  }
  if (normalizeScopeType(filters?.closeScopeType)) {
    nextParams.set("closeScopeType", normalizeScopeType(filters.closeScopeType));
  }
  if (normalizeStatus(filters?.status)) {
    nextParams.set("status", normalizeStatus(filters.status));
  }
  if (String(filters?.q || "").trim()) {
    nextParams.set("q", String(filters.q).trim());
  }
  return nextParams;
}

function buildPackDetailPath(packId) {
  return `/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri/${packId}`;
}

function getStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "APPROVED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "LOCKED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "READY_FOR_REVIEW":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "RETURNED":
    case "REOPENED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "NOT_OPENED":
      return l("Not opened", "Acilmadi");
    case "OPEN":
      return l("Open", "Acik");
    case "IN_PROGRESS":
      return l("In progress", "Devam ediyor");
    case "READY_FOR_REVIEW":
      return l("Ready for review", "Incelemeye hazir");
    case "RETURNED":
      return l("Returned", "Iade edildi");
    case "APPROVED":
      return l("Approved", "Onaylandi");
    case "LOCKED":
      return l("Locked", "Kilitlendi");
    case "REOPENED":
      return l("Reopened", "Yeniden acildi");
    default:
      return status || "-";
  }
}

function formatScopeLabel(row, l) {
  if (String(row?.closeScopeType || "").toUpperCase() === "OPERATING_UNIT") {
    const code = String(row?.operatingUnitCode || "").trim();
    const name = String(row?.operatingUnitName || "").trim();
    return code && name ? `${code} - ${name}` : code || name || l("Operating unit", "Isletme birimi");
  }
  return l("HQ / Central", "Merkez / HQ");
}

/**
 * First-pass RP07 local close workspace shell.
 */
export default function LocalCloseWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const { language } = useI18n();
  const isTr = language === "tr";
  const l = useCallback((en, tr) => (isTr ? tr : en), [isTr]);

  const canRead = hasPermission("ouclose.read");
  const canPrepare = hasPermission("ouclose.prepare");
  const canReadEntities = hasPermission("org.tree.read");
  const canReadBooks = hasPermission("gl.book.read");
  const canReadPeriods = hasPermission("org.fiscal_period.read");
  const hasLookupReads = canReadEntities && canReadBooks && canReadPeriods;

  const [filters, setFilters] = useState(() => createInitialFilters(searchParams));
  const [createForm, setCreateForm] = useState({
    closeScopeType: "CENTRAL",
    operatingUnitId: "",
    note: "",
  });
  const [legalEntities, setLegalEntities] = useState([]);
  const [books, setBooks] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [operatingUnits, setOperatingUnits] = useState([]);
  const [rows, setRows] = useState([]);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  const selectedLegalEntityId = toPositiveInt(filters.legalEntityId);
  const selectedBookId = toPositiveInt(filters.bookId);
  const selectedPeriodId = toPositiveInt(filters.fiscalPeriodId);
  const selectedBook = useMemo(
    () => books.find((row) => Number(row?.id) === Number(selectedBookId)) || null,
    [books, selectedBookId]
  );

  useEffect(() => {
    const nextFilters = createInitialFilters(searchParams);
    setFilters((prev) =>
      JSON.stringify(prev) === JSON.stringify(nextFilters) ? prev : nextFilters
    );
  }, [searchParams]);

  useEffect(() => {
    const nextParams = buildWorkspaceSearchParams(filters);
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [filters, searchParams, setSearchParams]);

  useEffect(() => {
    if (!canRead || !hasLookupReads) {
      return undefined;
    }
    let cancelled = false;
    async function loadReferences() {
      setLoadingRefs(true);
      try {
        const [entityResponse, bookResponse, operatingUnitResponse] = await Promise.all([
          listLegalEntities({ limit: 500, includeInactive: true }),
          listBooks(selectedLegalEntityId ? { legalEntityId: selectedLegalEntityId } : {}),
          selectedLegalEntityId
            ? listOperatingUnits({
                legalEntityId: selectedLegalEntityId,
                limit: 500,
                includeInactive: true,
              })
            : Promise.resolve({ rows: [] }),
        ]);
        if (cancelled) {
          return;
        }
        const nextEntities = Array.isArray(entityResponse?.rows) ? entityResponse.rows : [];
        const nextBooks = Array.isArray(bookResponse?.rows) ? bookResponse.rows : [];
        const nextOperatingUnits = Array.isArray(operatingUnitResponse?.rows)
          ? operatingUnitResponse.rows
          : [];
        setLegalEntities(nextEntities);
        setBooks(nextBooks);
        setOperatingUnits(nextOperatingUnits);
        setFilters((prev) => {
          const next = { ...prev };
          if (!hasRowId(nextEntities, prev.legalEntityId)) {
            next.legalEntityId = String(nextEntities[0]?.id || "");
          }
          if (!hasRowId(nextBooks, prev.bookId)) {
            next.bookId = String(nextBooks[0]?.id || "");
          }
          return next;
        });
        setCreateForm((prev) => ({
          ...prev,
          operatingUnitId: hasRowId(nextOperatingUnits, prev.operatingUnitId)
            ? prev.operatingUnitId
            : String(nextOperatingUnits[0]?.id || ""),
        }));
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
              l("Failed to load local close references.", "Yerel kapanis referanslari yuklenemedi.")
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingRefs(false);
        }
      }
    }
    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, [canRead, hasLookupReads, l, selectedLegalEntityId]);

  useEffect(() => {
    if (!canRead || !hasLookupReads) {
      return undefined;
    }
    let cancelled = false;
    async function loadPeriods() {
      const calendarId = toPositiveInt(selectedBook?.calendar_id);
      if (!selectedBookId || !calendarId) {
        setPeriods([]);
        return;
      }
      try {
        const response = await listFiscalPeriods(calendarId, { limit: 500 });
        if (cancelled) {
          return;
        }
        const nextPeriods = Array.isArray(response?.rows) ? response.rows : [];
        setPeriods(nextPeriods);
        setFilters((prev) => ({
          ...prev,
          fiscalPeriodId: hasRowId(nextPeriods, prev.fiscalPeriodId)
            ? prev.fiscalPeriodId
            : String(nextPeriods[0]?.id || ""),
        }));
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
              l("Failed to load fiscal periods.", "Mali donemler yuklenemedi.")
          );
        }
      }
    }
    void loadPeriods();
    return () => {
      cancelled = true;
    };
  }, [canRead, hasLookupReads, l, selectedBook, selectedBookId]);

  useEffect(() => {
    if (!canRead) {
      return undefined;
    }
    let cancelled = false;
    async function loadRows() {
      setLoadingRows(true);
      setError("");
      try {
        const response = await listLocalClosePacks({
          legalEntityId: selectedLegalEntityId || undefined,
          bookId: selectedBookId || undefined,
          fiscalPeriodId: selectedPeriodId || undefined,
          closeScopeType: filters.closeScopeType || undefined,
          status: filters.status || undefined,
          q: String(filters.q || "").trim() || undefined,
          limit: 200,
        });
        if (!cancelled) {
          setRows(Array.isArray(response?.rows) ? response.rows : []);
        }
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setError(
            err?.response?.data?.message ||
              l("Failed to load local close packs.", "Yerel kapanis paketleri yuklenemedi.")
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingRows(false);
        }
      }
    }
    void loadRows();
    return () => {
      cancelled = true;
    };
  }, [
    canRead,
    filters.closeScopeType,
    filters.q,
    filters.status,
    l,
    reloadNonce,
    selectedBookId,
    selectedLegalEntityId,
    selectedPeriodId,
  ]);

  const legalEntityOptions = legalEntities.map((row) => ({
    value: String(row.id),
    label: row.code ? `${row.code} - ${row.name}` : row.name || String(row.id),
    description: l("Legal entity", "Yasal varlik"),
  }));
  const bookOptions = books.map((row) => ({
    value: String(row.id),
    label: row.code ? `${row.code} - ${row.name}` : row.name || String(row.id),
    description: String(row.base_currency_code || "").toUpperCase(),
  }));
  const periodOptions = periods.map((row) => ({
    value: String(row.id),
    label: formatPeriodLabel(row),
    description: `${String(row.start_date || "").slice(0, 10)} -> ${String(row.end_date || "").slice(0, 10)}`,
  }));
  const operatingUnitOptions = operatingUnits.map((row) => ({
    value: String(row.id),
    label: row.code ? `${row.code} - ${row.name}` : row.name || String(row.id),
    description: l("Operating unit", "Isletme birimi"),
  }));

  async function handleCreatePack(event) {
    event.preventDefault();
    if (!canPrepare) {
      return;
    }
    const requestedScopeType = createForm.closeScopeType;
    const requestedOperatingUnitId =
      requestedScopeType === "OPERATING_UNIT"
        ? toPositiveInt(createForm.operatingUnitId)
        : null;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const response = await createLocalClosePack({
        legalEntityId: selectedLegalEntityId,
        bookId: selectedBookId,
        fiscalPeriodId: selectedPeriodId,
        closeScopeType: requestedScopeType,
        operatingUnitId: requestedOperatingUnitId || undefined,
        note: String(createForm.note || "").trim() || undefined,
      });
      const createdRow = response?.row || null;
      setMessage(
        l("Local close pack created.", "Yerel kapanis paketi olusturuldu.")
      );
      if (createdRow?.id) {
        window.location.assign(buildPackDetailPath(createdRow.id));
        return;
      }
    } catch (err) {
      if (Number(err?.response?.status) === 409) {
        try {
          const lookupResponse = await listLocalClosePacks({
            legalEntityId: selectedLegalEntityId || undefined,
            bookId: selectedBookId || undefined,
            fiscalPeriodId: selectedPeriodId || undefined,
            closeScopeType: requestedScopeType,
            operatingUnitId: requestedOperatingUnitId || undefined,
            limit: 20,
          });
          const existingRow = (Array.isArray(lookupResponse?.rows) ? lookupResponse.rows : []).find(
            (row) =>
              String(row?.closeScopeType || "").toUpperCase() === requestedScopeType &&
              Number(row?.operatingUnitId || 0) === Number(requestedOperatingUnitId || 0)
          );
          if (existingRow?.id) {
            setMessage(
              l(
                "Local close pack already exists. Opening the existing pack.",
                "Yerel kapanis paketi zaten var. Mevcut paket aciliyor."
              )
            );
            window.location.assign(buildPackDetailPath(existingRow.id));
            return;
          }
        } catch (lookupErr) {
          // Fall back to the original conflict message below when the recovery lookup fails.
          void lookupErr;
        }
      }
      setError(
        err?.response?.data?.message ||
          l("Failed to create local close pack.", "Yerel kapanis paketi olusturulamadi.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!canRead) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        {l(
          "Missing permission: ouclose.read",
          "Eksik yetki: ouclose.read"
        )}
      </div>
    );
  }

  if (!hasLookupReads) {
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">
            {l("Local Close Workspace", "Yerel Kapanis Calisma Alani")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            {l(
              "The RP07 workspace is live, but this shell still needs the entity, book, and fiscal-period lookup reads before users can build or launch close packs safely.",
              "RP07 calisma alani artik canli, ancak kullanicilarin kapanis paketi olusturup guvenle rapor baslatabilmesi icin bu kabuk hala varlik, defter ve mali donem lookup okumalarina ihtiyac duyuyor."
            )}
          </p>
        </section>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {l(
            "Additional permissions currently required: org.tree.read, gl.book.read, org.fiscal_period.read",
            "Su anda gereken ek yetkiler: org.tree.read, gl.book.read, org.fiscal_period.read"
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {l("Local Close Workspace", "Yerel Kapanis Calisma Alani")}
            </h1>
            <p className="mt-2 max-w-4xl text-sm text-slate-600">
              {l(
                "Review one operating-unit or HQ/central close pack, launch the local report family with scope prefilled, and keep first-pass evidence, comments, and audit in the same workspace.",
                "Tek bir isletme birimi veya merkez close pack'i inceleyin, yerel rapor ailesini scope'u hazir dolu sekilde baslatin ve ilk gecis kanit, yorum, denetim izlerini ayni calisma alaninda tutun."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReloadNonce((prev) => prev + 1);
              setMessage("");
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            {l("Refresh", "Yenile")}
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-6">
          <Combobox
            value={filters.legalEntityId || null}
            options={legalEntityOptions}
            onChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                legalEntityId: value ? String(value) : "",
                bookId: "",
                fiscalPeriodId: "",
              }))
            }
            placeholder={l("Select legal entity", "Yasal varlik secin")}
            noOptionsText={l("No legal entities found.", "Yasal varlik bulunamadi.")}
            loading={loadingRefs}
            clearable={false}
          />
          <Combobox
            value={filters.bookId || null}
            options={bookOptions}
            onChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                bookId: value ? String(value) : "",
                fiscalPeriodId: "",
              }))
            }
            placeholder={l("Select book", "Defter secin")}
            noOptionsText={l("No books found.", "Defter bulunamadi.")}
            loading={loadingRefs}
            clearable={false}
          />
          <Combobox
            value={filters.fiscalPeriodId || null}
            options={periodOptions}
            onChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                fiscalPeriodId: value ? String(value) : "",
              }))
            }
            placeholder={l("Select fiscal period", "Mali donem secin")}
            noOptionsText={l("No periods found.", "Donem bulunamadi.")}
            loading={loadingRefs}
            clearable={false}
          />
          <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Scope", "Scope")}
            </div>
            <select
              value={filters.closeScopeType}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, closeScopeType: event.target.value }))
              }
              className="mt-1 w-full bg-transparent text-sm outline-none"
            >
              {SCOPE_OPTIONS.map(([value]) => (
                <option key={value || "all"} value={value}>
                  {value === ""
                    ? l("All scopes", "Tum scope'lar")
                    : value === "CENTRAL"
                      ? l("HQ / Central", "Merkez / HQ")
                      : l("Operating unit", "Isletme birimi")}
                </option>
              ))}
            </select>
          </label>
          <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Status", "Durum")}
            </div>
            <select
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              className="mt-1 w-full bg-transparent text-sm outline-none"
            >
              {STATUS_OPTIONS.map(([value]) => (
                <option key={value || "all"} value={value}>
                  {value ? getStatusLabel(value, l) : l("All statuses", "Tum durumlar")}
                </option>
              ))}
            </select>
          </label>
          <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {l("Search", "Ara")}
            </div>
            <input
              value={filters.q}
              onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
              placeholder={l("Entity, book, or scope", "Varlik, defter veya scope")}
              className="mt-1 w-full bg-transparent text-sm outline-none"
            />
          </label>
        </div>
      </section>

      {canPrepare ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Create Local Close Pack", "Yerel Kapanis Paketi Olustur")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {l(
              "RP07 uses a dedicated local-close route family because the repo already uses the old year-end closing page for a different workflow.",
              "RP07, repoda eski yil sonu kapanis sayfasi baska bir is akisinda kullanildigi icin ayri bir yerel kapanis route ailesi kullanir."
            )}
          </p>
          <form onSubmit={handleCreatePack} className="mt-4 grid gap-3 lg:grid-cols-4">
            <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Scope Type", "Scope Turu")}
              </div>
              <select
                value={createForm.closeScopeType}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    closeScopeType: event.target.value,
                  }))
                }
                className="mt-1 w-full bg-transparent text-sm outline-none"
              >
                <option value="CENTRAL">{l("HQ / Central", "Merkez / HQ")}</option>
                <option value="OPERATING_UNIT">{l("Operating unit", "Isletme birimi")}</option>
              </select>
            </label>
            <Combobox
              value={createForm.operatingUnitId || null}
              options={operatingUnitOptions}
              onChange={(value) =>
                setCreateForm((prev) => ({
                  ...prev,
                  operatingUnitId: value ? String(value) : "",
                }))
              }
              placeholder={l("Select operating unit", "Isletme birimi secin")}
              noOptionsText={l("No operating units found.", "Isletme birimi bulunamadi.")}
              loading={loadingRefs}
              clearable={false}
              disabled={createForm.closeScopeType !== "OPERATING_UNIT"}
            />
            <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 lg:col-span-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {l("Note", "Not")}
              </div>
              <input
                value={createForm.note}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, note: event.target.value }))
                }
                placeholder={l("Optional preparation note", "Opsiyonel hazirlik notu")}
                className="mt-1 w-full bg-transparent text-sm outline-none"
              />
            </label>
            <div className="lg:col-span-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={
                  submitting ||
                  !selectedLegalEntityId ||
                  !selectedBookId ||
                  !selectedPeriodId ||
                  (createForm.closeScopeType === "OPERATING_UNIT" &&
                    !toPositiveInt(createForm.operatingUnitId))
                }
                className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting
                  ? l("Creating...", "Olusturuluyor...")
                  : l("Create Pack", "Paket Olustur")}
              </button>
              <div className="text-xs text-slate-500">
                {l(
                  "The currently selected entity, book, and period become the pack scope foundation.",
                  "Su anda secili varlik, defter ve donem paket scope temelini olusturur."
                )}
              </div>
            </div>
          </form>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {l("Workspace Packs", "Calisma Paketi Listesi")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {l(
              "Completion, blocker, and warning fields are first-pass derived RP07 metrics built from reviewed-report, evidence, comment, and reopen indicators.",
              "Tamamlanma, blokaj ve uyari alanlari; incelenen rapor, kanit, yorum ve yeniden acma gostergelerinden uretilen ilk gecis RP07 metrikleridir."
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">{l("Pack", "Paket")}</th>
                <th className="px-4 py-3 font-semibold">{l("Scope", "Scope")}</th>
                <th className="px-4 py-3 font-semibold">{l("Status", "Durum")}</th>
                <th className="px-4 py-3 font-semibold">{l("Completion", "Tamamlanma")}</th>
                <th className="px-4 py-3 font-semibold">{l("Issues", "Sorunlar")}</th>
                <th className="px-4 py-3 font-semibold">{l("Evidence", "Kanit")}</th>
                <th className="px-4 py-3 font-semibold">{l("Activity", "Aktivite")}</th>
                <th className="px-4 py-3 font-semibold">{l("Timeline", "Zaman Cizgisi")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingRows ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    {l("Loading local close packs...", "Yerel kapanis paketleri yukleniyor...")}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    {l("No local close packs found for the current filters.", "Mevcut filtreler icin yerel kapanis paketi bulunamadi.")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-4 py-3">
                      <Link
                        to={buildPackDetailPath(row.id)}
                        className="font-semibold text-slate-900 hover:text-slate-700"
                      >
                        {row.legalEntityCode || row.legalEntityName || row.id}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">
                        {(row.bookCode || row.bookName || "-")} | {row.periodName || "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>{formatScopeLabel(row, l)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {l("Owner", "Sahip")}: {row.ownerUserName || "-"} | {l("Reviewer", "Inceleyen")}:{" "}
                        {row.reviewerUserName || "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${getStatusTone(row.status)}`}
                      >
                        {getStatusLabel(row.status, l)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="font-semibold">{row.completionPercentage || 0}%</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.reportReviewCount || 0}/{row.requiredReportCount || 0}{" "}
                        {l("report reviews", "rapor incelemesi")}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="text-xs">
                        {l("Blockers", "Blokajlar")}: {row.blockerCount || 0}
                      </div>
                      <div className="mt-1 text-xs">
                        {l("Warnings", "Uyarilar")}: {row.warningCount || 0}
                      </div>
                      <div className="mt-1 text-xs">
                        {l("Pending reopens", "Bekleyen yeniden acmalar")}:{" "}
                        {row.pendingReopenRequestCount || 0}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="text-xs">
                        {l("Files", "Dosyalar")}: {row.evidenceCount || 0}
                      </div>
                      <div className="mt-1 text-xs">
                        {l("Comments", "Yorumlar")}: {row.commentCount || 0}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="text-xs">
                        {l("Last activity", "Son aktivite")}: {formatDateTime(row.lastActivityAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div className="text-xs">{l("Submitted", "Gonderildi")}: {formatDateTime(row.submittedAt)}</div>
                      <div className="mt-1 text-xs">{l("Approved", "Onaylandi")}: {formatDateTime(row.approvedAt)}</div>
                      <div className="mt-1 text-xs">{l("Locked", "Kilitlendi")}: {formatDateTime(row.lockedAt)}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
