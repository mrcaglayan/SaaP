import { useEffect, useState } from "react";
import {
  listDataScopes,
  listRoleAssignments,
  replaceUserDataScopes,
} from "../../api/rbacAdmin.js";
import {
  buildScopeLabel,
  getBootstrapHandoffPresetDisplayLabel,
  getRoleCatalogEntry,
} from "./roleCatalog.js";

function getToneClasses(tone) {
  if (tone === "blue") {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (tone === "green") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (tone === "rose") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (tone === "violet") {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function getUserStatusMeta(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return { label: "Active", tone: "green" };
  }
  if (normalized === "INVITED" || normalized === "PENDING") {
    return { label: "Pending invite", tone: "amber" };
  }
  if (normalized === "DISABLED" || normalized === "SUSPENDED") {
    return { label: "Disabled", tone: "slate" };
  }
  return { label: normalized || "Unknown", tone: "slate" };
}

function getBundleStatusMeta(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return { label: "Active", tone: "green" };
  }
  if (normalized === "UPCOMING") {
    return { label: "Upcoming", tone: "blue" };
  }
  if (normalized === "EXPIRED") {
    return { label: "Expired", tone: "slate" };
  }
  if (normalized === "REVOKED") {
    return { label: "Revoked", tone: "rose" };
  }
  return { label: "Custom", tone: "amber" };
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) {
    return "U";
  }
  return parts.map((part) => part[0].toUpperCase()).join("");
}

function formatDateTime(value) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  if (Number.isNaN(timestamp)) {
    return "-";
  }
  return new Date(timestamp).toLocaleString();
}

const RBAC_SCOPE_TYPES = Object.freeze([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

function createEmptyRoleRowDraft() {
  return {
    scopeType: "LEGAL_ENTITY",
    scopeId: "",
    effect: "ALLOW",
    effectiveFrom: "",
    effectiveTo: "",
  };
}

function getInviteExpiryLabel(l, row) {
  const normalizedStatus = String(row?.status || "").trim().toUpperCase();
  const normalizedInviteStatus = String(row?.invite_status || "")
    .trim()
    .toUpperCase();
  const hasPendingInvite =
    normalizedStatus === "INVITED" || normalizedInviteStatus === "PENDING";
  if (!row?.invite_expires_at || !hasPendingInvite) {
    return "";
  }
  return l("Invite expires {{date}}", "Davet suresi {{date}} tarihinde dolar", {
    date: formatDateTime(row.invite_expires_at),
  });
}

function Pill({ label, tone = "slate" }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getToneClasses(tone)}`}>
      {label}
    </span>
  );
}

function getPackageSourceRecommendationTone(recommendationType) {
  if (recommendationType === "starter") {
    return "blue";
  }
  if (recommendationType === "preset") {
    return "violet";
  }
  return "slate";
}

function getPackageSourceRecommendationLabel(l, recommendationType) {
  if (recommendationType === "starter") {
    return l("Starter package", "Starter paket");
  }
  if (recommendationType === "preset") {
    return l("Preset package", "Preset paket");
  }
  return l("Optional package", "Opsiyonel paket");
}

function getPackageSourcePreviewNote(l, entry) {
  const sourceName = entry?.recommendationSourceName || l("this source", "bu kaynak");
  if (entry?.recommendationType === "preset") {
    if (Array.isArray(entry?.previewStepLabels) && entry.previewStepLabels.length > 0) {
      return l(
        "Used in: {{steps}}",
        "Kullanildigi adimlar: {{steps}}",
        { steps: entry.previewStepLabels.join(", ") }
      );
    }
    return l(
      "Required by {{name}}.",
      "{{name}} icin gerekir.",
      { name: sourceName }
    );
  }
  if (entry?.recommendationType === "starter") {
    return l(
      "Recommended starter package for {{name}}.",
      "{{name}} icin onerilen starter paket.",
      { name: sourceName }
    );
  }
  return l(
    "Optional add-on package for {{name}}.",
    "{{name}} icin opsiyonel ek paket.",
    { name: sourceName }
  );
}

function getPackageSourcePreviewState(l, entry, scopeType) {
  if (entry?.alreadyAssigned) {
    return {
      tone: "amber",
      text: l(
        "Already assigned at this scope.",
        "Bu kapsamda zaten atanmis."
      ),
    };
  }
  if (!entry?.allowedAtScope) {
    return {
      tone: "amber",
      text: l(
        "Not available at {{scopeType}} scope.",
        "{{scopeType}} kapsaminda kullanilamaz.",
        { scopeType }
      ),
    };
  }
  if (entry?.assignmentBlockedByExtension) {
    return {
      tone: "amber",
      text: l(
        "Extension placeholder. This package cannot be applied yet.",
        "Extension taslagi. Bu paket henuz uygulanamaz."
      ),
    };
  }
  return {
    tone: "green",
    text: l(
      "Will be applied as a direct package grant.",
      "Dogrudan paket yetkisi olarak uygulanacak."
    ),
  };
}

function WorkbenchBundleCard({
  actingRowId,
  bundle,
  editingRoleRowId,
  expanded,
  l,
  lookups,
  onCancelRoleRowEdit,
  onRemoveBundleRoleRow,
  onSaveBundleRoleRow,
  onSelectBundle,
  onStartRoleRowEdit,
  onUpdateRoleRowDraft,
  roleRowDraft,
  roleRowScopeOptions,
  saving,
  tenantScopeId,
}) {
  const statusMeta = getBundleStatusMeta(bundle.status);
  return (
    <button
      type="button"
      onClick={() => onSelectBundle(bundle.id)}
      className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
        expanded
          ? "border-sky-300 bg-sky-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-base font-semibold text-slate-950">
              {bundle.presetDisplayName ||
                bundle.presetCode ||
                l("Custom assignment bundle", "Ozel atama paketi")}
            </div>
            <Pill label={statusMeta.label} tone={statusMeta.tone} />
            <Pill label={bundle.sourceTypeLabel} tone={bundle.isPresetBundle ? "blue" : "slate"} />
          </div>
          <div className="mt-2 text-sm text-slate-700">
            {bundle.userName} - {bundle.scopeLabel}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {bundle.packageLabels.map((packageLabel) => (
              <Pill key={`${bundle.id}-${packageLabel}`} label={packageLabel} tone="green" />
            ))}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{bundle.roleCodes.length} {l("roles", "rol")}</div>
          <div className="mt-1">{bundle.scopeType}</div>
        </div>
      </div>
      {expanded ? (
        <div className="mt-4 border-t border-sky-200 pt-4">
          <div>
            <p className="text-sm leading-6 text-slate-600">
              {bundle.presetSummary ||
                l(
                  "This bundle does not match a shipped preset exactly, so it remains a direct or custom business assignment.",
                  "Bu paket yayinlanan bir preset ile tam eslesmiyor; bu nedenle dogrudan veya ozel bir is atamasi olarak kalir."
                )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {bundle.roleLabels.map((roleLabel) => (
                <Pill key={`${bundle.id}-${roleLabel}`} label={roleLabel} tone="violet" />
              ))}
            </div>
            {bundle.workflowFamilyLabels.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {bundle.workflowFamilyLabels.map((familyLabel) => (
                  <Pill key={`${bundle.id}-${familyLabel}`} label={familyLabel} tone="blue" />
                ))}
              </div>
            ) : null}
            {Array.isArray(bundle.rows) && bundle.rows.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-sky-200 bg-white/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {l("Underlying role rows", "Alttaki rol satirlari")}
                  </div>
                  <Pill
                    label={l("{{count}} rows", "{{count}} satir", {
                      count: bundle.rows.length,
                    })}
                    tone="slate"
                  />
                </div>
                <div className="mt-3 space-y-3">
                  {bundle.rows.map((assignmentRow) => {
                    const rowStatusMeta = getBundleStatusMeta(assignmentRow.status);
                    const isEditing =
                      String(editingRoleRowId || "") ===
                      String(assignmentRow.assignmentId || "");
                    const rowBusy =
                      saving &&
                      actingRowId === `bundle-role-${assignmentRow.assignmentId}`;
                    const followsRecommendation =
                      !Array.isArray(assignmentRow.recommendedScopes) ||
                      assignmentRow.recommendedScopes.length === 0 ||
                      assignmentRow.recommendedScopes.includes(
                        assignmentRow.scopeType
                      );
                    return (
                      <div
                        key={`bundle-role-row-${assignmentRow.assignmentId}`}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-950">
                                {assignmentRow.roleLabel || assignmentRow.roleCode}
                              </div>
                              <Pill
                                label={rowStatusMeta.label}
                                tone={rowStatusMeta.tone}
                              />
                              <Pill label={assignmentRow.scopeType} tone="blue" />
                              {assignmentRow.effect !== "ALLOW" ? (
                                <Pill label={assignmentRow.effect} tone="rose" />
                              ) : null}
                              {!followsRecommendation ? (
                                <Pill
                                  label={l(
                                    "Outside recommendation",
                                    "Oneri disi"
                                  )}
                                  tone="amber"
                                />
                              ) : null}
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              {assignmentRow.scopeLabel}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {l(
                                "Effective {{from}} to {{to}}",
                                "{{from}} - {{to}} yururluk",
                                {
                                  from: assignmentRow.effectiveFrom || "-",
                                  to: assignmentRow.effectiveTo || "-",
                                }
                              )}
                            </div>
                            {Array.isArray(assignmentRow.recommendedScopes) &&
                            assignmentRow.recommendedScopes.length > 0 ? (
                              <div className="mt-1 text-xs text-slate-500">
                                {l(
                                  "Recommended scopes: {{scopes}}",
                                  "Onerilen kapsamlar: {{scopes}}",
                                  {
                                    scopes:
                                      assignmentRow.recommendedScopes.join(", "),
                                  }
                                )}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isEditing) {
                                  onCancelRoleRowEdit();
                                  return;
                                }
                                onStartRoleRowEdit(assignmentRow);
                              }}
                              disabled={rowBusy}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                            >
                              {isEditing
                                ? l("Cancel", "Iptal")
                                : l("Edit scope", "Kapsami duzenle")}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onRemoveBundleRoleRow(assignmentRow);
                              }}
                              disabled={rowBusy}
                              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-60"
                            >
                              {rowBusy
                                ? l("Working...", "Isleniyor...")
                                : l("Remove role", "Rolu kaldir")}
                            </button>
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-600">
                                  {l("Scope type", "Kapsam tipi")}
                                </label>
                                <select
                                  value={roleRowDraft.scopeType}
                                  onChange={(event) =>
                                    onUpdateRoleRowDraft(
                                      "scopeType",
                                      event.target.value
                                    )
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                >
                                  {RBAC_SCOPE_TYPES.map((scopeType) => (
                                    <option
                                      key={`bundle-role-scope-type-${scopeType}`}
                                      value={scopeType}
                                    >
                                      {scopeType}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1 md:col-span-1 xl:col-span-2">
                                <label className="text-xs font-semibold text-slate-600">
                                  {l("Target", "Hedef")}
                                </label>
                                <select
                                  value={roleRowDraft.scopeId}
                                  onChange={(event) =>
                                    onUpdateRoleRowDraft(
                                      "scopeId",
                                      event.target.value
                                    )
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                >
                                  <option value="">
                                    {l("Select...", "Secin...")}
                                  </option>
                                  {roleRowScopeOptions.map((option) => (
                                    <option
                                      key={`bundle-role-scope-${option.id}`}
                                      value={String(option.id)}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-600">
                                  {l("Effect", "Etki")}
                                </label>
                                <select
                                  value={roleRowDraft.effect}
                                  onChange={(event) =>
                                    onUpdateRoleRowDraft(
                                      "effect",
                                      event.target.value
                                    )
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                >
                                  <option value="ALLOW">ALLOW</option>
                                  <option value="DENY">DENY</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-600">
                                  {l("Effective from", "Baslangic tarihi")}
                                </label>
                                <input
                                  type="date"
                                  value={roleRowDraft.effectiveFrom}
                                  onChange={(event) =>
                                    onUpdateRoleRowDraft(
                                      "effectiveFrom",
                                      event.target.value
                                    )
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-600">
                                  {l("Effective to", "Bitis tarihi")}
                                </label>
                                <input
                                  type="date"
                                  value={roleRowDraft.effectiveTo}
                                  onChange={(event) =>
                                    onUpdateRoleRowDraft(
                                      "effectiveTo",
                                      event.target.value
                                    )
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                />
                              </div>
                            </div>
                            {bundle.isPresetBundle ? (
                              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                {l(
                                  "Changing only one underlying role row can turn this preset bundle into a custom bundle.",
                                  "Yalnizca tek bir alttaki rol satirini degistirmek bu preset paketini ozel pakete cevirebilir."
                                )}
                              </div>
                            ) : null}
                            {!Array.isArray(assignmentRow.recommendedScopes) ||
                            assignmentRow.recommendedScopes.length === 0 ||
                            assignmentRow.recommendedScopes.includes(
                              roleRowDraft.scopeType
                            ) ? null : (
                              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                {l(
                                  "This role is usually assigned at {{scopes}} scope.",
                                  "Bu rol genelde {{scopes}} kapsaminda atanir.",
                                  {
                                    scopes:
                                      assignmentRow.recommendedScopes.join(", "),
                                  }
                                )}
                              </div>
                            )}
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                              <div className="text-xs text-slate-500">
                                {l(
                                  "Current scope: {{scope}}",
                                  "Mevcut kapsam: {{scope}}",
                                  {
                                    scope: buildScopeLabel(
                                      roleRowDraft.scopeType,
                                      roleRowDraft.scopeType === "TENANT"
                                        ? Number(
                                            tenantScopeId ||
                                              roleRowDraft.scopeId ||
                                              0
                                          )
                                        : Number(roleRowDraft.scopeId || 0),
                                      lookups || {},
                                      tenantScopeId || null
                                    ),
                                  }
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onCancelRoleRowEdit();
                                  }}
                                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                                >
                                  {l("Cancel", "Iptal")}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSaveBundleRoleRow(assignmentRow);
                                  }}
                                  disabled={
                                    rowBusy ||
                                    (!roleRowDraft.scopeId &&
                                      roleRowDraft.scopeType !== "TENANT")
                                  }
                                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                                >
                                  {rowBusy
                                    ? l("Saving...", "Kaydediliyor...")
                                    : l("Save role row", "Rol satirini kaydet")}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </button>
  );
}

/**
 * Two-panel user-assignment workbench used by the UI-2A refactor.
 */
export default function UserAssignmentWorkbench(props) {
  const {
    businessRoleAssignmentForm,
    businessRoleAssignmentWriteAccess,
    businessRoleCatalogEntries,
    businessRolePackagePreviewEntries,
    businessRoleScopeOptions,
    filteredUsers,
    l,
    onAssignBusinessRoleLabel,
    onApplyPackageSource,
    onAssignWorkflowPackage,
    onClearFilters,
    onInviteUser,
    onUpdateBundleRoleRow,
    onRemoveBundleRoleRow,
    onSelectBundle,
    onSelectUser,
    onToggleBusinessRolePreviewPackage,
    onRemoveBusinessRoleLabel,
    onRemoveWorkflowPackage,
    onUpdateBusinessRoleAssignmentField,
    onUpdatePackageSourceApplyField,
    onUpdateWorkflowPackageAssignmentField,
    onTogglePackageSourcePreviewPackage,
    packageSourceApplyForm,
    packageSourceApplyWriteAccess,
    packageSourcePreviewEntries,
    packageSourceScopeOptions,
    packageSourceScopeTypeOptions,
    packageFilterOptions,
    roleFilterOptions,
    selectedBusinessRoleAssignments,
    selectedBusinessRolePackageCodes,
    selectedPackageSourcePackageCodes,
    selectedUserAssignmentAuditSummary,
    selectedUserEffectiveAuthorityPreview,
    selectedWorkflowPackageAssignments,
    selectedBundle,
    selectedUser,
    selectedUserBundles,
    selectedUserPackageLabels,
    selectedUserRoleEntries,
    setUserFilters,
    saving,
    actingRowId,
    userFilters,
    workflowPackageAssignmentForm,
    workflowPackageAssignmentWriteAccess,
    workflowPackageCatalogEntries,
    workflowPackageScopeOptions,
    workflowPackageScopeTypeOptions,
    workflowPresetCatalogEntries,
    // Setup owner — raw role row
    rawAssignmentForm,
    onUpdateRawAssignmentField,
    onCreateRawAssignment,
    rawScopeOptions,
    assignableRoleGroups,
    // Scope lookups
    lookups,
    tenantScopeId,
  } = props;
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [manageModalTab, setManageModalTab] = useState("access");
  // Scope tab — lazy loaded when tab is first opened
  const [scopeRows, setScopeRows] = useState([]);
  const [scopeRoleRows, setScopeRoleRows] = useState([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeError, setScopeError] = useState("");
  const [scopeMessage, setScopeMessage] = useState("");
  const [draftScope, setDraftScope] = useState({ scopeType: "LEGAL_ENTITY", scopeId: "", effect: "ALLOW" });
  const [editingRoleRowId, setEditingRoleRowId] = useState("");
  const [roleRowDraft, setRoleRowDraft] = useState(createEmptyRoleRowDraft());

  useEffect(() => {
    if (!manageModalOpen || manageModalTab !== "scopes" || !selectedUser?.id) return;
    let cancelled = false;
    setScopeLoading(true);
    setScopeError("");
    setScopeMessage("");
    setScopeRows([]);
    setScopeRoleRows([]);
    Promise.all([
      listDataScopes({ userId: selectedUser.id }),
      listRoleAssignments({ userId: selectedUser.id }),
    ])
      .then(([ds, ra]) => {
        if (cancelled) return;
        setScopeRows(
          (ds?.rows || []).map((row) => ({
            scopeType: String(row.scope_type || "").toUpperCase(),
            scopeId: Number(row.scope_id || 0),
            effect: String(row.effect || "ALLOW").toUpperCase(),
          }))
        );
        setScopeRoleRows(Array.isArray(ra?.rows) ? ra.rows : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setScopeError(
          err?.response?.data?.message ||
            l("Failed to load scope access.", "Kapsam erisimi yuklenemedi.")
        );
      })
      .finally(() => {
        if (!cancelled) {
          setScopeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [l, manageModalOpen, manageModalTab, selectedUser?.id]);

  function getScopeOptions(scopeType, lkp, tScopeId) {
    const l_ = lkp || {};
    if (scopeType === "TENANT") return tScopeId ? [{ id: tScopeId, label: `Tenant #${tScopeId}` }] : [];
    if (scopeType === "GROUP") return (l_.groups || []).map((r) => ({ id: Number(r.id), label: `${r.code} - ${r.name}` }));
    if (scopeType === "COUNTRY") return (l_.countries || []).map((r) => ({ id: Number(r.id), label: `${r.iso2} - ${r.name}` }));
    if (scopeType === "LEGAL_ENTITY") return (l_.legalEntities || []).map((r) => ({ id: Number(r.id), label: `${r.code} - ${r.name}` }));
    if (scopeType === "OPERATING_UNIT") return (l_.operatingUnits || []).map((r) => ({ id: Number(r.id), label: `${r.code} - ${r.name}` }));
    return [];
  }

  useEffect(() => {
    setEditingRoleRowId("");
    setRoleRowDraft(createEmptyRoleRowDraft());
  }, [manageModalOpen, selectedBundle?.id, selectedUser?.id]);

  function startRoleRowEdit(roleRow) {
    const scopeType = String(roleRow?.scopeType || "LEGAL_ENTITY").toUpperCase();
    const scopeOptions = getScopeOptions(scopeType, lookups, tenantScopeId);
    const currentScopeId = String(roleRow?.scopeId || "");
    const nextScopeId =
      scopeType === "TENANT"
        ? String(tenantScopeId || roleRow?.scopeId || "")
        : currentScopeId &&
            scopeOptions.some((option) => String(option.id) === currentScopeId)
          ? currentScopeId
          : String(scopeOptions[0]?.id || currentScopeId || "");
    setEditingRoleRowId(String(roleRow?.assignmentId || ""));
    setRoleRowDraft({
      scopeType,
      scopeId: nextScopeId,
      effect: String(roleRow?.effect || "ALLOW").toUpperCase(),
      effectiveFrom: roleRow?.effectiveFrom || "",
      effectiveTo: roleRow?.effectiveTo || "",
    });
  }

  function cancelRoleRowEdit() {
    setEditingRoleRowId("");
    setRoleRowDraft(createEmptyRoleRowDraft());
  }

  function updateRoleRowDraft(field, value) {
    setRoleRowDraft((prev) => {
      if (field === "scopeType") {
        const scopeType = String(value || "").toUpperCase();
        const scopeOptions = getScopeOptions(scopeType, lookups, tenantScopeId);
        return {
          ...prev,
          scopeType,
          scopeId:
            scopeType === "TENANT"
              ? String(tenantScopeId || "")
              : String(scopeOptions[0]?.id || ""),
        };
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  }

  async function handleSaveBundleRoleRow(roleRow) {
    const didSave = await onUpdateBundleRoleRow?.(roleRow, roleRowDraft);
    if (didSave) {
      cancelRoleRowEdit();
    }
  }

  const roleRowScopeOptions = getScopeOptions(
    roleRowDraft.scopeType,
    lookups,
    tenantScopeId
  );

  async function handleSaveScopes() {
    if (!selectedUser?.id) return;
    setScopeSaving(true);
    setScopeError("");
    setScopeMessage("");
    try {
      await replaceUserDataScopes(Number(selectedUser.id), scopeRows);
      setScopeMessage(l("Scopes saved.", "Kapsamlar kaydedildi."));
      try {
        const [ds, ra] = await Promise.all([
          listDataScopes({ userId: selectedUser.id }),
          listRoleAssignments({ userId: selectedUser.id }),
        ]);
        setScopeRows(
          (ds?.rows || []).map((row) => ({
            scopeType: String(row.scope_type || "").toUpperCase(),
            scopeId: Number(row.scope_id || 0),
            effect: String(row.effect || "ALLOW").toUpperCase(),
          }))
        );
        setScopeRoleRows(Array.isArray(ra?.rows) ? ra.rows : []);
      } catch (reloadError) {
        setScopeError(
          reloadError?.response?.data?.message ||
            l(
              "Scopes saved, but the latest scope data could not be refreshed.",
              "Kapsamlar kaydedildi ancak en guncel kapsam verisi yenilenemedi."
            )
        );
      }
    } catch (err) {
      setScopeError(err?.response?.data?.message || l("Failed to save scopes.", "Kapsamlar kaydedilemedi."));
    } finally {
      setScopeSaving(false);
    }
  }

  function addDraftScope() {
    const scopeId = draftScope.scopeType === "TENANT" && tenantScopeId
      ? tenantScopeId
      : Number(draftScope.scopeId);
    if (!scopeId) {
      setScopeError(l("Select a scope target first.", "Once bir kapsam hedefi secin."));
      setScopeMessage("");
      return;
    }
    setScopeRows((prev) => {
      const without = prev.filter((r) => !(r.scopeType === draftScope.scopeType && r.scopeId === scopeId));
      return [...without, { scopeType: draftScope.scopeType, scopeId, effect: draftScope.effect }];
    });
    setScopeMessage("");
    setScopeError("");
  }

  function removeScopeRow(scopeType, scopeId) {
    setScopeRows((prev) => prev.filter((r) => !(r.scopeType === scopeType && r.scopeId === scopeId)));
    setScopeMessage("");
    setScopeError("");
  }

  function closeManageModal() {
    setManageModalOpen(false);
    setManageModalTab("access");
    setScopeRows([]);
    setScopeRoleRows([]);
    setScopeLoading(false);
    setScopeSaving(false);
    setScopeError("");
    setScopeMessage("");
    setDraftScope({ scopeType: "LEGAL_ENTITY", scopeId: "", effect: "ALLOW" });
  }

  const effectiveAuthorityPreview = selectedUserEffectiveAuthorityPreview || {
    workflowLines: [],
    runtimeLines: [],
    warnings: [],
  };
  const activeRoleEntries = Array.isArray(selectedUserRoleEntries)
    ? selectedUserRoleEntries
    : [];
  const grantedPermissionCodes = Array.from(
    new Set(
      activeRoleEntries.flatMap((roleEntry) =>
        Array.isArray(roleEntry?.permissionCodes) ? roleEntry.permissionCodes : []
      )
    )
  ).sort();
  const assignmentAuditSummary = selectedUserAssignmentAuditSummary || {
    auditItems: [],
    sodWarnings: [],
  };

  return (
    <section className="space-y-4">
      {/* ── Filter toolbar ── */}
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-slate-200 bg-slate-50">
          <input
            type="text"
            value={userFilters.search}
            onChange={(event) => setUserFilters((prev) => ({ ...prev, search: event.target.value }))}
            placeholder={l("Search name, email, role, package…", "Ad, e-posta, rol, paket ara…")}
            className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
          />
          <select
            value={userFilters.status}
            onChange={(event) => setUserFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="ALL">{l("All statuses", "Tum durumlar")}</option>
            <option value="ACTIVE">Active</option>
            <option value="INVITED">{l("Pending invite", "Bekleyen davet")}</option>
            <option value="DISABLED">Disabled</option>
          </select>
          <select
            value={userFilters.roleCode}
            onChange={(event) => setUserFilters((prev) => ({ ...prev, roleCode: event.target.value }))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">{l("All roles", "Tum roller")}</option>
            {roleFilterOptions.map((option) => (
              <option key={`workbench-role-${option.value}`} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={userFilters.packageCode}
            onChange={(event) => setUserFilters((prev) => ({ ...prev, packageCode: event.target.value }))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">{l("All packages", "Tum paketler")}</option>
            {packageFilterOptions.map((option) => (
              <option key={`workbench-package-${option.value}`} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={userFilters.scopeType}
            onChange={(event) => setUserFilters((prev) => ({ ...prev, scopeType: event.target.value }))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">{l("All scope types", "Tum kapsam tipleri")}</option>
            {["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"].map((scopeType) => (
              <option key={`workbench-scope-type-${scopeType}`} value={scopeType}>{scopeType}</option>
            ))}
          </select>
          <select
            value={userFilters.sourceType}
            onChange={(event) => setUserFilters((prev) => ({ ...prev, sourceType: event.target.value }))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">{l("All sources", "Tum kaynaklar")}</option>
            <option value="DERIVED">{l("Derived", "Turevli")}</option>
            <option value="DIRECT">{l("Direct", "Dogrudan")}</option>
          </select>
          {(userFilters.search || userFilters.status !== "ALL" || userFilters.roleCode || userFilters.packageCode || userFilters.scopeType || userFilters.sourceType) ? (
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {l("Clear", "Temizle")}
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-500">{filteredUsers.length} {l("users", "kullanici")}</span>
            {typeof onInviteUser === "function" ? (
              <button
                type="button"
                onClick={onInviteUser}
                className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
              >
                {l("+ Invite user", "+ Kullanici davet et")}
              </button>
            ) : null}
          </div>
        </div>

        {/* ── User table ── */}
        {filteredUsers.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            {l("No users match the current filters.", "Mevcut filtrelere uyan kullanici yok.")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("User", "Kullanici")}</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("Status", "Durum")}</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("Roles & packages", "Roller ve paketler")}</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("Bundles", "Paketler")}</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("Organizational scope", "Organizasyon kapsami")}</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((row) => {
                  const statusMeta = getUserStatusMeta(row.status);
                  const selected = Number(row.id) === Number(selectedUser?.id || 0);
                  return (
                    <tr
                      key={`workbench-user-${row.id}`}
                      onClick={() => onSelectUser(String(row.id))}
                      className={`cursor-pointer transition-colors ${
                        selected
                          ? "bg-sky-50"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${selected ? "bg-sky-200 text-sky-900" : "bg-slate-100 text-slate-700"}`}>
                            {getInitials(row.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-950">{row.name}</div>
                            <div className="truncate text-xs text-slate-500">{row.email}</div>
                            {getInviteExpiryLabel(l, row) ? (
                              <div className="text-xs font-medium text-amber-700">{getInviteExpiryLabel(l, row)}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Pill label={statusMeta.label} tone={statusMeta.tone} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {row.businessRoleLabels.slice(0, 2).map((label) => (
                            <Pill key={`${row.id}-br-${label}`} label={label} tone="violet" />
                          ))}
                          {row.currentPresetCodes.slice(0, 1).map((code) => (
                            <Pill key={`${row.id}-pr-${code}`} label={getBootstrapHandoffPresetDisplayLabel(code)} tone="blue" />
                          ))}
                          {row.topPackageLabels.slice(0, 1).map((label) => (
                            <Pill key={`${row.id}-pk-${label}`} label={label} tone="green" />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-700">{row.assignmentCount}</td>
                      <td className="px-4 py-3 text-center text-sm text-slate-700">{row.scopeCount}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectUser(String(row.id));
                            setManageModalTab("access");
                            setManageModalOpen(true);
                          }}
                          className="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          {l("Manage", "Yonet")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Manage modal ── */}
      {manageModalOpen && selectedUser ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 px-4 py-8 backdrop-blur-sm">
          <div className="flex h-[82vh] max-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">

            {/* Modal header */}
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-4 rounded-t-[28px]">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">
                  {getInitials(selectedUser.name)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-slate-950">{selectedUser.name}</span>
                    <Pill label={getUserStatusMeta(selectedUser.status).label} tone={getUserStatusMeta(selectedUser.status).tone} />
                    {selectedUser.activeDelegationCount > 0 ? (
                      <Pill label={l("{{count}} delegation", "{{count}} delegation", { count: selectedUser.activeDelegationCount })} tone="violet" />
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                    <span>{selectedUser.email}</span>
                    <span>·</span>
                    <span>{selectedUser.assignmentCount} {l("bundles", "paket")}</span>
                    <span>·</span>
                    <span>{selectedUserPackageLabels.length} {l("packages", "paket")}</span>
                    <span>·</span>
                    <span>{selectedUser.scopeCount} {l("scopes", "kapsam")}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeManageModal}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {l("Close", "Kapat")}
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-slate-200 bg-white px-6 pt-3">
              {[
                { key: "access",   label: l("Permissions", "Yetkiler") },
                { key: "assign",   label: l("Role assignment", "Rol atamasi") },
                { key: "workflow", label: l("Workflow packages", "Workflow paketleri") },
                { key: "starter",  label: l("Starter bundles", "Starter paketler") },
                { key: "scopes",   label: l("Organizational scope", "Organizasyon kapsami") },
                { key: "audit",    label: l("Audit", "Denetim") },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setManageModalTab(tab.key)}
                  className={`rounded-t-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                    manageModalTab === tab.key
                      ? "border-b-2 border-slate-900 text-slate-950"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">

              {/* ── ACCESS TAB ── */}
              {manageModalTab === "access" ? (
                <div className="space-y-5">
                  {/* Business assignment bundles */}
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">
                        {l("Business assignment bundles", "Is atama paketleri")}
                      </h3>
                      <Pill label={l("{{count}} bundles", "{{count}} paket", { count: selectedUserBundles.length })} />
                    </div>
                    <div className="space-y-3 px-5 py-5">
                      {selectedUserBundles.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                          {l("No grouped business assignments yet.", "Henuz gruplanmis is atamasi yok.")}
                        </div>
                      ) : (
                        selectedUserBundles.map((bundle) => (
                          <WorkbenchBundleCard
                            key={`modal-bundle-${bundle.id}`}
                            actingRowId={actingRowId}
                            bundle={bundle}
                            editingRoleRowId={editingRoleRowId}
                            expanded={selectedBundle?.id === bundle.id}
                            l={l}
                            lookups={lookups}
                            onCancelRoleRowEdit={cancelRoleRowEdit}
                            onRemoveBundleRoleRow={onRemoveBundleRoleRow}
                            onSaveBundleRoleRow={handleSaveBundleRoleRow}
                            onSelectBundle={onSelectBundle}
                            onStartRoleRowEdit={startRoleRowEdit}
                            onUpdateRoleRowDraft={updateRoleRowDraft}
                            roleRowDraft={roleRowDraft}
                            roleRowScopeOptions={roleRowScopeOptions}
                            saving={saving}
                            tenantScopeId={tenantScopeId}
                          />
                        ))
                      )}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">
                        {l(
                          "Permissions granted by active role assignments",
                          "Etkin rol atamalarinin verdigi yetkiler"
                        )}
                      </h3>
                      <Pill
                        label={l(
                          "{{roles}} roles / {{permissions}} permissions",
                          "{{roles}} rol / {{permissions}} yetki",
                          {
                            roles: activeRoleEntries.length,
                            permissions: grantedPermissionCodes.length,
                          }
                        )}
                        tone="blue"
                      />
                    </div>
                    <div className="space-y-5 px-5 py-5">
                      {activeRoleEntries.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                          {l(
                            "No active role-backed permissions found.",
                            "Etkin rol kaynakli yetki bulunamadi."
                          )}
                        </div>
                      ) : (
                        <>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              {l("Granted permission codes", "Verilen yetki kodlari")}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {grantedPermissionCodes.map((permissionCode) => (
                                <code
                                  key={permissionCode}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                                >
                                  {permissionCode}
                                </code>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              {l("Source roles", "Kaynak roller")}
                            </div>
                            <div className="mt-3 space-y-3">
                              {activeRoleEntries.map((roleEntry) => (
                                <div
                                  key={String(roleEntry?.code || roleEntry?.id || "")}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-slate-950">
                                        {roleEntry?.displayName || roleEntry?.code || "-"}
                                      </div>
                                      <div className="mt-0.5 text-xs text-slate-500">
                                        {roleEntry?.code || "-"}
                                      </div>
                                    </div>
                                    <Pill
                                      label={l(
                                        "{{count}} permissions",
                                        "{{count}} yetki",
                                        {
                                          count: Array.isArray(roleEntry?.permissionCodes)
                                            ? roleEntry.permissionCodes.length
                                            : 0,
                                        }
                                      )}
                                      tone="slate"
                                    />
                                  </div>
                                  {Array.isArray(roleEntry?.permissionCodes) &&
                                  roleEntry.permissionCodes.length > 0 ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {roleEntry.permissionCodes.map((permissionCode) => (
                                        <code
                                          key={`${String(roleEntry?.code || "role")}:${permissionCode}`}
                                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                                        >
                                          {permissionCode}
                                        </code>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="mt-3 text-xs text-slate-500">
                                      {l(
                                        "No permission codes are attached to this role.",
                                        "Bu role bagli yetki kodu yok."
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Effective authority preview */}
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">
                        {l("Effective authority preview", "Etkin yetki onizlemesi")}
                      </h3>
                    </div>
                    <div className="space-y-5 px-5 py-5">
                      {effectiveAuthorityPreview.workflowLines.length === 0 && effectiveAuthorityPreview.runtimeLines.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                          {l("No active effective authority found.", "Etkin yetki bulunamadi.")}
                        </div>
                      ) : null}
                      {effectiveAuthorityPreview.workflowLines.length > 0 ? (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{l("Workflow & package authority", "Workflow ve paket yetkisi")}</div>
                          <div className="mt-3 space-y-3">
                            {effectiveAuthorityPreview.workflowLines.map((line) => (
                              <div key={line.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <Pill label={line.workflowFamilyLabel} tone="violet" />
                                  <Pill label={line.scopeType} tone="blue" />
                                  {line.sourceLabels.map((src) => <Pill key={src} label={src} tone="green" />)}
                                </div>
                                <p className="mt-2 text-sm font-medium text-slate-900">
                                  {l("Can {{summary}} in {{scope}}.", "{{scope}} kapsaminda {{summary}}.", { summary: line.summaryText, scope: line.scopeLabel })}
                                </p>
                                {line.missingText ? (
                                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                    {l("Still missing: {{missing}}.", "Hala eksik: {{missing}}.", { missing: line.missingText })}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {effectiveAuthorityPreview.runtimeLines.length > 0 ? (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {l("Direct runtime authority", "Dogrudan runtime yetkisi")}
                          </div>
                          <div className="mt-3 space-y-3">
                            {effectiveAuthorityPreview.runtimeLines.map((line) => (
                              <div
                                key={line.id}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                              >
                                <div className="flex flex-wrap gap-2">
                                  <Pill label={line.roleLabel || line.roleCode} tone="violet" />
                                  <Pill label={line.scopeType} tone="blue" />
                                  {line.sourceLabels.map((src) => (
                                    <Pill key={src} label={src} tone="slate" />
                                  ))}
                                </div>
                                <p className="mt-2 text-sm font-medium text-slate-900">
                                  {l(
                                    "Can {{summary}} in {{scope}}.",
                                    "{{scope}} kapsaminda {{summary}}.",
                                    {
                                      summary: line.summaryText,
                                      scope: line.scopeLabel,
                                    }
                                  )}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {effectiveAuthorityPreview.warnings.length > 0 ? (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                            {l("Authority warnings", "Yetki uyarilari")}
                          </div>
                          <div className="mt-3 space-y-3">
                            {effectiveAuthorityPreview.warnings.map((warning) => (
                              <div
                                key={warning.id}
                                className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                              >
                                {warning.text}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                </div>
              ) : null}

              {/* ── ASSIGN TAB ── */}
              {manageModalTab === "assign" ? (
                <div className="space-y-5">

                  {/* Business role labels */}
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-950">
                            {l("Business role labels", "Is rol etiketleri")}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {l(
                              "Assign the label and choose which default workflow packages should be granted with it.",
                              "Etiketi atayin ve birlikte verilecek varsayilan workflow paketlerini secin."
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Pill label={businessRoleAssignmentForm.scopeType} tone="blue" />
                          <Pill
                            label={l(
                              "{{count}} selected",
                              "{{count}} secili",
                              { count: selectedBusinessRolePackageCodes.length }
                            )}
                            tone="violet"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3 px-5 py-4">
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                        <form
                          onSubmit={onAssignBusinessRoleLabel}
                          className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                {l("Business role", "Is rolu")}
                              </label>
                              <select
                                value={businessRoleAssignmentForm.businessRoleCode}
                                onChange={(e) =>
                                  onUpdateBusinessRoleAssignmentField(
                                    "businessRoleCode",
                                    e.target.value
                                  )
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                              >
                                {roleFilterOptions.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                {l("Scope target", "Kapsam hedefi")}
                              </label>
                              <select
                                value={businessRoleAssignmentForm.scopeId}
                                onChange={(e) =>
                                  onUpdateBusinessRoleAssignmentField("scopeId", e.target.value)
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                              >
                                {businessRoleScopeOptions.map((o) => (
                                  <option key={o.id} value={String(o.id)}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <p className="text-xs leading-5 text-slate-500">
                            {l(
                              "Starter packages are preselected when available. You can remove them for a label-only assignment or add optional packages before saving.",
                              "Starter paketler varsa on secili gelir. Kaydetmeden once sadece etiket atamak icin bunlari kaldirabilir veya opsiyonel paketler ekleyebilirsiniz."
                            )}
                          </p>
                          <button
                            type="submit"
                            disabled={saving || !businessRoleAssignmentWriteAccess.allowed}
                            className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            {saving
                              ? l("Saving...", "Kaydediliyor...")
                              : selectedBusinessRolePackageCodes.length > 0
                                ? l(
                                    "Assign role + {{count}} packages",
                                    "Rol + {{count}} paket uygula",
                                    { count: selectedBusinessRolePackageCodes.length }
                                  )
                                : l("Add label only", "Sadece etiket ekle")}
                          </button>
                        </form>
                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              {l("Default authority packages", "Varsayilan yetki paketleri")}
                            </div>
                            <Pill
                              label={l(
                                "{{count}} selected",
                                "{{count}} secili",
                                { count: selectedBusinessRolePackageCodes.length }
                              )}
                              tone="blue"
                            />
                          </div>
                          {businessRolePackagePreviewEntries.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                              {l(
                                "No starter or optional packages are defined for this business role.",
                                "Bu is rolu icin tanimli starter veya opsiyonel paket yok."
                              )}
                            </div>
                          ) : (
                            businessRolePackagePreviewEntries.map((entry) => {
                              const state = getPackageSourcePreviewState(
                                l,
                                entry,
                                businessRoleAssignmentForm.scopeType
                              );
                              const recommendationTone = getPackageSourceRecommendationTone(
                                entry.recommendationType
                              );
                              return (
                                <label
                                  key={entry.code}
                                  className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
                                    entry.assignable
                                      ? "cursor-pointer border-slate-200 bg-white"
                                      : "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedBusinessRolePackageCodes.includes(entry.code)}
                                    onChange={() =>
                                      onToggleBusinessRolePreviewPackage(entry.code)
                                    }
                                    disabled={!entry.assignable}
                                    className="mt-0.5 h-4 w-4"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-sm font-semibold text-slate-950">
                                        {entry.displayName}
                                      </span>
                                      <Pill
                                        label={getPackageSourceRecommendationLabel(
                                          l,
                                          entry.recommendationType
                                        )}
                                        tone={recommendationTone}
                                      />
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                      {getPackageSourcePreviewNote(l, entry)}
                                    </div>
                                    <div
                                      className={`mt-1 text-xs font-medium ${
                                        state.tone === "green"
                                          ? "text-emerald-700"
                                          : "text-amber-700"
                                      }`}
                                    >
                                      {state.text}
                                    </div>
                                  </div>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        {selectedBusinessRoleAssignments.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                            {l("No business role labels assigned yet.", "Henuz is rol etiketi atanmamis.")}
                          </div>
                        ) : (
                          selectedBusinessRoleAssignments.map((assignment) => (
                            <div key={`brl-${assignment.assignmentId}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap gap-1.5">
                                    <Pill label={assignment.businessRoleLabel} tone="violet" />
                                    <Pill label={assignment.scopeType} tone="blue" />
                                    <Pill label={getBundleStatusMeta(assignment.status).label} tone={getBundleStatusMeta(assignment.status).tone} />
                                  </div>
                                  <div className="mt-1.5 text-xs text-slate-600">{assignment.scopeLabel}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onRemoveBusinessRoleLabel(assignment)}
                                  disabled={saving && actingRowId === `business-role-${assignment.assignmentId}`}
                                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                                >
                                  {saving && actingRowId === `business-role-${assignment.assignmentId}` ? l("Removing…", "Kaldiriliyor…") : l("Remove", "Kaldir")}
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <form onSubmit={onAssignBusinessRoleLabel} className="hidden">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{l("Assign label", "Etiket ata")}</div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Business role", "Is rolu")}</label>
                          <select value={businessRoleAssignmentForm.businessRoleCode} onChange={(e) => onUpdateBusinessRoleAssignmentField("businessRoleCode", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            {roleFilterOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Scope target", "Kapsam hedefi")}</label>
                          <select value={businessRoleAssignmentForm.scopeId} onChange={(e) => onUpdateBusinessRoleAssignmentField("scopeId", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            {businessRoleScopeOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
                          </select>
                        </div>
                        <button type="submit" disabled={saving || !businessRoleAssignmentWriteAccess.allowed} className="w-full rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                          {saving ? l("Saving…", "Kaydediliyor…") : l("Assign role label", "Rol etiketi ata")}
                        </button>
                        <p className="text-xs leading-5 text-slate-500">
                          {l(
                            "Business role labels do not assign starter workflow packages by themselves. Use Starter bundles to apply the recommended packages for that role.",
                            "Is rolu etiketleri tek basina starter workflow paketlerini vermez. Bu rol icin onerilen paketleri uygulamak uzere Starter paketler sekmesini kullanin."
                          )}
                        </p>
                      </form>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">{l("Advanced raw role row", "Gelismis ham rol satiri")}</h3>
                    </div>
                    <form onSubmit={onCreateRawAssignment} className="space-y-4 px-5 py-5">
                      <p className="text-sm leading-6 text-slate-600">
                        {l(
                          "Use this only for deliberate exceptions. Setup owner presets and package/starter flows should remain the normal admin paths.",
                          "Bunu yalnizca bilincli istisnalar icin kullanin. Setup sahibi presetleri ile paket/starter akisleri normal yonetici yolu olarak kalmalidir."
                        )}
                      </p>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700">{l("Role", "Rol")}</label>
                        <select
                          value={rawAssignmentForm?.roleId || ""}
                          onChange={(e) => onUpdateRawAssignmentField("roleId", e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                        >
                          <option value="">{l("Choose role", "Rol secin")}</option>
                          {(Array.isArray(assignableRoleGroups) ? assignableRoleGroups : []).map((group) => (
                            <optgroup key={`raw-rg-${group.key}`} label={group.label}>
                              {group.roles.map((role) => (
                                <option key={`raw-r-${role.id}`} value={String(role.id)}>
                                  {getRoleCatalogEntry(role.code || "")?.code || role.code || role.id}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Scope type", "Kapsam tipi")}</label>
                          <select
                            value={rawAssignmentForm?.scopeType || "TENANT"}
                            onChange={(e) => onUpdateRawAssignmentField("scopeType", e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                          >
                            {["TENANT","GROUP","COUNTRY","LEGAL_ENTITY","OPERATING_UNIT"].map((st) => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Effect", "Etki")}</label>
                          <select
                            value={rawAssignmentForm?.effect || "ALLOW"}
                            onChange={(e) => onUpdateRawAssignmentField("effect", e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                          >
                            {["ALLOW","DENY"].map((ef) => <option key={ef} value={ef}>{ef}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700">{l("Scope", "Kapsam")}</label>
                        <select
                          value={rawAssignmentForm?.scopeId || ""}
                          onChange={(e) => onUpdateRawAssignmentField("scopeId", e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                        >
                          {(Array.isArray(rawScopeOptions) ? rawScopeOptions : []).map((opt) => (
                            <option key={opt.id} value={String(opt.id)}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Effective from", "Baslangic tarihi")}</label>
                          <input type="date" value={rawAssignmentForm?.effectiveFrom || ""} onChange={(e) => onUpdateRawAssignmentField("effectiveFrom", e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Effective to", "Bitis tarihi")}</label>
                          <input type="date" value={rawAssignmentForm?.effectiveTo || ""} onChange={(e) => onUpdateRawAssignmentField("effectiveTo", e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60"
                      >
                        {saving ? l("Saving...", "Kaydediliyor...") : l("Create raw role row", "Ham rol satiri olustur")}
                      </button>
                    </form>
                  </div>
                </div>
              ) : null}

              {/* ── WORKFLOW PACKAGES TAB ── */}
              {manageModalTab === "workflow" ? (
                <div className="space-y-5">

                  {/* Direct workflow packages */}
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">{l("Direct workflow packages", "Dogrudan workflow paketleri")}</h3>
                    </div>
                    <div className="grid gap-5 px-5 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
                      <div className="space-y-3 lg:order-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{l("Assigned packages", "Atanmis paketler")}</div>
                        {selectedWorkflowPackageAssignments.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                            {l("No direct workflow packages assigned yet.", "Henuz dogrudan workflow paketi atanmamis.")}
                          </div>
                        ) : (
                          selectedWorkflowPackageAssignments.map((assignment) => (
                            <div key={`wpa-${assignment.assignmentId}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap gap-1.5">
                                    <Pill label={assignment.packageLabel} tone="green" />
                                    <Pill label={assignment.scopeType} tone="blue" />
                                    <Pill label={getBundleStatusMeta(assignment.status).label} tone={getBundleStatusMeta(assignment.status).tone} />
                                  </div>
                                  <div className="mt-1.5 text-xs text-slate-600">{assignment.scopeLabel}</div>
                                  <div className="mt-0.5 text-xs text-slate-500">{assignment.permissionCount} {l("permissions", "yetki")}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onRemoveWorkflowPackage(assignment)}
                                  disabled={saving && actingRowId === `workflow-package-${assignment.assignmentId}`}
                                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-60"
                                >
                                  {saving && actingRowId === `workflow-package-${assignment.assignmentId}` ? l("Removing…", "Kaldiriliyor…") : l("Remove", "Kaldir")}
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <form onSubmit={onAssignWorkflowPackage} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3 lg:order-1">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{l("Assign package", "Paket ata")}</div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Workflow package", "Workflow paketi")}</label>
                          <select value={workflowPackageAssignmentForm.packageCode} onChange={(e) => onUpdateWorkflowPackageAssignmentField("packageCode", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            {workflowPackageCatalogEntries.map((e) => <option key={e.code} value={e.code}>{e.displayName}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Scope type", "Kapsam tipi")}</label>
                          <select value={workflowPackageAssignmentForm.scopeType} onChange={(e) => onUpdateWorkflowPackageAssignmentField("scopeType", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            {workflowPackageScopeTypeOptions.map((st) => <option key={st} value={st}>{st}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Scope target", "Kapsam hedefi")}</label>
                          <select value={workflowPackageAssignmentForm.scopeId} onChange={(e) => onUpdateWorkflowPackageAssignmentField("scopeId", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            {workflowPackageScopeOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
                          </select>
                        </div>
                        <button type="submit" disabled={saving || !workflowPackageAssignmentWriteAccess.allowed} className="w-full rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                          {saving ? l("Saving…", "Kaydediliyor…") : l("Assign package", "Paket ata")}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ── STARTER BUNDLES TAB ── */}
              {manageModalTab === "starter" ? (
                <div className="space-y-5">

                  {/* Starter bundles & presets */}
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">{l("Starter bundles & presets", "Starter paketler ve presetler")}</h3>
                    </div>
                    <div className="grid gap-5 px-5 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
                      <form onSubmit={onApplyPackageSource} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{l("Quick apply", "Hizli uygula")}</div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Source", "Kaynak")}</label>
                          <select value={packageSourceApplyForm.sourceKind} onChange={(e) => onUpdatePackageSourceApplyField("sourceKind", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            <option value="STARTER">{l("Business role starter", "Is rolu starter")}</option>
                            <option value="PRESET">{l("Workflow preset", "Workflow preset")}</option>
                          </select>
                        </div>
                        {packageSourceApplyForm.sourceKind === "STARTER" ? (
                          <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-700">{l("Business role", "Is rolu")}</label>
                            <select value={packageSourceApplyForm.businessRoleCode} onChange={(e) => onUpdatePackageSourceApplyField("businessRoleCode", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                              {(Array.isArray(businessRoleCatalogEntries) ? businessRoleCatalogEntries : []).map((entry) => (
                                <option key={entry.code} value={entry.code}>{entry.displayName}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-700">{l("Workflow preset", "Workflow preset")}</label>
                            <select value={packageSourceApplyForm.presetCode} onChange={(e) => onUpdatePackageSourceApplyField("presetCode", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                              {workflowPresetCatalogEntries.map((entry) => (
                                <option key={entry.code} value={entry.code}>{entry.displayName}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Scope type", "Kapsam tipi")}</label>
                          <select value={packageSourceApplyForm.scopeType} onChange={(e) => onUpdatePackageSourceApplyField("scopeType", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            {packageSourceScopeTypeOptions.map((st) => <option key={st} value={st}>{st}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700">{l("Scope target", "Kapsam hedefi")}</label>
                          <select value={packageSourceApplyForm.scopeId} onChange={(e) => onUpdatePackageSourceApplyField("scopeId", e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            {packageSourceScopeOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
                          </select>
                        </div>
                        <button type="submit" disabled={saving || !packageSourceApplyWriteAccess.allowed || selectedPackageSourcePackageCodes.length === 0} className="w-full rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                          {saving ? l("Applying…", "Uygulaniyor…") : l("Apply {{count}} packages", "{{count}} paketi uygula", { count: selectedPackageSourcePackageCodes.length })}
                        </button>
                        <p className="text-xs leading-5 text-slate-500">
                          {l(
                            "Starter source previews the workflow packages recommended for the selected business role at the chosen scope.",
                            "Starter kaynagi, secilen is rolu icin secilen kapsamda onerilen workflow paketlerini onizler."
                          )}
                        </p>
                      </form>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{l("Preview packages", "Onizleme paketleri")}</div>
                          <Pill label={l("{{count}} selected", "{{count}} secili", { count: selectedPackageSourcePackageCodes.length })} tone="blue" />
                        </div>
                        {packageSourcePreviewEntries.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                            {l("Select a source to preview packages.", "Paketleri onizlemek icin bir kaynak secin.")}
                          </div>
                        ) : (
                          packageSourcePreviewEntries.map((entry) => {
                            const state = getPackageSourcePreviewState(l, entry, packageSourceApplyForm.scopeType);
                            const recommendationTone = getPackageSourceRecommendationTone(entry.recommendationType);
                            return (
                              <label key={entry.code} className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 ${entry.assignable ? "border-slate-200 bg-white" : "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"}`}>
                                <input type="checkbox" checked={selectedPackageSourcePackageCodes.includes(entry.code)} onChange={() => onTogglePackageSourcePreviewPackage(entry.code)} disabled={!entry.assignable} className="mt-0.5 h-4 w-4" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-sm font-semibold text-slate-950">{entry.displayName}</span>
                                    <Pill label={getPackageSourceRecommendationLabel(l, entry.recommendationType)} tone={recommendationTone} />
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">{getPackageSourcePreviewNote(l, entry)}</div>
                                  <div className={`mt-1 text-xs font-medium ${state.tone === "green" ? "text-emerald-700" : "text-amber-700"}`}>{state.text}</div>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ── ASSIGNMENTS (BUNDLES) TAB ── */}

              {/* ── SCOPES TAB ── */}
              {manageModalTab === "scopes" ? (
                <div className="space-y-5">

                  {/* Feedback */}
                  {scopeError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{scopeError}</div>
                  ) : null}
                  {scopeMessage ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{scopeMessage}</div>
                  ) : null}

                  {/* Data scope access */}
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">{l("Data scope access", "Veri kapsami erisimi")}</h3>
                      <Pill label={l("{{count}} rules", "{{count}} kural", { count: scopeRows.length })} />
                    </div>

                    {/* Add row form */}
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-600">{l("Scope type", "Kapsam tipi")}</label>
                          <select
                            value={draftScope.scopeType}
                            onChange={(e) => {
                              const scopeType = e.target.value;
                              const opts = getScopeOptions(scopeType, lookups, tenantScopeId);
                              setDraftScope({ scopeType, scopeId: String(opts[0]?.id || ""), effect: draftScope.effect });
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            {["TENANT","GROUP","COUNTRY","LEGAL_ENTITY","OPERATING_UNIT"].map((st) => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-[200px] flex-1 space-y-1">
                          <label className="text-xs font-semibold text-slate-600">{l("Target", "Hedef")}</label>
                          <select
                            value={draftScope.scopeId}
                            onChange={(e) => setDraftScope((prev) => ({ ...prev, scopeId: e.target.value }))}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            <option value="">{l("Select…", "Secin…")}</option>
                            {getScopeOptions(draftScope.scopeType, lookups, tenantScopeId).map((opt) => (
                              <option key={opt.id} value={String(opt.id)}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-600">{l("Effect", "Etki")}</label>
                          <select
                            value={draftScope.effect}
                            onChange={(e) => setDraftScope((prev) => ({ ...prev, effect: e.target.value }))}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            <option value="ALLOW">ALLOW</option>
                            <option value="DENY">DENY</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={addDraftScope}
                          disabled={!draftScope.scopeId && draftScope.scopeType !== "TENANT"}
                          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {l("Add", "Ekle")}
                        </button>
                      </div>
                    </div>

                    {/* Scope rows */}
                    <div className="px-5 py-4">
                      {scopeLoading ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                          {l("Loading…", "Yukleniyor…")}
                        </div>
                      ) : scopeRows.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                          {l("No data scopes assigned yet. Add one above.", "Henuz veri kapsami atanmamis. Yukaridan ekleyin.")}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {scopeRows.map((row) => (
                            <div key={`${row.scopeType}-${row.scopeId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Pill label={row.scopeType} tone="blue" />
                                <Pill label={row.effect} tone={row.effect === "DENY" ? "rose" : "green"} />
                                <span className="text-sm text-slate-700">
                                  {buildScopeLabel(row.scopeType, row.scopeId, lookups || {}, tenantScopeId || null)}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeScopeRow(row.scopeType, row.scopeId)}
                                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                              >
                                {l("Remove", "Kaldir")}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Save button */}
                    <div className="border-t border-slate-200 px-5 py-4">
                      <button
                        type="button"
                        onClick={handleSaveScopes}
                        disabled={scopeSaving || scopeLoading}
                        className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {scopeSaving ? l("Saving…", "Kaydediliyor…") : l("Save scope rules", "Kapsam kurallarini kaydet")}
                      </button>
                    </div>
                  </div>

                  {/* Role assignments (read-only) */}
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">{l("Role assignments", "Rol atamalari")}</h3>
                      <Pill label={l("{{count}} rows", "{{count}} satir", { count: scopeRoleRows.length })} />
                    </div>
                    <div className="px-5 py-5">
                      {scopeLoading ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                          {l("Loading…", "Yukleniyor…")}
                        </div>
                      ) : scopeRoleRows.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                          {l("No role assignments found.", "Rol atamasi bulunamadi.")}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {scopeRoleRows.map((row) => (
                            <div key={Number(row.id || 0) || `${row.role_code}-${row.scope_type}-${row.scope_id}`} className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                              <Pill label={String(row.role_code || "")} tone="violet" />
                              <Pill label={String(row.scope_type || "").toUpperCase()} tone="blue" />
                              <span className="text-sm text-slate-700">
                                {buildScopeLabel(
                                  String(row.scope_type || "").toUpperCase(),
                                  Number(row.scope_id || 0),
                                  lookups || {},
                                  tenantScopeId || null
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {/* ── AUDIT TAB ── */}
              {manageModalTab === "audit" ? (
                <div className="space-y-5">
                  <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                      <h3 className="text-sm font-semibold text-slate-950">{l("Assignment audit & SoD warnings", "Atama audit ve SoD uyarilari")}</h3>
                    </div>
                    <div className="space-y-5 px-5 py-5">
                      {assignmentAuditSummary.sodWarnings.length > 0 ? (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">{l("SoD warnings", "SoD uyarilari")}</div>
                          <div className="mt-3 space-y-3">
                            {assignmentAuditSummary.sodWarnings.map((warning) => (
                              <div key={warning.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                                <div className="flex flex-wrap gap-1.5">
                                  <Pill label={warning.title} tone="amber" />
                                  {warning.scopeLabel ? <Pill label={warning.scopeLabel} tone="blue" /> : null}
                                </div>
                                <p className="mt-2 text-sm text-amber-900">{warning.description}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                          {l("No SoD warnings for this user.", "Bu kullanici icin SoD uyarisi yok.")}
                        </div>
                      )}
                      {assignmentAuditSummary.auditItems.length > 0 ? (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{l("Audit items", "Audit kayitlari")}</div>
                          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50">
                                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("Type", "Tip")}</th>
                                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("Label", "Etiket")}</th>
                                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("Scope", "Kapsam")}</th>
                                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{l("Status", "Durum")}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {assignmentAuditSummary.auditItems.map((item, i) => (
                                  <tr key={i} className="hover:bg-slate-50">
                                    <td className="px-4 py-2.5"><Pill label={item.type} tone="slate" /></td>
                                    <td className="px-4 py-2.5 text-slate-900">{item.label}</td>
                                    <td className="px-4 py-2.5 text-slate-600">{item.scopeLabel || "-"}</td>
                                    <td className="px-4 py-2.5"><Pill label={item.status} tone={item.status === "ACTIVE" ? "green" : "slate"} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                          {l("No audit items available.", "Audit kaydi bulunamadi.")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
