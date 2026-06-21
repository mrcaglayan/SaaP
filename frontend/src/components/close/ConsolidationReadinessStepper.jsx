import { useId } from "react";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";

const CONSOLIDATION_READINESS_STEPS = Object.freeze([
  {
    status: "WAITING_FOR_ENTITY_CLOSE",
    label: (l) => l("Entity close packs", "Varlik kapanis paketleri"),
  },
  {
    status: "READY_TO_START",
    label: (l) => l("Ready to start", "Baslamaya hazir"),
  },
  {
    status: "IN_PROGRESS",
    label: (l) => l("Consolidation in progress", "Konsolidasyon devam ediyor"),
  },
  {
    status: "READY_TO_FINALIZE",
    label: (l) => l("Ready for final review", "Nihai incelemeye hazir"),
  },
  {
    status: "LOCKED",
    label: (l) => l("Locked", "Kilitlendi"),
  },
]);

function getConsolidationReadinessStepIndex(status) {
  const normalizedStatus = String(status || "").trim().toUpperCase();
  return CONSOLIDATION_READINESS_STEPS.findIndex(
    (step) => step.status === normalizedStatus,
  );
}

function getStepperItemClasses(stepState) {
  if (stepState === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (stepState === "current") {
    return "border-sky-300 bg-sky-50 text-sky-900 ring-2 ring-sky-100";
  }
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function getStepperIcon(stepState) {
  if (stepState === "completed") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />;
  }
  if (stepState === "current") {
    return <CircleDot className="h-4 w-4 text-sky-700" aria-hidden="true" />;
  }
  return <Circle className="h-4 w-4 text-slate-400" aria-hidden="true" />;
}

function getStepperStateLabel(stepState, l) {
  if (stepState === "completed") {
    return l("Completed", "Tamamlandi");
  }
  if (stepState === "current") {
    return l("Current step", "Guncel adim");
  }
  return l("Upcoming", "Sonraki");
}

/**
 * Render the consolidation readiness journey using the backend readiness status.
 */
export default function ConsolidationReadinessStepper({ status, l }) {
  const currentStepDescriptionId = useId();
  const currentStepIndex = getConsolidationReadinessStepIndex(status);
  const currentStepLabel =
    currentStepIndex >= 0
      ? CONSOLIDATION_READINESS_STEPS[currentStepIndex].label(l)
      : l("Unknown step", "Bilinmeyen adim");

  return (
    <div className="min-w-0">
      <div className="mb-3 text-xs font-semibold text-slate-500 break-words">
        {l("Consolidation journey", "Konsolidasyon yolculugu")}
      </div>
      <p id={currentStepDescriptionId} className="sr-only">
        {l("Current consolidation readiness step", "Guncel konsolidasyon hazirlik adimi")}:{" "}
        {currentStepLabel}
      </p>
      <ol
        aria-label={l("Consolidation readiness journey", "Konsolidasyon hazirlik yolculugu")}
        aria-describedby={currentStepDescriptionId}
        className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        {CONSOLIDATION_READINESS_STEPS.map((step, index) => {
          const stepState =
            currentStepIndex < 0
              ? "upcoming"
              : index < currentStepIndex
                ? "completed"
                : index === currentStepIndex
                  ? "current"
                  : "upcoming";
          const stateLabel = getStepperStateLabel(stepState, l);

          return (
            <li
              key={step.status}
              aria-current={stepState === "current" ? "step" : undefined}
              className={`min-w-0 overflow-hidden rounded-2xl border p-3 ${getStepperItemClasses(stepState)}`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">{getStepperIcon(stepState)}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-5 break-words">
                    {step.label(l)}
                  </div>
                  <div className="mt-1 text-xs font-medium break-words opacity-80">
                    {stateLabel}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
