const TONE_STYLES = Object.freeze({
  blue: {
    panel: "border-sky-200 bg-sky-50 text-sky-950",
    badge: "border-sky-200 bg-white/80 text-sky-800",
    tile: "border-white/70 bg-white/65 text-slate-950",
    helper: "text-sky-900/90",
  },
  emerald: {
    panel: "border-emerald-200 bg-emerald-50 text-emerald-950",
    badge: "border-emerald-200 bg-white/80 text-emerald-800",
    tile: "border-white/70 bg-white/65 text-slate-950",
    helper: "text-emerald-900/90",
  },
  amber: {
    panel: "border-amber-200 bg-amber-50 text-amber-950",
    badge: "border-amber-200 bg-white/80 text-amber-800",
    tile: "border-white/70 bg-white/65 text-slate-950",
    helper: "text-amber-950/90",
  },
  rose: {
    panel: "border-rose-200 bg-rose-50 text-rose-950",
    badge: "border-rose-200 bg-white/80 text-rose-800",
    tile: "border-white/70 bg-white/65 text-slate-950",
    helper: "text-rose-950/90",
  },
  slate: {
    panel: "border-slate-200 bg-slate-50 text-slate-900",
    badge: "border-slate-300 bg-white/80 text-slate-700",
    tile: "border-white/70 bg-white/65 text-slate-950",
    helper: "text-slate-700/90",
  },
});

function renderSummaryTile(key, label, value, tileClass) {
  if (!value) {
    return null;
  }
  return (
    <div key={key} className={`rounded-lg border px-3 py-2 ${tileClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function renderLinesSection(title, lines, tileClass) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }
  return (
    <div className={`rounded-lg border px-3 py-3 ${tileClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{title}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {lines.map((line, index) => (
          <li key={`${title}-${index}`}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function renderHistorySection(historyItems, tileClass, l) {
  if (!Array.isArray(historyItems) || historyItems.length === 0) {
    return null;
  }
  return (
    <div className={`rounded-lg border px-3 py-3 ${tileClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
        {l("Prior step history", "Onceki adim gecmisi")}
      </p>
      <div className="mt-2 space-y-2">
        {historyItems.map((item) => (
          <div key={item.key} className="rounded-md border border-white/70 bg-white/70 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {item.title}
            </p>
            <p className="mt-1 text-sm text-slate-900">{item.summary}</p>
            {item.note ? <p className="mt-1 text-xs text-slate-600">{item.note}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the shared runtime explainability panel for governed records.
 */
export default function GovernedRuntimeExplainabilityPanel({
  title = "",
  model = null,
  className = "",
  l = (en) => en,
}) {
  if (!model) {
    return null;
  }

  const styles = TONE_STYLES[model.tone] || TONE_STYLES.slate;
  const sectionClass = styles.tile;
  const summaryTiles = [
    renderSummaryTile(
      "current-step",
      l("Current step", "Guncel adim"),
      model.currentStepLabel,
      sectionClass
    ),
    renderSummaryTile(
      "required-package",
      l("Required package", "Gerekli paket"),
      model.requiredPackageLabel,
      sectionClass
    ),
    renderSummaryTile(
      "required-scope",
      l("Required scope", "Gerekli kapsam"),
      model.requiredScopeLabel,
      sectionClass
    ),
  ].filter(Boolean);
  const eligibleRoleLabels = Array.isArray(model.eligibleRoleLabels)
    ? model.eligibleRoleLabels
    : [];
  const factItems = Array.isArray(model.factItems) ? model.factItems : [];
  const noteItems = Array.isArray(model.noteItems) ? model.noteItems : [];
  const technicalItems = Array.isArray(model.technicalItems) ? model.technicalItems : [];
  const factSectionTitle =
    model.factSectionTitle || l("Routing context", "Yonlendirme baglami");

  return (
    <div className={`rounded-xl border px-4 py-4 ${styles.panel} ${className}`.trim()}>
      {title ? (
        <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{title}</p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles.badge}`}
          >
            {model.badgeLabel}
          </span>
          <p className="mt-2 text-sm font-semibold">{model.headline}</p>
          {model.supportingText ? (
            <p className={`mt-1 text-xs leading-5 ${styles.helper}`}>{model.supportingText}</p>
          ) : null}
        </div>
        {model.workflowStatusLabel ? (
          <div className="text-right text-[11px] font-medium uppercase tracking-wide opacity-80">
            {l("Workflow status", "Workflow durumu")}: {model.workflowStatusLabel}
          </div>
        ) : null}
      </div>

      {summaryTiles.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">{summaryTiles}</div>
      ) : null}

      {factItems.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
            {factSectionTitle}
          </p>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {factItems.map((item) => (
              <div
                key={`${item.label}-${item.value}`}
                className={`rounded-lg border px-3 py-3 ${sectionClass}`}
              >
                <dt className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                  {item.label}
                </dt>
                <dd className="mt-1 text-sm font-medium">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {model.eligibleActorSummary || eligibleRoleLabels.length > 0 ? (
        <div className={`mt-4 rounded-lg border px-3 py-3 ${sectionClass}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
            {l("Who can act next", "Siradaki islemi kim yapabilir")}
          </p>
          {model.eligibleActorSummary ? (
            <p className="mt-2 text-sm">{model.eligibleActorSummary}</p>
          ) : null}
          {eligibleRoleLabels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {eligibleRoleLabels.map((roleLabel) => (
                <span
                  key={roleLabel}
                  className="rounded-full border border-white/80 bg-white/75 px-2.5 py-1 text-[11px] font-medium text-slate-800"
                >
                  {roleLabel}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {renderLinesSection(l("Your access", "Erisiminiz"), model.userCapabilityLines, sectionClass)}

      {noteItems.length > 0 ? (
        <div className="mt-4 space-y-2">
          {noteItems.map((item) => (
            <div
              key={`${item.label}-${item.value}`}
              className={`rounded-lg border px-3 py-2 ${sectionClass}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                {item.label}
              </p>
              <p className="mt-1 text-sm">{item.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {renderHistorySection(model.historyItems, sectionClass, l)}
      </div>

      {technicalItems.length > 0 ? (
        <details className="mt-4 text-xs text-slate-700">
          <summary className="cursor-pointer font-semibold uppercase tracking-wide text-slate-800">
            {l("Technical detail", "Teknik detay")}
          </summary>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            {technicalItems.map((item) => (
              <div
                key={`${item.label}-${item.value}`}
                className="rounded-md border border-white/70 bg-white/60 px-3 py-2"
              >
                <dt className="font-semibold text-slate-700">{item.label}</dt>
                <dd className="mt-1 break-all text-slate-900">{item.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
