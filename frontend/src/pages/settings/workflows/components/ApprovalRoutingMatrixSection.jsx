import { useMemo, useState } from "react";
import { Copy, Pencil, Route, ShieldAlert, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import OrgScopeTreePicker from "../../../../components/org/OrgScopeTreePicker.jsx";
import {
  findOrgScopeTreeNodeByScopeSelection,
  getOrgScopeTreeNodeSummaryValue,
} from "../../../../shared/orgScopeTree.js";
import {
  buildApprovalRoutingMatrixValidationModel,
  buildApprovalRoutingRulePreview,
  buildAssignmentScopeLabel,
  sortApprovalRoutingMatrixRows,
  todayIsoDate,
  toPositiveInt,
} from "../utils/workflowSetupHelpers.js";

const AP_PROCESS_TYPE = "AP_DOCUMENT_POSTING";
function createEmptyDraft() {
  return {
    id: null,
    processType: AP_PROCESS_TYPE,
    targetMode: "definition",
    workflowDefinitionId: "",
    scopeType: "TENANT",
    groupCompanyId: "",
    countryId: "",
    legalEntityId: "",
    operatingUnitId: "",
    minAmount: "",
    maxAmount: "",
    amountBasis: "BASE_AMOUNT",
    priority: "100",
    isFallback: false,
    effectiveFrom: todayIsoDate(),
    effectiveTo: "",
    status: "ACTIVE",
  };
}

function resolveDraftScopeSelection(draft, tenantScopeId) {
  const scopeType = String(draft?.scopeType || "").trim().toUpperCase();
  if (scopeType === "TENANT") {
    return tenantScopeId ? { scopeType, scopeId: tenantScopeId } : null;
  }
  if (scopeType === "GROUP") {
    return toPositiveInt(draft?.groupCompanyId)
      ? { scopeType, scopeId: toPositiveInt(draft.groupCompanyId) }
      : null;
  }
  if (scopeType === "COUNTRY") {
    return toPositiveInt(draft?.countryId)
      ? { scopeType, scopeId: toPositiveInt(draft.countryId) }
      : null;
  }
  if (scopeType === "LEGAL_ENTITY") {
    return toPositiveInt(draft?.legalEntityId)
      ? { scopeType, scopeId: toPositiveInt(draft.legalEntityId) }
      : null;
  }
  if (scopeType === "OPERATING_UNIT") {
    return toPositiveInt(draft?.operatingUnitId)
      ? { scopeType, scopeId: toPositiveInt(draft.operatingUnitId) }
      : null;
  }
  return null;
}

function applyScopeSelectionToDraft(previousDraft, selection) {
  const scopeType = String(selection?.scopeType || "").trim().toUpperCase();
  const scopeId = toPositiveInt(selection?.scopeId);
  if (!scopeType || !scopeId) {
    return previousDraft;
  }

  const scopeValue = String(scopeId);
  return {
    ...previousDraft,
    scopeType,
    groupCompanyId: scopeType === "GROUP" ? scopeValue : "",
    countryId: scopeType === "COUNTRY" ? scopeValue : "",
    legalEntityId: scopeType === "LEGAL_ENTITY" ? scopeValue : "",
    operatingUnitId: scopeType === "OPERATING_UNIT" ? scopeValue : "",
  };
}

function buildScopeSummaryFromRow(row) {
  if (row?.operatingUnitId) {
    return row.operatingUnitCode || row.operatingUnitName || String(row.operatingUnitId);
  }
  if (row?.legalEntityId) {
    return row.legalEntityCode || row.legalEntityName || String(row.legalEntityId);
  }
  if (row?.countryId) {
    return row.countryIso2 || row.countryName || String(row.countryId);
  }
  if (row?.groupCompanyId) {
    return row.groupCompanyCode || row.groupCompanyName || String(row.groupCompanyId);
  }
  return "Tenant";
}

function buildRouteTargetLabelFromRow(row) {
  const code = String(row?.workflowDefinitionCode || "").trim();
  const name = String(row?.workflowDefinitionName || "").trim();
  if (code && name) {
    return `${name} (${code})`;
  }
  return name || code || "-";
}

function mapRowToDraft(row, { clone = false } = {}) {
  const scopeType = row?.operatingUnitId
    ? "OPERATING_UNIT"
    : row?.legalEntityId
      ? "LEGAL_ENTITY"
      : row?.countryId
        ? "COUNTRY"
        : row?.groupCompanyId
          ? "GROUP"
          : "TENANT";

  return {
    id: clone ? null : toPositiveInt(row?.id),
    processType: AP_PROCESS_TYPE,
    targetMode: "definition",
    workflowDefinitionId: String(row?.workflowDefinitionId || ""),
    scopeType,
    groupCompanyId: scopeType === "GROUP" ? String(row?.groupCompanyId || "") : "",
    countryId: scopeType === "COUNTRY" ? String(row?.countryId || "") : "",
    legalEntityId: scopeType === "LEGAL_ENTITY" ? String(row?.legalEntityId || "") : "",
    operatingUnitId: scopeType === "OPERATING_UNIT" ? String(row?.operatingUnitId || "") : "",
    minAmount: row?.minAmount ?? "",
    maxAmount: row?.maxAmount ?? "",
    amountBasis: String(row?.amountBasis || "BASE_AMOUNT"),
    priority: String(row?.priority ?? 100),
    isFallback: Boolean(row?.isFallback),
    effectiveFrom: String(row?.effectiveFrom || todayIsoDate()),
    effectiveTo: String(row?.effectiveTo || ""),
    status: String(row?.status || "ACTIVE").trim().toUpperCase() || "ACTIVE",
  };
}

function buildDraftTargetLabel(draft, selectedDefinition, l) {
  if (selectedDefinition?.name && selectedDefinition?.code) {
    return `${selectedDefinition.name} (${selectedDefinition.code})`;
  }
  return (
    selectedDefinition?.name ||
    selectedDefinition?.code ||
    l("the selected workflow", "secilen workflow")
  );
}

/**
 * Render the admin-facing AP routing matrix without replacing the existing
 * guided workflow setup flow.
 */
export default function ApprovalRoutingMatrixSection({
  l,
  assignments = [],
  definitions = [],
  orgTreeRoot = null,
  tenantScopeId = null,
  scopeTypeLabels = {},
  getNodeDisabledReason = null,
  canWriteAny = false,
  canWriteScopeSelection = null,
  saving = "",
  onSaveRule,
  onRetireRule,
}) {
  const [draft, setDraft] = useState(() => createEmptyDraft());
  const [scopeNodeKey, setScopeNodeKey] = useState("");

  const apAssignments = useMemo(
    () =>
      sortApprovalRoutingMatrixRows(
        assignments.filter(
          (row) => String(row?.processType || "").trim().toUpperCase() === AP_PROCESS_TYPE
        ),
        l
      ),
    [assignments, l]
  );
  const apDefinitions = useMemo(
    () =>
      definitions.filter(
        (row) => String(row?.processType || "").trim().toUpperCase() === AP_PROCESS_TYPE
      ),
    [definitions]
  );
  const selectedScopeSelection = useMemo(
    () => resolveDraftScopeSelection(draft, tenantScopeId),
    [draft, tenantScopeId]
  );
  const selectedScopeNode = useMemo(
    () =>
      findOrgScopeTreeNodeByScopeSelection(
        orgTreeRoot,
        selectedScopeSelection,
        scopeNodeKey
      ),
    [orgTreeRoot, scopeNodeKey, selectedScopeSelection]
  );
  const selectedDefinition =
    apDefinitions.find(
      (row) => toPositiveInt(row?.id) === toPositiveInt(draft?.workflowDefinitionId)
    ) || null;
  const scopeSummary = useMemo(() => {
    if (selectedScopeNode) {
      return getOrgScopeTreeNodeSummaryValue(selectedScopeNode) || "";
    }
    if (draft.scopeType === "TENANT") {
      return "Tenant";
    }
    return "";
  }, [draft.scopeType, selectedScopeNode]);
  const previewText = useMemo(
    () =>
      buildApprovalRoutingRulePreview({
        scopeType: draft.scopeType,
        scopeSummary,
        minAmount: draft.minAmount === "" ? null : Number(draft.minAmount),
        maxAmount: draft.maxAmount === "" ? null : Number(draft.maxAmount),
        amountBasis: draft.amountBasis || "BASE_AMOUNT",
        isFallback: draft.isFallback,
        targetLabel: buildDraftTargetLabel(draft, selectedDefinition, l),
        l,
      }),
    [draft, l, scopeSummary, selectedDefinition]
  );
  const validation = useMemo(
    () =>
      buildApprovalRoutingMatrixValidationModel({
        draft,
        assignments: apAssignments,
        definitions: apDefinitions,
        editingAssignmentId: draft.id,
        l,
      }),
    [apAssignments, apDefinitions, draft, l]
  );
  const draftCanWrite =
    typeof canWriteScopeSelection === "function"
      ? Boolean(canWriteScopeSelection(selectedScopeSelection))
      : false;

  const activeCount = apAssignments.filter((row) => row.status === "ACTIVE").length;
  const fallbackCount = apAssignments.filter(
    (row) => row.status === "ACTIVE" && row.isFallback
  ).length;
  const busy = String(saving || "").startsWith("routing-");

  function resetDraft() {
    setDraft(createEmptyDraft());
    setScopeNodeKey("");
  }

  function handleScopeSelect(selection, node) {
    setScopeNodeKey(String(node?.key || ""));
    setDraft((prev) => applyScopeSelectionToDraft(prev, selection));
  }

  function handleEditRow(row) {
    setDraft(mapRowToDraft(row));
    setScopeNodeKey("");
  }

  function handleCloneRow(row) {
    setDraft(mapRowToDraft(row, { clone: true }));
    setScopeNodeKey("");
  }

  async function handleSubmit() {
    if (typeof onSaveRule !== "function") {
      return;
    }
    await onSaveRule(draft);
    resetDraft();
  }

  async function handleRetire(row) {
    if (typeof onRetireRule !== "function") {
      return;
    }
    await onRetireRule(row);
    if (toPositiveInt(draft?.id) === toPositiveInt(row?.id)) {
      resetDraft();
    }
  }

  return (
    <Card className="rounded-3xl">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>{l("Approval Routing Matrix", "Onay Yonlendirme Matrisi")}</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {l(
                "Configure AP routing rules by scope and amount band without replacing the existing workflow setup flow.",
                "Mevcut workflow kurulum akisini degistirmeden AP yonlendirme kurallarini kapsam ve tutar bandina gore yapilandirin."
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{l("AP Document Posting", "AP Belge Kaydi")}</Badge>
            <Badge variant="outline">
              {activeCount} {l("active rules", "aktif kural")}
            </Badge>
            <Badge variant="outline">
              {fallbackCount} {l("fallbacks", "fallback")}
            </Badge>
          </div>
        </div>

        <Alert className="border-blue-200 bg-blue-50/90 text-blue-950">
          <Route className="h-4 w-4" />
          <AlertTitle>{l("How matching works", "Eslesme mantigi")}</AlertTitle>
          <AlertDescription className="text-blue-900">
            {l(
              "More specific scope wins first. Amount bands and fallback are then evaluated only inside that matched scope.",
              "Once daha spesifik kapsam kazanir. Ardindan tutar bantlari ve fallback yalnizca eslesen kapsam icinde degerlendirilir."
            )}
          </AlertDescription>
        </Alert>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-5 rounded-3xl border border-border bg-muted/15 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {draft.id ? l("Edit route", "Rotayi duzenle") : l("New route", "Yeni rota")}
                </p>
                <p className="mt-2 text-sm leading-6 text-foreground">
                  {draft.id
                    ? l(
                        "Update one saved AP route without leaving this matrix.",
                        "Kayitli bir AP rotasini bu matristen ayrilmadan guncelleyin."
                      )
                    : l(
                        "Add a new AP route by binding one existing workflow definition to one scope and amount band.",
                        "Bir mevcut workflow tanimini tek bir kapsam ve tutar bandina baglayarak yeni bir AP rotasi ekleyin."
                      )}
                </p>
              </div>

              {draft.id ? <Badge variant="outline">#{draft.id}</Badge> : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                {l("Workflow definition", "Workflow tanimi")}
              </label>
              <Select
                value={String(draft.workflowDefinitionId || "")}
                onValueChange={(value) =>
                  setDraft((prev) => ({ ...prev, workflowDefinitionId: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={l(
                      "Choose one saved AP workflow",
                      "Kayitli bir AP workflow secin"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {apDefinitions.map((definition) => (
                    <SelectItem key={definition.id} value={String(definition.id)}>
                      {definition.name} ({definition.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <OrgScopeTreePicker
              root={orgTreeRoot}
              value={selectedScopeSelection}
              valueNodeKey={scopeNodeKey}
              onChange={handleScopeSelect}
              allowedScopeTypes={Object.keys(scopeTypeLabels)}
              getNodeDisabledReason={getNodeDisabledReason}
              title={l("Route scope", "Rota kapsami")}
              description={l(
                "Pick the exact AP scope where this amount rule should be evaluated.",
                "Bu tutar kuralinin hangi AP kapsaminda degerlendirilecegini secin."
              )}
              searchPlaceholder={l(
                "Search scope by code, name, or ISO2",
                "Kapsami kod, ad veya ISO2 ile arayin"
              )}
              emptyText={l(
                "No organization tree is available for this tenant.",
                "Bu tenant icin organizasyon agaci mevcut degil."
              )}
              noResultsText={l(
                "No matching AP scope was found.",
                "Eslesen AP kapsami bulunamadi."
              )}
            />

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Amount from", "Tutar alt siniri")}
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.minAmount}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, minAmount: event.target.value }))
                  }
                  disabled={draft.isFallback}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Amount to", "Tutar ust siniri")}
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.maxAmount}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, maxAmount: event.target.value }))
                  }
                  disabled={draft.isFallback}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Amount basis", "Tutar baz tipi")}
                </label>
                <Input value={l("Base amount", "Baz tutar")} disabled />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Priority", "Oncelik")}
                </label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, priority: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Effective from", "Gecerlilik baslangici")}
                </label>
                <Input
                  type="date"
                  value={draft.effectiveFrom}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, effectiveFrom: event.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Effective to", "Gecerlilik bitisi")}
                </label>
                <Input
                  type="date"
                  value={draft.effectiveTo}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, effectiveTo: event.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  {l("Status", "Durum")}
                </label>
                <Select
                  value={draft.status}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, status: value }))}
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

            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="workflow-routing-fallback"
                  checked={draft.isFallback}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({
                      ...prev,
                      isFallback: Boolean(checked),
                      minAmount: checked ? "" : prev.minAmount,
                      maxAmount: checked ? "" : prev.maxAmount,
                    }))
                  }
                />
                <label
                  htmlFor="workflow-routing-fallback"
                  className="text-sm font-medium text-amber-950"
                >
                  {l("Fallback rule", "Fallback kurali")}
                </label>
              </div>
              <p className="mt-2 text-xs leading-5 text-amber-900">
                {l(
                  "Use fallback only for the one catch-all route that should win when no amount band matches at this scope.",
                  "Fallback'i yalnizca bu kapsamda hicbir tutar bandi eslesmediginde kazanacak tek yakalama kurali icin kullanin."
                )}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                {l("Preview sentence", "Onizleme cumlesi")}
              </p>
              <p className="mt-2 text-sm leading-6 text-emerald-950">{previewText}</p>
            </div>

            {selectedScopeSelection && !draftCanWrite ? (
              <Alert variant="destructive">
                <AlertTitle>{l("Write access is missing", "Yazma erisimi eksik")}</AlertTitle>
                <AlertDescription>
                  {l(
                    "You can read this scope, but workflow assignment write access does not cover saving a route here.",
                    "Bu kapsami okuyabilirsiniz ancak workflow atama yazma erisimi burada rota kaydetmeyi kapsamiyor."
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            {validation.errors.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>{l("Fix before save", "Kaydetmeden once duzeltin")}</AlertTitle>
                <AlertDescription className="space-y-1">
                  {validation.errors.map((message, index) => (
                    <p key={`routing-error-${index}`}>{message}</p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            {validation.conflicts.length > 0 ? (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>{l("Rule conflict detected", "Kural cakismasi bulundu")}</AlertTitle>
                <AlertDescription className="space-y-3">
                  {validation.conflicts.map((conflict, index) => (
                    <div key={`routing-conflict-${index}`}>
                      <p>{conflict.message}</p>
                      <p className="text-xs opacity-80">
                        {buildAssignmentScopeLabel(conflict.row, l)} -{" "}
                        {buildRouteTargetLabelFromRow(conflict.row)}
                      </p>
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            {validation.warnings.length > 0 ? (
              <Alert className="border-amber-200 bg-amber-50/90 text-amber-950">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>{l("Review this carefully", "Bunu dikkatle kontrol edin")}</AlertTitle>
                <AlertDescription className="space-y-1 text-amber-900">
                  {validation.warnings.map((message, index) => (
                    <p key={`routing-warning-${index}`}>{message}</p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{l("Scope", "Kapsam")}</th>
                  <th className="px-4 py-3">{l("Amount band", "Tutar bandi")}</th>
                  <th className="px-4 py-3">{l("Route target", "Rota hedefi")}</th>
                  <th className="px-4 py-3">{l("Priority", "Oncelik")}</th>
                  <th className="px-4 py-3">{l("Status", "Durum")}</th>
                  <th className="px-4 py-3">{l("Preview", "Onizleme")}</th>
                  <th className="px-4 py-3">{l("Action", "Islem")}</th>
                </tr>
              </thead>
              <tbody>
                {apAssignments.map((row) => {
                  const rowPreview = buildApprovalRoutingRulePreview({
                    scopeType: row?.operatingUnitId
                      ? "OPERATING_UNIT"
                      : row?.legalEntityId
                        ? "LEGAL_ENTITY"
                        : row?.countryId
                          ? "COUNTRY"
                          : row?.groupCompanyId
                            ? "GROUP"
                            : "TENANT",
                    scopeSummary: buildScopeSummaryFromRow(row),
                    minAmount: row?.minAmount ?? null,
                    maxAmount: row?.maxAmount ?? null,
                    amountBasis: row?.amountBasis || "BASE_AMOUNT",
                    isFallback: row?.isFallback,
                    targetLabel: buildRouteTargetLabelFromRow(row),
                    l,
                  });

                  return (
                    <tr
                      key={row.id}
                      className={
                        row.isFallback
                          ? "border-t border-amber-200 bg-amber-50/40"
                          : "border-t border-border/70"
                      }
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-foreground">
                          {buildAssignmentScopeLabel(row, l)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.effectiveFrom}
                          {row.effectiveTo ? ` -> ${row.effectiveTo}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            {row.isFallback
                              ? l("Fallback", "Fallback")
                              : row.minAmount !== null && row.maxAmount !== null
                                ? `${row.minAmount} -> ${row.maxAmount}`
                                : row.minAmount !== null
                                  ? `> ${row.minAmount}`
                                  : row.maxAmount !== null
                                    ? `<= ${row.maxAmount}`
                                    : l("All amounts", "Tum tutarlar")}
                          </Badge>
                          <Badge variant="outline">{row.amountBasis || "BASE_AMOUNT"}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-foreground">
                        {buildRouteTargetLabelFromRow(row)}
                      </td>
                      <td className="px-4 py-3 align-top text-foreground">{row.priority ?? 100}</td>
                      <td className="px-4 py-3 align-top">
                        <Badge variant={row.status === "ACTIVE" ? "default" : "outline"}>
                          {row.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground">
                        <p className="max-w-md leading-6">{rowPreview}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditRow(row)}
                            disabled={!row.canEdit || busy}
                          >
                            <Pencil />
                            {l("Edit", "Duzenle")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleCloneRow(row)}
                            disabled={!canWriteAny || busy}
                          >
                            <Copy />
                            {l("Clone", "Kopyala")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleRetire(row)}
                            disabled={!row.canEdit || busy}
                          >
                            <Trash2 />
                            {saving === `routing-retire-${row.id}`
                              ? l("Removing...", "Kaldiriliyor...")
                              : l("Remove", "Kaldir")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {apAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-muted-foreground">
                      {l(
                        "No AP routing rules exist yet. Use the editor above to add the first route.",
                        "Henuz AP yonlendirme kurali yok. Ilk rotayi eklemek icin yukaridaki editoru kullanin."
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" onClick={resetDraft} disabled={busy}>
          {draft.id ? l("Cancel edit", "Duzenlemeyi iptal et") : l("Clear form", "Formu temizle")}
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!draftCanWrite || busy || !validation.isValid}
        >
          {busy
            ? l("Saving route...", "Rota kaydediliyor...")
            : draft.id
              ? l("Update route", "Rotayi guncelle")
              : l("Save route", "Rotayi kaydet")}
        </Button>
      </CardFooter>
    </Card>
  );
}
