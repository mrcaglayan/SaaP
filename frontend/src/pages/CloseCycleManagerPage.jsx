import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  createCloseCycle,
  listCloseCycleCreateFiscalPeriods,
  listCloseCycleScopeOptions,
  listCloseManagerCycles,
  lockCloseCycle,
  provisionCloseCycle,
} from "../api/closeCycles.js";
import { useAuth } from "../auth/useAuth.js";
import { useWorkingContext } from "../context/useWorkingContext.js";
import { useI18n } from "../i18n/useI18n.js";

const CLOSE_CYCLE_FILTER_VALUES = Object.freeze(["ALL", "OPEN", "PLANNED", "LOCKED"]);
const CLOSE_CYCLE_STATUS_SORT_ORDER = Object.freeze({
  OPEN: 0,
  PLANNED: 1,
  LOCKED: 2,
});

function toPositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toUpperText(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCycleFilterValue(value) {
  const normalized = toUpperText(value);
  return CLOSE_CYCLE_FILTER_VALUES.includes(normalized) ? normalized : "ALL";
}

function resolveCloseCycleFilterParams(filterValue) {
  const normalized = normalizeCycleFilterValue(filterValue);
  return normalized === "ALL" ? {} : { status: normalized };
}

function sortCloseCycleRows(rows = []) {
  return [...rows].sort((left, right) => {
    const leftStatusOrder =
      CLOSE_CYCLE_STATUS_SORT_ORDER[toUpperText(left?.status)] ?? Number.MAX_SAFE_INTEGER;
    const rightStatusOrder =
      CLOSE_CYCLE_STATUS_SORT_ORDER[toUpperText(right?.status)] ?? Number.MAX_SAFE_INTEGER;
    if (leftStatusOrder !== rightStatusOrder) {
      return leftStatusOrder - rightStatusOrder;
    }
    return Number(right?.id || 0) - Number(left?.id || 0);
  });
}

function buildCodeNameLabel(code, name, fallback = "-") {
  const codeText = String(code || "").trim();
  const nameText = String(name || "").trim();
  if (codeText && nameText) {
    return `${codeText} - ${nameText}`;
  }
  return codeText || nameText || fallback;
}

function buildLegalEntityOptionLabel(row) {
  return buildCodeNameLabel(row?.code, row?.name, `Legal Entity #${row?.id || "-"}`);
}

function buildConsolidationGroupOptionLabel(row) {
  return buildCodeNameLabel(row?.code, row?.name, `Group #${row?.id || "-"}`);
}

function buildFiscalPeriodOptionLabel(row) {
  const fiscalYear = Number(row?.fiscalYear ?? row?.fiscal_year ?? 0) || "-";
  const periodNo = Number(row?.periodNo ?? row?.period_no ?? 0);
  const startDate = String(row?.startDate ?? row?.start_date ?? "").trim();
  const endDate = String(row?.endDate ?? row?.end_date ?? "").trim();
  const periodLabel = periodNo ? `P${String(periodNo).padStart(2, "0")}` : "P--";
  const dateLabel = startDate && endDate ? `${startDate} - ${endDate}` : null;
  return dateLabel ? `FY${fiscalYear} ${periodLabel} / ${dateLabel}` : `FY${fiscalYear} ${periodLabel}`;
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

function toIsoDateTimeOrNull(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function getCycleStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "OPEN":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "PLANNED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "LOCKED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getCycleStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "OPEN":
      return l("Open", "Acik");
    case "PLANNED":
      return l("Planned", "Planlandi");
    case "LOCKED":
      return l("Locked", "Kilitlendi");
    default:
      return status || "-";
  }
}

function renderStatusPill(label, tone) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function buildCyclePickerLabel(row, l) {
  const scopeLabel =
    String(row?.scopeKind || "").toUpperCase() === "CONSOLIDATION_GROUP"
      ? l("Group cycle", "Grup dongusu")
      : l("Entity cycle", "Varlik dongusu");
  const anchorLabel =
    String(row?.scopeKind || "").toUpperCase() === "CONSOLIDATION_GROUP"
      ? `#${row?.consolidationGroupId || "-"}`
      : `#${row?.legalEntityId || "-"}`;
  const cycleTypeLabel = String(row?.cycleType || "")
    .trim()
    .replaceAll("_", " ");
  return `${cycleTypeLabel || "Cycle"} / ${scopeLabel} / ${anchorLabel}`;
}

function isSameId(left, right) {
  return Number(left || 0) === Number(right || 0);
}

/**
 * Keep close-cycle lifecycle actions on a dedicated management surface so the
 * cockpit can stay read-only and governed by `close.cockpit.read` alone.
 */
export default function CloseCycleManagerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const { workingContext } = useWorkingContext();
  const { l } = useI18n();

  const canReadCycles = hasPermission("close.cycle.read");
  const canWriteCycles = hasPermission("close.cycle.write");
  const canProvisionCycles = hasPermission("close.cycle.provision");
  const canLockCycles = hasPermission("close.cycle.lock");
  const canReadCockpit = hasPermission("close.cockpit.read");

  const [cycles, setCycles] = useState([]);
  const [legalEntities, setLegalEntities] = useState([]);
  const [consolidationGroups, setConsolidationGroups] = useState([]);
  const [createPeriods, setCreatePeriods] = useState([]);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [loadingScopeOptions, setLoadingScopeOptions] = useState(false);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [cycleError, setCycleError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [createOpen, setCreateOpen] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [createForm, setCreateForm] = useState({
    cycleType: "YEAR_END",
    scopeKind: "LEGAL_ENTITY",
    legalEntityId: "",
    consolidationGroupId: "",
    fiscalPeriodId: "",
    startsAt: "",
    dueAt: "",
  });

  const cycleStatusFilter = normalizeCycleFilterValue(searchParams.get("cycleStatus"));
  const selectedCycleId = toPositiveInt(searchParams.get("cycleId"));
  const selectedCycle =
    cycles.find((row) => Number(row?.id) === Number(selectedCycleId)) || null;
  const selectedCycleStatus = toUpperText(selectedCycle?.status);
  const selectedLockAction = selectedCycle?.lifecycleActions?.lock || null;
  const selectedCycleLockBlocked =
    selectedCycleStatus === "OPEN" && selectedLockAction?.visible && selectedLockAction?.canRun === false;
  const selectedLegalEntityId = toPositiveInt(createForm.legalEntityId);
  const selectedConsolidationGroupId = toPositiveInt(createForm.consolidationGroupId);
  const hasEntityScopeOptions = legalEntities.length > 0;
  const hasGroupScopeOptions = consolidationGroups.length > 0;
  const canBrowseCycleHeaders = canReadCycles || canProvisionCycles || canLockCycles;
  const canRunLifecycleActions = canProvisionCycles || canLockCycles;
  const periodScopeSelectionMissing =
    createForm.scopeKind === "CONSOLIDATION_GROUP"
      ? !selectedConsolidationGroupId
      : !selectedLegalEntityId;
  const periodCatalogEmptyForSelectedScope =
    !periodScopeSelectionMissing && !loadingPeriods && createPeriods.length === 0;
  const canSubmitCreate =
    canWriteCycles &&
    !savingAction &&
    Boolean(toPositiveInt(createForm.fiscalPeriodId)) &&
    (createForm.scopeKind === "CONSOLIDATION_GROUP"
      ? Boolean(selectedConsolidationGroupId)
      : Boolean(selectedLegalEntityId));
  const canSelectLifecycleCycle = canBrowseCycleHeaders && canRunLifecycleActions;

  const replaceCycleSearchParams = useCallback((nextCycleId, nextFilter = cycleStatusFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    const normalizedFilter = normalizeCycleFilterValue(nextFilter);
    if (normalizedFilter === "ALL") {
      nextParams.delete("cycleStatus");
    } else {
      nextParams.set("cycleStatus", normalizedFilter);
    }
    if (toPositiveInt(nextCycleId)) {
      nextParams.set("cycleId", String(toPositiveInt(nextCycleId)));
    } else {
      nextParams.delete("cycleId");
    }
    setSearchParams(nextParams, { replace: true });
  }, [cycleStatusFilter, searchParams, setSearchParams]);

  useEffect(() => {
    if (!canWriteCycles) {
      setLegalEntities([]);
      setConsolidationGroups([]);
      return undefined;
    }

    let cancelled = false;

    async function loadScopeOptions() {
      setLoadingScopeOptions(true);
      setLookupError("");
      try {
        const response = await listCloseCycleScopeOptions();
        if (cancelled) {
          return;
        }
        setLegalEntities(Array.isArray(response?.legalEntities) ? response.legalEntities : []);
        setConsolidationGroups(
          Array.isArray(response?.consolidationGroups) ? response.consolidationGroups : [],
        );
      } catch (err) {
        if (!cancelled) {
          setLookupError(
            err?.message ||
              l(
                "Cycle scope options could not be loaded.",
                "Dongu kapsam secenekleri yuklenemedi.",
              ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingScopeOptions(false);
        }
      }
    }

    loadScopeOptions();
    return () => {
      cancelled = true;
    };
  }, [canWriteCycles, l]);

  useEffect(() => {
    if (!canWriteCycles) {
      return;
    }

    setCreateForm((previous) => {
      let next = previous;
      let changed = false;

      if (previous.scopeKind === "LEGAL_ENTITY" && !hasEntityScopeOptions && hasGroupScopeOptions) {
        next = {
          ...next,
          scopeKind: "CONSOLIDATION_GROUP",
        };
        changed = true;
      }

      if (
        previous.scopeKind === "CONSOLIDATION_GROUP" &&
        !hasGroupScopeOptions &&
        hasEntityScopeOptions
      ) {
        next = {
          ...next,
          scopeKind: "LEGAL_ENTITY",
        };
        changed = true;
      }

      const workingContextEntityId = toPositiveInt(workingContext?.legalEntityId);
      const preferredLegalEntityId = legalEntities.some((row) => isSameId(row.id, workingContextEntityId))
        ? workingContextEntityId
        : toPositiveInt(legalEntities[0]?.id);
      const hasValidLegalEntity = legalEntities.some((row) =>
        isSameId(row.id, previous.legalEntityId),
      );
      if (hasEntityScopeOptions && (!hasValidLegalEntity || !toPositiveInt(previous.legalEntityId))) {
        next = {
          ...next,
          legalEntityId: preferredLegalEntityId ? String(preferredLegalEntityId) : "",
        };
        changed = true;
      }

      if (!hasEntityScopeOptions && previous.legalEntityId) {
        next = {
          ...next,
          legalEntityId: "",
        };
        changed = true;
      }

      const hasValidGroup = consolidationGroups.some((row) =>
        isSameId(row.id, previous.consolidationGroupId),
      );
      if (
        hasGroupScopeOptions &&
        (!hasValidGroup || !toPositiveInt(previous.consolidationGroupId))
      ) {
        next = {
          ...next,
          consolidationGroupId: String(toPositiveInt(consolidationGroups[0]?.id) || ""),
        };
        changed = true;
      }

      if (!hasGroupScopeOptions && previous.consolidationGroupId) {
        next = {
          ...next,
          consolidationGroupId: "",
        };
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [
    canWriteCycles,
    consolidationGroups,
    hasEntityScopeOptions,
    hasGroupScopeOptions,
    legalEntities,
    workingContext?.legalEntityId,
  ]);

  useEffect(() => {
    if (!canWriteCycles) {
      setCreatePeriods([]);
      setLoadingPeriods(false);
      return undefined;
    }

    if (periodScopeSelectionMissing) {
      setCreatePeriods([]);
      setLoadingPeriods(false);
      return undefined;
    }

    let cancelled = false;

    async function loadCreatePeriods() {
      setLoadingPeriods(true);
      setLookupError("");
      try {
        const response = await listCloseCycleCreateFiscalPeriods({
          scopeKind: createForm.scopeKind,
          legalEntityId:
            createForm.scopeKind === "LEGAL_ENTITY" ? selectedLegalEntityId || undefined : undefined,
          consolidationGroupId:
            createForm.scopeKind === "CONSOLIDATION_GROUP"
              ? selectedConsolidationGroupId
              : undefined,
        });
        if (!cancelled) {
          setCreatePeriods(Array.isArray(response?.rows) ? response.rows : []);
        }
      } catch (err) {
        if (!cancelled) {
          setLookupError(
            err?.message ||
              l(
                "Fiscal periods could not be loaded for close-cycle creation.",
                "Kapanis dongusu olusturma icin mali donemler yuklenemedi.",
              ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPeriods(false);
        }
      }
    }

    loadCreatePeriods();
    return () => {
      cancelled = true;
    };
  }, [
    canWriteCycles,
    createForm.scopeKind,
    l,
    periodScopeSelectionMissing,
    selectedConsolidationGroupId,
    selectedLegalEntityId,
  ]);

  useEffect(() => {
    if (!canWriteCycles) {
      return;
    }

    setCreateForm((previous) => {
      const hasCurrentSelection = createPeriods.some((row) =>
        isSameId(row.id, previous.fiscalPeriodId),
      );
      if (hasCurrentSelection) {
        return previous;
      }

      const workingContextPeriodId = toPositiveInt(workingContext?.fiscalPeriodId);
      const preferredPeriodId = createPeriods.some((row) => isSameId(row.id, workingContextPeriodId))
        ? workingContextPeriodId
        : toPositiveInt(createPeriods[0]?.id);
      if (String(preferredPeriodId || "") === String(previous.fiscalPeriodId || "")) {
        return previous;
      }

      return {
        ...previous,
        fiscalPeriodId: preferredPeriodId ? String(preferredPeriodId) : "",
      };
    });
  }, [canWriteCycles, createPeriods, workingContext?.fiscalPeriodId]);

  useEffect(() => {
    if (!canBrowseCycleHeaders) {
      setCycles([]);
      return undefined;
    }

    let cancelled = false;

    async function loadCycles() {
      setLoadingCycles(true);
      setCycleError("");
      try {
        const response = await listCloseManagerCycles(
          resolveCloseCycleFilterParams(cycleStatusFilter),
        );
        const nextRows = sortCloseCycleRows(Array.isArray(response?.rows) ? response.rows : []);
        if (cancelled) {
          return;
        }

        setCycles(nextRows);
        const requestedCycleId = toPositiveInt(searchParams.get("cycleId"));
        const requestedExists = nextRows.some((row) => isSameId(row.id, requestedCycleId));
        const fallbackCycleId = requestedExists ? requestedCycleId : toPositiveInt(nextRows[0]?.id);
        if (fallbackCycleId && fallbackCycleId !== requestedCycleId) {
          replaceCycleSearchParams(fallbackCycleId, cycleStatusFilter);
        } else if (!fallbackCycleId && requestedCycleId) {
          replaceCycleSearchParams(null, cycleStatusFilter);
        }
      } catch (err) {
        if (!cancelled) {
          setCycleError(
            err?.message ||
              l(
                "Manager cycle headers could not be loaded.",
                "Yonetim dongu basliklari yuklenemedi.",
              ),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingCycles(false);
        }
      }
    }

    loadCycles();
    return () => {
      cancelled = true;
    };
  }, [canBrowseCycleHeaders, cycleStatusFilter, l, reloadNonce, replaceCycleSearchParams, searchParams]);

  useEffect(() => {
    if (!canWriteCycles) {
      return;
    }
    if (!canBrowseCycleHeaders || (!loadingCycles && cycles.length === 0)) {
      setCreateOpen(true);
    }
  }, [canBrowseCycleHeaders, canWriteCycles, cycles.length, loadingCycles]);

  async function handleCreateCycle(event) {
    event.preventDefault();
    if (!canSubmitCreate) {
      setActionError(
        l(
          "Select a scope anchor and fiscal period before creating the close cycle.",
          "Kapanis dongusunu olusturmadan once bir kapsam ankori ve mali donem secin.",
        ),
      );
      return;
    }

    setSavingAction(true);
    setActionError("");
    setActionMessage("");
    try {
      const payload = {
        cycleType: createForm.cycleType,
        fiscalPeriodId: toPositiveInt(createForm.fiscalPeriodId),
        startsAt: toIsoDateTimeOrNull(createForm.startsAt) || undefined,
        dueAt: toIsoDateTimeOrNull(createForm.dueAt) || undefined,
      };

      if (createForm.scopeKind === "CONSOLIDATION_GROUP") {
        payload.consolidationGroupId = selectedConsolidationGroupId;
      } else {
        payload.legalEntityId = selectedLegalEntityId;
      }

      const response = await createCloseCycle(payload);
      const createdRow = response?.row || null;
      const createdCycleId = toPositiveInt(createdRow?.id);
      setActionMessage(
        l(
          `Close cycle created. #${createdCycleId || "-"}`,
          `Kapanis dongusu olusturuldu. #${createdCycleId || "-"}`,
        ),
      );
      setCreateForm((previous) => ({
        ...previous,
        startsAt: "",
        dueAt: "",
      }));
      if (canBrowseCycleHeaders && createdCycleId) {
        replaceCycleSearchParams(createdCycleId, "ALL");
      }
      setReloadNonce((current) => current + 1);
    } catch (err) {
      setActionError(
        err?.message ||
          l(
            "Close cycle could not be created.",
            "Kapanis dongusu olusturulamadi.",
          ),
      );
    } finally {
      setSavingAction(false);
    }
  }

  async function handleProvisionSelectedCycle() {
    if (!selectedCycleId || !canProvisionCycles) {
      return;
    }

    setSavingAction(true);
    setActionError("");
    setActionMessage("");
    try {
      await provisionCloseCycle(selectedCycleId);
      setActionMessage(
        l(
          `Close cycle provisioned. #${selectedCycleId}`,
          `Kapanis dongusu provision edildi. #${selectedCycleId}`,
        ),
      );
      const nextFilter = cycleStatusFilter === "PLANNED" ? "OPEN" : cycleStatusFilter;
      replaceCycleSearchParams(selectedCycleId, nextFilter);
      setReloadNonce((current) => current + 1);
    } catch (err) {
      setActionError(
        err?.message ||
          l(
            "Close cycle provisioning failed.",
            "Kapanis dongusu provision islemi basarisiz oldu.",
          ),
      );
    } finally {
      setSavingAction(false);
    }
  }

  async function handleLockSelectedCycle() {
    if (!selectedCycleId || !canLockCycles) {
      return;
    }
    if (selectedCycleLockBlocked) {
      const firstBlockerMessage = selectedLockAction?.blockers?.[0]?.message;
      setActionError(
        firstBlockerMessage ||
          l(
            "Close cycle lock is still blocked by unresolved terminal dependencies.",
            "Kapanis dongusu kilitlemesi halen cozulmemis terminal bagimliliklar nedeniyle blokeli.",
          ),
      );
      return;
    }

    setSavingAction(true);
    setActionError("");
    setActionMessage("");
    try {
      await lockCloseCycle(selectedCycleId);
      setActionMessage(
        l(
          `Close cycle locked. #${selectedCycleId}`,
          `Kapanis dongusu kilitlendi. #${selectedCycleId}`,
        ),
      );
      const nextFilter = cycleStatusFilter === "OPEN" ? "LOCKED" : cycleStatusFilter;
      replaceCycleSearchParams(selectedCycleId, nextFilter);
      setReloadNonce((current) => current + 1);
    } catch (err) {
      setActionError(
        err?.message ||
          l(
            "Close cycle lock failed.",
            "Kapanis dongusu kilitleme islemi basarisiz oldu.",
          ),
      );
    } finally {
      setSavingAction(false);
    }
  }

  const cockpitLink = selectedCycleId
    ? `/app/donem-sonu-islemler/yillik/kapanis-kokpiti?cycleId=${selectedCycleId}`
    : "/app/donem-sonu-islemler/yillik/kapanis-kokpiti";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {l("Close Cycle Manager", "Kapanis Donguleri")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            {l(
              "Keep cycle creation, provisioning, and lock actions on their own control-plane surface so the cockpit can stay read-only and operational.",
              "Kokpitin salt okunur ve operasyonel kalmasi icin dongu olusturma, provision ve kilitleme aksiyonlarini ayri bir kontrol duzlemi alaninda tutun.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canWriteCycles ? (
            <button
              type="button"
              onClick={() => {
                setCreateOpen((current) => !current);
                setActionError("");
                setActionMessage("");
              }}
              className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100"
            >
              {createOpen
                ? l("Hide create form", "Olusturma formunu gizle")
                : l("New close cycle", "Yeni kapanis dongusu")}
            </button>
          ) : null}
          {canReadCockpit ? (
            <Link
              to={cockpitLink}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {l("Open cockpit", "Kokpiti ac")}
            </Link>
          ) : null}
          {canBrowseCycleHeaders ? (
            <button
              type="button"
              onClick={() => setReloadNonce((current) => current + 1)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {l("Refresh", "Yenile")}
            </button>
          ) : null}
        </div>
      </div>

      {cycleError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {cycleError}
        </div>
      ) : null}

      {lookupError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {lookupError}
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {actionError}
        </div>
      ) : null}

      {actionMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {actionMessage}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr),380px]">
        <main className="space-y-6">
          {canWriteCycles && createOpen ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {l("Create close cycle", "Kapanis dongusu olustur")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {l(
                    "Cycle creation stays scope-governed under close-cycle permissions and provisions later on its own dedicated action.",
                    "Dongu olusturma, close-cycle yetkileri altinda kapsam kontrollu kalir ve provision sonraki ayri aksiyonda calisir.",
                  )}
                </p>
              </div>

              <form onSubmit={handleCreateCycle} className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block font-medium">{l("Cycle type", "Dongu tipi")}</span>
                    <select
                      value={createForm.cycleType}
                      onChange={(event) =>
                        setCreateForm((previous) => ({
                          ...previous,
                          cycleType: toUpperText(event.target.value) || "YEAR_END",
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      disabled={savingAction}
                    >
                      <option value="MONTH_END">{l("Month end", "Ay sonu")}</option>
                      <option value="QUARTER_END">{l("Quarter end", "Ceyrek sonu")}</option>
                      <option value="YEAR_END">{l("Year end", "Yil sonu")}</option>
                    </select>
                  </label>

                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block font-medium">{l("Scope kind", "Kapsam turu")}</span>
                    <select
                      value={createForm.scopeKind}
                      onChange={(event) =>
                        setCreateForm((previous) => ({
                          ...previous,
                          scopeKind: toUpperText(event.target.value) || "LEGAL_ENTITY",
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      disabled={
                        savingAction ||
                        loadingScopeOptions ||
                        (!hasEntityScopeOptions && !hasGroupScopeOptions)
                      }
                    >
                      {hasEntityScopeOptions ? (
                        <option value="LEGAL_ENTITY">{l("Legal entity", "Legal entity")}</option>
                      ) : null}
                      {hasGroupScopeOptions ? (
                        <option value="CONSOLIDATION_GROUP">
                          {l("Consolidation group", "Konsolidasyon grubu")}
                        </option>
                      ) : null}
                    </select>
                  </label>
                </div>

                {createForm.scopeKind === "CONSOLIDATION_GROUP" ? (
                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block font-medium">
                      {l("Consolidation group", "Konsolidasyon grubu")}
                    </span>
                    <select
                      value={createForm.consolidationGroupId}
                      onChange={(event) =>
                        setCreateForm((previous) => ({
                          ...previous,
                          consolidationGroupId: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      disabled={savingAction || loadingScopeOptions}
                    >
                      <option value="">{l("Select consolidation group", "Konsolidasyon grubu secin")}</option>
                      {consolidationGroups.map((row) => (
                        <option key={row.id} value={row.id}>
                          {buildConsolidationGroupOptionLabel(row)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block font-medium">{l("Legal entity", "Legal entity")}</span>
                    <select
                      value={createForm.legalEntityId}
                      onChange={(event) =>
                        setCreateForm((previous) => ({
                          ...previous,
                          legalEntityId: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      disabled={savingAction || loadingScopeOptions}
                    >
                      <option value="">{l("Select legal entity", "Legal entity secin")}</option>
                      {legalEntities.map((row) => (
                        <option key={row.id} value={row.id}>
                          {buildLegalEntityOptionLabel(row)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">{l("Fiscal period", "Mali donem")}</span>
                  <select
                    value={createForm.fiscalPeriodId}
                    onChange={(event) =>
                      setCreateForm((previous) => ({
                        ...previous,
                        fiscalPeriodId: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    disabled={savingAction || loadingPeriods || periodScopeSelectionMissing}
                  >
                    <option value="">
                      {periodScopeSelectionMissing
                        ? l(
                            "Select scope first",
                            "Once kapsam secin",
                          )
                        : l("Select fiscal period", "Mali donem secin")}
                    </option>
                    {createPeriods.map((row) => (
                      <option key={row.id} value={row.id}>
                        {buildFiscalPeriodOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                  {periodScopeSelectionMissing ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {l(
                        "Choose the legal entity or consolidation group first so the form can load only provisionable fiscal periods.",
                        "Formun sadece provision edilebilir mali donemleri yukleyebilmesi icin once legal entity veya konsolidasyon grubunu secin.",
                      )}
                    </p>
                  ) : null}
                  {periodCatalogEmptyForSelectedScope ? (
                    <p className="mt-2 text-xs text-amber-700">
                      {createForm.scopeKind === "CONSOLIDATION_GROUP"
                        ? l(
                            "No fiscal periods are available for the selected group's consolidation calendar.",
                            "Secilen grubun konsolidasyon takvimi icin uygun mali donem bulunamadi.",
                          )
                        : l(
                            "No provisionable fiscal periods are available because the selected legal entity does not yet have LOCAL books on a cycle calendar.",
                            "Secilen legal entity'nin henuz bir dongu takviminde LOCAL defteri olmadigi icin provision edilebilir mali donem bulunamadi.",
                          )}
                    </p>
                  ) : null}
                </label>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block font-medium">{l("Starts at", "Baslangic zamani")}</span>
                    <input
                      type="datetime-local"
                      value={createForm.startsAt}
                      onChange={(event) =>
                        setCreateForm((previous) => ({
                          ...previous,
                          startsAt: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      disabled={savingAction}
                    />
                  </label>

                  <label className="block text-sm text-slate-700">
                    <span className="mb-1 block font-medium">{l("Due at", "Son tarih zamani")}</span>
                    <input
                      type="datetime-local"
                      value={createForm.dueAt}
                      onChange={(event) =>
                        setCreateForm((previous) => ({
                          ...previous,
                          dueAt: event.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      disabled={savingAction}
                    />
                  </label>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  {createForm.scopeKind === "CONSOLIDATION_GROUP"
                    ? l(
                        "Group-scoped periods are narrowed to the consolidation group's native calendar before the cycle is created.",
                        "Grup kapsamli donemler, dongu olusturulmadan once konsolidasyon grubunun yerel takvimine daraltilir.",
                      )
                    : l(
                        "Entity-scoped periods now surface only provisionable LOCAL-book calendars for the selected legal entity before the cycle is created.",
                        "Entity kapsamli donemler artik dongu olusturulmadan once secilen legal entity icin yalnizca provision edilebilir LOCAL kitap takvimlerini gosterir.",
                      )}
                </div>

                {!hasEntityScopeOptions && !hasGroupScopeOptions ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    {l(
                      "No cycle-create scope is currently reachable under your close-cycle write scope.",
                      "Close-cycle yazma kapsaminiz altinda su anda ulasilabilir dongu-olusturma kapsami yok.",
                    )}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    {loadingScopeOptions || loadingPeriods
                      ? l("Loading close-owned lookups...", "Close-owned lookup'lar yukleniyor...")
                      : l(
                          "Created cycles start in PLANNED status and move to OPEN only after provisioning succeeds.",
                          "Olusturulan donguler PLANNED durumunda baslar ve ancak provision basariyla tamamlaninca OPEN olur.",
                        )}
                  </div>
                  <button
                    type="submit"
                    disabled={!canSubmitCreate}
                    className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingAction
                      ? l("Creating...", "Olusturuluyor...")
                      : l("Create cycle", "Dongu olustur")}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {canBrowseCycleHeaders ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {l("Cycle register", "Dongu kayit listesi")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {l(
                      "Browse manager-visible cycle headers and choose the row that read, provision, or lock actions should target on this surface.",
                      "Bu alanda okuma, provision veya kilitleme aksiyonlarinin hedefleyecegi yonetim-gorunumlu dongu basliklarini inceleyin ve satiri secin.",
                    )}
                  </p>
                </div>
                {loadingCycles ? (
                  <span className="text-xs text-slate-400">{l("Loading", "Yukleniyor")}</span>
                ) : null}
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {CLOSE_CYCLE_FILTER_VALUES.map((filterValue) => {
                  const isActive = cycleStatusFilter === filterValue;
                  return (
                    <button
                      key={filterValue}
                      type="button"
                      onClick={() => replaceCycleSearchParams(selectedCycleId, filterValue)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        isActive
                          ? "border-sky-300 bg-sky-50 text-sky-700"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
                      }`}
                    >
                      {filterValue === "ALL"
                        ? l("All", "Tum")
                        : getCycleStatusLabel(filterValue, l)}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3">
                {cycles.map((row) => {
                  const isSelected = isSameId(row.id, selectedCycleId);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => replaceCycleSearchParams(row.id, cycleStatusFilter)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        isSelected
                          ? "border-sky-300 bg-sky-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">
                          {buildCyclePickerLabel(row, l)}
                        </div>
                        {renderStatusPill(
                          getCycleStatusLabel(row.status, l),
                          getCycleStatusTone(row.status),
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                        <span>
                          {l("Cycle id", "Dongu id")}: #{row.id || "-"}
                        </span>
                        <span>
                          {l("Fiscal period", "Mali donem")}: #{row.fiscalPeriodId || "-"}
                        </span>
                        <span>
                          {l("Starts", "Baslangic")}: {formatDateTime(row.startsAt)}
                        </span>
                        <span>
                          {l("Due", "Son tarih")}: {formatDateTime(row.dueAt)}
                        </span>
                      </div>
                    </button>
                  );
                })}

                {!loadingCycles && cycles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    {canWriteCycles
                      ? l(
                          "No close cycles are available yet. Create the first planned cycle from this manager surface.",
                          "Henuz kapanis dongusu yok. Ilk planli donguyu bu yonetim alanindan olusturun.",
                        )
                      : l(
                          "No close cycles are visible in your current manager action scope.",
                          "Mevcut yonetim aksiyon kapsaminizda gorunur kapanis dongusu yok.",
                        )}
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-sm">
              {l(
                "Cycle headers appear here when close.cycle.read, close.cycle.provision, or close.cycle.lock is granted. Create remains available separately under close.cycle.write.",
                "Dongu basliklari burada close.cycle.read, close.cycle.provision veya close.cycle.lock verildiginde gorunur. Olusturma ise close.cycle.write altinda ayri olarak kullanilabilir.",
              )}
            </section>
          )}
        </main>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {l("Lifecycle actions", "Yasam dongusu aksiyonlari")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {l(
                  "Provision and lock remain backend-governed actions, but they are surfaced only on this manager route.",
                  "Provision ve kilitleme backend tarafinda yonetilen aksiyonlar olarak kalir, ancak sadece bu yonetim route'unda gorunur kilinir.",
                )}
              </p>
            </div>

            {selectedCycle ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">
                      {buildCyclePickerLabel(selectedCycle, l)}
                    </div>
                    {renderStatusPill(
                      getCycleStatusLabel(selectedCycleStatus, l),
                      getCycleStatusTone(selectedCycleStatus),
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600">
                    <div>
                      {l("Cycle id", "Dongu id")}: #{selectedCycle.id || "-"}
                    </div>
                    <div>
                      {l("Starts", "Baslangic")}: {formatDateTime(selectedCycle.startsAt)}
                    </div>
                    <div>
                      {l("Due", "Son tarih")}: {formatDateTime(selectedCycle.dueAt)}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedCycleStatus === "PLANNED" ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      {l(
                        "Provisioning materializes the frozen participant set, creates or reuses safe local close packs, and moves the cycle to OPEN on success.",
                        "Provision, dondurulmus katilim kumesini materialize eder, guvenli yerel kapanis paketlerini olusturur veya tekrar kullanir ve basarida donguyu OPEN durumuna tasir.",
                      )}
                    </div>
                  ) : null}

                  {selectedCycleStatus === "OPEN" ? (
                    <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-800">
                      {l(
                        "Lock remains a completion gate. This surface only enables the action after the cycle is OPEN and its terminal blockers are cleared.",
                        "Kilitleme bir tamamlama kapisi olarak kalir. Bu alan aksiyonu ancak dongu OPEN olduktan ve terminal blokajlari temizlendikten sonra etkinlestirir.",
                      )}
                    </div>
                  ) : null}

                  {selectedCycleLockBlocked ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                      <div className="font-semibold">
                        {l(
                          "Cycle lock is blocked until required terminal steps are complete.",
                          "Gerekli terminal adimlar tamamlanana kadar dongu kilidi blokeli kalir.",
                        )}
                      </div>
                      <div className="mt-2 space-y-2">
                        {(selectedLockAction?.blockers || []).map((blocker, index) => (
                          <div key={`${blocker.code || "blocker"}-${index}`}>
                            {blocker.message || blocker.code || "-"}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedCycleStatus === "LOCKED" ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      {l(
                        "This cycle is already locked. Use the cockpit for read-only monitoring and blocker history.",
                        "Bu dongu zaten kilitli. Salt okunur izleme ve blokaj gecmisi icin kokpiti kullanin.",
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedCycleStatus === "PLANNED" && canProvisionCycles ? (
                    <button
                      type="button"
                      onClick={handleProvisionSelectedCycle}
                      disabled={savingAction}
                      className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingAction
                        ? l("Provisioning...", "Provision ediliyor...")
                        : l("Provision cycle", "Donguyu provision et")}
                    </button>
                  ) : null}

                  {selectedCycleStatus === "OPEN" && canLockCycles ? (
                    <button
                      type="button"
                      onClick={handleLockSelectedCycle}
                      disabled={savingAction || selectedCycleLockBlocked}
                      className="rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingAction
                        ? l("Locking...", "Kilitleniyor...")
                        : selectedCycleLockBlocked
                          ? l("Resolve blockers to lock", "Kilitlemek icin blokajlari coz")
                          : l("Lock cycle", "Donguyu kilitle")}
                    </button>
                  ) : null}

                  {canReadCockpit ? (
                    <Link
                      to={cockpitLink}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {l("Open cockpit", "Kokpiti ac")}
                    </Link>
                  ) : null}
                </div>

                {!canProvisionCycles && selectedCycleStatus === "PLANNED" ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                    {l(
                      "Provision action is hidden until close.cycle.provision is granted.",
                      "close.cycle.provision verilene kadar provision aksiyonu gizli kalir.",
                    )}
                  </div>
                ) : null}

                {!canLockCycles && selectedCycleStatus === "OPEN" ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                    {l(
                      "Lock action is hidden until close.cycle.lock is granted.",
                      "close.cycle.lock verilene kadar kilitleme aksiyonu gizli kalir.",
                    )}
                  </div>
                ) : null}
              </div>
            ) : canSelectLifecycleCycle ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                {l(
                  "Select a visible cycle to expose provision or lock actions on this management route.",
                  "Bu yonetim route'unda provision veya kilitleme aksiyonlarini acmak icin gorunur bir dongu secin.",
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                {l(
                  "Lifecycle actions appear here when the matching cycle-management permissions are granted.",
                  "Eslesen cycle-management yetkileri verildiginde yasam dongusu aksiyonlari burada gorunur.",
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
