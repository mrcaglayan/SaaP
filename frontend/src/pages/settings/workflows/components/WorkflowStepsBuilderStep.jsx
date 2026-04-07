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
  // PR-WGX-01: AP business template props
  apTemplates,
  apTemplateLabels,
  apBusinessLabels,
  selectedApTemplate,
  onSelectApTemplate,
  apBusinessPreviewLines,
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

          {isAp && apTemplates && apTemplateLabels ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {apBusinessLabels?.templateSectionTitle || "AP business flow template"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {apBusinessLabels?.templateSectionDescription || "Choose a predefined approval flow or customize the steps below."}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {apTemplates.map((template) => {
                  const meta = apTemplateLabels[template.id];
                  if (!meta) return null;
                  const isActive = selectedApTemplate === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => onSelectApTemplate(template.id)}
                      className={`rounded-2xl border px-4 py-3 text-left transition-colors ${isActive
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                          : "border-border bg-card hover:border-blue-300 hover:bg-blue-50/50"
                        }`}
                    >
                      <p className="text-sm font-medium text-foreground">{meta.label}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.description}</p>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => onSelectApTemplate("custom")}
                  className={`rounded-2xl border px-4 py-3 text-left transition-colors ${selectedApTemplate === "custom"
                      ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                      : "border-border bg-card hover:border-blue-300 hover:bg-blue-50/50"
                    }`}
                >
                  <p className="text-sm font-medium text-foreground">
                    {apBusinessLabels?.customTemplate || "Custom (configure manually)"}
                  </p>
                </button>
              </div>
            </div>
          ) : null}

          {isAp && Array.isArray(apBusinessPreviewLines) && apBusinessPreviewLines.length > 0 ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
                {apBusinessLabels?.businessPreviewTitle || "Business process preview"}
              </p>
              <div className="mt-2 space-y-1">
                {apBusinessPreviewLines.map((line, i) => (
                  <p key={i} className="text-sm leading-6 text-blue-900">{line}</p>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-blue-700/80">
                {apBusinessLabels?.effectivePermission}
              </p>
            </div>
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
                apBusinessLabels={apBusinessLabels}
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
                  className="min-h-55 font-mono text-xs"
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
