import { useId } from "react";
import { ExternalLink, Loader2, PlayCircle } from "lucide-react";
import ConsolidationReadinessBlockers from "./ConsolidationReadinessBlockers.jsx";
import ConsolidationReadinessFacts from "./ConsolidationReadinessFacts.jsx";
import ConsolidationReadinessStepper from "./ConsolidationReadinessStepper.jsx";
import {
  getConsolidationReadinessActionHelper,
  getConsolidationReadinessActionState,
  getConsolidationReadinessDescription,
  getConsolidationReadinessFacts,
  getConsolidationReadinessLabel,
  getConsolidationReadinessNextActionCopy,
  getConsolidationReadinessTone,
  getConsolidationReadinessWhyLines,
  getOwnerHint,
} from "./consolidationReadinessUtils.js";

function renderStatusPill(label, tone) {
  return (
    <span
      aria-label={label}
      className={`inline-flex max-w-full rounded-full border px-2.5 py-1 text-left text-xs font-semibold leading-5 whitespace-normal break-words ${tone}`}
    >
      {label}
    </span>
  );
}

function ReadinessAction({
  readiness,
  canCreateConsolidationRun,
  canReadConsolidationRun,
  onStartConsolidationRun,
  onOpenConsolidationRun,
  startingConsolidationRun,
  describedById,
  l,
}) {
  const actionState = getConsolidationReadinessActionState({
    readiness,
    canCreateConsolidationRun,
    canReadConsolidationRun,
    l,
  });

  if (actionState.kind === "start") {
    return (
      <button
        type="button"
        onClick={onStartConsolidationRun}
        disabled={startingConsolidationRun}
        aria-busy={startingConsolidationRun || undefined}
        aria-describedby={describedById}
        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-center text-sm font-semibold text-emerald-800 whitespace-normal break-words hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {startingConsolidationRun ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{actionState.buttonLabel}</span>
      </button>
    );
  }

  if (actionState.kind === "open") {
    const buttonClass =
      actionState.actionTone === "cyan"
        ? "inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-center text-sm font-semibold text-cyan-800 whitespace-normal break-words hover:bg-cyan-100 sm:w-auto"
        : "inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-center text-sm font-semibold text-sky-800 whitespace-normal break-words hover:bg-sky-100 sm:w-auto";
    return (
      <button
        type="button"
        onClick={onOpenConsolidationRun}
        aria-describedby={describedById}
        className={buttonClass}
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        <span>{actionState.buttonLabel}</span>
      </button>
    );
  }

  return (
    <span
      aria-describedby={describedById}
      className="text-sm font-semibold text-slate-600 break-words"
    >
      {actionState.text}
    </span>
  );
}

/**
 * Render the top consolidation readiness card for group close cockpit users.
 */
export function ConsolidationReadinessSummaryCard({
  readiness,
  memberRows,
  canCreateConsolidationRun,
  canReadConsolidationRun,
  onStartConsolidationRun,
  onOpenConsolidationRun,
  startingConsolidationRun,
  l,
}) {
  const headingId = useId();
  const actionHelperId = useId();

  if (!readiness) {
    return null;
  }

  const facts = getConsolidationReadinessFacts(readiness, memberRows, l);
  const actionHelper = getConsolidationReadinessActionHelper({
    readiness,
    canCreateConsolidationRun,
    canReadConsolidationRun,
    l,
  });

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 id={headingId} className="min-w-0 text-lg font-semibold text-slate-900 break-words">
              {l("Consolidation Readiness", "Konsolidasyon Hazirligi")}
            </h2>
            {renderStatusPill(
              getConsolidationReadinessLabel(readiness.status, l),
              getConsolidationReadinessTone(readiness.status),
            )}
          </div>

          <p className="max-w-3xl text-sm text-slate-600 break-words">
            {getConsolidationReadinessDescription(readiness, l)}
          </p>

          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {l("Next action", "Sonraki aksiyon")}
              </div>
              <div className="mt-1 font-semibold text-slate-800 break-words">
                {getConsolidationReadinessNextActionCopy(readiness, l, {
                  canCreateConsolidationRun,
                  canReadConsolidationRun,
                })}
              </div>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {l("Owner / responsible role", "Sahip / sorumlu rol")}
              </div>
              <div className="mt-1 font-semibold text-slate-800 break-words">
                {getOwnerHint(readiness, l)}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 w-full shrink-0 space-y-2 xl:w-72">
          <ReadinessAction
            readiness={readiness}
            canCreateConsolidationRun={canCreateConsolidationRun}
            canReadConsolidationRun={canReadConsolidationRun}
            onStartConsolidationRun={onStartConsolidationRun}
            onOpenConsolidationRun={onOpenConsolidationRun}
            startingConsolidationRun={startingConsolidationRun}
            describedById={actionHelperId}
            l={l}
          />
          <p id={actionHelperId} className="text-xs leading-5 text-slate-500 break-words">
            {actionHelper}
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <ConsolidationReadinessStepper status={readiness.status} l={l} />
      </div>

      <ConsolidationReadinessFacts facts={facts} l={l} />
    </section>
  );
}

/**
 * Render the visible explanation for why the current readiness status exists.
 */
export function ConsolidationReadinessWhyPanel({ readiness, l }) {
  const headingId = useId();

  if (!readiness) {
    return null;
  }

  const lines = getConsolidationReadinessWhyLines(readiness, l);

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4"
    >
      <h3 id={headingId} className="text-sm font-semibold text-slate-900 break-words">
        {l("Why this status?", "Bu durum neden?")}
      </h3>
      <div className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
        {lines.map((line, index) => (
          <p key={`${line}:${index}`} className="break-words">
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}

/**
 * Compose the top readiness UX sections for the group close monitor.
 */
export function ConsolidationReadinessSection({
  readiness,
  memberRows,
  canCreateConsolidationRun,
  canReadConsolidationRun,
  onStartConsolidationRun,
  onOpenConsolidationRun,
  startingConsolidationRun,
  getBusinessStatusLabel,
  getStaleStatusLabel,
  l,
}) {
  if (!readiness) {
    return null;
  }

  return (
    <>
      <ConsolidationReadinessSummaryCard
        readiness={readiness}
        memberRows={memberRows}
        canCreateConsolidationRun={canCreateConsolidationRun}
        canReadConsolidationRun={canReadConsolidationRun}
        onStartConsolidationRun={onStartConsolidationRun}
        onOpenConsolidationRun={onOpenConsolidationRun}
        startingConsolidationRun={startingConsolidationRun}
        l={l}
      />
      <ConsolidationReadinessWhyPanel readiness={readiness} l={l} />
      <ConsolidationReadinessBlockers
        readiness={readiness}
        memberRows={memberRows}
        getBusinessStatusLabel={getBusinessStatusLabel}
        getStaleStatusLabel={getStaleStatusLabel}
        l={l}
      />
    </>
  );
}

/**
 * Render the compact readiness strip inside the consolidation run row.
 */
export function ConsolidationRunReadinessStrip({
  readiness,
  canCreateConsolidationRun,
  canReadConsolidationRun,
  onStartConsolidationRun,
  onOpenConsolidationRun,
  startingConsolidationRun,
  l,
}) {
  const actionHelperId = useId();

  if (!readiness) {
    return null;
  }

  const readinessDescription = getConsolidationReadinessDescription(readiness, l);
  const readinessNextAction = getConsolidationReadinessNextActionCopy(readiness, l, {
    canCreateConsolidationRun,
    canReadConsolidationRun,
  });
  const readinessActionHelper = getConsolidationReadinessActionHelper({
    readiness,
    canCreateConsolidationRun,
    canReadConsolidationRun,
    l,
  });

  return (
    <div className="mt-4 flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {renderStatusPill(
            getConsolidationReadinessLabel(readiness.status, l),
            getConsolidationReadinessTone(readiness.status),
          )}
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 break-words">
            {l("Ready to consolidate", "Konsolidasyona hazirlik")}
          </span>
        </div>
        {readinessDescription ? (
          <div className="text-sm text-slate-700 break-words">{readinessDescription}</div>
        ) : null}
        {readinessNextAction ? (
          <div className="text-xs text-slate-500 break-words">
            {l("Next action", "Sonraki aksiyon")}: {readinessNextAction}
          </div>
        ) : null}
        <div className="text-xs text-slate-500 break-words">
          {l("Owner", "Sahip")}: {getOwnerHint(readiness, l)}
        </div>
      </div>
      <div className="flex min-w-0 shrink-0 flex-col items-stretch gap-2 sm:items-end">
        <ReadinessAction
          readiness={readiness}
          canCreateConsolidationRun={canCreateConsolidationRun}
          canReadConsolidationRun={canReadConsolidationRun}
          onStartConsolidationRun={onStartConsolidationRun}
          onOpenConsolidationRun={onOpenConsolidationRun}
          startingConsolidationRun={startingConsolidationRun}
          describedById={actionHelperId}
          l={l}
        />
        {readinessActionHelper ? (
          <p id={actionHelperId} className="max-w-sm text-xs leading-5 text-slate-500 break-words sm:text-right">
            {readinessActionHelper}
          </p>
        ) : null}
      </div>
    </div>
  );
}
