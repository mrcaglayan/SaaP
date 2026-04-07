import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Renders the workflow setup page header.
 */
export default function WorkflowSetupHeader({ l, currentStep, totalSteps }) {
  return (
    <Card className="rounded-3xl border-border/80">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="space-y-2">
          <Badge variant="secondary" className="rounded-full px-3">
            {l("Workflow Governance", "Workflow Yonetimi")}
          </Badge>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {l("Set up an approval workflow", "Bir onay workflow'u kurun")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {l(
                "Define who must approve AP postings, period closes, consolidations, and local close packs, then decide where those rules apply.",
                "AP kayitlari, donem kapanislari, konsolidasyonlar ve yerel kapanis paketleri icin kimin onay verecegini tanimlayin, sonra bu kurallarin nerede gecerli olacagini belirleyin."
              )}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-center shadow-sm">
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{currentStep}</span>{" "}
            {l("of", "/")} {totalSteps}
          </div>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {l("Wizard Steps", "Sihirbaz Adimlari")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
