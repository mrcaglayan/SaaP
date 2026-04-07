import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BookOpen, Clock, FileText, Layers } from "lucide-react";

const PROCESS_ICONS = {
  AP_DOCUMENT_POSTING: FileText,
  PERIOD_CLOSE: Clock,
  CONSOLIDATION_RUN: Layers,
  LOCAL_CLOSE_PACK: BookOpen,
};

/**
 * Chooses the process type for the workflow being configured.
 */
export default function WorkflowTypeStep({
  l,
  processTypes,
  value,
  onChange,
  onNext,
  workflowTypeLabels,
  workflowTypeMeta,
}) {
  const selectedMeta = workflowTypeMeta[String(value || "").toUpperCase()] || null;

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle>{l("Step 1 - Choose workflow type", "Adim 1 - Workflow turunu secin")}</CardTitle>
          <CardDescription>
            {l(
              "Choose the business process this workflow will control. Each process type carries different approval defaults and review rules.",
              "Bu workflow'un yonetecegi is surecini secin. Her surec tipi farkli onay varsayimlari ve inceleme kurallari tasir."
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {processTypes.map((processType) => {
              const meta = workflowTypeMeta[String(processType || "").toUpperCase()] || {};
              const Icon = PROCESS_ICONS[processType] || FileText;
              const selected = value === processType;

              return (
                <button
                  key={processType}
                  type="button"
                  onClick={() => onChange(processType)}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-all",
                    selected
                      ? meta.tone?.active || "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "border-border bg-card hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                        meta.tone?.icon || "border-border bg-muted text-muted-foreground"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">
                        {workflowTypeLabels[processType] || processType}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {meta.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedMeta ? (
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {l("Recommended setup", "Onerilen kurulum")}
                </div>
                <Badge variant="secondary">{workflowTypeLabels[value] || value}</Badge>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {Object.entries(selectedMeta.recommended || {}).map(([key, recommendedValue]) => (
                  <div key={key} className="rounded-xl border border-border bg-background px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      {key.replace(/([A-Z])/g, " $1")}
                    </div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {recommendedValue}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="justify-end">
          <Button disabled={!value} onClick={onNext}>
            {l("Continue to Target Scope", "Hedef kapsama devam et")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
