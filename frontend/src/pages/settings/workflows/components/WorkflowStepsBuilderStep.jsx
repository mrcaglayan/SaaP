
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

function SummaryInfoBox({ label, value, subtext, tone = "default" }) {
  const valueToneClassName =
    tone === "danger"
      ? "text-rose-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "success"
          ? "text-emerald-700"
          : "text-slate-900";

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-900">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className={`mt-2 text-sm font-semibold ${valueToneClassName}`}>{value}</div>
      {subtext ? <div className="mt-1 text-sm text-slate-600">{subtext}</div> : null}
    </div>
  );
}
function DiagnosticNotice({ title, text, tone = "slate" }) {
  const toneClassName =
    tone === "danger"
      ? "border-rose-200 bg-rose-50/80 text-rose-800"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/80 text-amber-800"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-xl border p-3 ${toneClassName}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-sm leading-6">{text}</div>
    </div>
  );
}
function getApStepActionLabel(actionCode, l) {
  const normalizedActionCode = String(actionCode || "").trim().toUpperCase();
  if (normalizedActionCode === "DRAFT") {
    return l("Draft", "Taslak");
  }
  if (normalizedActionCode === "SUBMIT") {
    return l("Submit", "Gonder");
  }
  if (normalizedActionCode === "APPROVE") {
    return l("Approve", "Onayla");
  }
  if (normalizedActionCode === "POST") {
    return l("Post", "Kaydet");
  }
  return l("Step", "Adim");
}

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
  const blockingIssueCount = Number(workflowStepValidation?.blockingIssueCount || 0);
  const warningCount = Number(workflowStepValidation?.warningCount || 0);
  const canSaveSteps =
    !saving &&
    canWrite &&
    selectedDefinition !== null &&
    !workflowStepValidation?.hasBlockingIssues;
  const validationHighlights = validationEntries
    .flatMap((entry) =>
      (Array.isArray(entry?.allIssues) ? entry.allIssues : []).map((issue) => ({
        ...issue,
        stepNo: entry.stepNo,
      }))
    )
    .slice(0, 2);
  const explainabilityLeadEntry = Array.isArray(workflowExplainabilityPreview?.entries)
    ? workflowExplainabilityPreview.entries[0]
    : null;
  const selectedPresetApplied = Boolean(
    selectedWorkflowPreset && workflowPresetComparison?.matchesBaseline
  );
  const stepTable = (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-260 text-sm">
        <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <tr>
            <th className="px-4 py-3">{l("Step", "Adim")}</th>
            <th className="px-4 py-3">
              {isAp ? l("Action", "Eylem") : l("Action label", "Islem etiketi")}
            </th>
            <th className="px-4 py-3">
              {isAp
                ? (apBusinessLabels?.atWhichScope ||
                  l("At which organizational scope", "Hangi organizasyon kapsaminda"))
                : l("Step scope type", "Adim kapsam tipi")}
            </th>
            <th className="px-4 py-3">{l("Required package", "Gerekli paket")}</th>
            <th className="px-4 py-3">{l("Minimum approvals", "Minimum onay")}</th>
            <th className="px-4 py-3">{l("Self approval", "Kendi onayi")}</th>
            <th className="px-4 py-3">{l("Escalation hours", "Escalation saati")}</th>
            <th className="px-4 py-3">{l("Status", "Durum")}</th>
            <th className="px-4 py-3">{l("Action", "Islem")}</th>
          </tr>
        </thead>
        <tbody>
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
              onChange={(field, value) => onStepFieldChange(index, field, value)}
              onRemove={() => onRemoveStep(index)}
              disableRemove={stepDrafts.length <= 1}
              previewText={buildStepPreviewText(step)}
              validation={validationByIndex.get(index) || null}
              apBusinessLabels={apBusinessLabels}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
  const advancedJsonEditor = showAdvancedJson ? (
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
  ) : null;
  if (isAp) {
    const healthTone = workflowStepValidation?.hasBlockingIssues
      ? "danger"
      : workflowStepValidation?.hasWarnings
        ? "warning"
        : "success";
    const healthValue = workflowStepValidation?.hasBlockingIssues
      ? l(
        `${blockingIssueCount} blocker(s), ${warningCount} warning(s)`,
        `${blockingIssueCount} engel, ${warningCount} uyari`
      )
      : workflowStepValidation?.hasWarnings
        ? l(`${warningCount} warning(s)`, `${warningCount} uyari`)
        : l("Checks passed", "Kontroller gecti");
    return (
      <div className="space-y-5">
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {l("Workflow governance", "Workflow yonetimi")}
                </div>
                <CardTitle className="mt-1 text-xl">
                  {l("Step 4 - Define AP workflow steps", "Adim 4 - AP workflow adimlarini tanimlayin")}
                </CardTitle>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {l(
                    "Business-first layout. Read the AP flow first, then edit the rows that define who owns each action.",
                    "Is odakli duzen. Once AP akisini okuyun, sonra her eylemin sahibini belirleyen satirlari duzenleyin."
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="border-slate-200 bg-white" onClick={onBack}>
                  {l("Back", "Geri")}
                </Button>
                <Button type="button" variant="outline" className="border-slate-200 bg-white" onClick={onResetStepsToDefaults}>
                  {l("Reset", "Sifirla")}
                </Button>
                <Button
                  type="button"
                  className="bg-slate-900 text-white hover:bg-slate-800"
                  onClick={onSubmit}
                  disabled={!canSaveSteps}
                >
                  {saving
                    ? l("Saving...", "Kaydediliyor...")
                    : l(
                      "Save steps and continue",
                      "Adimlari kaydet ve devam et"
                    )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            <div className="grid gap-3 border-b border-slate-200 px-5 py-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryInfoBox
                label={l("Definition", "Tanim")}
                value={selectedDefinition?.code || l("Not selected", "Secilmedi")}
                subtext={
                  selectedDefinition?.processType ||
                  l("Choose a workflow definition first.", "Once workflow tanimi secin.")
                }
              />
              <SummaryInfoBox
                label={l("Target scope", "Hedef kapsam")}
                value={targetScopeLabel || l("Not selected", "Secilmedi")}
                subtext={
                  targetScopeEffectText ||
                  l(
                    "Posting ownership will follow the step scope you define below.",
                    "Kayit sahipligi asagida tanimladiginiz adim kapsamlarini izleyecektir."
                  )
                }
              />
              <SummaryInfoBox
                label={l("Health", "Saglik")}
                value={healthValue}
                subtext={
                  workflowStepValidation?.summaryText ||
                  l(
                    "Run through the step rows to validate blockers and rollout warnings.",
                    "Engelleyici sorunlari ve canliya alma uyarilarini kontrol etmek icin adim satirlarini gozden gecirin."
                  )
                }
                tone={healthTone}
              />
              <SummaryInfoBox
                label={l("Design mode", "Tasarim modu")}
                value={l("Manual action-step flow", "Manuel eylem-adim akisi")}
                subtext={l(
                  "No preset is used. Every AP step saves explicit action, scope, and package binding.",
                  "Preset kullanilmaz. Her AP adimi acik eylem, kapsam ve paket bagini kaydeder."
                )}
              />
            </div>
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {l("Workflow path", "Workflow akisi")}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {l("Readable business flow preview", "Okunabilir is akisi onizlemesi")}
                  </div>
                </div>
                <Badge variant="secondary">
                  {stepDrafts.length} {l("steps", "adim")}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {stepDrafts.map((step, index) => {
                  const scopeLabel = stepScopeLabels[step?.stageScopeType] || step?.stageScopeType || "-";
                  return (
                    <div key={`workflow-path-${index}`} className="flex items-center gap-2">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                          {l("Step", "Adim")} {index + 1}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {getApStepActionLabel(step?.actionCode, l)}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {scopeLabel}
                        </div>
                      </div>
                      {index < stepDrafts.length - 1 ? (
                        <span className="text-slate-400">-&gt;</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {l("Step list", "Adim listesi")}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {l(
                      "Flat readable editor with the main business columns first. Open details only when you need helper roles or issue text.",
                      "Ana is kolonlarini once gosteren duz ve okunabilir editor. Yardimci roller veya sorun metinleri gerektiginde ayrintilari acin."
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="border-slate-200 bg-white" onClick={onAddStep}>
                    {l("Add step", "Adim ekle")}
                  </Button>
                  <Button type="button" variant="outline" className="border-slate-200 bg-white" onClick={onToggleAdvancedJson}>
                    {showAdvancedJson
                      ? l("Hide advanced JSON", "Gelismis JSON'u gizle")
                      : l("Advanced JSON", "Gelismis JSON")}
                  </Button>
                </div>
              </div>
              {stepTable}
            </div>
            <div className="grid gap-4 px-5 py-4 xl:grid-cols-[1.5fr_1fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">
                  {l("Diagnostics", "Tani kartlari")}
                </div>
                <div className="mt-3 space-y-3">
                  {workflowStepValidation ? (
                    <DiagnosticNotice
                      tone={healthTone}
                      title={workflowStepValidation.summaryTitle}
                      text={workflowStepValidation.summaryText}
                    />
                  ) : null}
                  {validationHighlights.map((issue, index) => (
                    <DiagnosticNotice
                      key={`${issue.stepNo}-${issue.code}-${index}`}
                      tone={issue.severity === "error" ? "danger" : "warning"}
                      title={`${l("Step", "Adim")} ${issue.stepNo} - ${issue.title}`}
                      text={issue.description}
                    />
                  ))}
                  {coverageDiagnosticsLoading ? (
                    <DiagnosticNotice
                      tone="slate"
                      title={l("Coverage check is running", "Coverage kontrolu calisiyor")}
                      text={l(
                        "The system is checking whether active users currently exist for the selected AP scopes and packages.",
                        "Sistem, secilen AP kapsamlari ve paketleri icin aktif kullanici olup olmadigini kontrol ediyor."
                      )}
                    />
                  ) : null}
                  {!coverageDiagnosticsLoading && coverageDiagnosticsError ? (
                    <DiagnosticNotice
                      tone="warning"
                      title={l("Coverage warnings unavailable", "Coverage uyarilari kullanilamiyor")}
                      text={coverageDiagnosticsError}
                    />
                  ) : null}
                  {!canReadCoverageDiagnostics ? (
                    <DiagnosticNotice
                      tone="slate"
                      title={l("Coverage read access needed", "Coverage okuma erisimi gerekli")}
                      text={l(
                        "workflow.assignment.read is required to surface in-scope actor warnings here.",
                        "Burada kapsam ici aktor uyarilarini gosterebilmek icin workflow.assignment.read gerekir."
                      )}
                    />
                  ) : null}
                  {workflowExplainabilityPreview?.summaryText || explainabilityLeadEntry?.lineText ? (
                    <DiagnosticNotice
                      tone="slate"
                      title={l("Explainability preview", "Aciklanabilirlik onizlemesi")}
                      text={
                        workflowExplainabilityPreview?.summaryText ||
                        explainabilityLeadEntry?.lineText ||
                        workflowPreviewText
                      }
                    />
                  ) : null}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">
                  {l("Technical tools", "Teknik araclar")}
                </div>
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    {l(
                      "AP action-step mode stays explicit. Each row saves exactly which action happens at which scope.",
                      "AP eylem-adim modu acik kalir. Her satir hangi eylemin hangi kapsamda oldugunu dogrudan kaydeder."
                    )}
                  </div>
                  {apBusinessLabels?.effectivePermission ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      {apBusinessLabels.effectivePermission}
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    {showAdvancedJson
                      ? l(
                        "Advanced JSON is open. Use it only for bulk edits or template import.",
                        "Gelismis JSON acik. Bunu yalnizca toplu duzenleme veya sablon ice aktarma icin kullanin."
                      )
                      : l(
                        "Advanced JSON stays hidden by default and remains secondary to the row editor.",
                        "Gelismis JSON varsayilan olarak gizli kalir ve satir editorune gore ikincil konumdadir."
                      )}
                  </div>
                  {advancedJsonEditor}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>{l("Step 4 - Define workflow steps", "Adim 4 - Workflow adimlarini tanimlayin")}</CardTitle>
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
                    "Choose a business-readable preset to preview its package flow. The current workflow changes only after you apply the preset below.",
                    "Paket akisini onizlemek icin is dilinde bir preset secin. Mevcut workflow ancak asagidan preseti uyguladiginizda degisir."
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
                          {isActive ? (
                            <Badge variant="outline">
                              {l("Preview selected", "Onizleme secili")}
                            </Badge>
                          ) : null}
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
                    variant={selectedPresetApplied ? "secondary" : "outline"}
                  >
                    {selectedPresetApplied
                      ? l("Applied to workflow", "Workflow'a uygulandi")
                      : l("Preview only", "Yalnizca onizleme")}
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
                      <p className="mt-2 text-xs leading-5 text-slate-600">
                        {selectedPresetApplied
                          ? l(
                              "This preset baseline is already applied to the current editable workflow steps.",
                              "Bu preset temeli mevcut duzenlenebilir workflow adimlarina zaten uygulanmis durumda."
                            )
                          : l(
                              "Selecting a preset only previews it. Apply it below if you want the current editable workflow to match this preset.",
                              "Preset secmek yalnizca onizleme yapar. Mevcut duzenlenebilir workflow'un bu presetle eslesmesini istiyorsaniz asagidan uygulayin."
                            )}
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
                          "Apply preset to current workflow",
                          "Preseti mevcut workflow'a uygula"
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
            <Button type="button" variant="outline" onClick={onResetStepsToDefaults}>
              {l("Reset to defaults", "Varsayilanlara don")}
            </Button>
            <Button type="button" variant="secondary" onClick={onAddStep}>
              {l("Add workflow step", "Workflow adimi ekle")}
            </Button>
            <Button type="button" variant="ghost" onClick={onToggleAdvancedJson}>
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
          {stepTable}
          {showAdvancedJson ? (
            <>
              <Separator />
              {advancedJsonEditor}
            </>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
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
              type="button"
              onClick={onSubmit}
              disabled={!canSaveSteps}
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
