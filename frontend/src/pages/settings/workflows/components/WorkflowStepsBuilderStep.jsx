import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
} from "../../../../../../shared/cariDocumentWorkflowGovernance.js";
import ApprovalStepCard from "./ApprovalStepCard.jsx";

/**
 * Edits the step chain for one workflow definition.
 */
export default function WorkflowStepsBuilderStep({
  l,
  processType,
  selectedDefinition,
  stepDrafts,
  stepScopeTypes,
  stepScopeLabels,
  onStepFieldChange,
  onAddStep,
  onRemoveStep,
  onResetStepsToDefaults,
  stepsJson,
  onChangeStepsJson,
  stepsJsonError,
  showAdvancedJson,
  onToggleAdvancedJson,
  workflowPreviewText,
  buildStepPreviewText,
  onSubmit,
  saving,
  canWrite,
  onBack,
}) {
  const isAp = String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>{l("Step 3 - Define approval steps", "Adim 3 - Onay adimlarini tanimlayin")}</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {l(
                "Each step defines who approves at a specific organizational level and in what order. The sequence runs from top to bottom.",
                "Her adim, belirli bir organizasyon seviyesinde kimin hangi sirada onay verecegini tanimlar. Sira yukaridan asagiya calisir."
              )}
            </p>
          </div>

          <Alert>
            <AlertTitle>
              {selectedDefinition
                ? `${selectedDefinition.code} (${selectedDefinition.processType})`
                : l("Choose a workflow definition first", "Once workflow tanimi secin")}
            </AlertTitle>
            <AlertDescription>{workflowPreviewText}</AlertDescription>
          </Alert>

          {isAp ? (
            <Alert>
              <AlertTitle>{l("AP reviewer rule", "AP inceleyen kurali")}</AlertTitle>
              <AlertDescription>
                {l(
                  "AP workflow steps must keep the reviewer permission empty. Reviewer authority comes from the assignment scope.",
                  "AP workflow adimlarinda inceleyen yetkisi bos kalmalidir. Inceleyen yetkisi atama kapsamindan gelir."
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onResetStepsToDefaults}>
              {l("Reset to defaults", "Varsayilanlara don")}
            </Button>
            <Button variant="secondary" onClick={onAddStep}>
              {l("Add approval step", "Onay adimi ekle")}
            </Button>
            <Button variant="ghost" onClick={onToggleAdvancedJson}>
              {showAdvancedJson
                ? l("Hide advanced JSON", "Gelismis JSON'u gizle")
                : l("Show advanced JSON", "Gelismis JSON'u goster")}
            </Button>
          </div>

          <div className="space-y-3">
            {stepDrafts.map((step, index) => (
              <ApprovalStepCard
                key={`workflow-step-${index}`}
                l={l}
                index={index}
                step={step}
                processType={processType}
                stepScopeTypes={stepScopeTypes}
                stepScopeLabels={stepScopeLabels}
                onChange={(field, value) => onStepFieldChange(index, field, value)}
                onRemove={() => onRemoveStep(index)}
                disableRemove={stepDrafts.length <= 1}
                previewText={buildStepPreviewText(step)}
              />
            ))}
          </div>

          {showAdvancedJson ? (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {l("Advanced step JSON", "Gelismis adim JSON")}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {l(
                    "Visual edits keep this JSON synchronized. Use it only for bulk edits or template import.",
                    "Gorsel duzenlemeler bu JSON'u senkron tutar. Bunu sadece toplu duzenleme veya sablon ice aktarimi icin kullanin."
                  )}
                </p>
                <Textarea
                  value={stepsJson}
                  onChange={(event) => onChangeStepsJson(event.target.value)}
                  className="min-h-[220px] font-mono text-xs"
                />
                {stepsJsonError ? (
                  <p className="text-xs font-medium text-destructive">{stepsJsonError}</p>
                ) : null}
              </div>
            </>
          ) : null}
        </CardContent>

        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" onClick={onBack}>
            {l("Back", "Geri")}
          </Button>
          <Button onClick={onSubmit} disabled={saving || !canWrite || !selectedDefinition}>
            {saving ? l("Saving...", "Kaydediliyor...") : l("Save steps and continue", "Adimlari kaydet ve devam et")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
