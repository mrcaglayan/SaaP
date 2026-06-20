import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  getCloseCycleCockpit,
  listCloseCockpitCycles,
} from "../api/closeCycles.js";
import { createOfficialConsolidationRun } from "../api/consolidationRuns.js";
import { useAuth } from "../auth/useAuth.js";
import { useI18n } from "../i18n/useI18n.js";
import EntityCloseMonitorPage from "./EntityCloseMonitorPage.jsx";
import GroupCloseMonitorPage from "./GroupCloseMonitorPage.jsx";

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

function resolveCloseCycleFilterParams(filterValue) {
  const normalized = normalizeCycleFilterValue(filterValue);
  return normalized === "ALL" ? {} : { status: normalized };
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

function getBusinessStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "COMPLETED":
    case "APPROVED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "LOCKED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "READY_FOR_REVIEW":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "SUBMITTED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "WAIVED":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "FAILED":
    case "RETURNED":
    case "REOPENED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "CANCELLED":
      return "border-slate-300 bg-slate-100 text-slate-700";
    case "IN_PROGRESS":
    case "OPEN":
    case "DRAFT":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getBusinessStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "NOT_STARTED":
      return l("Not started", "Baslamadi");
    case "NOT_OPENED":
      return l("Not opened", "Acilmadi");
    case "OPEN":
      return l("Open", "Acik");
    case "IN_PROGRESS":
      return l("In progress", "Devam ediyor");
    case "READY_FOR_REVIEW":
      return l("Ready for review", "Incelemeye hazir");
    case "SUBMITTED":
      return l("Submitted", "Gonderildi");
    case "RETURNED":
      return l("Returned", "Iade edildi");
    case "APPROVED":
      return l("Approved", "Onaylandi");
    case "WAIVED":
      return l("Waived", "Feragat edildi");
    case "CANCELLED":
      return l("Cancelled", "Iptal edildi");
    case "COMPLETED":
      return l("Completed", "Tamamlandi");
    case "LOCKED":
      return l("Locked", "Kilitlendi");
    case "REOPENED":
      return l("Reopened", "Yeniden acildi");
    case "FAILED":
      return l("Failed", "Basarisiz");
    case "DRAFT":
      return l("Draft", "Taslak");
    default:
      return status || "-";
  }
}

function getStaleStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "STALE":
    case "STALE_REVIEW_REQUIRED":
    case "FINALIZED_BUT_OUTDATED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getStaleStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "FRESH":
      return l("Fresh", "Guncel");
    case "STALE":
      return l("Stale", "Bayat");
    case "STALE_REVIEW_REQUIRED":
      return l("Review required", "Inceleme gerekli");
    case "FINALIZED_BUT_OUTDATED":
      return l("Finalized but outdated", "Kesinlesti ama guncel degil");
    default:
      return status || "-";
  }
}

function getDueStateTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "OVERDUE":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "DUE_SOON":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "READY":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "ON_TRACK":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getDueStateLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "OVERDUE":
      return l("Overdue", "Gecikti");
    case "DUE_SOON":
      return l("Due soon", "Suresi yaklasiyor");
    case "READY":
      return l("Ready", "Hazir");
    case "ON_TRACK":
      return l("On track", "Takviminde");
    case "NO_DUE_DATE":
      return l("No due date", "Son tarih yok");
    default:
      return status || "-";
  }
}

function getSeverityTone(severity) {
  switch (String(severity || "").trim().toUpperCase()) {
    case "CRITICAL":
      return "border-rose-300 bg-rose-100 text-rose-800";
    case "HIGH":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "MEDIUM":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "LOW":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getSeverityLabel(severity, l) {
  switch (String(severity || "").trim().toUpperCase()) {
    case "CRITICAL":
      return l("Critical", "Kritik");
    case "HIGH":
      return l("High", "Yuksek");
    case "MEDIUM":
      return l("Medium", "Orta");
    case "LOW":
      return l("Low", "Dusuk");
    default:
      return severity || "-";
  }
}

function getAlertTypeTone(alertType) {
  switch (String(alertType || "").trim().toUpperCase()) {
    case "OVERDUE":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "DUE_SOON":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "BLOCKED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "ACTION_REQUIRED":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "STALE":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getAlertTypeLabel(alertType, l) {
  switch (String(alertType || "").trim().toUpperCase()) {
    case "OVERDUE":
      return l("Overdue", "Gecikti");
    case "DUE_SOON":
      return l("Due soon", "Suresi yaklasiyor");
    case "BLOCKED":
      return l("Blocked", "Blokeli");
    case "ACTION_REQUIRED":
      return l("Action required", "Aksiyon gerekli");
    case "STALE":
      return l("Stale", "Guncel degil");
    default:
      return alertType || "-";
  }
}

function getItemTypeLabel(itemType, l) {
  switch (String(itemType || "").trim().toUpperCase()) {
    case "LOCAL_CLOSE_PACK":
      return l("Local Close Packs", "Yerel Kapanis Paketleri");
    case "PERIOD_CLOSE_RUN":
      return l("Period Close Runs", "Donem Kapanis Kosulari");
    case "CONSOLIDATION_RUN":
      return l("Consolidation Runs", "Konsolidasyon Kosulari");
    default:
      return itemType || "-";
  }
}

function getCatalogStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "ACTIVE":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "PAUSED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "DISABLED":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getCatalogStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "ACTIVE":
      return l("Active", "Aktif");
    case "PAUSED":
      return l("Paused", "Duraklatildi");
    case "DISABLED":
      return l("Disabled", "Devre disi");
    default:
      return status || "-";
  }
}

function getJournalFamilyLabel(journalFamily, l) {
  switch (String(journalFamily || "").trim().toUpperCase()) {
    case "LOCAL_ADJUSTMENT":
      return l("Local Adjustment", "Yerel Duzeltme");
    case "TOPSIDE":
      return l("Topside", "Topside");
    case "ELIMINATION":
      return l("Elimination", "Eliminasyon");
    case "CONSOLIDATION_ADJUSTMENT":
      return l("Consolidation Adjustment", "Konsolidasyon Duzeltmesi");
    case "RECLASS":
      return l("Reclass", "Siniflama");
    case "REVERSING":
      return l("Reversing", "Ters Kayit");
    case "RECURRING":
      return l("Recurring", "Tekrarlayan");
    default:
      return journalFamily || "-";
  }
}

function getGovernanceModeTone(mode) {
  switch (String(mode || "").trim().toUpperCase()) {
    case "RUNTIME_MAPPED":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "CATALOG_ONLY":
      return "border-violet-200 bg-violet-50 text-violet-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getGovernanceModeLabel(mode, l) {
  switch (String(mode || "").trim().toUpperCase()) {
    case "RUNTIME_MAPPED":
      return l("Runtime mapped", "Runtime'a bagli");
    case "CATALOG_ONLY":
      return l("Catalog only", "Sadece katalog");
    default:
      return mode || "-";
  }
}

function getSupportScheduleKindLabel(kind, l) {
  switch (String(kind || "").trim().toUpperCase()) {
    case "SUPPORT_SCHEDULE":
      return l("Support schedule", "Destek cizelgesi");
    case "DISCLOSURE_PACK":
      return l("Disclosure pack", "Aciklama paketi");
    default:
      return kind || "-";
  }
}

function getSupportScheduleStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "APPROVED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "SUBMITTED":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "IN_PROGRESS":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "NOT_STARTED":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getSupportScheduleStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "APPROVED":
      return l("Approved", "Onaylandi");
    case "SUBMITTED":
      return l("Submitted", "Sunuldu");
    case "IN_PROGRESS":
      return l("In progress", "Devam ediyor");
    case "NOT_STARTED":
      return l("Not started", "Baslamadi");
    default:
      return status || "-";
  }
}

function getSupportScheduleDueStateTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "OVERDUE":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "READY":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "ON_TRACK":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getSupportScheduleDueStateLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "OVERDUE":
      return l("Overdue", "Gecikti");
    case "READY":
      return l("Ready", "Hazir");
    case "ON_TRACK":
      return l("On track", "Takviminde");
    case "NO_DUE_DATE":
      return l("No due date", "Son tarih yok");
    default:
      return status || "-";
  }
}

function getReconciliationFamilyLabel(family, l) {
  switch (String(family || "").trim().toUpperCase()) {
    case "BANK_RECONCILIATION":
      return l("Bank reconciliation", "Banka mutabakati");
    case "SUBLEDGER_GL_RECONCILIATION":
      return l("Subledger vs GL", "Alt defter ve GL");
    case "SUSPENSE_CLEARING_RECONCILIATION":
      return l("Suspense / clearing", "Supheli / clearing");
    case "INTERCOMPANY_RECONCILIATION":
      return l("Intercompany", "Intercompany");
    default:
      return family || "-";
  }
}

function getReconciliationStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "MATCHED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "REVIEW_REQUIRED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "NOT_STARTED":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getReconciliationStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "MATCHED":
      return l("Matched", "Eslesti");
    case "REVIEW_REQUIRED":
      return l("Review required", "Inceleme gerekli");
    case "NOT_STARTED":
      return l("Not started", "Baslamadi");
    default:
      return status || "-";
  }
}

function getMismatchQueueStatusTone(status) {
  switch (String(status || "").trim().toUpperCase()) {
    case "MISMATCHED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "UNILATERAL":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "RESOLVED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getMismatchQueueStatusLabel(status, l) {
  switch (String(status || "").trim().toUpperCase()) {
    case "MISMATCHED":
      return l("Mismatch queue", "Uyumsuzluk kuyrugu");
    case "UNILATERAL":
      return l("Unilateral queue", "Tek tarafli kuyruk");
    case "RESOLVED":
      return l("Resolved queue", "Cozulen kuyruk");
    default:
      return status || "-";
  }
}

function getConsolidationScenarioTone(scenarioCode) {
  switch (String(scenarioCode || "").trim().toUpperCase()) {
    case "OFFICIAL":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "RESTATED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "SIMULATION":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "TRIAL":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getConsolidationScenarioLabel(scenarioCode, l) {
  switch (String(scenarioCode || "").trim().toUpperCase()) {
    case "OFFICIAL":
      return l("Official", "Resmi");
    case "RESTATED":
      return l("Restated", "Yeniden duzenlenmis");
    case "SIMULATION":
      return l("Simulation", "Simulasyon");
    case "TRIAL":
      return l("Trial", "Deneme");
    default:
      return scenarioCode || "-";
  }
}

function getBottleneckStepLabel(step, l) {
  switch (String(step || "").trim().toUpperCase()) {
    case "PERIOD_CLOSE_RUN":
      return l("Period close", "Donem kapanisi");
    case "LOCAL_CLOSE_PACK":
      return l("Local close", "Yerel kapanis");
    case "CONSOLIDATION_RUN":
      return l("Consolidation", "Konsolidasyon");
    default:
      return step || "-";
  }
}

function findReconciliationStatusCount(snapshot, targetStatus) {
  return (
    (snapshot?.byStatus || []).find(
      (row) =>
        String(row?.status || "").trim().toUpperCase() ===
        String(targetStatus || "").trim().toUpperCase(),
    )?.count || 0
  );
}

function formatAmountValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function findScheduleStatusCount(snapshot, targetStatus) {
  return (
    (snapshot?.byStatus || []).find(
      (row) => String(row?.scheduleStatus || "").trim().toUpperCase() === String(targetStatus || "").trim().toUpperCase(),
    )?.count || 0
  );
}

function describeReconciliationItemMetrics(row, l) {
  const metrics = row?.metrics || {};
  switch (String(row?.setFamily || "").trim().toUpperCase()) {
    case "BANK_RECONCILIATION":
      return [
        `${l("Lines", "Satirlar")}: ${metrics.statementLinesTotal || 0}`,
        `${l("Unmatched", "Eslesmeyen")}: ${metrics.unmatchedOpenTotal || 0}`,
        `${l("Open exceptions", "Acik istisnalar")}: ${metrics.openExceptionTotal || 0}`,
      ];
    case "SUBLEDGER_GL_RECONCILIATION":
      return [
        `${l("Rows", "Satirlar")}: ${metrics.rowCount || 0}`,
        `${l("Exception rows", "Istisna satirlari")}: ${metrics.exceptionRowCount || 0}`,
        `${l("Abs diff", "Mutlak fark")}: ${formatAmountValue(metrics.absoluteDifferenceBaseTotal)}`,
      ];
    case "SUSPENSE_CLEARING_RECONCILIATION":
      return [
        `${l("Account", "Hesap")}: ${metrics.accountCode || "-"}`,
        `${l("Ending balance", "Donem sonu bakiye")}: ${formatAmountValue(metrics.endingBalanceBase)}`,
        `${l("Journals", "Yevmiyeler")}: ${metrics.journalCount || 0}`,
      ];
    case "INTERCOMPANY_RECONCILIATION":
      return [
        `${l("Pair status", "Cift durumu")}: ${row?.pairStatus || "-"}`,
        `${l("Abs diff", "Mutlak fark")}: ${formatAmountValue(metrics.absoluteDifferenceBase)}`,
        `${l("Directional lines", "Yonsel satirlar")}: ${(metrics.directionABLineCount || 0) + (metrics.directionBALineCount || 0)}`,
      ];
    default:
      return [];
  }
}

function formatObservedRuntime(byStatus = {}, l) {
  const entries = Object.entries(byStatus || {});
  if (!entries.length) {
    return l("No runtime rows yet", "Henuz runtime satiri yok");
  }
  return entries
    .sort(([leftStatus], [rightStatus]) => String(leftStatus).localeCompare(String(rightStatus)))
    .map(([status, count]) => `${status}: ${count}`)
    .join(" / ");
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

function MetricCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-sm text-slate-500">{hint}</div> : null}
    </div>
  );
}

function KpiDashboardPanel({ kpiSnapshot = null, l }) {
  if (!kpiSnapshot?.summary) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {l(
          "PR-09 KPI metrics are not available for this cycle yet.",
          "PR-09 KPI metrikleri bu dongu icin henuz hazir degil.",
        )}
      </div>
    );
  }

  const summary = kpiSnapshot.summary || {};
  const entityHeatmapRows = Array.isArray(kpiSnapshot?.entityHeatmap?.rows)
    ? kpiSnapshot.entityHeatmap.rows
    : [];
  const scenarioRows = Array.isArray(kpiSnapshot?.consolidationScenarios?.rows)
    ? kpiSnapshot.consolidationScenarios.rows
    : [];
  const scenarioCounts = Array.isArray(kpiSnapshot?.consolidationScenarios?.byScenario)
    ? kpiSnapshot.consolidationScenarios.byScenario
    : [];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label={l("Close completion %", "Kapanis tamamlama %")}
          value={`${summary.completionPercent || 0}%`}
          hint={`${summary.readyItems || 0} / ${summary.totalItems || 0}`}
        />
        <MetricCard
          label={l("Overdue count", "Geciken adet")}
          value={summary.overdueCount || 0}
          hint={l("Rows past due date", "Son tarihi gecen satirlar")}
        />
        <MetricCard
          label={l("Stale count", "Stale adet")}
          value={summary.staleCount || 0}
          hint={l("Rows with stale state", "Stale durumu olan satirlar")}
        />
        <MetricCard
          label={l("Reopen events", "Yeniden acma olaylari")}
          value={summary.reopenEventsTotal ?? summary.reopenCount ?? 0}
          hint={l(
            `${summary.itemsReopenedAtLeastOnce || 0} items reopened at least once / ${
              summary.currentlyReopenedItems || 0
            } currently reopened`,
            `En az bir kez yeniden acilan ${summary.itemsReopenedAtLeastOnce || 0} kalem / su an yeniden acik ${
              summary.currentlyReopenedItems || 0
            } kalem`,
          )}
        />
        <MetricCard
          label={l("Avg approval SLA", "Ort. onay SLA")}
          value={
            summary.avgApprovalSlaHours === null ||
            summary.avgApprovalSlaHours === undefined
              ? "-"
              : `${Number(summary.avgApprovalSlaHours).toFixed(1)}h`
          }
          hint={l(
            "Average submit-to-approve hours on linked local close packs",
            "Bagli yerel kapanis paketlerinde submit-ten onaya ortalama saat",
          )}
        />
        <MetricCard
          label={l("Bottleneck step", "Darbogaz adimi")}
          value={getBottleneckStepLabel(summary.bottleneckStep, l)}
          hint={l("Largest unresolved work family", "Cozulmemis en buyuk is ailesi")}
        />
      </div>

      {scenarioCounts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {scenarioCounts.map((row) => (
            <span
              key={row.scenarioCode}
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getConsolidationScenarioTone(
                row.scenarioCode,
              )}`}
            >
              {getConsolidationScenarioLabel(row.scenarioCode, l)}: {row.count || 0}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr),minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {l("Entity readiness heatmap", "Varlik hazirlik isi haritasi")}
            </h4>
            <p className="mt-1 text-sm text-slate-500">
              {l(
                "Surface completion, overdue, stale, and blocked pressure by entity on one management grid.",
                "Tamamlama, gecikme, stale ve blokaj baskisini varlik bazinda tek bir yonetim tablosunda gosterin.",
              )}
            </p>
          </div>
          {entityHeatmapRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
              {l("No entity heatmap rows are available.", "Hazir entity isi haritasi satiri yok.")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-3 pr-4 font-semibold">{l("Entity", "Varlik")}</th>
                    <th className="pb-3 pr-4 font-semibold">{l("Completion", "Tamamlama")}</th>
                    <th className="pb-3 pr-4 font-semibold">{l("Blocked", "Blokeli")}</th>
                    <th className="pb-3 pr-4 font-semibold">{l("Overdue", "Geciken")}</th>
                    <th className="pb-3 pr-4 font-semibold">{l("Stale", "Stale")}</th>
                    <th className="pb-3 font-semibold">
                      {l("Reopen events", "Yeniden acma olaylari")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entityHeatmapRows.map((row) => (
                    <tr key={row.snapshotKey || row.legalEntityId} className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        {row.legalEntityLabel || "-"}
                      </td>
                      <td className="py-3 pr-4 text-slate-700">
                        {row.completionPercent || 0}% ({row.readyItems || 0}/{row.totalItems || 0})
                      </td>
                      <td className="py-3 pr-4 text-slate-700">{row.blockedItems || 0}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.overdueItems || 0}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.staleItems || 0}</td>
                      <td className="py-3 text-slate-700">
                        {row.reopenEventsTotal ?? row.reopenCount ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {l("Consolidation scenarios", "Konsolidasyon senaryolari")}
            </h4>
            <p className="mt-1 text-sm text-slate-500">
              {l(
                "Keep trial, official, restated, and simulation runs visible beside the close cockpit without changing the existing OFFICIAL governance path.",
                "Deneme, resmi, yeniden duzenlenmis ve simulasyon kosularini mevcut OFFICIAL yonetim yolunu degistirmeden kokpitin yaninda gorunur tutun.",
              )}
            </p>
          </div>
          {scenarioRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
              {l("No consolidation scenarios are available for this cycle period.", "Bu dongu donemi icin konsolidasyon senaryosu yok.")}
            </div>
          ) : (
            <div className="space-y-3">
              {scenarioRows.map((row) => (
                <div key={row.runId} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {row.runName || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {l("Version", "Versiyon")}: {row.versionNo || 1}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {renderStatusPill(
                        getConsolidationScenarioLabel(row.scenarioCode, l),
                        getConsolidationScenarioTone(row.scenarioCode),
                      )}
                      {renderStatusPill(
                        row.status || "-",
                        getBusinessStatusTone(row.status),
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {l("Presentation currency", "Sunum para birimi")}
                      </div>
                      <div className="mt-1">{row.presentationCurrencyCode || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {l("Started", "Basladi")}
                      </div>
                      <div className="mt-1">{formatDateTime(row.startedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {l("Finished", "Bitti")}
                      </div>
                      <div className="mt-1">{formatDateTime(row.finishedAt)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SupportSchedulesPanel({ supportScheduleSnapshot = null, l }) {
  const rows = Array.isArray(supportScheduleSnapshot?.rows) ? supportScheduleSnapshot.rows : [];
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {l(
          "No support schedules or disclosure packs are materialized for this cycle yet.",
          "Bu dongu icin henuz materialize edilmis destek cizelgesi veya aciklama paketi yok.",
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={l("Rows", "Satirlar")}
          value={supportScheduleSnapshot?.total || 0}
          hint={l("Materialized support collection rows", "Materialize edilmis destek toplama satirlari")}
        />
        <MetricCard
          label={l("Support", "Destek")}
          value={supportScheduleSnapshot?.counts?.supportSchedules || 0}
          hint={l("Support schedules", "Destek cizelgeleri")}
        />
        <MetricCard
          label={l("Disclosure", "Aciklama")}
          value={supportScheduleSnapshot?.counts?.disclosurePacks || 0}
          hint={l("Disclosure packs", "Aciklama paketleri")}
        />
        <MetricCard
          label={l("Approved", "Onayli")}
          value={findScheduleStatusCount(supportScheduleSnapshot, "APPROVED")}
          hint={l("Rows already finalized", "Hali hazirda tamamlanan satirlar")}
        />
        <MetricCard
          label={l("Overdue", "Geciken")}
          value={supportScheduleSnapshot?.counts?.overdue || 0}
          hint={l("Rows past due date", "Son tarihini gecen satirlar")}
        />
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id || row.scheduleKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {row.scheduleTitle || row.template?.templateName || row.scheduleKey || "-"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {row.template?.templateCode || "-"}
                  {row.linkedItem?.itemKey ? ` / ${row.linkedItem.itemKey}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {renderStatusPill(
                  getSupportScheduleKindLabel(row.scheduleKind, l),
                  row.scheduleKind === "DISCLOSURE_PACK"
                    ? "border-violet-200 bg-violet-50 text-violet-700"
                    : "border-sky-200 bg-sky-50 text-sky-700",
                )}
                {renderStatusPill(
                  getSupportScheduleStatusLabel(row.scheduleStatus, l),
                  getSupportScheduleStatusTone(row.scheduleStatus),
                )}
                {renderStatusPill(
                  getSupportScheduleDueStateLabel(row.dueState, l),
                  getSupportScheduleDueStateTone(row.dueState),
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  {l("Scope", "Kapsam")}:{" "}
                  {row.closeCycleItemId ? l("Item-scoped", "Kalem bazli") : l("Cycle-scoped", "Dongu bazli")}
                </span>
                <span>
                  {l("Progress", "Ilerleme")}: {row.progressPercentage || 0}%
                </span>
                <span>
                  {l("Responses", "Yanıtlar")}: {row.completedResponseCount || 0} / {row.totalResponseCount || 0}
                </span>
                <span>
                  {l("Owner", "Sorumlu")}: {row.ownerUserId ? `#${row.ownerUserId}` : l("Unassigned", "Atanmadi")}
                </span>
                {row.dueAt ? (
                  <span>
                    {l("Due date", "Son tarih")}: {formatDateTime(row.dueAt)}
                  </span>
                ) : null}
              </div>
              {row.drillPath ? (
                <Link to={row.drillPath} className="font-semibold text-sky-700 hover:text-sky-900">
                  {l("Open drill path", "Detay yolunu ac")}
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReconciliationControlsPanel({ reconciliationSnapshot = null, l }) {
  const setRows = Array.isArray(reconciliationSnapshot?.sets)
    ? reconciliationSnapshot.sets
    : [];
  if (!setRows.length) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {l(
          "No PR-08 reconciliation controls are materialized for this cycle yet.",
          "Bu dongu icin henuz PR-08 mutabakat kontrolleri materialize edilmedi.",
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={l("Control items", "Kontrol kalemleri")}
          value={reconciliationSnapshot?.totalItems || 0}
          hint={l("Materialized PR-08 close controls", "Materialize edilmis PR-08 kapanis kontrolleri")}
        />
        <MetricCard
          label={l("Review required", "Inceleme gerekli")}
          value={findReconciliationStatusCount(reconciliationSnapshot, "REVIEW_REQUIRED")}
          hint={l("Controls with live issues", "Canli issue tasiyan kontroller")}
        />
        <MetricCard
          label={l("Matched", "Eslesen")}
          value={findReconciliationStatusCount(reconciliationSnapshot, "MATCHED")}
          hint={l("Controls that currently reconcile", "Su anda mutabik gorunen kontroller")}
        />
        <MetricCard
          label={l("Not started", "Baslamayan")}
          value={findReconciliationStatusCount(reconciliationSnapshot, "NOT_STARTED")}
          hint={l("Controls with no activity yet", "Henuz aktivitesi olmayan kontroller")}
        />
        <MetricCard
          label={l("Open IC queue", "Acik IC kuyrugu")}
          value={reconciliationSnapshot?.counts?.openMismatchQueue || 0}
          hint={l("Persisted intercompany mismatch rows", "Kayitli intercompany uyumsuzluk satirlari")}
        />
      </div>

      <div className="space-y-4">
        {setRows.map((setRow) => (
          <div key={setRow.id || setRow.setKey} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">
                  {getReconciliationFamilyLabel(setRow.setFamily, l)}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {setRow.setTitle || getReconciliationFamilyLabel(setRow.setFamily, l)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {l("Items", "Kalemler")}: {(setRow.items || []).length}
                </span>
                <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                  {l("Review", "Inceleme")}: {(setRow.items || []).filter((row) => row.status === "REVIEW_REQUIRED").length}
                </span>
              </div>
            </div>

            {(setRow.items || []).length ? (
              <div className="mt-4 space-y-3">
                {setRow.items.map((row) => (
                  <div key={row.id || row.itemKey} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {row.label || row.itemKey || "-"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.itemKey || "-"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {renderStatusPill(
                          getReconciliationStatusLabel(row.status, l),
                          getReconciliationStatusTone(row.status),
                        )}
                        {row.persistedMismatchQueue ? renderStatusPill(
                          getMismatchQueueStatusLabel(row.persistedMismatchQueue.status, l),
                          getMismatchQueueStatusTone(row.persistedMismatchQueue.status),
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                      {describeReconciliationItemMetrics(row, l).map((entry) => (
                        <span key={`${row.itemKey}-${entry}`}>{entry}</span>
                      ))}
                      {row.ownerUserId ? (
                        <span>
                          {l("Owner", "Sorumlu")}: #{row.ownerUserId}
                        </span>
                      ) : null}
                    </div>

                    {Array.isArray(row.issues) && row.issues.length ? (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <span className="font-semibold">{l("Issues", "Sorunlar")}:</span>{" "}
                        {row.issues.join(" / ")}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
                      {row.persistedMismatchQueue?.lastDetectedAt ? (
                        <span>
                          {l("Queue updated", "Kuyruk guncelleme")}: {formatDateTime(row.persistedMismatchQueue.lastDetectedAt)}
                        </span>
                      ) : (
                        <span>{l("No persisted queue row", "Kayitli kuyruk satiri yok")}</span>
                      )}
                      {row.drillPath ? (
                        <Link to={row.drillPath} className="font-semibold text-sky-700 hover:text-sky-900">
                          {l("Open source control", "Kaynak kontroli ac")}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                {l(
                  "No control rows were materialized for this family inside the current cycle scope.",
                  "Mevcut dongu kapsami icinde bu aile icin materialize edilmis kontrol satiri yok.",
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function JournalGovernancePanel({ journalSnapshot = null, l }) {
  const families = Array.isArray(journalSnapshot?.families) ? journalSnapshot.families : [];
  if (!families.length) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {l(
          "No governed close-journal families are configured for this cycle yet.",
          "Bu dongu icin henuz yapilandirilmis yonetilen kapanis yevmiye ailesi yok.",
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={l("Profiles", "Profiller")}
          value={journalSnapshot?.summary?.profileCount || 0}
          hint={l("Governance headers", "Yonetim basliklari")}
        />
        <MetricCard
          label={l("Templates", "Sablonlar")}
          value={journalSnapshot?.summary?.templateCount || 0}
          hint={l("Governed journal variants", "Yonetilen yevmiye varyantlari")}
        />
        <MetricCard
          label={l("Runtime mapped", "Runtime'a bagli")}
          value={journalSnapshot?.summary?.runtimeMappedTemplateCount || 0}
          hint={l("Already aligned to live runtime seams", "Canli runtime seam'lerine bagli")}
        />
        <MetricCard
          label={l("Catalog only", "Sadece katalog")}
          value={journalSnapshot?.summary?.catalogOnlyTemplateCount || 0}
          hint={l("Tracked for later runtime wiring", "Sonraki runtime baglantisi icin izlenir")}
        />
        <MetricCard
          label={l("Observed rows", "Gozlenen satirlar")}
          value={journalSnapshot?.summary?.observedRuntimeRowCount || 0}
          hint={l("Live runtime rows matched this period", "Bu donemde eslesen canli runtime satirlari")}
        />
      </div>

      <div className="space-y-4">
        {families.map((family) => (
          <div key={family.journalFamily} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">
                  {getJournalFamilyLabel(family.journalFamily, l)}
                </h4>
                <div className="mt-1 text-xs text-slate-500">
                  {family.profileCount || 0} {l("profiles", "profil")} / {family.templateCount || 0}{" "}
                  {l("templates", "sablon")}
                </div>
              </div>
              <div className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                {l("Observed", "Gozlenen")}: {family.observedRuntimeRowCount || 0}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(family.profiles || []).map((profile) => (
                <div key={profile.id || profile.profileCode} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {profile.profileName || profile.profileCode || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {profile.profileCode || "-"} / {profile.scopeLabel || "-"}
                      </div>
                      {profile.description ? (
                        <div className="mt-2 text-sm text-slate-600">{profile.description}</div>
                      ) : null}
                    </div>
                    {renderStatusPill(
                      getCatalogStatusLabel(profile.status, l),
                      getCatalogStatusTone(profile.status),
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    {(profile.templates || []).map((template) => (
                      <div
                        key={template.id || template.templateCode}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {template.templateName || template.templateCode || "-"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {template.templateCode || "-"} / {template.runtimeBindingLabel || "-"}
                            </div>
                            {template.description ? (
                              <div className="mt-2 text-sm text-slate-600">{template.description}</div>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {renderStatusPill(
                              getCatalogStatusLabel(template.status, l),
                              getCatalogStatusTone(template.status),
                            )}
                            {renderStatusPill(
                              getGovernanceModeLabel(template?.observedRuntime?.governanceMode, l),
                              getGovernanceModeTone(template?.observedRuntime?.governanceMode),
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                          <div className="flex flex-wrap items-center gap-3">
                            <span>
                              {l("Reversal", "Ters kayit")}: {template.reversalMode || "NONE"}
                            </span>
                            <span>
                              {l("Cycle link", "Dongu baglantisi")}:{" "}
                              {template.requiresCycleLink ? l("Required", "Zorunlu") : l("Optional", "Opsiyonel")}
                            </span>
                            <span>
                              {l("Period binding", "Donem baglantisi")}:{" "}
                              {template.requiresPeriodBinding ? l("Required", "Zorunlu") : l("Optional", "Opsiyonel")}
                            </span>
                            <span>
                              {l("Manual draft", "Elle taslak")}:{" "}
                              {template.allowManualDraft ? l("Allowed", "Izinli") : l("Restricted", "Sinirli")}
                            </span>
                          </div>
                          {template.drillPath ? (
                            <Link
                              to={template.drillPath}
                              className="font-semibold text-sky-700 hover:text-sky-900"
                            >
                              {l("Open runtime surface", "Runtime yuzeyini ac")}
                            </Link>
                          ) : null}
                        </div>

                        <div className="mt-3 text-sm text-slate-600">
                          <span className="font-medium text-slate-700">
                            {l("Observed runtime", "Gozlenen runtime")}:
                          </span>{" "}
                          {template?.observedRuntime?.total === null
                            ? l(
                                "Catalog-only foundation; dedicated runtime binding is deferred.",
                                "Sadece katalog temeli; ozel runtime baglantisi ertelendi.",
                              )
                            : `${template?.observedRuntime?.total || 0} / ${formatObservedRuntime(
                                template?.observedRuntime?.byStatus,
                                l,
                              )}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlockerList({ rows = [], l }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        {l("No merged blockers are visible for this cycle.", "Bu dongu icin gorunur birlesik blokaj yok.")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div
          key={`${row?.code || "blocker"}:${index}`}
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{row?.message || "-"}</div>
              <div className="mt-1 text-xs text-slate-500">
                {row?.code || "CLOSE_BLOCKER"}
                {row?.blockingItemType ? ` / ${row.blockingItemType}` : ""}
              </div>
            </div>
            {renderStatusPill(
              row?.severity === "HIGH" ? l("High", "Yuksek") : l("Medium", "Orta"),
              row?.severity === "HIGH"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-amber-200 bg-amber-50 text-amber-700",
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                {l("Owner", "Sorumlu")}:{" "}
                {row?.owner?.userId ? `#${row.owner.userId}` : l("Unassigned", "Atanmadi")}
              </span>
              {row?.blockingAction ? (
                <span>
                  {l("Blocking action", "Bloklayan aksiyon")}: {row.blockingAction}
                </span>
              ) : null}
              {row?.firstBlockedAt ? (
                <span>
                  {l("First blocked", "Ilk blokaj")}: {formatDateTime(row.firstBlockedAt)}
                </span>
              ) : null}
              {row?.dueDate ? (
                <span>
                  {l("Due date", "Son tarih")}: {formatDateTime(row.dueDate)}
                </span>
              ) : null}
            </div>
            {row?.drillPath ? (
              <Link to={row.drillPath} className="font-semibold text-sky-700 hover:text-sky-900">
                {l("Open drill path", "Detay yolunu ac")}
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function AlertList({ alertSnapshot = null, l }) {
  const rows = Array.isArray(alertSnapshot?.rows) ? alertSnapshot.rows : [];
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        {l("No active close alerts are visible for this cycle.", "Bu dongu icin gorunur aktif kapanis uyarisi yok.")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.slice(0, 12).map((row) => (
        <div key={row.alertKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{row.title || "-"}</div>
              <div className="mt-1 text-sm text-slate-700">{row.message || "-"}</div>
              <div className="mt-2 text-xs text-slate-500">
                {row.alertCode || row.alertType || "CLOSE_ALERT"}
                {row.itemKey ? ` / ${row.itemKey}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {renderStatusPill(getSeverityLabel(row.severity, l), getSeverityTone(row.severity))}
              {renderStatusPill(
                getAlertTypeLabel(row.alertType, l),
                getAlertTypeTone(row.alertType),
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                {l("Owner", "Sorumlu")}:{" "}
                {row?.owner?.userId ? `#${row.owner.userId}` : l("Unassigned", "Atanmadi")}
              </span>
              {row?.dueDate ? (
                <span>
                  {l("Due date", "Son tarih")}: {formatDateTime(row.dueDate)}
                </span>
              ) : null}
              {row?.firstTriggeredAt ? (
                <span>
                  {l("First seen", "Ilk gorulme")}: {formatDateTime(row.firstTriggeredAt)}
                </span>
              ) : null}
            </div>
            {row?.drillPath ? (
              <Link to={row.drillPath} className="font-semibold text-sky-700 hover:text-sky-900">
                {l("Open drill path", "Detay yolunu ac")}
              </Link>
            ) : null}
          </div>
        </div>
      ))}
      {rows.length > 12 ? (
        <div className="text-xs text-slate-500">
          {l("Additional alerts", "Ek uyarilar")}: {rows.length - 12}
        </div>
      ) : null}
    </div>
  );
}

function buildTaskBoardPath(cycleId, taskId = null) {
  const params = new URLSearchParams();
  if (cycleId) {
    params.set("cycleId", String(cycleId));
  }
  if (taskId) {
    params.set("taskId", String(taskId));
  }
  const query = params.toString();
  return `/app/donem-sonu-islemler/yillik/kapanis-gorevleri${query ? `?${query}` : ""}`;
}

function buildConsolidationRunPath({ consolidationGroupId, runId }) {
  const params = new URLSearchParams();
  if (toPositiveInt(consolidationGroupId)) {
    params.set("consolidationGroupId", String(toPositiveInt(consolidationGroupId)));
  }
  if (toPositiveInt(runId)) {
    params.set("runId", String(toPositiveInt(runId)));
  }
  const query = params.toString();
  return `/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari${query ? `?${query}` : ""}`;
}

function findOfficialConsolidationRow(rows = [], readiness = null) {
  const expectedRunName = toUpperText(readiness?.runName || "OFFICIAL");
  return (
    (Array.isArray(rows) ? rows : []).find(
      (row) =>
        toUpperText(row?.itemType) === "CONSOLIDATION_RUN" &&
        toUpperText(row?.runName) === expectedRunName,
    ) || null
  );
}

function TaskMiniList({ rows = [], emptyText, cycleId, l }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((row) => (
        <Link
          key={row.id}
          to={row.drillPath || buildTaskBoardPath(cycleId, row.id)}
          className="block rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-cyan-300 hover:bg-cyan-50"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">
                {row.taskName || row.taskCode || "-"}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {row.taskFamily || "MANUAL"} / {row.ownerUserId ? `#${row.ownerUserId}` : "-"}
              </div>
            </div>
            {renderStatusPill(
              getBusinessStatusLabel(row.status, l),
              getBusinessStatusTone(row.status),
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            {row.dueAt ? <span>{formatDateTime(row.dueAt)}</span> : null}
            {row.evidenceMissing ? <span>{l("Evidence missing", "Kanit eksik")}</span> : null}
            {row.sourceCheckFailed ? (
              <span>{l("Source check failed", "Kaynak kontrolu basarisiz")}</span>
            ) : null}
          </div>
        </Link>
      ))}
    </div>
  );
}

function TaskCockpitPanel({ taskSnapshot = null, cycleId, l }) {
  const counts = taskSnapshot?.counts || {};
  const rows = Array.isArray(taskSnapshot?.rows) ? taskSnapshot.rows : [];
  const byFamily = Array.isArray(taskSnapshot?.byFamily) ? taskSnapshot.byFamily : [];
  const lockBlockingRows = rows.filter((row) => Boolean(row.lockBlocking));
  const overdueRows = rows.filter((row) => Boolean(row.overdue));
  const myOpenTasks = Array.isArray(taskSnapshot?.myOpenTasks)
    ? taskSnapshot.myOpenTasks
    : [];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={l("Checklist tasks", "Kontrol gorevleri")}
          value={taskSnapshot?.total || 0}
          hint={`${counts.approved || 0} ${l("approved", "onayli")}`}
        />
        <MetricCard
          label={l("Submitted", "Gonderildi")}
          value={counts.submitted || 0}
          hint={l("Waiting for review", "Inceleme bekliyor")}
        />
        <MetricCard
          label={l("Overdue", "Geciken")}
          value={counts.overdue || 0}
          hint={l("Open tasks past due", "Vadesi gecen acik gorevler")}
        />
        <MetricCard
          label={l("Evidence missing", "Kanit eksik")}
          value={counts.evidenceMissing || 0}
          hint={l("Evidence-required tasks", "Kanit gerektiren gorevler")}
        />
        <MetricCard
          label={l("Lock blockers", "Kilit blokajlari")}
          value={counts.lockBlocking || 0}
          hint={l("Required task gates", "Zorunlu gorev gecitleri")}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-900">
            {l("Lock-blocking tasks", "Kilidi bloke eden gorevler")}
          </div>
          <TaskMiniList
            rows={lockBlockingRows}
            cycleId={cycleId}
            l={l}
            emptyText={l("No lock-blocking tasks.", "Kilidi bloke eden gorev yok.")}
          />
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-900">
            {l("Overdue tasks", "Geciken gorevler")}
          </div>
          <TaskMiniList
            rows={overdueRows}
            cycleId={cycleId}
            l={l}
            emptyText={l("No overdue tasks.", "Geciken gorev yok.")}
          />
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-900">
            {l("My open tasks", "Acik gorevlerim")}
          </div>
          <TaskMiniList
            rows={myOpenTasks}
            cycleId={cycleId}
            l={l}
            emptyText={l("No open tasks assigned to you.", "Size atanmis acik gorev yok.")}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-3 pr-4 font-semibold">{l("Family", "Aile")}</th>
              <th className="pb-3 pr-4 font-semibold">{l("Total", "Toplam")}</th>
              <th className="pb-3 pr-4 font-semibold">{l("Open", "Acik")}</th>
              <th className="pb-3 pr-4 font-semibold">{l("Approved", "Onayli")}</th>
              <th className="pb-3 pr-4 font-semibold">{l("Waived", "Feragat")}</th>
              <th className="pb-3 pr-4 font-semibold">{l("Cancelled", "Iptal")}</th>
              <th className="pb-3 pr-4 font-semibold">{l("Overdue", "Geciken")}</th>
              <th className="pb-3 font-semibold">{l("Lock blockers", "Kilit blokajlari")}</th>
            </tr>
          </thead>
          <tbody>
            {byFamily.map((row) => (
              <tr key={row.taskFamily} className="border-b border-slate-100">
                <td className="py-3 pr-4 font-medium text-slate-900">{row.taskFamily || "MANUAL"}</td>
                <td className="py-3 pr-4 text-slate-700">{row.total || 0}</td>
                <td className="py-3 pr-4 text-slate-700">{row.open || 0}</td>
                <td className="py-3 pr-4 text-slate-700">{row.approved || 0}</td>
                <td className="py-3 pr-4 text-slate-700">{row.waived || 0}</td>
                <td className="py-3 pr-4 text-slate-700">{row.cancelled || 0}</td>
                <td className="py-3 pr-4 text-slate-700">{row.overdue || 0}</td>
                <td className="py-3 text-slate-700">{row.lockBlocking || 0}</td>
              </tr>
            ))}
            {byFamily.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-sm text-slate-500">
                  {l("No task families are visible.", "Gorunur gorev ailesi yok.")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StaleList({ staleSnapshot = null, l }) {
  const rows = Array.isArray(staleSnapshot?.rows) ? staleSnapshot.rows : [];
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        {l("No non-fresh stale rows are open in this cycle.", "Bu dongude FRESH disi stale satiri yok.")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.closeCycleItemId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {row.scopeLabel}
                {row.bookLabel ? ` / ${row.bookLabel}` : ""}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {row.legalEntityLabel || "-"}
                {row.operatingUnitLabel && row.operatingUnitLabel !== "-" ? ` / ${row.operatingUnitLabel}` : ""}
                {row.itemKey ? ` / ${row.itemKey}` : ""}
              </div>
              <div className="mt-2 text-sm text-slate-700">{row.message}</div>
            </div>
            {renderStatusPill(getStaleStatusLabel(row.staleStatus, l), getStaleStatusTone(row.staleStatus))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                {l("Latest event", "Son olay")}: {formatDateTime(row?.latestEvent?.createdAt)}
              </span>
              {row?.latestEvent?.eventCode ? (
                <span>
                  {l("Event code", "Olay kodu")}: {row.latestEvent.eventCode}
                </span>
              ) : null}
              {row?.latestEvent?.sourceTargetType ? (
                <span>
                  {l("Source", "Kaynak")}: {row.latestEvent.sourceTargetType}
                </span>
              ) : null}
            </div>
            {row?.drillPath ? (
              <Link to={row.drillPath} className="font-semibold text-sky-700 hover:text-sky-900">
                {l("Open drill path", "Detay yolunu ac")}
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Render the operational close cockpit with KPI, blocker, stale, readiness,
 * and narrowly permissioned consolidation-start visibility layered onto one cycle view.
 */
export default function CloseCockpitPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { l } = useI18n();
  const canReadCockpit = hasPermission("close.cockpit.read");
  const canCreateConsolidationRunLocal = hasPermission("consolidation.run.create");
  const canReadConsolidationRunLocal = hasPermission("consolidation.run.read");
  const canAccessCycleManager =
    hasPermission("close.cycle.read") ||
    hasPermission("close.cycle.write") ||
    hasPermission("close.cycle.provision") ||
    hasPermission("close.cycle.lock");

  const [cycles, setCycles] = useState([]);
  const [cockpit, setCockpit] = useState(null);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [loadingCockpit, setLoadingCockpit] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [runningAction, setRunningAction] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);

  const cycleStatusFilter = normalizeCycleFilterValue(
    searchParams.get("cycleStatus"),
  );
  const selectedCycleId = toPositiveInt(searchParams.get("cycleId"));
  const selectedCycleListRow =
    cycles.find((row) => Number(row?.id) === Number(selectedCycleId)) || null;
  const selectedCycleStatus = toUpperText(
    cockpit?.row?.status || selectedCycleListRow?.status,
  );
  const consolidationReadiness = cockpit?.consolidationReadiness || null;

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
    if (!canReadCockpit) {
      return undefined;
    }

    let cancelled = false;

    async function loadCycles() {
      setLoadingCycles(true);
      setError("");
      try {
        const response = await listCloseCockpitCycles(
          resolveCloseCycleFilterParams(cycleStatusFilter),
        );
        const nextRows = sortCloseCycleRows(
          Array.isArray(response?.rows) ? response.rows : [],
        );
        if (cancelled) {
          return;
        }
        setCycles(nextRows);

        const requestedCycleId = toPositiveInt(searchParams.get("cycleId"));
        const requestedExists = nextRows.some((row) => Number(row?.id) === Number(requestedCycleId));
        const fallbackCycleId = requestedExists ? requestedCycleId : toPositiveInt(nextRows[0]?.id);
        if (fallbackCycleId && fallbackCycleId !== requestedCycleId) {
          replaceCycleSearchParams(fallbackCycleId, cycleStatusFilter);
        } else if (!fallbackCycleId && requestedCycleId) {
          replaceCycleSearchParams(null, cycleStatusFilter);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || l("Close cockpit could not be loaded.", "Kapanis kokpiti yuklenemedi."));
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
  }, [
    canReadCockpit,
    cycleStatusFilter,
    l,
    reloadNonce,
    replaceCycleSearchParams,
    searchParams,
  ]);

  useEffect(() => {
    if (!canReadCockpit || !selectedCycleId) {
      setCockpit(null);
      return undefined;
    }

    let cancelled = false;

    async function loadCockpit() {
      setLoadingCockpit(true);
      setError("");
      try {
        const response = await getCloseCycleCockpit(selectedCycleId);
        if (!cancelled) {
          setCockpit(response);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || l("Close cockpit detail could not be loaded.", "Kapanis kokpiti detayi yuklenemedi."));
        }
      } finally {
        if (!cancelled) {
          setLoadingCockpit(false);
        }
      }
    }

    loadCockpit();
    return () => {
      cancelled = true;
    };
  }, [canReadCockpit, l, selectedCycleId]);

  const onOpenConsolidationRun = useCallback(
    (readinessInput = null) => {
      const readiness = readinessInput || consolidationReadiness;
      const runId = toPositiveInt(readiness?.runId);
      const consolidationGroupId = toPositiveInt(readiness?.consolidationGroupId);
      if (!readiness?.canOpenRun || !canReadConsolidationRunLocal) {
        setError(
          l(
            "Missing permission: consolidation.run.read",
            "Eksik yetki: consolidation.run.read",
          ),
        );
        return;
      }
      if (!runId) {
        setError(
          l(
            "Consolidation run is not available yet.",
            "Konsolidasyon kosusu henuz hazir degil.",
          ),
        );
        return;
      }
      setError("");
      setActionMessage("");
      navigate(buildConsolidationRunPath({ consolidationGroupId, runId }));
    },
    [canReadConsolidationRunLocal, consolidationReadiness, l, navigate],
  );

  const onStartConsolidationRun = useCallback(async () => {
    const readiness = consolidationReadiness;
    if (!readiness?.canStart || !canCreateConsolidationRunLocal) {
      setError(
        l(
          "Missing permission: consolidation.run.create",
          "Eksik yetki: consolidation.run.create",
        ),
      );
      return;
    }

    const consolidationGroupId = toPositiveInt(readiness?.consolidationGroupId);
    const fiscalPeriodId = toPositiveInt(readiness?.fiscalPeriodId);
    if (!consolidationGroupId || !fiscalPeriodId) {
      setError(
        l(
          "Consolidation group and fiscal period are required.",
          "Konsolidasyon grubu ve mali donem zorunludur.",
        ),
      );
      return;
    }

    const officialRow = findOfficialConsolidationRow(
      cockpit?.worklist?.rows || [],
      readiness,
    );

    setRunningAction("start-consolidation-run");
    setError("");
    setActionMessage("");
    try {
      const response = await createOfficialConsolidationRun({
        consolidationGroupId,
        fiscalPeriodId,
        presentationCurrencyCode:
          officialRow?.presentationCurrencyCode ||
          cockpit?.scope?.presentationCurrencyCode ||
          undefined,
        versionNo: toPositiveInt(officialRow?.versionNo) || 1,
      });
      const runId = toPositiveInt(response?.runId);
      const canOpenStartedRun =
        Boolean(readiness?.userCanOpen) && canReadConsolidationRunLocal;
      setActionMessage(
        canOpenStartedRun
          ? response?.idempotent
            ? l(
                "Existing official consolidation run opened.",
                "Mevcut resmi konsolidasyon kosusu acildi.",
              )
            : l(
                "Official consolidation run started.",
                "Resmi konsolidasyon kosusu baslatildi.",
              )
          : l(
              "Official consolidation run started or already exists. A user with consolidation.run.read can open it.",
              "Resmi konsolidasyon kosusu baslatildi veya zaten mevcut. consolidation.run.read yetkisi olan bir kullanici acabilir.",
            ),
      );
      setReloadNonce((current) => current + 1);
      if (runId && canOpenStartedRun) {
        navigate(buildConsolidationRunPath({ consolidationGroupId, runId }));
      }
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.normalizedError?.message ||
          err?.message ||
          l(
            "Failed to start consolidation run.",
            "Konsolidasyon kosusu baslatilamadi.",
          ),
      );
    } finally {
      setRunningAction("");
    }
  }, [
    canCreateConsolidationRunLocal,
    cockpit,
    consolidationReadiness,
    l,
    navigate,
  ]);

  if (!canReadCockpit) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-lg font-semibold text-amber-900">
          {l("Close cockpit access is missing.", "Kapanis kokpiti erisimi eksik.")}
        </h1>
        <p className="mt-2 text-sm text-amber-800">
          {l(
            "This surface requires Close Cockpit / Read authority.",
            "Bu alan Kapanis Kokpiti / Oku yetkisini gerektirir.",
          )}
        </p>
      </div>
    );
  }

  const monitorProps = {
    rows: cockpit?.worklist?.rows || [],
    l,
    getBusinessStatusTone,
    getBusinessStatusLabel: (status) => getBusinessStatusLabel(status, l),
    getStaleStatusTone,
    getStaleStatusLabel: (status) => getStaleStatusLabel(status, l),
    getDueStateTone,
    getDueStateLabel: (status) => getDueStateLabel(status, l),
    formatDateTime,
    canCreateConsolidationRun:
      Boolean(consolidationReadiness?.userCanStart) &&
      canCreateConsolidationRunLocal,
    canReadConsolidationRun:
      Boolean(consolidationReadiness?.userCanOpen) &&
      canReadConsolidationRunLocal,
    onStartConsolidationRun,
    onOpenConsolidationRun,
    consolidationReadiness,
    startingConsolidationRun: runningAction === "start-consolidation-run",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {l("Close Cockpit", "Kapanis Kokpiti")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            {l(
              "See cycle readiness, merged blockers, and the provisioned participation set without changing existing source enforcement.",
              "Mevcut kaynak zorlamalarini degistirmeden dongu hazirligini, birlesik blokajlari ve provision edilen katilim kumesini gorun.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canAccessCycleManager ? (
            <Link
              to="/app/donem-sonu-islemler/yillik/kapanis-donguleri"
              className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100"
            >
              {l("Open close cycles", "Kapanis dongulerini ac")}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setReloadNonce((current) => current + 1)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {l("Refresh", "Yenile")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {actionMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {actionMessage}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {l("Close cycles", "Kapanis donguleri")}
            </h2>
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

          {canAccessCycleManager ? (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">
                {l("Lifecycle actions moved", "Yasam dongusu aksiyonlari tasindi")}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {l(
                  "Create, provision, and lock actions stay on the Close Cycles manager; this cockpit only exposes the governed consolidation start action when readiness allows it.",
                  "Olusturma, provision ve kilitleme aksiyonlari Kapanis Donguleri yoneticisinde kalir; bu kokpit yalnizca hazirlik izin verdiginde yonetilen konsolidasyon baslatma aksiyonunu gosterir.",
                )}
              </p>
              <Link
                to="/app/donem-sonu-islemler/yillik/kapanis-donguleri"
                className="mt-3 inline-flex rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100"
              >
                {l("Open close cycles", "Kapanis dongulerini ac")}
              </Link>
            </div>
          ) : null}

          <div className="space-y-2">
            {cycles.map((row) => {
              const isSelected = Number(row?.id) === Number(selectedCycleId);
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => replaceCycleSearchParams(row.id, cycleStatusFilter)}
                  className={`w-full rounded-2xl border p-3 text-left transition ${
                    isSelected
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">
                      {buildCyclePickerLabel(row, l)}
                    </div>
                    {renderStatusPill(
                      getCycleStatusLabel(row.status, l),
                      getCycleStatusTone(row.status),
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>
                      {l("Cycle id", "Dongu id")}: #{row.id || "-"}
                    </span>
                    <span>
                      {l("Fiscal period", "Mali donem")}: #{row.fiscalPeriodId || "-"}
                    </span>
                  </div>
                </button>
              );
            })}
            {!loadingCycles && cycles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                {l("No close cycles are available yet.", "Henuz kullanilabilir kapanis dongusu yok.")}
              </div>
            ) : null}
          </div>
        </aside>

        <main className="space-y-6">
          {loadingCockpit ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
              {l("Loading cockpit detail...", "Kokpit detayi yukleniyor...")}
            </div>
          ) : null}

          {!loadingCockpit && cockpit ? (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {renderStatusPill(
                        getCycleStatusLabel(cockpit?.row?.status, l),
                        getCycleStatusTone(cockpit?.row?.status),
                      )}
                      {renderStatusPill(
                        cockpit?.scope?.kind === "CONSOLIDATION_GROUP"
                          ? l("Group cycle", "Grup dongusu")
                          : l("Entity cycle", "Varlik dongusu"),
                        "border-slate-200 bg-slate-100 text-slate-700",
                      )}
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold text-slate-900">
                      {cockpit?.scope?.label || "-"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">{cockpit?.period?.label || "-"}</p>
                  </div>
                  <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {l("Cycle due date", "Dongu son tarihi")}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {formatDateTime(cockpit?.row?.dueAt)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {l("Presentation currency", "Sunum para birimi")}
                      </div>
                      <div className="mt-1 font-medium text-slate-900">
                        {cockpit?.scope?.presentationCurrencyCode || "-"}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <MetricCard
                  label={l("Completion", "Tamamlama")}
                  value={`${cockpit?.readiness?.completionPercent || 0}%`}
                  hint={`${cockpit?.readiness?.readyItems || 0} / ${cockpit?.readiness?.totalItems || 0}`}
                />
                <MetricCard
                  label={l("Active alerts", "Aktif uyarilar")}
                  value={cockpit?.alerts?.counts?.total || 0}
                  hint={l("Operational attention rows", "Operasyonel dikkat satirlari")}
                />
                <MetricCard
                  label={l("Due soon", "Suresi yaklasan")}
                  value={cockpit?.readiness?.dueSoonItems || 0}
                  hint={l("Not-ready rows inside SLA lead window", "SLA on pencere icindeki hazir olmayan satirlar")}
                />
                <MetricCard
                  label={l("Overdue", "Geciken")}
                  value={cockpit?.readiness?.overdueItems || 0}
                  hint={l("Not-ready rows past due date", "Son tarihi gecen hazir olmayan satirlar")}
                />
                <MetricCard
                  label={l("Blocked items", "Blokeli ogeler")}
                  value={cockpit?.readiness?.blockedItems || 0}
                  hint={l("Items with visible blockers", "Gorunur blokaji olan ogeler")}
                />
                <MetricCard
                  label={l("Stale items", "Guncel olmayan ogeler")}
                  value={cockpit?.readiness?.staleItems || 0}
                  hint={l("Rows with non-fresh stale state", "FRESH disi stale durumu olan satirlar")}
                />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">
                    {l("Management KPIs", "Yonetim KPI'lari")}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {l(
                      "PR-09 adds scenario-aware management monitoring on top of the existing close cockpit so leadership can read completion, bottlenecks, and entity heatmap pressure at once.",
                      "PR-09, liderligin tamamlama, darbo gaz ve entity isi haritasi baskisini tek seferde gorebilmesi icin mevcut kapanis kokpitinin ustune senaryo farkindalikli yonetim izleme ekler.",
                    )}
                  </p>
                </div>
                <KpiDashboardPanel kpiSnapshot={cockpit?.kpis} l={l} />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {l("Operational alerts", "Operasyonel uyarilar")}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {l(
                        "PR-05 groups action-required, due-soon, overdue, blocked, and stale attention rows on the same close surface.",
                        "PR-05, aksiyon gerekli, suresi yaklasan, geciken, blokeli ve stale dikkat satirlarini ayni kapanis yuzeyinde toplar.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                      {l("Action required", "Aksiyon gerekli")}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-indigo-900">
                      {cockpit?.alerts?.panels?.actionRequired?.total || 0}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                      {l("Overdue alerts", "Geciken uyarilar")}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-rose-900">
                      {cockpit?.alerts?.panels?.overdue?.total || 0}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                      {l("Due soon alerts", "Suresi yaklasan uyarilar")}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-amber-900">
                      {cockpit?.alerts?.panels?.dueSoon?.total || 0}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
                      {l("Blocked alerts", "Bloke uyarilari")}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-cyan-900">
                      {cockpit?.alerts?.panels?.blocked?.total || 0}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {l("Stale alerts", "Stale uyarilari")}
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {cockpit?.alerts?.panels?.stale?.total || 0}
                    </div>
                  </div>
                </div>
                <AlertList alertSnapshot={cockpit?.alerts} l={l} />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {l("Close checklist tasks", "Kapanis kontrol gorevleri")}
                    </h3>
                  </div>
                  <Link
                    to={buildTaskBoardPath(selectedCycleId)}
                    className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-cyan-300 hover:text-cyan-800"
                  >
                    {l("Open task board", "Gorev panosunu ac")}
                  </Link>
                </div>
                <TaskCockpitPanel taskSnapshot={cockpit?.tasks} cycleId={selectedCycleId} l={l} />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">
                    {l("Readiness by family", "Aile bazinda hazirlik")}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {l(
                      "Keep period close, local close, and consolidation visibility on one operational grid.",
                      "Donem kapanisi, yerel kapanis ve konsolidasyon gorunurlugunu tek bir operasyonel tabloda tutun.",
                    )}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="pb-3 pr-4 font-semibold">{l("Family", "Aile")}</th>
                        <th className="pb-3 pr-4 font-semibold">{l("Total", "Toplam")}</th>
                        <th className="pb-3 pr-4 font-semibold">{l("Ready", "Hazir")}</th>
                        <th className="pb-3 pr-4 font-semibold">{l("Blocked", "Blokeli")}</th>
                        <th className="pb-3 pr-4 font-semibold">{l("Expected only", "Sadece beklenen")}</th>
                        <th className="pb-3 font-semibold">{l("Stale", "Guncel degil")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(cockpit?.readiness?.byItemType || []).map((row) => (
                        <tr key={row.itemType} className="border-b border-slate-100">
                          <td className="py-3 pr-4 font-medium text-slate-900">
                            {getItemTypeLabel(row.itemType, l)}
                          </td>
                          <td className="py-3 pr-4 text-slate-700">{row.total}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.readyCount}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.blockedCount}</td>
                          <td className="py-3 pr-4 text-slate-700">{row.expectedOnlyCount}</td>
                          <td className="py-3 text-slate-700">{row.staleCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">
                    {l("Governed close journals", "Yonetilen kapanis yevmiyeleri")}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {l(
                      "PR-06 adds the journal-governance catalog on top of the existing journal and consolidation-adjustment runtimes, without replacing how those runtimes post today.",
                      "PR-06, mevcut yevmiye ve konsolidasyon duzeltme runtime'larinin bugun nasil post ettigini degistirmeden ustlerine yevmiye yonetim katalogunu ekler.",
                    )}
                  </p>
                </div>
                <JournalGovernancePanel journalSnapshot={cockpit?.journals} l={l} />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">
                    {l("Support schedules", "Destek cizelgeleri")}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {l(
                      "PR-07 materializes structured support schedules and disclosure packs from the cycle's provisioned participant set without turning on any new enforcement yet.",
                      "PR-07, henuz yeni bir enforcement acmadan destek cizelgelerini ve aciklama paketlerini dongunun provision edilen katilim kumesinden materialize eder.",
                    )}
                  </p>
                </div>
                <SupportSchedulesPanel supportScheduleSnapshot={cockpit?.supportSchedules} l={l} />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">
                    {l("Reconciliation controls", "Mutabakat kontrolleri")}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {l(
                      "PR-08 adds the first close-control layer beyond approvals by surfacing bank, subledger-vs-GL, clearing, and intercompany controls from the cycle scope.",
                      "PR-08, banka, alt defter-ve-GL, clearing ve intercompany kontrollerini dongu kapsamindan yuzeye tasiyarak onaylarin otesindeki ilk kapanis kontrol katmanini ekler.",
                    )}
                  </p>
                </div>
                <ReconciliationControlsPanel reconciliationSnapshot={cockpit?.reconciliations} l={l} />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {l("Merged blockers", "Birlesik blokajlar")}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {l(
                        "Merge live source review gates with cycle dependency blockers using the standard payload shape.",
                        "Canli kaynak inceleme gecitlerini dongu bagimlilik blokajlariyla standart payload sekliyle birlestirin.",
                      )}
                    </p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {cockpit?.blockers?.counts?.total || 0}
                  </div>
                </div>
                <BlockerList rows={cockpit?.blockers?.rows || []} l={l} />
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {l("Stale visibility", "Stale gorunurlugu")}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {l(
                        "Surface the latest upstream change behind every non-fresh row before it turns into silent process drift.",
                        "FRESH olmayan her satirin arkasindaki son ust-akis degisimini, sessiz surec kaymasina donusmeden once gorunur kilin.",
                      )}
                    </p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {cockpit?.stale?.total || 0}
                  </div>
                </div>
                <StaleList staleSnapshot={cockpit?.stale} l={l} />
              </section>

              {cockpit?.scope?.kind === "CONSOLIDATION_GROUP" ? (
                <GroupCloseMonitorPage {...monitorProps} />
              ) : (
                <EntityCloseMonitorPage {...monitorProps} />
              )}
            </>
          ) : null}

          {!loadingCockpit && !cockpit && !error ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              {selectedCycleListRow ? (
                <>
                  <div className="text-base font-semibold text-slate-700">
                    {buildCyclePickerLabel(selectedCycleListRow, l)}
                  </div>
                  <div className="mt-2">
                    {selectedCycleStatus === "PLANNED"
                      ? l(
                          "This planned cycle is visible, but provisioning now lives on the Close Cycles manager.",
                          "Bu planli dongu gorunur durumda, ancak provision artik Kapanis Donguleri yoneticisinde yer aliyor.",
                        )
                      : l(
                          "Cycle detail is not available on this read yet.",
                          "Bu okuma katmaninda dongu detayi henuz hazir degil.",
                        )}
                  </div>
                </>
              ) : (
                l(
                  "Select a close cycle to open the cockpit.",
                  "Kokpiti acmak icin bir kapanis dongusu secin.",
                )
              )}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
