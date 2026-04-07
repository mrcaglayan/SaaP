import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

/**
 * Shows the guided workflow setup progress rail.
 */
export default function WorkflowSetupProgress({
  currentStep,
  steps,
  canReachStep,
  onSelectStep,
}) {
  return (
    <Card className="rounded-3xl border-border/80">
      <CardContent className="overflow-x-auto px-3 py-4 sm:px-4">
        <div className="flex items-center gap-0 pb-1">
          {steps.map((step, index) => {
            const stepNo = step.id || index + 1;
            const active = stepNo === currentStep;
            const done = stepNo < currentStep;
            const reachable = typeof canReachStep === "function" ? canReachStep(stepNo) : true;

            return (
              <div key={stepNo} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onSelectStep?.(stepNo)}
                  disabled={!reachable}
                  className={cn(
                    "flex min-w-[116px] flex-col items-center rounded-2xl px-3 py-2 text-center transition-all",
                    active
                      ? "bg-primary/10 text-primary"
                      : done
                        ? "text-emerald-700 hover:bg-emerald-50"
                        : reachable
                          ? "text-muted-foreground hover:bg-muted/60"
                          : "cursor-not-allowed text-muted-foreground/40"
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all",
                      active
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {done ? <CheckCircle2 className="h-4 w-4" /> : stepNo}
                  </div>
                  <span className="text-xs font-semibold leading-tight">{step.label}</span>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">
                    {step.description}
                  </span>
                </button>

                {index < steps.length - 1 ? (
                  <div
                    className={cn(
                      "mx-1 h-0.5 w-8 shrink-0 rounded",
                      done ? "bg-emerald-300" : "bg-border"
                    )}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
