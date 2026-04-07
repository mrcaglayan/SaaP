import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AP_DOCUMENT_WORKFLOW_PROCESS_TYPE,
} from "../../../../../../shared/cariDocumentWorkflowGovernance.js";

/**
 * Renders one editable approval step card.
 */
export default function ApprovalStepCard({
  l,
  index,
  step,
  processType,
  stepScopeTypes,
  stepScopeLabels,
  onChange,
  onRemove,
  disableRemove,
  previewText,
}) {
  const isAp = String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;

  return (
    <Card className="rounded-2xl border-border/80">
      <CardHeader className="border-b border-border/70 bg-muted/30">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {index + 1}
            </div>
            <div>
              <CardTitle className="text-sm">
                {l("Step", "Adim")} {index + 1}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{previewText}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={disableRemove}
          >
            {l("Remove", "Kaldir")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {l("Step number", "Adim numarasi")}
          </label>
          <Input
            type="number"
            min={1}
            value={step.stepNo}
            onChange={(event) => onChange("stepNo", event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {l("Approval level", "Onay seviyesi")}
          </label>
          <Select value={step.stageScopeType} onValueChange={(value) => onChange("stageScopeType", value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={l("Choose a level", "Seviye secin")} />
            </SelectTrigger>
            <SelectContent>
              {stepScopeTypes.map((scopeType) => (
                <SelectItem key={scopeType} value={scopeType}>
                  {stepScopeLabels[scopeType] || scopeType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {l("Minimum approvals", "Minimum onay")}
          </label>
          <Input
            type="number"
            min={1}
            value={step.minApproverCount}
            onChange={(event) => onChange("minApproverCount", event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {l("Escalate after hours", "Kac saat sonra escalation")}
          </label>
          <Input
            type="number"
            min={1}
            value={step.escalationAfterHours || ""}
            placeholder="24"
            onChange={(event) => onChange("escalationAfterHours", event.target.value)}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {l("Required reviewer permission", "Gerekli inceleyen yetkisi")}
            </label>
            {isAp ? <Badge variant="secondary">AP</Badge> : null}
          </div>
          <Input
            value={step.requiredPermissionCode}
            onChange={(event) => onChange("requiredPermissionCode", event.target.value)}
            disabled={isAp}
            placeholder={isAp ? l("Leave empty for AP", "AP icin bos birakin") : "permission.code"}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            {isAp
              ? l(
                  "AP uses workflow scope assignment instead of a step-level permission code.",
                  "AP, adim seviyesinde yetki kodu yerine workflow kapsam atamasini kullanir."
                )
              : l(
                  "Only users with this permission can approve this step.",
                  "Yalnizca bu yetkiye sahip kullanicilar bu adimi onaylayabilir."
                )}
          </p>
        </div>

        <div className="md:col-span-2">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/20 px-4 py-3">
            <Checkbox
              checked={Boolean(step.allowSelfApprove)}
              onCheckedChange={(checked) => onChange("allowSelfApprove", Boolean(checked))}
              id={`workflow-step-self-approve-${index}`}
            />
            <label
              htmlFor={`workflow-step-self-approve-${index}`}
              className="text-sm text-foreground"
            >
              {l("Allow self-approval", "Kendi kendine onaya izin ver")}
            </label>
            <span className="ml-auto text-xs text-muted-foreground">
              {l("Recommended: Off", "Onerilen: Kapali")}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
