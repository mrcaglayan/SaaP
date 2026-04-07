import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, CheckCircle2, Clock, FileText, Layers } from "lucide-react";

const PROCESS_ICONS = {
  AP_DOCUMENT_POSTING: FileText,
  PERIOD_CLOSE: Clock,
  CONSOLIDATION_RUN: Layers,
  LOCAL_CLOSE_PACK: BookOpen,
};

function ReviewStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value || "-"}</p>
    </div>
  );
}

/**
 * Summarizes the saved workflow setup before the user leaves the page.
 */
export default function WorkflowReviewStep({
  l,
  definition,
  stepDrafts,
  assignmentForm,
  assignmentLabel,
  workflowType,
  workflowTypeLabel,
  workflowPreviewText,
  assignmentEffectText,
  onBack,
}) {
  const Icon = PROCESS_ICONS[String(workflowType || "").toUpperCase()] || FileText;

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>{l("Step 5 - Review your setup", "Adim 5 - Kurulumu gozden gecirin")}</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {l(
                "Check the saved workflow definition, approval steps, and assignment scope before leaving the page.",
                "Sayfadan ayrilmadan once kaydedilen workflow tanimini, onay adimlarini ve atama kapsamini kontrol edin."
              )}
            </p>
          </div>

          <Alert className="border-emerald-200 bg-emerald-50/90 text-emerald-900">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>{l("Setup saved", "Kurulum kaydedildi")}</AlertTitle>
            <AlertDescription className="text-emerald-800">
              {assignmentForm?.status === "ACTIVE"
                ? l(
                    "This workflow is active from the selected effective date and now governs matching records.",
                    "Bu workflow secilen gecerlilik tarihinden itibaren aktiftir ve eslesen kayitlari yonetir."
                  )
                : l(
                    "This workflow is saved in inactive mode. Activate the assignment when you are ready.",
                    "Bu workflow pasif modda kaydedildi. Hazir oldugunuzda atamayi aktif hale getirin."
                  )}
            </AlertDescription>
          </Alert>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {l("Workflow type", "Workflow turu")}
                  </p>
                  <p className="mt-1 text-base font-semibold text-foreground">{workflowTypeLabel}</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {l("Workflow definition", "Workflow tanimi")}
                  </p>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    {definition?.name || "-"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {definition?.code || "-"}
                  </p>
                </div>
                <Badge
                  variant={
                    definition?.isActive || definition?.is_active ? "default" : "secondary"
                  }
                >
                  {definition?.isActive || definition?.is_active
                    ? l("Active", "Aktif")
                    : l("Inactive", "Pasif")}
                </Badge>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ReviewStat label={l("Workflow code", "Workflow kodu")} value={definition?.code} />
            <ReviewStat
              label={l("Version", "Versiyon")}
              value={definition?.versionNo || definition?.version_no || "1"}
            />
            <ReviewStat
              label={l("Approval steps", "Onay adimlari")}
              value={String(Array.isArray(stepDrafts) ? stepDrafts.length : 0)}
            />
            <ReviewStat label={l("Assignment status", "Atama durumu")} value={assignmentForm?.status} />
          </div>

          <div className="rounded-3xl border border-border bg-muted/20 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {l("Approval path", "Onay yolu")}
            </p>
            <p className="mt-2 text-sm leading-6 text-foreground">{workflowPreviewText}</p>
          </div>

          <div className="rounded-3xl border border-blue-200 bg-blue-50/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              {l("Assignment outcome", "Atama sonucu")}
            </p>
            <p className="mt-2 text-sm leading-6 text-blue-900">{assignmentEffectText}</p>
            <p className="mt-3 text-sm font-medium text-blue-900">
              {l("Applied scope", "Uygulanan kapsam")}: {assignmentLabel}
            </p>
          </div>
        </CardContent>

        <CardFooter className="justify-start">
          <Button type="button" variant="outline" onClick={onBack}>
            {l("Back to Assignment", "Atamaya geri don")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
