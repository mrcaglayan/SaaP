import { Link } from "react-router-dom";

function renderStatusPill(label, tone) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function groupRowsByEntity(rows = []) {
  const entityMap = new Map();
  for (const row of rows) {
    const key = row.legalEntityLabel || `entity:${row.legalEntityId || "unknown"}`;
    const existing = entityMap.get(key) || [];
    existing.push(row);
    entityMap.set(key, existing);
  }
  return [...entityMap.entries()].map(([entityLabel, entityRows]) => ({
    entityLabel,
    rows: entityRows,
  }));
}

function renderBlockerSummary(blockers = [], l) {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return <span className="text-xs text-slate-400">{l("No blockers", "Bloke eden konu yok")}</span>;
  }
  return (
    <div className="space-y-1">
      {blockers.slice(0, 2).map((blocker, index) => (
        <div key={`${blocker?.code || "blocker"}:${index}`} className="text-sm text-rose-700">
          {blocker?.message || "-"}
        </div>
      ))}
      {blockers.length > 2 ? (
        <div className="text-xs text-slate-500">
          {l("Additional blockers", "Ek blokajlar")}: {blockers.length - 2}
        </div>
      ) : null}
    </div>
  );
}

function renderAlertSummary(alerts = [], l) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return <span className="text-xs text-slate-400">{l("No active alerts", "Aktif uyari yok")}</span>;
  }
  return (
    <div className="space-y-1">
      <div className="text-sm text-slate-700">{alerts[0]?.title || alerts[0]?.message || "-"}</div>
      {alerts.length > 1 ? (
        <div className="text-xs text-slate-500">
          {l("Additional alerts", "Ek uyarilar")}: {alerts.length - 1}
        </div>
      ) : null}
    </div>
  );
}

function getScenarioTone(scenarioCode) {
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

/**
 * Render the consolidation-group monitor used by the PR-03 close cockpit.
 */
export default function GroupCloseMonitorPage({
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
  const consolidationRows = rows.filter((row) => row.itemType === "CONSOLIDATION_RUN");
  const memberRows = rows.filter((row) => row.itemType !== "CONSOLIDATION_RUN");
  const memberGroups = groupRowsByEntity(memberRows);

  return (
    <div className="space-y-5">
      {consolidationRows.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {l("Group Consolidation Monitor", "Grup Konsolidasyon Izleme")}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {l(
                  "Keep the expected OFFICIAL consolidation run visible beside entity close readiness.",
                  "Beklenen OFFICIAL konsolidasyon kosusunu varlik kapanis hazirligi ile birlikte gorunur tutun.",
                )}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {consolidationRows.map((row) => (
              <div
                key={row.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {row.consolidationGroupLabel}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {l("Run name", "Kosu adi")}: {row.runName || "-"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {row.scenarioCode
                      ? renderStatusPill(
                          getScenarioLabel(row.scenarioCode, l),
                          getScenarioTone(row.scenarioCode),
                        )
                      : null}
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
                <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-5">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {l("Presentation currency", "Sunum para birimi")}
                    </div>
                    <div className="mt-1">{row.presentationCurrencyCode || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {l("Scenario / version", "Senaryo / versiyon")}
                    </div>
                    <div className="mt-1">
                      {row.scenarioCode
                        ? `${getScenarioLabel(row.scenarioCode, l)} / ${row.versionNo || 1}`
                        : "-"}
                    </div>
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
                      {l("Link state", "Bag durumu")}
                    </div>
                    <div className="mt-1">{row.linkState === "LINKED" ? l("Linked", "Bagli") : l("Expected only", "Sadece beklenen")}</div>
                  </div>
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
                <div className="mt-3 flex justify-end">
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
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {l("Entity Close Monitor", "Varlik Kapanis Izleme")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {l(
              "Use the provisioned in-cycle participation rows as the authoritative multi-book member set.",
              "Dongu icinde provision edilen katilim satirlarini yetkili cok defterli uye kumesi olarak kullanin.",
            )}
          </p>
        </div>
        <div className="space-y-4">
          {memberGroups.map((group) => (
            <div
              key={group.entityLabel}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">{group.entityLabel}</div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {group.rows.length}
                </div>
              </div>
              <div className="space-y-3">
                {group.rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-2xl border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {row.scopeLabel}
                          {row.bookId ? ` / ${row.bookLabel}` : ""}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{row.itemKey}</div>
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
                    <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-4">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          {l("Item type", "Oge tipi")}
                        </div>
                        <div className="mt-1">{row.itemType}</div>
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
                          {l("Link state", "Bag durumu")}
                        </div>
                        <div className="mt-1">{row.linkState === "LINKED" ? l("Linked", "Bagli") : l("Expected only", "Sadece beklenen")}</div>
                      </div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {l("Blockers", "Blokajlar")}
                      </div>
                      {renderBlockerSummary(row.blockers, l)}
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {l("Alerts", "Uyarilar")}
                      </div>
                      {renderAlertSummary(row.alerts, l)}
                    </div>
                    <div className="mt-3 flex justify-end">
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
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
