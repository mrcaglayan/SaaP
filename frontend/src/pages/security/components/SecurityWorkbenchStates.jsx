import { Link } from "react-router-dom";

function getToneClasses(tone) {
  if (tone === "info") {
    return "border-sky-200 bg-sky-50 text-sky-950";
  }
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  if (tone === "danger") {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }
  return "border-slate-200 bg-white text-slate-900";
}

function renderAction(action) {
  if (!action?.label) {
    return null;
  }

  const classes =
    "inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50";

  if (typeof action.onClick === "function") {
    return (
      <button type="button" onClick={action.onClick} className={classes}>
        {action.label}
      </button>
    );
  }

  if (action.to) {
    return (
      <Link to={action.to} className={classes}>
        {action.label}
      </Link>
    );
  }

  return null;
}

function StatePanel({
  title = "",
  description = "",
  tone = "neutral",
  action = null,
  children = null,
}) {
  return (
    <section
      className={`rounded-[28px] border px-5 py-5 shadow-sm ${getToneClasses(
        tone
      )}`}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm leading-6 opacity-90">{description}</p>
      ) : null}
      {children ? <div className="mt-3 text-sm leading-6">{children}</div> : null}
      {action ? <div className="mt-4">{renderAction(action)}</div> : null}
    </section>
  );
}

/**
 * Renders the shared loading card for workbench-level loading states so
 * security-admin surfaces keep the same skeleton language.
 */
export function SecurityWorkbenchLoadingState({
  title = "",
  description = "",
}) {
  return <StatePanel title={title} description={description} tone="neutral" />;
}

/**
 * Renders the shared empty-state card for workbench-level empty or pre-action
 * states, optionally with a single follow-up action.
 */
export function SecurityWorkbenchEmptyState({
  title = "",
  description = "",
  action = null,
}) {
  return (
    <StatePanel
      title={title}
      description={description}
      action={action}
      tone="info"
    />
  );
}

/**
 * Renders the shared informational, warning, success, or error notice card for
 * security-admin workbenches.
 */
export function SecurityWorkbenchNoticeState({
  title = "",
  description = "",
  tone = "neutral",
  action = null,
  children = null,
}) {
  return (
    <StatePanel
      title={title}
      description={description}
      tone={tone}
      action={action}
    >
      {children}
    </StatePanel>
  );
}
