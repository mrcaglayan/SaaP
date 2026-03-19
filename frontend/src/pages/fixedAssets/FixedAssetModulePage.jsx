import { useI18n } from "../../i18n/useI18n.js";

function SectionCard({ title, items, tone = "slate" }) {
  const toneClasses =
    tone === "amber"
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";

  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${toneClasses}`}>
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">
        {title}
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {items.map((item) => (
          <li key={item} className="rounded-xl bg-slate-50 px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function FixedAssetModulePage({
  title,
  route,
  description,
  currentScope = [],
  nextSteps = [],
  decisionItems = [],
}) {
  const { t, l } = useI18n();
  const resolvedTitle =
    title ||
    t(["sidebar", "byPath", route], route || l("Fixed assets", "Demirbaslar"));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-cyan-600 via-teal-600 to-emerald-600 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-50/90">
            {l("Fixed assets module scaffold", "Demirbas modul iskeleti")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold">{resolvedTitle}</h1>
          <p className="mt-2 max-w-3xl text-sm text-cyan-50/95">{description}</p>
        </div>
        <div className="grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">
              {l(
                "This route now has a dedicated fixed-assets page shell instead of the shared generic placeholder.",
                "Bu rota artik ortak genel placeholder yerine ozel bir demirbas sayfa iskeleti kullaniyor."
              )}
            </p>
            <p className="mt-2">
              {l(
                "Backend migrations, validators, SQL services, routes, and OpenAPI generation still need to be delivered from the FA tracker.",
                "Backend migration, validator, SQL servis, route ve OpenAPI uretimi teslimleri FA tracker uzerinden hala tamamlanmali."
              )}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {l("Route", "Rota")}
            </p>
            <p className="mt-2 rounded-xl bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100">
              {route || l("Not assigned", "Atanmadi")}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title={l("Current scope", "Mevcut kapsam")}
          items={currentScope}
        />
        <SectionCard
          title={l("Next build items", "Siradaki gelistirme kalemleri")}
          items={nextSteps}
        />
      </div>

      {decisionItems.length > 0 ? (
        <SectionCard
          title={l("Locked decisions", "Kilitlenmis kararlar")}
          items={decisionItems}
          tone="amber"
        />
      ) : null}
    </div>
  );
}
