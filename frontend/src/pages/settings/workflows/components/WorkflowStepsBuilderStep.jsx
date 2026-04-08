import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
} from "../../../../../../shared/cariDocumentWorkflowGovernance.js";
import ApprovalStepCard from "./ApprovalStepCard.jsx";
import WorkflowExplainabilityPreviewPanel from "./WorkflowExplainabilityPreviewPanel.jsx";

/**
 * Edits the step chain for one workflow definition.
 */
export default function WorkflowStepsBuilderStep({
  l,
  processType,
  selectedDefinition,
  targetScopeLabel = "",
  targetScopeEffectText = "",
  stepDrafts,
  stepScopeTypes,
  stepScopeLabels,
  workflowStepPackageOptions = [],
  workflowStepBusinessRoleOptions = [],
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
  workflowPresetOptions = [],
  selectedWorkflowPreset = null,
  workflowPresetPreview = null,
  workflowPresetComparison = null,
  onSelectWorkflowPreset,
  onCloneWorkflowPreset,
  onResetStepsToSelectedPreset,
  workflowStepValidation = null,
  coverageDiagnosticsLoading = false,
  coverageDiagnosticsError = "",
  canReadCoverageDiagnostics = false,
  workflowExplainabilityPreview = null,
  apBusinessLabels,
}) {
  const isAp = String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;
  const validationEntries = Array.isArray(workflowStepValidation?.steps)
    ? workflowStepValidation.steps
    : [];
  const validationByIndex = new Map(validationEntries.map((entry) => [entry.index, entry]));

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>{l("Step 4 - Define approval steps", "Adim 4 - Onay adimlarini tanimlayin")}</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {l(
                "Each step now binds to a workflow package at a specific organizational scope. Business roles stay visible only as human-friendly eligibility helpers.",
                "Her adim artik belirli bir organizasyon kapsaminda bir workflow paketine baglanir. Is rolleri yalnizca okunabilir uygunluk yardimcisi olarak gorunur."
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

          {targetScopeLabel ? (
            <Alert>
              <AlertTitle>{l("Current target scope", "Guncel hedef kapsam")}</AlertTitle>
              <AlertDescription>
                {targetScopeLabel}
                {targetScopeEffectText ? ` - ${targetScopeEffectText}` : ""}
              </AlertDescription>
            </Alert>
          ) : null}

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

          {workflowStepValidation ? (
            <Alert
              variant={workflowStepValidation.hasBlockingIssues ? "destructive" : "default"}
              className={
                workflowStepValidation.hasBlockingIssues
                  ? ""
                  : workflowStepValidation.hasWarnings
                    ? "border-amber-200 bg-amber-50/90 text-amber-950"
                    : "border-emerald-200 bg-emerald-50/90 text-emerald-950"
              }
            >
              <AlertTitle>{workflowStepValidation.summaryTitle}</AlertTitle>
              <AlertDescription
                className={
                  workflowStepValidation.hasBlockingIssues
                    ? ""
                    : workflowStepValidation.hasWarnings
                      ? "text-amber-900"
                      : "text-emerald-900"
                }
              >
                {workflowStepValidation.summaryText}
              </AlertDescription>
            </Alert>
          ) : null}

          {canReadCoverageDiagnostics && coverageDiagnosticsLoading ? (
            <Alert>
              <AlertTitle>{l("Checking in-scope actors", "Kapsam ici aktorler kontrol ediliyor")}</AlertTitle>
              <AlertDescription>
                {l(
                  "The system is checking whether active users currently exist for the selected step scopes and packages.",
                  "Sistem, secilen adim kapsamlari ve paketleri icin su anda aktif kullanici olup olmadigini kontrol ediyor."
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {canReadCoverageDiagnostics && !coverageDiagnosticsLoading && coverageDiagnosticsError ? (
            <Alert>
              <AlertTitle>{l("Coverage warnings unavailable", "Kapsam uyarilari kullanilamiyor")}</AlertTitle>
              <AlertDescription>{coverageDiagnosticsError}</AlertDescription>
            </Alert>
          ) : null}

          {!canReadCoverageDiagnostics ? (
            <Alert>
              <AlertTitle>{l("Coverage warnings need read access", "Kapsam uyarilari icin okuma erisimi gerekir")}</AlertTitle>
              <AlertDescription>
                {l(
                  "workflow.assignment.read is required to warn when no in-scope users currently match a step package.",
                  "Bir adim paketine uyan kapsam ici kullanici olmadiginda uyari verebilmek icin workflow.assignment.read gerekir."
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {Array.isArray(workflowPresetOptions) && workflowPresetOptions.length > 0 ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {l("Workflow preset", "Workflow preset")}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {l(
                    "Choose a business-readable preset, preview the package flow, then clone its baseline into this tenant workflow.",
                    "Is dilinde bir preset secin, paket akisina onizleme yapin, sonra temelini bu tenant workflow'una kopyalayin."
                  )}
                </p>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {workflowPresetOptions.map((preset) => {
                  const isActive =
                    String(selectedWorkflowPreset?.code || "") === String(preset.code || "");
                  return (
                    <button
                      key={preset.code}
                      type="button"
                      onClick={() => onSelectWorkflowPreset(preset.code)}
                      className={`rounded-2xl border px-4 py-3 text-left transition-colors ${isActive
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                          : "border-border bg-card hover:border-blue-300 hover:bg-blue-50/50"
                        }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {preset.displayName}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            {preset.primaryScope || preset.defaultScope || "-"}
                          </Badge>
                          <Badge
                            variant={preset.usesExtension ? "outline" : "secondary"}
                          >
                            {preset.stepCount} {l("steps", "adim")}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {preset.description}
                      </p>
                      {preset.usesExtension ? (
                        <p className="mt-2 text-[11px] font-medium text-amber-700">
                          {preset.extensionNote ||
                            l(
                              "Extension-backed preset",
                              "Extension destekli preset"
                            )}
                        </p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {selectedWorkflowPreset ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
                    {l("Selected preset", "Secilen preset")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-blue-950">
                    {selectedWorkflowPreset.displayName}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-blue-800/80">
                    {workflowPresetPreview?.summaryText || selectedWorkflowPreset.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{selectedWorkflowPreset.primaryScope}</Badge>
                  <Badge variant="secondary">
                    {selectedWorkflowPreset.stepCount} {l("steps", "adim")}
                  </Badge>
                  <Badge
                    variant={selectedWorkflowPreset.usesExtension ? "outline" : "secondary"}
                  >
                    {selectedWorkflowPreset.usesExtension
                      ? l("Extension", "Extension")
                      : l("Shipped", "Hazir")}
                  </Badge>
                </div>
              </div>

              {Array.isArray(workflowPresetPreview?.lines) &&
              workflowPresetPreview.lines.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {workflowPresetPreview.lines.map((line, index) => (
                    <p
                      key={`${selectedWorkflowPreset.code}-preview-${index}`}
                      className="text-sm leading-6 text-blue-950"
                    >
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}

              {workflowPresetComparison ? (
                <div className="mt-4 rounded-2xl border border-white/70 bg-white/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {l("Preset comparison", "Preset karsilastirma")}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-950">
                        {workflowPresetComparison.statusLabel}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        {workflowPresetComparison.summaryText}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        {workflowPresetComparison.supportNote}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={onCloneWorkflowPreset}
                        disabled={
                          !canWrite ||
                          !workflowPresetComparison.canApply ||
                          workflowPresetComparison.matchesBaseline
                        }
                      >
                        {l(
                          "Clone preset into this workflow",
                          "Preseti bu workflow'a kopyala"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={onResetStepsToSelectedPreset}
                        disabled={
                          !canWrite ||
                          !workflowPresetComparison.canApply ||
                          workflowPresetComparison.matchesBaseline
                        }
                      >
                        {l(
                          "Reset to preset baseline",
                          "Preset temeline sifirla"
                        )}
                      </Button>
                    </div>
                  </div>

                  {workflowPresetComparison.differenceLines.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      {workflowPresetComparison.differenceLines.slice(0, 4).map((line, index) => (
                        <p
                          key={`${selectedWorkflowPreset.code}-difference-${index}`}
                          className="text-xs leading-5 text-slate-700"
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
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

          <WorkflowExplainabilityPreviewPanel
            title={l("Explainability preview", "Aciklanabilirlik onizlemesi")}
            previewModel={workflowExplainabilityPreview}
            tone="blue"
          />

          {isAp && apBusinessLabels?.effectivePermission ? (
            <p className="text-xs leading-5 text-blue-700/80">
              {apBusinessLabels.effectivePermission}
            </p>
          ) : null}

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
                workflowStepPackageOptions={workflowStepPackageOptions}
                workflowStepBusinessRoleOptions={workflowStepBusinessRoleOptions}
                onChange={(field, value) => onStepFieldChange(index, field, value)}
                onRemove={() => onRemoveStep(index)}
                disableRemove={stepDrafts.length <= 1}
                previewText={buildStepPreviewText(step)}
                validation={validationByIndex.get(index) || null}
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
          <div className="flex flex-col items-end gap-2">
            {workflowStepValidation?.hasBlockingIssues ? (
              <p className="text-xs font-medium text-destructive">
                {l(
                  "Fix the blocking step issues before saving.",
                  "Kaydetmeden once engelleyici adim sorunlarini duzeltin."
                )}
              </p>
            ) : null}
            <Button
              onClick={onSubmit}
              disabled={
                saving ||
                !canWrite ||
                !selectedDefinition ||
                Boolean(workflowStepValidation?.hasBlockingIssues)
              }
            >
              {saving
                ? l("Saving...", "Kaydediliyor...")
                : l(
                    "Save steps and continue to review",
                    "Adimlari kaydet ve incelemeye devam et"
                  )}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
