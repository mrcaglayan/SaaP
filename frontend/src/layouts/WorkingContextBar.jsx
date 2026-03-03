import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth.js";
import { useWorkingContext } from "../context/useWorkingContext.js";
import { useI18n } from "../i18n/useI18n.js";

function toOptionLabel(row, fallbackPrefix) {
  const code = String(row?.code || "").trim();
  const name = String(row?.name || "").trim();
  if (code && name) return `${code} - ${name}`;
  if (code) return code;
  if (name) return name;
  return `${fallbackPrefix} #${row?.id || "?"}`;
}

function renderPeriodLabel(row) {
  if (!row) return "-";
  const year = row?.fiscal_year ?? row?.fiscalYear ?? "-";
  const periodNo = row?.period_no ?? row?.periodNo ?? "-";
  const periodName = row?.period_name ?? row?.periodName ?? "";
  const periodPart =
    Number.isFinite(Number(periodNo)) && Number(periodNo) > 0
      ? `P${String(periodNo).padStart(2, "0")}`
      : `P${periodNo}`;
  return periodName ? `FY${year} ${periodPart} - ${periodName}` : `FY${year} ${periodPart}`;
}

function findById(rows, targetId) {
  const normalizedTarget = String(targetId || "").trim();
  if (!normalizedTarget) return null;
  return (rows || []).find((row) => String(row?.id || "") === normalizedTarget) || null;
}

export default function WorkingContextBar({ collapsed = false, className = "" }) {
  const { isAuthed } = useAuth();
  const { t } = useI18n();
  const {
    workingContext,
    setWorkingContext,
    refreshLookups,
    legalEntities,
    operatingUnits,
    fiscalCalendars,
    fiscalPeriods,
    loading,
    error,
  } = useWorkingContext();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedLegalEntity = useMemo(
    () => findById(legalEntities, workingContext.legalEntityId),
    [legalEntities, workingContext.legalEntityId]
  );
  const selectedFiscalPeriod = useMemo(
    () => findById(fiscalPeriods, workingContext.fiscalPeriodId),
    [fiscalPeriods, workingContext.fiscalPeriodId]
  );

  const summaryText = useMemo(() => {
    const parts = [];
    if (selectedLegalEntity) {
      parts.push(toOptionLabel(selectedLegalEntity, "LE"));
    }
    if (selectedFiscalPeriod) {
      parts.push(renderPeriodLabel(selectedFiscalPeriod));
    }
    if (parts.length === 0) {
      return t("workingContext.notSelected", "Secim yapilmadi");
    }
    return parts.join(" | ");
  }, [selectedFiscalPeriod, selectedLegalEntity, t]);

  if (!isAuthed) {
    return null;
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          collapsed
            ? t("workingContext.openModal", "Sirket/Donem")
            : summaryText
        }
        className={`inline-flex w-full items-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50 ${
          collapsed
            ? "h-9 justify-center px-0"
            : "justify-between gap-2 overflow-hidden px-2.5 py-1.5 text-left"
        }`}
      >
        <span className="inline-flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <svg
            viewBox="0 0 20 20"
            className="h-4 w-4 shrink-0 text-slate-700"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 4.5h10A1.5 1.5 0 0116.5 6v9A1.5 1.5 0 0115 16.5H5A1.5 1.5 0 013.5 15V6A1.5 1.5 0 015 4.5zm0 3h10M7 3.5v2m6-2v2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {!collapsed && (
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {t("workingContext.openModal", "Sirket/Donem")}
              </span>
              <span className="block truncate text-xs font-medium text-slate-700">
                {summaryText}
              </span>
            </span>
          )}
        </span>
        {!collapsed && (
          <svg
            viewBox="0 0 20 20"
            className="h-3.5 w-3.5 shrink-0 text-slate-500"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 7.5L10 12.5l5-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <div className="w-full max-w-5xl rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  {t("workingContext.modalTitle", "Sirket / Donem Secimi")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t(
                    "workingContext.modalDescription",
                    "Sectiginiz context tum modullerde varsayilan filtre olarak kullanilir."
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50"
                aria-label={t("workingContext.closeModal", "Kapat")}
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                  <path
                    d="M5.5 5.5l9 9m0-9l-9 9"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="p-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  {t("workingContext.legalEntity", "Legal entity")}
                  <select
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-700"
                    value={workingContext.legalEntityId}
                    onChange={(event) =>
                      setWorkingContext({
                        legalEntityId: event.target.value,
                      })
                    }
                    disabled={loading && legalEntities.length === 0}
                  >
                    <option value="">
                      {t("workingContext.selectLegalEntity", "Select legal entity")}
                    </option>
                    {legalEntities.map((row) => (
                      <option key={`working-context-le-${row.id}`} value={String(row.id)}>
                        {toOptionLabel(row, "LE")}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="min-w-[12rem] flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  {t("workingContext.operatingUnit", "Operating unit")}
                  <select
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-700"
                    value={workingContext.operatingUnitId}
                    onChange={(event) =>
                      setWorkingContext({
                        operatingUnitId: event.target.value,
                      })
                    }
                    disabled={
                      !workingContext.legalEntityId ||
                      (loading && operatingUnits.length === 0)
                    }
                  >
                    <option value="">
                      {t("workingContext.allOperatingUnits", "All operating units")}
                    </option>
                    {operatingUnits.map((row) => (
                      <option key={`working-context-ou-${row.id}`} value={String(row.id)}>
                        {toOptionLabel(row, "OU")}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="min-w-[11rem] flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  {t("workingContext.fiscalCalendar", "Fiscal calendar")}
                  <select
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-700"
                    value={workingContext.fiscalCalendarId}
                    onChange={(event) =>
                      setWorkingContext({
                        fiscalCalendarId: event.target.value,
                      })
                    }
                    disabled={loading && fiscalCalendars.length === 0}
                  >
                    <option value="">
                      {t("workingContext.selectFiscalCalendar", "Select fiscal calendar")}
                    </option>
                    {fiscalCalendars.map((row) => (
                      <option
                        key={`working-context-calendar-${row.id}`}
                        value={String(row.id)}
                      >
                        {toOptionLabel(row, "CAL")}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="min-w-[14rem] flex-[1.2] text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  {t("workingContext.fiscalPeriod", "Fiscal period")}
                  <select
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-700"
                    value={workingContext.fiscalPeriodId}
                    onChange={(event) =>
                      setWorkingContext({
                        fiscalPeriodId: event.target.value,
                      })
                    }
                    disabled={
                      !workingContext.fiscalCalendarId ||
                      (loading && fiscalPeriods.length === 0)
                    }
                  >
                    <option value="">
                      {t("workingContext.selectFiscalPeriod", "Select fiscal period")}
                    </option>
                    {fiscalPeriods.map((row) => (
                      <option key={`working-context-period-${row.id}`} value={String(row.id)}>
                        {renderPeriodLabel(row)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {workingContext.dateFrom && workingContext.dateTo ? (
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                      {workingContext.dateFrom} - {workingContext.dateTo}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={refreshLookups}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    disabled={loading}
                  >
                    {loading
                      ? t("workingContext.loading", "Loading...")
                      : t("workingContext.refresh", "Refresh")}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  {t("workingContext.done", "Tamam")}
                </button>
              </div>

              {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
