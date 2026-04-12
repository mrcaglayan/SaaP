import { Link } from "react-router-dom";

function TabPill({ active, count, label, locked, title, to }) {
  const classes = `inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
    active
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
  }`;

  const countNode =
    count === undefined || count === null ? null : (
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
        }`}
      >
        {count}
      </span>
    );

  if (locked) {
    return (
      <span
        title={title}
        className={`${classes} cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-white`}
      >
        <span>{label}</span>
        {countNode}
      </span>
    );
  }

  return (
    <Link to={to} className={classes}>
      <span>{label}</span>
      {countNode}
    </Link>
  );
}

/**
 * Renders the shared workbench tab card so each security-admin family keeps
 * the same tab grammar, copy layout, and permission-lock affordances.
 */
export default function SecurityWorkbenchTabsCard({
  title = "",
  description = "",
  tabs = [],
}) {
  const hasHeader = Boolean(title) || Boolean(description);
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
      {hasHeader ? (
        <div className="mb-4">
          {title ? (
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {title}
            </div>
          ) : null}
          {description ? (
            <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <TabPill
            key={tab.key}
            active={Boolean(tab.active)}
            count={tab.count}
            label={tab.label}
            locked={Boolean(tab.locked)}
            title={tab.title || ""}
            to={tab.to}
          />
        ))}
      </div>
    </section>
  );
}
