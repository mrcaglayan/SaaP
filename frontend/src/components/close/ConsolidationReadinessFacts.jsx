import { getMissingFactValue } from "./consolidationReadinessUtils.js";

/**
 * Render compact consolidation readiness facts derived from the existing payload.
 */
export default function ConsolidationReadinessFacts({ facts, l }) {
  if (!Array.isArray(facts) || facts.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 min-w-0 border-t border-slate-100 pt-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 break-words">
        {l("Key facts", "Ana bilgiler")}
      </div>
      <dl
        aria-label={l(
          "Consolidation readiness key facts",
          "Konsolidasyon hazirligi ana bilgileri",
        )}
        className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 break-words">
              {fact.label}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-slate-800 break-words">
              {fact.value || getMissingFactValue(l)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
