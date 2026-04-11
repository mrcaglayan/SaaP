import { Link } from "react-router-dom";

function HeaderMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-slate-950">{value}</div>
    </div>
  );
}

/**
 * Keeps the role-specific back path, core metadata, and compact summary counts
 * together so the detail screen reads like a single-record admin page.
 */
export default function RoleDetailHeader({
  backLabel = "Back to role list",
  backTo = "",
  eyebrow = "Role detail",
  metadataLine = "",
  metrics = [],
  roleName = "",
}) {
  const visibleMetrics = Array.isArray(metrics)
    ? metrics.filter((metric) => metric?.label)
    : [];

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-3xl">
          <Link
            to={backTo}
            className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {backLabel}
          </Link>

          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {eyebrow}
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">{roleName}</h2>
            {metadataLine ? (
              <div className="mt-2 text-sm leading-6 text-slate-500">{metadataLine}</div>
            ) : null}
          </div>
        </div>

        {visibleMetrics.length > 0 ? (
          <div className="grid min-w-[280px] gap-2 sm:grid-cols-3">
            {visibleMetrics.map((metric) => (
              <HeaderMetric
                key={`${String(metric.label)}:${String(metric.value)}`}
                label={metric.label}
                value={metric.value}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
