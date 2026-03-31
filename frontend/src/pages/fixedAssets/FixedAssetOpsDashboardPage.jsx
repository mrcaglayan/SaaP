import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getOpsFixedAssetActivationAttention,
  getOpsFixedAssetDepreciationAttention,
  getOpsFixedAssetLateCatchUpAttention,
} from "../../api/opsDashboard.js";
import { useAuth } from "../../auth/useAuth.js";
import { useWorkingContext } from "../../context/useWorkingContext.js";
import { useI18n } from "../../i18n/useI18n.js";

const EMPTY_ACTIVATION_ATTENTION = Object.freeze({
  filters: {
    legalEntityId: null,
  },
  affected_assets: {
    pending_activation_assets: 0,
  },
  acquisition_dates: {
    oldest_acquisition_date: null,
    latest_acquisition_date: null,
  },
});

const EMPTY_ATTENTION = Object.freeze({
  filters: {
    legalEntityId: null,
  },
  affected_assets: {
    pending_skipped_assets: 0,
  },
  runs: {
    pending_skipped_runs: 0,
    oldest_period_key: null,
    latest_period_key: null,
  },
});

const EMPTY_LATE_CATCH_UP_ATTENTION = Object.freeze({
  filters: {
    legalEntityId: null,
  },
  affected_assets: {
    pending_late_catch_up_assets: 0,
  },
  periods: {
    oldest_pending_period_key: null,
    latest_pending_period_key: null,
  },
  acquisition_dates: {
    oldest_acquisition_date: null,
    latest_acquisition_date: null,
  },
  amounts: {
    estimated_catch_up_base: 0,
  },
});

const FUTURE_WARNING_SLOTS = Object.freeze([
  {
    key: "lifecycleConflicts",
    titleEn: "Lifecycle Conflict Checks",
    titleTr: "Yasam Dongusu Cakisma Kontrolleri",
    descriptionEn:
      "Suspend, reactivate, sale, and reversal combinations that need sequencing review.",
    descriptionTr:
      "Siralama incelemesi gerektiren durdurma, yeniden aktivasyon, satis ve ters kayit kombinasyonlari.",
  },
  {
    key: "duplicateProtection",
    titleEn: "Disposal Month Integrity",
    titleTr: "Satis Donemi Butunlugu",
    descriptionEn:
      "Disposal-cutoff depreciation and ordinary run posting checks for same-period duplication risk.",
    descriptionTr:
      "Ayni donemde cift kayit riski icin satis-kesim amortismani ve normal run kontrolleri.",
  },
]);

function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeApiError(error, fallback) {
  const message = String(
    error?.response?.data?.message || error?.message || fallback
  ).trim();
  const requestId = String(error?.response?.data?.requestId || "").trim();
  return requestId ? `${message} (requestId: ${requestId})` : message || fallback;
}

function formatCount(value) {
  return toInt(value, 0).toLocaleString();
}

function formatAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "0.00";
  }
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function formatDate(value) {
  const normalized = String(value || "").slice(0, 10);
  return normalized || "-";
}

function buildScopeParams(workingContext) {
  const params = {};
  const legalEntityId = parsePositiveInt(workingContext?.legalEntityId);
  if (legalEntityId) {
    params.legalEntityId = legalEntityId;
  }

  const dateFrom = String(workingContext?.dateFrom || "").trim();
  const dateTo = String(workingContext?.dateTo || "").trim();
  if (dateFrom) {
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    params.dateTo = dateTo;
  }

  if (!params.dateFrom && !params.dateTo) {
    params.days = 30;
  }

  return params;
}

function buildLegalEntityLabel(legalEntities, legalEntityId, l) {
  const normalizedLegalEntityId = parsePositiveInt(legalEntityId);
  if (!normalizedLegalEntityId) {
    return l(
      "All permitted legal entities",
      "Tum yetkili tuzel kisilikler"
    );
  }

  const match = (Array.isArray(legalEntities) ? legalEntities : []).find(
    (row) => parsePositiveInt(row?.id) === normalizedLegalEntityId
  );
  const code = String(match?.code || "").trim();
  const name = String(match?.name || "").trim();
  if (code && name) {
    return `${code} - ${name}`;
  }
  if (code || name) {
    return code || name;
  }
  return `#${normalizedLegalEntityId}`;
}

function buildPeriodHint(attention, l) {
  const oldest = String(attention?.runs?.oldest_period_key || "").trim();
  const latest = String(attention?.runs?.latest_period_key || "").trim();
  if (!oldest && !latest) {
    return l("No open warning periods", "Acik uyari donemi yok");
  }
  if (oldest && latest && oldest !== latest) {
    return `${oldest} - ${latest}`;
  }
  return latest || oldest;
}

function SummaryCard({ label, value, hint }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{hint}</p>
    </article>
  );
}

/**
 * Render the fixed-asset operations warning surface scoped by the current
 * working-context legal entity and date range.
 */
export default function FixedAssetOpsDashboardPage() {
  const { l } = useI18n();
  const { hasPermission } = useAuth();
  const { workingContext, legalEntities } = useWorkingContext();

  const canReadOps = hasPermission("ops.dashboard.read");
  const canReadFixedAssets =
    hasPermission("fixed_assets.read") || hasPermission("fixed_assets.depreciation.run");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [activationAttention, setActivationAttention] = useState(EMPTY_ACTIVATION_ATTENTION);
  const [lateCatchUpAttention, setLateCatchUpAttention] = useState(EMPTY_LATE_CATCH_UP_ATTENTION);
  const [attention, setAttention] = useState(EMPTY_ATTENTION);

  const workingContextLegalEntityId = workingContext?.legalEntityId;
  const workingContextDateFrom = workingContext?.dateFrom;
  const workingContextDateTo = workingContext?.dateTo;
  const scopeParams = useMemo(
    () =>
      buildScopeParams({
        legalEntityId: workingContextLegalEntityId,
        dateFrom: workingContextDateFrom,
        dateTo: workingContextDateTo,
      }),
    [
      workingContextDateFrom,
      workingContextDateTo,
      workingContextLegalEntityId,
    ]
  );
  const pendingActivationAssetCount = toInt(
    activationAttention?.affected_assets?.pending_activation_assets,
    0
  );
  const lateCatchUpAssetCount = toInt(
    lateCatchUpAttention?.affected_assets?.pending_late_catch_up_assets,
    0
  );
  const assetCount = toInt(attention?.affected_assets?.pending_skipped_assets, 0);
  const runCount = toInt(attention?.runs?.pending_skipped_runs, 0);
  const hasPendingActivationWarning = pendingActivationAssetCount > 0;
  const hasLateCatchUpWarning = lateCatchUpAssetCount > 0;
  const hasSkippedMonthWarning = assetCount > 0;
  const activeWarningTypeCount =
    Number(hasPendingActivationWarning)
    + Number(hasLateCatchUpWarning)
    + Number(hasSkippedMonthWarning);
  const legalEntityLabel = buildLegalEntityLabel(
    legalEntities,
    scopeParams.legalEntityId,
    l
  );
  const periodHint = buildPeriodHint(attention, l);
  const activationOldestAcquisitionDate = String(
    activationAttention?.acquisition_dates?.oldest_acquisition_date || ""
  ).trim();
  const activationLatestAcquisitionDate = String(
    activationAttention?.acquisition_dates?.latest_acquisition_date || ""
  ).trim();
  const lateCatchUpOldestPendingPeriod = String(
    lateCatchUpAttention?.periods?.oldest_pending_period_key || ""
  ).trim();
  const lateCatchUpLatestPendingPeriod = String(
    lateCatchUpAttention?.periods?.latest_pending_period_key || ""
  ).trim();
  const lateCatchUpOldestAcquisitionDate = String(
    lateCatchUpAttention?.acquisition_dates?.oldest_acquisition_date || ""
  ).trim();
  const lateCatchUpEstimatedBase = Number(
    lateCatchUpAttention?.amounts?.estimated_catch_up_base || 0
  );
  const lateCatchUpPeriodHint =
    lateCatchUpOldestPendingPeriod && lateCatchUpLatestPendingPeriod
      ? lateCatchUpOldestPendingPeriod === lateCatchUpLatestPendingPeriod
        ? lateCatchUpLatestPendingPeriod
        : `${lateCatchUpOldestPendingPeriod} - ${lateCatchUpLatestPendingPeriod}`
      : lateCatchUpLatestPendingPeriod
        || lateCatchUpOldestPendingPeriod
        || l("No pending periods", "Bekleyen donem yok");

  useEffect(() => {
    if (!canReadOps || !canReadFixedAssets) {
      setActivationAttention(EMPTY_ACTIVATION_ATTENTION);
      setLateCatchUpAttention(EMPTY_LATE_CATCH_UP_ATTENTION);
      setAttention(EMPTY_ATTENTION);
      setLoading(false);
      setError("");
      return;
    }

    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const settled = await Promise.allSettled([
          getOpsFixedAssetActivationAttention(scopeParams),
          getOpsFixedAssetLateCatchUpAttention(scopeParams),
          getOpsFixedAssetDepreciationAttention(scopeParams),
        ]);
        if (!active) return;

        const [activationResult, lateCatchUpResult, depreciationResult] = settled;
        if (activationResult.status === "fulfilled") {
          setActivationAttention(activationResult.value || EMPTY_ACTIVATION_ATTENTION);
        } else {
          setActivationAttention(EMPTY_ACTIVATION_ATTENTION);
        }
        if (lateCatchUpResult.status === "fulfilled") {
          setLateCatchUpAttention(
            lateCatchUpResult.value || EMPTY_LATE_CATCH_UP_ATTENTION
          );
        } else {
          setLateCatchUpAttention(EMPTY_LATE_CATCH_UP_ATTENTION);
        }
        if (depreciationResult.status === "fulfilled") {
          setAttention(depreciationResult.value || EMPTY_ATTENTION);
        } else {
          setAttention(EMPTY_ATTENTION);
        }

        const failedSections = [];
        if (activationResult.status !== "fulfilled") {
          failedSections.push("activation");
        }
        if (lateCatchUpResult.status !== "fulfilled") {
          failedSections.push("lateCatchUp");
        }
        if (depreciationResult.status !== "fulfilled") {
          failedSections.push("depreciation");
        }
        if (failedSections.length > 0) {
          setError(
            l(
              `Some fixed asset warning sections could not be loaded: ${failedSections.join(", ")}`,
              `Bazi demirbas uyari bolumleri yuklenemedi: ${failedSections.join(", ")}`
            )
          );
        }
        setLastRefreshedAt(new Date().toISOString());
      } catch (loadError) {
        if (!active) return;
        setActivationAttention(EMPTY_ACTIVATION_ATTENTION);
        setLateCatchUpAttention(EMPTY_LATE_CATCH_UP_ATTENTION);
        setAttention(EMPTY_ATTENTION);
        setError(
          normalizeApiError(
            loadError,
            l(
              "Fixed asset warning dashboard could not be loaded.",
              "Demirbas uyari dashboard'u yuklenemedi."
            )
          )
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    canReadFixedAssets,
    canReadOps,
    l,
    scopeParams,
  ]);

  if (!canReadFixedAssets) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {l(
          "Missing fixed asset access. Required: fixed_assets.read or fixed_assets.depreciation.run",
          "Demirbas erisimi eksik. Gerekli yetki: fixed_assets.read veya fixed_assets.depreciation.run"
        )}
      </div>
    );
  }

  if (!canReadOps) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {l(
          "Missing permission: ops.dashboard.read",
          "Eksik yetki: ops.dashboard.read"
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              {l("Fixed Asset Ops Dashboard", "Demirbas Ops Dashboard")}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "Use this page as the warning surface for depreciation sequencing and future fixed asset controls.",
                "Bu sayfayi amortisman siralamasi ve gelecekteki demirbas kontrolleri icin uyari yuzeyi olarak kullanin."
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/app/demirbas-amortisman-islemleri"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {l("Open Depreciation Runs", "Amortisman Runlarini Ac")}
            </Link>
            <Link
              to="/app/demirbas-karti-listesi"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {l("Open Asset Cards", "Demirbas Kartlarini Ac")}
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label={l("Scope", "Kapsam")}
            value={legalEntityLabel}
            hint={l(
              "Respects working-context legal entity and date filters.",
              "Calisma baglamindaki tuzel kisilik ve tarih filtrelerine uyar."
            )}
          />
          <SummaryCard
            label={l("Active Warning Types", "Aktif Uyari Turu")}
            value={formatCount(activeWarningTypeCount)}
            hint={l(
              "Current warning categories already emitting rows on this page.",
              "Bu sayfada su anda satir ureten uyari kategorileri."
            )}
          />
          <SummaryCard
            label={l("Late Catch-Up Assets", "Gec Catch-Up Demirbaslari")}
            value={formatCount(lateCatchUpAssetCount)}
            hint={l(
              "Active assets entered after already-posted depreciation periods.",
              "Amortismani zaten postalanmis donemlerden sonra girilen aktif demirbaslar."
            )}
          />
          <SummaryCard
            label={l("Skipped Warning Periods", "Atlanan Uyari Donemleri")}
            value={periodHint}
            hint={l(
              "Oldest and latest warning periods currently covered by this feed.",
              "Bu beslemede su an kapsanan en eski ve en yeni uyari donemleri."
            )}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            {l("Late catch-up assets", "Gec catch-up demirbaslari")}:{" "}
            {formatCount(lateCatchUpAssetCount)}
          </span>
          <span>
            {l("Skipped runs in warning scope", "Uyari kapsamindaki atlanan runlar")}:{" "}
            {formatCount(runCount)}
          </span>
          <span>
            {l("Last refreshed", "Son yenileme")}: {formatDateTime(lastRefreshedAt)}
          </span>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {l("Current Warnings", "Guncel Uyarilar")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {l(
                "The first warning block is live. New fixed asset warning types will be added here later without changing the navigation path.",
                "Ilk uyari blogu canli. Yeni demirbas uyari turleri daha sonra bu yol degismeden buraya eklenecek."
              )}
            </p>
          </div>
          {loading ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {l("Refreshing...", "Yenileniyor...")}
            </span>
          ) : null}
        </div>

        <article
          className={`mt-4 rounded-xl border p-4 ${
            hasPendingActivationWarning
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  {l("Assets Waiting Activation", "Aktiflestirme Bekleyen Demirbaslar")}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    hasPendingActivationWarning
                      ? "bg-amber-100 text-amber-900"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {hasPendingActivationWarning
                    ? l("Attention", "Dikkat")
                    : l("Clear", "Temiz")}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                {l(
                  "Tracks draft fixed assets that have been created from acquisition flow but still have not been activated into service.",
                  "Alim akisindan olusturulmus ancak henuz hizmete alinip aktiflestirilmemis draft demirbaslari izler."
                )}
              </p>
            </div>
            <Link
              to="/app/demirbas-alim-islemleri"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {l("Open Acquisition Queue", "Alim Kuyrugunu Ac")}
            </Link>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SummaryCard
              label={l("Pending Activation", "Bekleyen Aktiflestirme")}
              value={formatCount(pendingActivationAssetCount)}
              hint={l(
                "Draft assets currently waiting activation.",
                "Su anda aktiflestirme bekleyen draft demirbaslar."
              )}
            />
            <SummaryCard
              label={l("Oldest Acquisition", "En Eski Alim")}
              value={formatDate(activationOldestAcquisitionDate)}
              hint={l(
                "Oldest acquisition date still sitting in draft status.",
                "Halen draft durumda bekleyen en eski alim tarihi."
              )}
            />
            <SummaryCard
              label={l("Latest Acquisition", "En Yeni Alim")}
              value={formatDate(activationLatestAcquisitionDate)}
              hint={l(
                "Most recent acquisition date currently waiting activation.",
                "Su an aktiflestirme bekleyen en yeni alim tarihi."
              )}
            />
          </div>
        </article>

        <article
          className={`mt-4 rounded-xl border p-4 ${
            hasLateCatchUpWarning
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  {l("Late Catch-Up Pending", "Gec Catch-Up Bekleyenler")}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    hasLateCatchUpWarning
                      ? "bg-amber-100 text-amber-900"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {hasLateCatchUpWarning
                    ? l("Attention", "Dikkat")
                    : l("Clear", "Temiz")}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                {l(
                  "Tracks late-entered active assets whose historical periods already have posted depreciation runs, so a catch-up posting must still be recognized without rewriting those old runs.",
                  "Gec girilen aktif demirbaslari izler; bu demirbaslarin gecmis donemlerinde amortisman runlari zaten postalanmistir ve eski runlar yeniden yazilmadan catch-up kaydi alinmalidir."
                )}
              </p>
            </div>
            <Link
              to="/app/demirbas-alim-islemleri"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {l("Open Acquisition Queue", "Alim Kuyrugunu Ac")}
            </Link>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <SummaryCard
              label={l("Pending Assets", "Bekleyen Demirbaslar")}
              value={formatCount(lateCatchUpAssetCount)}
              hint={l(
                "Assets currently waiting late catch-up depreciation handling.",
                "Su anda gec catch-up amortisman islemi bekleyen demirbaslar."
              )}
            />
            <SummaryCard
              label={l("Pending Periods", "Bekleyen Donemler")}
              value={lateCatchUpPeriodHint}
              hint={l(
                "Oldest to latest missed period currently detected.",
                "Su an tespit edilen en eski ve en yeni eksik donem."
              )}
            />
            <SummaryCard
              label={l("Oldest Acquisition", "En Eski Alim")}
              value={formatDate(lateCatchUpOldestAcquisitionDate)}
              hint={l(
                "Oldest acquisition date among current late catch-up cases.",
                "Mevcut gec catch-up vakalari icindeki en eski alim tarihi."
              )}
            />
            <SummaryCard
              label={l("Est. Catch-Up Base", "Tahmini Catch-Up Baz")}
              value={formatAmount(lateCatchUpEstimatedBase)}
              hint={l(
                "Estimated base-currency depreciation still missing from historical periods.",
                "Gecmis donemlerde halen eksik olan tahmini baz para amortisman tutari."
              )}
            />
          </div>
        </article>

        <article
          className={`mt-4 rounded-xl border p-4 ${
            hasSkippedMonthWarning
              ? "border-amber-200 bg-amber-50"
              : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  {l("Skipped Depreciation Runs", "Atlanan Amortisman Runlari")}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    hasSkippedMonthWarning
                      ? "bg-amber-100 text-amber-900"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {hasSkippedMonthWarning
                    ? l("Attention", "Dikkat")
                    : l("Clear", "Temiz")}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                {l(
                  "Tracks active assets tied to skipped depreciation runs whose covered periods still do not have matching posted depreciation state.",
                  "Kapsanan donemlerinde halen eslesen postalanmis amortisman durumu olmayan, atlanan amortisman runlarina bagli aktif demirbaslari izler."
                )}
              </p>
            </div>
            <Link
              to="/app/demirbas-amortisman-islemleri"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {l("Open Depreciation Queue", "Amortisman Kuyrugunu Ac")}
            </Link>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SummaryCard
              label={l("Affected Assets", "Etkilenen Demirbas")}
              value={formatCount(assetCount)}
              hint={l(
                "Active assets still requiring skipped-period review.",
                "Atlanan donem incelemesi halen gereken aktif demirbaslar."
              )}
            />
            <SummaryCard
              label={l("Skipped Runs", "Atlanan Runlar")}
              value={formatCount(runCount)}
              hint={l(
                "Skipped run headers contributing to the current warning count.",
                "Mevcut uyari sayisina katkida bulunan skipped run basliklari."
              )}
            />
            <SummaryCard
              label={l("Covered Periods", "Kapsanan Donemler")}
              value={periodHint}
              hint={l(
                "Oldest to latest warning period currently detected.",
                "Su an tespit edilen en eski ve en yeni uyari donemi."
              )}
            />
          </div>
        </article>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          {l("Reserved Warning Slots", "Ayrilmis Uyari Alanlari")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {l(
            "These cards reserve the fixed asset dashboard path for the next warning families we discussed.",
            "Bu kartlar, konustugumuz sonraki uyari aileleri icin demirbas dashboard yolunu rezerve eder."
          )}
        </p>

        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {FUTURE_WARNING_SLOTS.map((slot) => (
            <article
              key={slot.key}
              className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  {l(slot.titleEn, slot.titleTr)}
                </h3>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {l("Planned", "Planlandi")}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {l(slot.descriptionEn, slot.descriptionTr)}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
