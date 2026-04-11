import { Link } from "react-router-dom";

function getToneClasses(tone) {
  if (tone === "sky") {
    return "border-sky-200 bg-sky-50";
  }
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50";
  }
  if (tone === "violet") {
    return "border-violet-200 bg-violet-50";
  }
  return "border-slate-200 bg-white";
}

function GuidanceLink({ link }) {
  const classes =
    "rounded-2xl border px-3 py-3 text-sm font-medium transition";

  if (link?.locked) {
    return (
      <div
        title={link.title || ""}
        className={`${classes} cursor-not-allowed border-dashed border-slate-300 bg-slate-50 text-slate-500`}
      >
        <div className="text-slate-700">{link.label}</div>
        {link.title ? (
          <div className="mt-1 text-xs leading-5">{link.title}</div>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      to={link.to}
      className={`${classes} border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50`}
    >
      {link.label}
    </Link>
  );
}

/**
 * Renders the shared right-rail guidance panel for security-admin workbenches,
 * combining operating guidance with permission-aware companion route links.
 */
export default function SecurityWorkbenchGuidancePanel({
  eyebrow = "",
  title = "",
  description = "",
  items = [],
  linksTitle = "",
  links = [],
  footer = "",
  tone = "slate",
}) {
  return (
    <aside
      className={`rounded-[28px] border px-5 py-5 shadow-sm xl:sticky xl:top-24 ${getToneClasses(
        tone
      )}`}
    >
      {eyebrow ? (
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {eyebrow}
        </div>
      ) : null}
      <h2 className="mt-2 text-lg font-semibold text-slate-950">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      ) : null}

      {Array.isArray(items) && items.length > 0 ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <section
              key={`${item.title}:${item.description}`}
              className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3"
            >
              <div className="text-sm font-semibold text-slate-900">{item.title}</div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {item.description}
              </p>
            </section>
          ))}
        </div>
      ) : null}

      {Array.isArray(links) && links.length > 0 ? (
        <section className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {linksTitle}
          </div>
          <div className="mt-3 space-y-2">
            {links.map((link) => (
              <GuidanceLink key={`${link.label}:${link.to || link.title || ""}`} link={link} />
            ))}
          </div>
        </section>
      ) : null}

      {footer ? (
        <p className="mt-5 text-xs leading-5 text-slate-500">{footer}</p>
      ) : null}
    </aside>
  );
}
