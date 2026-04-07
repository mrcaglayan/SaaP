import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle } from "lucide-react";

function SummaryRow({ label, value, done, fallback }) {
  return (
    <div className="flex items-start gap-3 border-b border-border/70 py-2 last:border-0">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
      )}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">
          {done ? value : fallback}
        </p>
      </div>
    </div>
  );
}

/**
 * Shows live guidance beside the workflow setup wizard.
 */
export default function WorkflowSetupSidebar({
  l,
  currentStep,
  processTypeLabel,
  definition,
  stepDrafts,
  hasTargetScope = false,
  assignmentLabel,
  assignmentStatus,
  recommendation,
  workflowPreviewText,
  assignmentEffectText,
  quickGuide,
}) {
  const stepCount = Array.isArray(stepDrafts) ? stepDrafts.length : 0;
  const progressValue = Math.max(0, Math.min(100, ((currentStep - 1) / 4) * 100));

  return (
    <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
      <Card className="rounded-3xl border-border/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{l("Current setup", "Guncel kurulum")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SummaryRow
            label={l("Workflow type", "Workflow turu")}
            value={processTypeLabel}
            done={currentStep >= 2}
            fallback={l("Not selected yet", "Henuz secilmedi")}
          />
          <SummaryRow
            label={l("Target scope", "Hedef kapsam")}
            value={assignmentLabel}
            done={hasTargetScope}
            fallback={l("Not selected yet", "Henuz secilmedi")}
          />
          <SummaryRow
            label={l("Workflow", "Workflow")}
            value={definition?.name || definition?.code}
            done={Boolean(definition)}
            fallback={l("Not selected yet", "Henuz secilmedi")}
          />
          <SummaryRow
            label={l("Approval steps", "Onay adimlari")}
            value={
              stepCount > 0
                ? `${stepCount} ${l("steps", "adim")}`
                : l("No steps yet", "Henuz adim yok")
            }
            done={currentStep >= 5}
            fallback={l("Save steps to continue", "Devam etmek icin adimlari kaydedin")}
          />
          <SummaryRow
            label={l("Status", "Durum")}
            value={assignmentStatus || "-"}
            done={hasTargetScope}
            fallback={l("Choose target scope first", "Once hedef kapsami secin")}
          />

          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{l("Setup progress", "Kurulum ilerlemesi")}</span>
              <span>{Math.round(progressValue)}%</span>
            </div>
            <Progress value={progressValue} className="h-2" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-border/80 bg-muted/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">
              {recommendation?.title || l("Recommendation", "Oneri")}
            </CardTitle>
            <Badge variant="secondary">{processTypeLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {(recommendation?.points || []).map((point) => (
            <p key={point}>{point}</p>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-border/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{l("Quick guide", "Hizli rehber")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {(quickGuide || []).map((item) => (
            <p key={item}>{item}</p>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-blue-200 bg-blue-50/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-blue-900">
            {l("Live preview", "Canli onizleme")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-blue-900">
          <p>{workflowPreviewText}</p>
          <p className="text-blue-800">{assignmentEffectText}</p>
        </CardContent>
      </Card>
    </div>
  );
}
