import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import PermissionAccessNotice from "../../../../auth/PermissionAccessNotice.jsx";
import { Building, Globe, Layers, LayoutGrid, MapPin } from "lucide-react";

const SCOPE_ICONS = {
  TENANT: Globe,
  GROUP: Layers,
  COUNTRY: MapPin,
  LEGAL_ENTITY: Building,
  OPERATING_UNIT: LayoutGrid,
};

function resetScopeTargets(prev, scopeType) {
  return {
    ...prev,
    scopeType,
    groupCompanyId: "",
    countryId: "",
    legalEntityId: "",
    operatingUnitId: "",
  };
}

/**
 * Configures where one workflow definition becomes active.
 */
export default function WorkflowAssignmentStep({
  l,
  form,
  onFormChange,
  definitions,
  countries,
  groupCompanies,
  legalEntities,
  operatingUnits,
  effectText,
  onSubmit,
  saving,
  canWrite,
  access,
  scopeTypeLabels,
  scopeTypeMeta,
  workflowTypeLabel,
  onBack,
}) {
  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>
              {l("Step 4 - Where should this workflow be active?", "Adim 4 - Bu workflow nerede aktif olmali?")}
            </CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {l(
                "An assignment connects the workflow to a specific part of your organization and decides which records are governed by it.",
                "Atama, workflow'u organizasyonunuzun belirli bir kismina baglar ve hangi kayitlarin bu workflow tarafindan yonetilecegini belirler."
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{workflowTypeLabel}</Badge>
            <Badge variant="outline">{scopeTypeLabels[form.scopeType] || form.scopeType}</Badge>
          </div>

          <PermissionAccessNotice access={access} permissionCode="workflow.assignment.write" />
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              {l("Selected workflow", "Secili workflow")}
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              {l(
                "Choose which saved workflow definition becomes active at the selected scope.",
                "Secilen kapsamda hangi kayitli workflow taniminin aktif olacagini secin."
              )}
            </p>
            <Select
              value={form.workflowDefinitionId || ""}
              onValueChange={(value) =>
                onFormChange((prev) => ({ ...prev, workflowDefinitionId: value }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={l("Select workflow", "Workflow secin")} />
              </SelectTrigger>
              <SelectContent>
                {definitions.map((row) => (
                  <SelectItem key={row.id} value={String(row.id)}>
                    {row.code} - {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-semibold text-foreground">
                {l("Applies to", "Kapsam")}
              </label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {l(
                  "Select the organizational level where this workflow takes effect.",
                  "Bu workflow'un hangi organizasyon seviyesinde gecerli olacagini secin."
                )}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {Object.entries(scopeTypeLabels).map(([scopeType, scopeLabel]) => {
                const Icon = SCOPE_ICONS[scopeType] || Globe;
                const selected = form.scopeType === scopeType;
                const meta = scopeTypeMeta?.[scopeType];

                return (
                  <button
                    key={scopeType}
                    type="button"
                    onClick={() => onFormChange((prev) => resetScopeTargets(prev, scopeType))}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition-all",
                      selected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/15"
                        : "border-border bg-card hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-xl border",
                          selected
                            ? "border-primary/20 bg-primary/10 text-primary"
                            : "border-border bg-muted text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">{scopeLabel}</div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                          {meta?.shortCode || scopeType}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {meta?.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {form.scopeType === "GROUP" ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Select group company", "Grup sirketi secin")}
                </label>
                <Select
                  value={form.groupCompanyId || ""}
                  onValueChange={(value) =>
                    onFormChange((prev) => ({ ...prev, groupCompanyId: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={l("Select group company", "Grup sirketi secin")} />
                  </SelectTrigger>
                  <SelectContent>
                    {groupCompanies.map((row) => (
                      <SelectItem key={row.id} value={String(row.id)}>
                        {row.code} - {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {form.scopeType === "COUNTRY" ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Select country", "Ulke secin")}
                </label>
                <Select
                  value={form.countryId || ""}
                  onValueChange={(value) =>
                    onFormChange((prev) => ({ ...prev, countryId: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={l("Select country", "Ulke secin")} />
                  </SelectTrigger>
                  <SelectContent>
                    {countries.map((row) => (
                      <SelectItem key={row.id} value={String(row.id)}>
                        {row.iso2} - {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {form.scopeType === "LEGAL_ENTITY" ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Select legal entity", "Legal entity secin")}
                </label>
                <Select
                  value={form.legalEntityId || ""}
                  onValueChange={(value) =>
                    onFormChange((prev) => ({ ...prev, legalEntityId: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={l("Select legal entity", "Legal entity secin")} />
                  </SelectTrigger>
                  <SelectContent>
                    {legalEntities.map((row) => (
                      <SelectItem key={row.id} value={String(row.id)}>
                        {row.code} - {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {form.scopeType === "OPERATING_UNIT" ? (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Select operating unit", "Operating unit secin")}
                </label>
                <Select
                  value={form.operatingUnitId || ""}
                  onValueChange={(value) =>
                    onFormChange((prev) => ({ ...prev, operatingUnitId: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={l("Select operating unit", "Operating unit secin")} />
                  </SelectTrigger>
                  <SelectContent>
                    {operatingUnits.map((row) => (
                      <SelectItem key={row.id} value={String(row.id)}>
                        {row.code} - {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                {l("Effective from", "Gecerlilik baslangici")}
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                {l(
                  "This workflow starts governing records on or after this date.",
                  "Bu workflow bu tarihten itibaren kayitlari yonetmeye baslar."
                )}
              </p>
              <Input
                type="date"
                value={form.effectiveFrom}
                onChange={(event) =>
                  onFormChange((prev) => ({ ...prev, effectiveFrom: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                {l("Assignment status", "Atama durumu")}
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                {l(
                  "Active assignments govern live records. Use inactive while testing.",
                  "Aktif atamalar canli kayitlari yonetir. Test sirasinda pasif kullanin."
                )}
              </p>
              <Select
                value={form.status}
                onValueChange={(value) => onFormChange((prev) => ({ ...prev, status: value }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {definitions.length === 0 ? (
            <Alert>
              <AlertTitle>{l("No matching workflow available", "Eslesen workflow yok")}</AlertTitle>
              <AlertDescription>
                {l(
                  "Create or select a workflow definition for this process type before saving the assignment.",
                  "Atamayi kaydetmeden once bu surec tipi icin bir workflow tanimi olusturun veya secin."
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          <Alert className="border-blue-200 bg-blue-50/80 text-blue-900">
            <AlertTitle>{l("Effect of this assignment", "Bu atamanin etkisi")}</AlertTitle>
            <AlertDescription className="text-blue-800">{effectText}</AlertDescription>
          </Alert>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            {l("Back", "Geri")}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={saving || !canWrite}>
            {saving
              ? l("Saving...", "Kaydediliyor...")
              : l("Save assignment and continue", "Atamayi kaydet ve devam et")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
