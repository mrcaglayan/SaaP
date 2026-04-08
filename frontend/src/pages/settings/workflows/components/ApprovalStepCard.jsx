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
  workflowStepPackageOptions = [],
  workflowStepBusinessRoleOptions = [],
  onChange,
  onRemove,
  disableRemove,
  previewText,
  validation = null,
  apBusinessLabels,
}) {
  const isAp = String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;
  const blockingIssueCount = Array.isArray(validation?.blockingIssues)
    ? validation.blockingIssues.length
    : 0;
  const warningIssueCount = Array.isArray(validation?.warningIssues)
    ? validation.warningIssues.length
    : 0;

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
          <div className="flex items-center gap-2">
            {blockingIssueCount > 0 ? (
              <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-900">
                {blockingIssueCount} {l("blocker", "engel")}
              </Badge>
            ) : null}
            {warningIssueCount > 0 ? (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                {warningIssueCount} {l("warning", "uyari")}
              </Badge>
            ) : null}
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
            {l("Action label", "Islem etiketi")}
          </label>
          <Input
            value={step.actionLabel || ""}
            onChange={(event) => onChange("actionLabel", event.target.value)}
            placeholder={l("Approve", "Onayla")}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {isAp
              ? (apBusinessLabels?.atWhichScope || l("At which organizational scope", "Hangi organizasyon kapsaminda"))
              : l("Step scope type", "Adim kapsam tipi")}
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
            {l("Required package", "Gerekli paket")}
          </label>
          <Select
            value={step.requiredPackageCode || ""}
            onValueChange={(value) => onChange("requiredPackageCode", value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={l("Choose a package", "Paket secin")} />
            </SelectTrigger>
            <SelectContent>
              {workflowStepPackageOptions.map((packageEntry) => (
                <SelectItem key={packageEntry.code} value={packageEntry.code}>
                  {packageEntry.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">
            {step.requiredPermissionCode
              ? l(
                  `Current runtime bridge permission: ${step.requiredPermissionCode}`,
                  `Mevcut runtime kopru yetkisi: ${step.requiredPermissionCode}`
                )
              : isAp
                ? l(
                    "AP review authority is still resolved from the assignment scope in the current backend bridge.",
                    "AP inceleme yetkisi mevcut backend koprusunde hala atama kapsamindan cozulur."
                  )
                : l(
                    "Choose a workflow package to define the acting authority for this step.",
                    "Bu adimin isleyen yetkisini tanimlamak icin bir workflow paketi secin."
                  )}
          </p>
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
              {l("Eligible business roles", "Uygun is rolleri")}
            </label>
            <Badge variant="secondary">
              {l("Helper only", "Yardimci bilgi")}
            </Badge>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {l(
              "These role suggestions improve readability and assignee filtering, but the workflow step still resolves authority from the selected package.",
              "Bu rol onerileri okunabilirligi ve atanan kisiyi filtrelemeyi kolaylastirir; ancak workflow adimi yetkiyi yine secilen paketten cozer."
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {workflowStepBusinessRoleOptions.map((roleOption) => {
              const selectedRoleCodes = Array.isArray(step.eligibleBusinessRoleCodes)
                ? step.eligibleBusinessRoleCodes
                : [];
              const isSelected = selectedRoleCodes.includes(roleOption.code);
              const nextRoleCodes = isSelected
                ? selectedRoleCodes.filter((roleCode) => roleCode !== roleOption.code)
                : [...selectedRoleCodes, roleOption.code];
              return (
                <button
                  key={roleOption.code}
                  type="button"
                  onClick={() => onChange("eligibleBusinessRoleCodes", nextRoleCodes)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? "border-blue-300 bg-blue-50 text-blue-900"
                      : "border-border bg-card text-foreground hover:border-blue-200 hover:bg-blue-50/50"
                  }`}
                >
                  {roleOption.label}
                </button>
              );
            })}
          </div>
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

        {Array.isArray(validation?.allIssues) && validation.allIssues.length > 0 ? (
          <div className="space-y-2 md:col-span-2">
            {validation.allIssues.map((issue) => (
              <div
                key={`${issue.code}-${issue.severity}`}
                className={`rounded-2xl border px-4 py-3 ${
                  issue.severity === "error"
                    ? "border-rose-200 bg-rose-50/80 text-rose-950"
                    : "border-amber-200 bg-amber-50/80 text-amber-950"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                    {issue.severity === "error"
                      ? l("Blocking issue", "Engelleyici sorun")
                      : l("Warning", "Uyari")}
                  </span>
                  <span className="text-sm font-medium">{issue.title}</span>
                </div>
                <p className="mt-1 text-sm leading-6">{issue.description}</p>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
