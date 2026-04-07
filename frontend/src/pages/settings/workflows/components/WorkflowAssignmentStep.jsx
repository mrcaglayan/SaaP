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
import OrgScopeTreePicker from "../../../../components/org/OrgScopeTreePicker.jsx";
import PermissionAccessNotice from "../../../../auth/PermissionAccessNotice.jsx";

/**
 * Captures the target scope and assignment timing before workflow-definition
 * details are configured.
 */
export default function WorkflowAssignmentStep({
  l,
  form,
  onFormChange,
  orgTreeRoot = null,
  scopeValue = null,
  scopeValueNodeKey = "",
  onSelectScope,
  allowedScopeTypes = [],
  getNodeDisabledReason = null,
  effectText,
  onSubmit,
  saving,
  canWrite,
  access,
  scopeTypeLabels,
  workflowTypeLabel,
  onBack,
}) {
  return (
    <div className="space-y-5">
      <Card className="rounded-3xl">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>
              {l("Step 2 - Choose target scope", "Adim 2 - Hedef kapsami secin")}
            </CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {l(
                "Choose where this workflow should apply before you define the reusable approval design.",
                "Tekrar kullanilabilir onay tasarimini tanimlamadan once bu workflow'un nerede gecerli olacagini secin."
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
          <Alert>
            <AlertTitle>{l("Scope first", "Once kapsam")}</AlertTitle>
            <AlertDescription>
              {l(
                "The selected scope drives the later workflow summary, coverage diagnostics, and final assignment save.",
                "Secilen kapsam daha sonraki workflow ozetini, kapsam tanilarini ve son atama kaydini belirler."
              )}
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(scopeTypeLabels).map(([scopeType, scopeLabel]) => (
                <Badge
                  key={scopeType}
                  variant={form.scopeType === scopeType ? "default" : "outline"}
                >
                  {scopeLabel}
                </Badge>
              ))}
            </div>

            <OrgScopeTreePicker
              root={orgTreeRoot}
              value={scopeValue}
              valueNodeKey={scopeValueNodeKey}
              onChange={onSelectScope}
              allowedScopeTypes={allowedScopeTypes}
              getNodeDisabledReason={getNodeDisabledReason}
              title={l("Target scope", "Hedef kapsam")}
              description={l(
                "Select the scope from the canonical organization tree. The workflow definition itself is chosen in the next step.",
                "Kapsami kanonik organizasyon agacindan secin. Workflow taniminin kendisi bir sonraki adimda secilir."
              )}
              searchPlaceholder={l(
                "Search by code, name, or ISO2",
                "Kod, ad veya ISO2 ile arayin"
              )}
              emptyText={l(
                "No organization tree is available for this tenant.",
                "Bu tenant icin organizasyon agaci mevcut degil."
              )}
              noResultsText={l(
                "No matching scope was found.",
                "Eslesen kapsam bulunamadi."
              )}
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
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

          <Alert className="border-blue-200 bg-blue-50/80 text-blue-900">
            <AlertTitle>{l("Effect of this assignment", "Bu atamanin etkisi")}</AlertTitle>
            <AlertDescription className="text-blue-800">{effectText}</AlertDescription>
          </Alert>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            {l("Back", "Geri")}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={saving || !canWrite || !orgTreeRoot || !scopeValue}>
            {l("Continue to Definition", "Tanima devam et")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
