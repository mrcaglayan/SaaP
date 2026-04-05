import { Link } from "react-router-dom";
import { useI18n } from "../i18n/useI18n.js";

function formatEntitySummary(summary, l) {
  const readyCheckCount = Number(summary?.readyCheckCount || 0);
  const totalCheckCount = Number(summary?.totalCheckCount || 0);
  const blockingCheckCount = Number(summary?.blockingCheckCount || 0);
  return l(
    `${readyCheckCount}/${totalCheckCount} activation checks are ready. ${blockingCheckCount} blocking check(s) remain.`,
    `${readyCheckCount}/${totalCheckCount} aktivasyon kontrolu hazir. ${blockingCheckCount} engelleyici kontrol kaldi.`
  );
}

function getStatusBadgeTone(status, ready) {
  if (ready || String(status || "").trim().toUpperCase() === "READY") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (String(status || "").trim().toUpperCase() === "NOT_STARTED") {
    return "bg-slate-100 text-slate-700";
  }
  return "bg-amber-100 text-amber-800";
}

function getStatusLabel(status, ready, l) {
  if (ready || String(status || "").trim().toUpperCase() === "READY") {
    return l("Ready", "Hazir");
  }
  if (String(status || "").trim().toUpperCase() === "NOT_STARTED") {
    return l("Not started", "Baslamadi");
  }
  return l("In progress", "Devam ediyor");
}

/**
 * Renders the activation overview for every visible legal entity and the
 * grouped detailed checklist for the focused entity.
 */
export default function LegalEntityActivationChecklist({
  entities = [],
  onFocusLegalEntity = null,
}) {
  const { l } = useI18n();
  const focusedEntity =
    entities.find((entity) => entity?.isFocused) || null;

  return (
    <div className="space-y-4">
      {entities.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {entities.map((entity) => (
            <div
              key={`activation-entity-${entity.legalEntityId}`}
              className={`rounded-xl border px-3 py-3 ${
                entity.isFocused
                  ? "border-sky-300 bg-white shadow-sm"
                  : "border-sky-200 bg-white/90"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {entity.label}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {formatEntitySummary(entity.summary, l)}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeTone(
                    entity.status,
                    entity.ready
                  )}`}
                >
                  {getStatusLabel(entity.status, entity.ready, l)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {entity.isFocused ? (
                  <span className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 font-semibold text-sky-900">
                    {l("Current focus", "Mevcut odak")}
                  </span>
                ) : typeof onFocusLegalEntity === "function" ? (
                  <button
                    type="button"
                    onClick={() => onFocusLegalEntity(entity.legalEntityId)}
                    className="rounded-lg border border-sky-300 bg-white px-3 py-2 font-semibold text-sky-900"
                  >
                    {l("Focus this entity", "Bu entity'ye odaklan")}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {focusedEntity?.groups?.length ? (
        <div className="space-y-3">
          {focusedEntity.groups.map((group) => {
            const groupReady = group.items.every((item) => item.ready);
            return (
              <div
                key={`activation-group-${focusedEntity.legalEntityId}-${group.key}`}
                className="rounded-xl border border-sky-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {group.title}
                    </div>
                    {group.description ? (
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        {group.description}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      groupReady
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {groupReady ? l("Ready", "Hazir") : l("Action", "Aksiyon")}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {group.items.map((item) => (
                    <div
                      key={`activation-item-${group.key}-${item.key}`}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900">
                          {item.title}
                        </div>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            item.ready
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {item.ready ? l("Ready", "Hazir") : l("Action", "Aksiyon")}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">
                        {item.detail}
                      </p>
                      {item.actionPath ? (
                        <Link
                          to={item.actionPath}
                          className="mt-3 inline-flex text-xs font-semibold text-sky-800 hover:text-sky-950"
                        >
                          {item.actionLabel || l("Open relevant surface", "Ilgili ekrani ac")}
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
