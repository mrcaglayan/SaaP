import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  AP_WORKFLOW_ACTION_CODES,
  getApWorkflowRequiredPackageCode,
} from "../utils/workflowSetupHelpers.js";

/**
 * Renders one editable workflow step row inside the sequence editor table.
 */
export default function ApprovalStepCard({
  l,
  index,
  step,
  processType,
  stepScopeTypes,
  stepScopeLabels,
  workflowStepPackageOptions = [],
  onChange,
  onRemove,
  disableRemove,
  previewText,
  validation = null,
  apBusinessLabels,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isAp = String(processType || "").toUpperCase() === AP_DOCUMENT_WORKFLOW_PROCESS_TYPE;
  const selectedApActionCode = isAp ? String(step?.actionCode || "").trim().toUpperCase() : "";
  const filteredPackageOptions = isAp
    ? workflowStepPackageOptions.filter((packageEntry) => {
        const expectedPackageCode = getApWorkflowRequiredPackageCode(selectedApActionCode);
        return expectedPackageCode
          ? String(packageEntry?.code || "").trim().toUpperCase() === expectedPackageCode
          : true;
      })
    : workflowStepPackageOptions;
  const isApproveAction = !isAp || selectedApActionCode === "APPROVE";
  const blockingIssueCount = Array.isArray(validation?.blockingIssues)
    ? validation.blockingIssues.length
    : 0;
  const warningIssueCount = Array.isArray(validation?.warningIssues)
    ? validation.warningIssues.length
    : 0;
  const runtimeBridgeMessage = step.requiredPermissionCode
    ? l(
        `Current runtime bridge permission: ${step.requiredPermissionCode}`,
        `Mevcut runtime kopru yetkisi: ${step.requiredPermissionCode}`
      )
    : isAp
      ? l(
          "This AP package is bound by the selected action and resolves authority at the chosen step scope.",
          "Bu AP paketi secilen eylemle baglanir ve yetkiyi secilen adim kapsaminda cozer."
        )
      : l(
          "Choose a workflow package to define the acting authority for this step.",
          "Bu adimin isleyen yetkisini tanimlamak icin bir workflow paketi secin."
        );
  const statusToneClass =
    blockingIssueCount > 0
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : warningIssueCount > 0
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";
  const statusLabel =
    blockingIssueCount > 0
      ? l("Blocked", "Engelli")
      : warningIssueCount > 0
        ? l("Warning", "Uyari")
        : l("Ready", "Hazir");
  const statusDetail =
    blockingIssueCount > 0
      ? l(
          `${blockingIssueCount} blocking issue(s)`,
          `${blockingIssueCount} engelleyici sorun`
        )
      : warningIssueCount > 0
        ? l(`${warningIssueCount} warning(s)`, `${warningIssueCount} uyari`)
        : l("No open issues", "Acik sorun yok");

  return (
    <>
      <tr className="border-t border-slate-200 align-top hover:bg-slate-50/60">
        <td className="px-4 py-2 align-middle">
          <div className="flex min-w-[4.5rem] items-center">
            <Input
              type="number"
              min={1}
              value={step.stepNo}
              onChange={(event) => onChange("stepNo", event.target.value)}
              className="h-8 w-14 rounded-lg border-slate-200 bg-white px-2 text-xs"
            />
          </div>
        </td>

        <td className="min-w-[10rem] px-4 py-2 align-middle">
          {isAp ? (
            <Select
              value={selectedApActionCode || AP_WORKFLOW_ACTION_CODES[0]}
              onValueChange={(value) => onChange("actionCode", value)}
            >
              <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-white text-xs">
                <SelectValue placeholder={l("Choose an action", "Bir eylem secin")} />
              </SelectTrigger>
              <SelectContent>
                {AP_WORKFLOW_ACTION_CODES.map((actionCode) => (
                  <SelectItem key={actionCode} value={actionCode}>
                    {actionCode === "DRAFT"
                      ? l("Draft", "Taslak")
                      : actionCode === "SUBMIT"
                        ? l("Submit", "Gonder")
                        : actionCode === "APPROVE"
                          ? l("Approve", "Onayla")
                          : l("Post", "Kaydet")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={step.actionLabel || ""}
              onChange={(event) => onChange("actionLabel", event.target.value)}
              placeholder={l("Approve", "Onayla")}
              className="h-8 rounded-lg border-slate-200 bg-white px-2 text-xs"
            />
          )}
        </td>

        <td className="min-w-[11rem] px-4 py-2 align-middle">
          <Select value={step.stageScopeType} onValueChange={(value) => onChange("stageScopeType", value)}>
            <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-white text-xs">
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
        </td>

        <td className="min-w-[14rem] px-4 py-2 align-middle">
          <Select
            value={step.requiredPackageCode || ""}
            onValueChange={(value) => onChange("requiredPackageCode", value)}
            disabled={isAp && filteredPackageOptions.length <= 1}
          >
            <SelectTrigger className="h-8 w-full rounded-lg border-slate-200 bg-white text-xs">
              <SelectValue placeholder={l("Choose a package", "Paket secin")} />
            </SelectTrigger>
            <SelectContent>
              {filteredPackageOptions.map((packageEntry) => (
                <SelectItem key={packageEntry.code} value={packageEntry.code}>
                  {packageEntry.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>

        <td className="min-w-[7rem] px-4 py-2 align-middle">
          <Input
            type="number"
            min={1}
            value={isApproveAction ? step.minApproverCount : "1"}
            onChange={(event) => onChange("minApproverCount", event.target.value)}
            disabled={!isApproveAction}
            className="h-8 rounded-lg border-slate-200 bg-white px-2 text-xs"
          />
        </td>

        <td className="min-w-[9rem] px-4 py-2 align-middle">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isApproveAction && Boolean(step.allowSelfApprove)}
              onCheckedChange={(checked) => onChange("allowSelfApprove", Boolean(checked))}
              id={`workflow-step-self-approve-${index}`}
              disabled={!isApproveAction}
            />
            <label
              htmlFor={`workflow-step-self-approve-${index}`}
              className="text-[11px] text-slate-600"
            >
              {isAp && !isApproveAction
                ? l("Approve only", "Yalnizca approve")
                : step.allowSelfApprove
                  ? l("Allowed", "Acik")
                  : l("Off", "Kapali")}
            </label>
          </div>
        </td>

        <td className="min-w-[7rem] px-4 py-2 align-middle">
          <Input
            type="number"
            min={1}
            value={step.escalationAfterHours || ""}
            placeholder="24"
            onChange={(event) => onChange("escalationAfterHours", event.target.value)}
            className="h-8 rounded-lg border-slate-200 bg-white px-2 text-xs"
          />
        </td>

        <td className="min-w-[10rem] px-4 py-2 align-middle">
          <div className="space-y-0.5">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusToneClass}`}>
              {statusLabel}
            </span>
            <p className="text-[11px] leading-4 text-slate-500">{statusDetail}</p>
          </div>
        </td>

        <td className="px-4 py-2 align-middle">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              onClick={() => setIsExpanded((prev) => !prev)}
            >
              {isExpanded ? l("Hide details", "Detayi gizle") : l("Details", "Detay")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-rose-700 hover:bg-rose-50 hover:text-rose-800"
              onClick={onRemove}
              disabled={disableRemove}
            >
              {l("Remove", "Kaldir")}
            </Button>
          </div>
        </td>
      </tr>

      {isExpanded ? (
        <tr className="border-t border-dashed border-slate-200 bg-slate-50/70">
          <td colSpan={9} className="px-4 py-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.52fr)_minmax(0,0.48fr)]">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {l("Step preview", "Adim onizlemesi")}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-900">{previewText}</p>
                </div>
                <p className="text-xs leading-5 text-slate-600">{runtimeBridgeMessage}</p>
                {apBusinessLabels?.effectivePermission ? (
                  <p className="text-xs leading-5 text-slate-600">
                    {apBusinessLabels.effectivePermission}
                  </p>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {l("Authority source", "Yetki kaynagi")}
                    </p>
                    <Badge variant="secondary">
                      {l("Package-backed", "Paket tabanli")}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {l(
                      "This step resolves authority from the selected workflow package at the chosen organizational scope.",
                      "Bu adim, yetkiyi secilen organizasyon kapsamindaki workflow paketinden cozer."
                    )}
                  </p>
                </div>
              </div>
            </div>

            {Array.isArray(validation?.allIssues) && validation.allIssues.length > 0 ? (
              <div className="mt-4 space-y-2">
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
          </td>
        </tr>
      ) : null}
    </>
  );
}
