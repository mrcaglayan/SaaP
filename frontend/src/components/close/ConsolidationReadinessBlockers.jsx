import { useId } from "react";
import { Link } from "react-router-dom";
import {
  buildReadinessBlockerItems,
  getReadinessBlockerGroupLabel,
  groupReadinessBlockerItems,
} from "./consolidationReadinessUtils.js";

/**
 * Render grouped readiness blockers with recommended action text and safe links.
 */
export default function ConsolidationReadinessBlockers({
  readiness,
  memberRows,
  getBusinessStatusLabel,
  getStaleStatusLabel,
  l,
}) {
  const headingId = useId();

  if (!readiness) {
    return null;
  }

  const blockerItems = buildReadinessBlockerItems({
    readiness,
    memberRows,
    getBusinessStatusLabel,
    getStaleStatusLabel,
    l,
  });
  const blockerGroups = groupReadinessBlockerItems(blockerItems);

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-4">
        <h3 id={headingId} className="text-sm font-semibold text-slate-900 break-words">
          {l("Blocking reasons", "Bloke eden nedenler")}
        </h3>
        <p className="mt-1 text-sm text-slate-500 break-words">
          {l(
            "Open blocking items from here when a direct link is available.",
            "Dogrudan baglanti varsa bloke eden kalemleri buradan acin.",
          )}
        </p>
      </div>

      {blockerItems.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm font-semibold text-emerald-900 break-words">
            {l("No blocking reasons. All good.", "Bloke eden neden yok. Her sey iyi.")}
          </div>
          <p className="mt-1 text-sm text-emerald-800 break-words">
            {l(
              "If something blocks consolidation, it will appear here with direct links.",
              "Konsolidasyonu bloke eden bir konu olursa burada dogrudan baglantilarla gorunur.",
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {blockerGroups.map((group) => (
            <div key={group.group} className="min-w-0">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 break-words">
                {getReadinessBlockerGroupLabel(group.group, l)}
              </h4>
              <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="text-sm font-semibold text-slate-900 break-words">
                      {item.title}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-600 break-words">
                      {item.reason}
                    </p>
                    <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400 break-words">
                      {item.meta}
                    </div>
                    <div className="mt-3 min-w-0">
                      {item.to ? (
                        <Link
                          to={item.to}
                          className="inline-block max-w-full text-sm font-semibold text-sky-700 break-words hover:text-sky-900"
                        >
                          {item.action}
                        </Link>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-slate-700 break-words">
                            {l("Action", "Aksiyon")}: {item.action}
                          </div>
                          <div className="text-xs text-slate-500 break-words">
                            {l(
                              "No direct link is available for this blocker.",
                              "Bu blokaj icin dogrudan baglanti mevcut degil.",
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
