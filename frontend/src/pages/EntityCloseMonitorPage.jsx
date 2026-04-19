import { Link } from "react-router-dom";

function renderStatusPill(label, tone) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function renderBlockerSummary(blockers = [], l) {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return <span className="text-xs text-slate-400">{l("No blockers", "Bloke eden konu yok")}</span>;
  }

  const firstBlocker = blockers[0];
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-rose-700">{firstBlocker?.message || "-"}</div>
      {blockers.length > 1 ? (
        <div className="text-xs text-slate-500">
          {l("Additional blockers", "Ek blokajlar")}: {blockers.length - 1}
        </div>
      ) : null}
    </div>
  );
}

function renderAlertSummary(alerts = [], l) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return <span className="text-xs text-slate-400">{l("No active alerts", "Aktif uyari yok")}</span>;
  }

  const firstAlert = alerts[0];
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-slate-700">{firstAlert?.title || firstAlert?.message || "-"}</div>
      {alerts.length > 1 ? (
        <div className="text-xs text-slate-500">
          {l("Additional alerts", "Ek uyarilar")}: {alerts.length - 1}
        </div>
      ) : null}
    </div>
  );
}

function getScenarioLabel(scenarioCode, l) {
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

function renderSection({
  title,
  subtitle,
  rows,
  l,
  getBusinessStatusTone,
  getBusinessStatusLabel,
  getStaleStatusTone,
  getStaleStatusLabel,
  getDueStateTone,
  getDueStateLabel,
  formatDateTime,
}) {
  if (!rows.length) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {rows.length}
        </div>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {row.scopeLabel}
                  {row.bookId ? ` / ${row.bookLabel}` : ""}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {row.legalEntityLabel}
                  {row.operatingUnitId ? ` / ${row.operatingUnitLabel}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {renderStatusPill(
                  getBusinessStatusLabel(row.businessStatus),
                  getBusinessStatusTone(row.businessStatus),
                )}
                {renderStatusPill(
                  getStaleStatusLabel(row.staleStatus),
                  getStaleStatusTone(row.staleStatus),
                )}
                {renderStatusPill(
                  getDueStateLabel(row.dueState),
                  getDueStateTone(row.dueState),
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-4 xl:grid-cols-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {l("Link state", "Bag durumu")}
                </div>
                <div className="mt-1">{row.linkState === "LINKED" ? l("Linked", "Bagli") : l("Expected only", "Sadece beklenen")}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {l("Due date", "Son tarih")}
                </div>
                <div className="mt-1">{formatDateTime(row.dueAt)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {l("Due window", "Sure penceresi")}
                </div>
                <div className="mt-1">
                  {row.dueState === "OVERDUE"
                    ? `${row.overdueHours || 0}h`
                    : row.dueState === "DUE_SOON"
                      ? `${row.remainingHours || 0}h`
                      : "-"}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {l("Work item", "Is oge")}
                </div>
                <div className="mt-1">{row.itemKey}</div>
              </div>
              {row.itemType === "CONSOLIDATION_RUN" ? (
                <>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {l("Scenario", "Senaryo")}
                    </div>
                    <div className="mt-1">{getScenarioLabel(row.scenarioCode, l)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {l("Version", "Versiyon")}
                    </div>
                    <div className="mt-1">{row.versionNo || "-"}</div>
                  </div>
                </>
              ) : null}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {l("Blockers", "Blokajlar")}
              </div>
              {renderBlockerSummary(row.blockers, l)}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {l("Alerts", "Uyarilar")}
              </div>
              {renderAlertSummary(row.alerts, l)}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                {l("Current source", "Mevcut kaynak")}: {row.currentSourceTargetType || "-"}
              </div>
              {row.drillPath ? (
                <Link
                  to={row.drillPath}
                  className="text-sm font-semibold text-sky-700 hover:text-sky-900"
                >
                  {l("Open detail", "Detayi ac")}
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Render the legal-entity monitor view used by the PR-03 close cockpit.
 */
export default function EntityCloseMonitorPage({
  rows = [],
  l,
  getBusinessStatusTone,
  getBusinessStatusLabel,
  getStaleStatusTone,
  getStaleStatusLabel,
  getDueStateTone,
  getDueStateLabel,
  formatDateTime,
}) {
  const periodRows = rows.filter((row) => row.itemType === "PERIOD_CLOSE_RUN");
  const localCloseRows = rows.filter((row) => row.itemType === "LOCAL_CLOSE_PACK");
  const consolidationRows = rows.filter((row) => row.itemType === "CONSOLIDATION_RUN");

  return (
    <div className="space-y-5">
      {renderSection({
        title: l("Period Close Monitor", "Donem Kapanis Izleme"),
        subtitle: l(
          "Track technical period-close readiness by participating book.",
          "Katilimci defter bazinda teknik donem kapanis hazirligini izleyin.",
        ),
        rows: periodRows,
        l,
        getBusinessStatusTone,
        getBusinessStatusLabel,
        getStaleStatusTone,
        getStaleStatusLabel,
        getDueStateTone,
        getDueStateLabel,
        formatDateTime,
      })}
      {renderSection({
        title: l("Local Close Monitor", "Yerel Kapanis Izleme"),
        subtitle: l(
          "Review central and operating-unit local close participation rows.",
          "Merkez ve isletme birimi yerel kapanis katilim satirlarini inceleyin.",
        ),
        rows: localCloseRows,
        l,
        getBusinessStatusTone,
        getBusinessStatusLabel,
        getStaleStatusTone,
        getStaleStatusLabel,
        getDueStateTone,
        getDueStateLabel,
        formatDateTime,
      })}
      {renderSection({
        title: l("Consolidation Monitor", "Konsolidasyon Izleme"),
        subtitle: l(
          "Surface the expected consolidation run when the cycle includes it.",
          "Dongu bunu iceriyorsa beklenen konsolidasyon kosusunu gosterin.",
        ),
        rows: consolidationRows,
        l,
        getBusinessStatusTone,
        getBusinessStatusLabel,
        getStaleStatusTone,
        getStaleStatusLabel,
        getDueStateTone,
        getDueStateLabel,
        formatDateTime,
      })}
    </div>
  );
}
