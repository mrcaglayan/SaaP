import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import PermissionAccessNotice from "../../../../auth/PermissionAccessNotice.jsx";

const DEFINITION_EXAMPLES = {
  AP_DOCUMENT_POSTING: {
    code: "WF_STD_AP_COUNTRY_POSTING_V1",
    nameEn: "Standard AP Country Approval Gate",
    nameTr: "Standart AP Ulke Onay Kapisi",
  },
  PERIOD_CLOSE: {
    code: "WF_STD_PERIOD_CLOSE_3STEP_V1",
    nameEn: "Standard Period Close Approval Chain",
    nameTr: "Standart Donem Kapanisi Onay Zinciri",
  },
  CONSOLIDATION_RUN: {
    code: "WF_STD_CONSOLIDATION_FINALIZE_V1",
    nameEn: "Consolidation Run Finalization Gate",
    nameTr: "Konsolidasyon Run Finalizasyon Kapisi",
  },
  LOCAL_CLOSE_PACK: {
    code: "WF_STD_LOCAL_CLOSE_PACK_LE_V1",
    nameEn: "Local Close Pack Legal Entity Gate",
    nameTr: "Yerel Kapanis Paketi Legal Entity Kapisi",
  },
};

/**
 * Manages workflow definition selection and creation.
 */
export default function WorkflowDefinitionStep({
  l,
  mode,
  onModeChange,
  definitions,
  selectedDefinitionId,
  onSelectDefinition,
  onContinueSelectedDefinition,
  form,
  onFormChange,
  onSubmit,
  saving,
  canWrite,
  access,
  onBack,
}) {
  const currentExample =
    DEFINITION_EXAMPLES[String(form?.processType || "").toUpperCase()] ||
    DEFINITION_EXAMPLES.AP_DOCUMENT_POSTING;

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>
              {l("Step 2 - Create or select a workflow", "Adim 2 - Workflow secin veya olusturun")}
            </CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {l(
                "A workflow is the reusable approval recipe. Reuse an existing definition or create a new one with a stable code and clear name.",
                "Workflow tekrar kullanilabilir onay tarifidir. Mevcut bir tanimi tekrar kullanin veya sabit kodlu ve acik adli yeni bir tane olusturun."
              )}
            </p>
          </div>

          <Tabs value={mode} onValueChange={onModeChange} className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="select">{l("Use existing", "Mevcut olani kullan")}</TabsTrigger>
              <TabsTrigger value="create">{l("Create new", "Yeni olustur")}</TabsTrigger>
            </TabsList>
          </Tabs>

          <PermissionAccessNotice access={access} permissionCode="workflow.definition.write" />
        </CardHeader>

        <CardContent className="space-y-5">
          {mode === "select" ? (
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {l("Saved workflows", "Kayitli workflow'lar")}
              </div>

              {definitions.length === 0 ? (
                <Alert>
                  <AlertTitle>{l("No saved workflow found", "Kayitli workflow bulunamadi")}</AlertTitle>
                  <AlertDescription>
                    {l(
                      "Create a new workflow definition for this process type.",
                      "Bu surec tipi icin yeni bir workflow tanimi olusturun."
                    )}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {definitions.map((row) => {
                    const selected = String(selectedDefinitionId) === String(row.id);

                    return (
                      <div
                        key={row.id}
                        className={cn(
                          "flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between",
                          selected ? "border-primary bg-primary/5" : "border-border bg-muted/20"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-semibold text-foreground">{row.name}</div>
                            <Badge variant={selected ? "default" : "secondary"}>{row.code}</Badge>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l("Version", "Versiyon")} {row.versionNo || 1} |{" "}
                            {l("Steps", "Adimlar")} {row.stepCount || 0}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant={selected ? "default" : "outline"}
                          onClick={() => onSelectDefinition(row.id)}
                        >
                          {selected ? l("Selected", "Secili") : l("Choose", "Sec")}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Workflow Code", "Workflow Kodu")}
                </label>
                <p className="text-xs leading-5 text-muted-foreground">
                  {l(
                    "Stable internal identifier. Do not rename it casually after rollout.",
                    "Sabit ic tanimlayici. Rollout sonrasi gelisiguzel degistirmeyin."
                  )}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {l("Example:", "Ornek:")} {currentExample.code}
                </p>
                <Input
                  value={form.code}
                  onChange={(event) =>
                    onFormChange((prev) => ({ ...prev, code: event.target.value }))
                  }
                  placeholder={currentExample.code}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Workflow Name", "Workflow Adi")}
                </label>
                <p className="text-xs leading-5 text-muted-foreground">
                  {l(
                    "Human-friendly title shown to admins and reviewers.",
                    "Yoneticilere ve inceleyenlere gosterilen kolay anlasilir ad."
                  )}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {l("Example:", "Ornek:")}{" "}
                  {l(currentExample.nameEn, currentExample.nameTr)}
                </p>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    onFormChange((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder={l(currentExample.nameEn, currentExample.nameTr)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Version", "Versiyon")}
                </label>
                <p className="text-xs leading-5 text-muted-foreground">
                  {l("Use 1 for a new workflow design.", "Yeni workflow tasarimi icin 1 kullanin.")}
                </p>
                <Input
                  type="number"
                  min={1}
                  value={form.versionNo}
                  onChange={(event) =>
                    onFormChange((prev) => ({ ...prev, versionNo: event.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Status", "Durum")}
                </label>
                <div className="flex min-h-10 items-center gap-3 rounded-2xl border border-border bg-muted/20 px-3">
                  <Checkbox
                    checked={Boolean(form.isActive)}
                    onCheckedChange={(checked) =>
                      onFormChange((prev) => ({ ...prev, isActive: Boolean(checked) }))
                    }
                    id="workflow-definition-active"
                  />
                  <label htmlFor="workflow-definition-active" className="text-sm text-foreground">
                    {l("Available for use", "Kullanima acik")}
                  </label>
                </div>
              </div>
            </form>
          )}

          {selectedDefinitionId && mode === "select" ? (
            <Alert>
              <AlertTitle>{l("Workflow selected", "Workflow secildi")}</AlertTitle>
              <AlertDescription>
                {l(
                  "The saved workflow steps will load automatically in the next step.",
                  "Kayitli workflow adimlari bir sonraki adimda otomatik yuklenir."
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>

        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            {l("Back", "Geri")}
          </Button>
          {mode === "create" ? (
            <Button type="button" onClick={onSubmit} disabled={saving || !canWrite}>
              {saving
                ? l("Creating...", "Olusturuluyor...")
                : l("Create workflow", "Workflow olustur")}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onContinueSelectedDefinition}
              disabled={!selectedDefinitionId}
            >
              {l("Continue to Approval Steps", "Onay adimlarina devam et")}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
