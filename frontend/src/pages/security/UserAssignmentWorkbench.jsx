import {
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
    return { label: "Scheduled", tone: "blue" };
  }
  if (normalized === "EXPIRED") {
    return { label: "Expired", tone: "slate" };
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

function Pill({ label, tone = "slate" }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getToneClasses(tone)}`}>
      {label}
    </span>
  );
}

function WorkbenchMetric({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function WorkbenchBundleCard({
  actingRowId,
  bundle,
  expanded,
  l,
  onOpenUserEditor,
  onRevokeBundle,
  onSelectBundle,
  saving,
}) {
  const statusMeta = getBundleStatusMeta(bundle.status);
  const revoking = saving && actingRowId === bundle.id;
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
            <Pill label={bundle.roleMixLabel} tone={bundle.hasLegacyRole ? "amber" : "green"} />
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
        <div className="mt-4 grid gap-4 border-t border-sky-200 pt-4 lg:grid-cols-[minmax(0,1fr)_220px]">
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
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {l("Actions", "Aksiyonlar")}
            </div>
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenUserEditor(bundle.userId);
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                {l("Open user editor", "Kullanici editorunu ac")}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRevokeBundle(bundle);
                }}
                disabled={revoking}
                className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {revoking ? l("Revoking...", "Geri aliniyor...") : l("Revoke bundle", "Paketi geri al")}
              </button>
            </div>
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
    businessRoleScopeOptions,
    canUpsertRole,
    filteredUsers,
    l,
    onAssignBusinessRoleLabel,
    onClearFilters,
    onOpenBulkAssignments,
    onOpenUserEditor,
    onSelectBundle,
    onSelectUser,
    onRemoveBusinessRoleLabel,
    onUpdateBusinessRoleAssignmentField,
    packageFilterOptions,
    roleFilterOptions,
    selectedBusinessRoleAssignments,
    selectedBusinessRoleCatalogEntry,
    selectedBusinessRoleRuntimeRoleExists,
    scopeTargetOptions,
    selectedBundle,
    selectedUser,
    selectedUserBundles,
    selectedUserPackageLabels,
    selectedUserRoleEntries,
    selectedUserScopeLabels,
    setUserFilters,
    saving,
    actingRowId,
    userFilters,
    onRevokeBundle,
  } = props;

  return (
    <section className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Assignment workbench", "Atama calisma alani")}
              </div>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">
                {l("People list", "Kisi listesi")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {l(
                  "Filter users by business-facing role labels, workflow-package coverage, scope target, and assignment source before drilling into one selected user.",
                  "Kullanicilari is-odakli rol etiketleri, workflow-package kapsami, kapsam hedefi ve atama kaynagina gore filtreleyip tek bir secili kullaniciya inin."
                )}
              </p>
            </div>
            <div className="grid gap-3 px-5 py-5 md:grid-cols-2">
              <input
                type="text"
                value={userFilters.search}
                onChange={(event) => setUserFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder={l(
                  "Search by name, email, role, package, or scope",
                  "Ad, e-posta, rol, paket veya kapsama gore ara"
                )}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm md:col-span-2"
              />
              <select
                value={userFilters.status}
                onChange={(event) => setUserFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="ALL">{l("All statuses", "Tum durumlar")}</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INVITED">{l("Pending invite", "Bekleyen davet")}</option>
                <option value="DISABLED">DISABLED</option>
              </select>
              <select
                value={userFilters.roleCode}
                onChange={(event) => setUserFilters((prev) => ({ ...prev, roleCode: event.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="">{l("All business roles", "Tum is rolleri")}</option>
                {roleFilterOptions.map((option) => (
                  <option key={`workbench-role-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={userFilters.packageCode}
                onChange={(event) => setUserFilters((prev) => ({ ...prev, packageCode: event.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="">{l("All workflow packages", "Tum workflow paketleri")}</option>
                {packageFilterOptions.map((option) => (
                  <option key={`workbench-package-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={userFilters.scopeType}
                onChange={(event) => setUserFilters((prev) => ({ ...prev, scopeType: event.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="">{l("All scope types", "Tum kapsam tipleri")}</option>
                {["TENANT", "GROUP", "COUNTRY", "LEGAL_ENTITY", "OPERATING_UNIT"].map((scopeType) => (
                  <option key={`workbench-scope-type-${scopeType}`} value={scopeType}>
                    {scopeType}
                  </option>
                ))}
              </select>
              <select
                value={userFilters.scopeTarget}
                onChange={(event) => setUserFilters((prev) => ({ ...prev, scopeTarget: event.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="">{l("All scope targets", "Tum kapsam hedefleri")}</option>
                {scopeTargetOptions.map((option) => (
                  <option key={`workbench-scope-target-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={userFilters.sourceType}
                onChange={(event) => setUserFilters((prev) => ({ ...prev, sourceType: event.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="">{l("Direct or preset-derived", "Dogrudan veya preset")}</option>
                <option value="PRESET_DERIVED">{l("Preset-derived", "Preset-turevli")}</option>
                <option value="DIRECT">{l("Direct / custom", "Dogrudan / ozel")}</option>
              </select>
              <select
                value={userFilters.roleMix}
                onChange={(event) => setUserFilters((prev) => ({ ...prev, roleMix: event.target.value }))}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              >
                <option value="">{l("Legacy or composable", "Legacy veya composable")}</option>
                <option value="COMPOSABLE_ONLY">{l("Composable only", "Yalniz composable")}</option>
                <option value="LEGACY_PRESENT">{l("Legacy present", "Legacy mevcut")}</option>
              </select>
              <button
                type="button"
                onClick={onClearFilters}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"
              >
                {l("Clear filters", "Filtreleri temizle")}
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {l("Filtered users", "Filtrelenmis kullanicilar")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {l("Select one user to inspect current authority on the right.", "Mevcut yetkiyi sagda incelemek icin bir kullanici secin.")}
                </p>
              </div>
              <Pill
                label={l("{{count}} users", "{{count}} kullanici", { count: filteredUsers.length })}
                tone="blue"
              />
            </div>
            <div className="space-y-3 px-5 py-5">
              {filteredUsers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                  {l("No users match the current workbench filters.", "Calisma alani filtrelerine uyan kullanici yok.")}
                </div>
              ) : (
                filteredUsers.map((row) => {
                  const statusMeta = getUserStatusMeta(row.status);
                  const selected = Number(row.id) === Number(selectedUser?.id || 0);
                  return (
                    <button
                      key={`workbench-user-${row.id}`}
                      type="button"
                      onClick={() => onSelectUser(String(row.id))}
                      className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                        selected
                          ? "border-sky-300 bg-sky-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">
                            {getInitials(row.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-950">{row.name}</div>
                            <div className="mt-1 truncate text-sm text-slate-500">{row.email}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Pill label={statusMeta.label} tone={statusMeta.tone} />
                          <Pill
                            label={row.hasLegacyAssignments ? l("Legacy present", "Legacy mevcut") : l("Composable only", "Yalniz composable")}
                            tone={row.hasLegacyAssignments ? "amber" : "green"}
                          />
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {row.businessRoleLabels.slice(0, 2).map((businessRoleLabel) => (
                          <Pill
                            key={`workbench-user-business-role-${row.id}-${businessRoleLabel}`}
                            label={businessRoleLabel}
                            tone="violet"
                          />
                        ))}
                        {row.currentPresetCodes.slice(0, 2).map((presetCode) => (
                          <Pill
                            key={`workbench-user-preset-${row.id}-${presetCode}`}
                            label={getBootstrapHandoffPresetDisplayLabel(presetCode)}
                            tone="blue"
                          />
                        ))}
                        {row.topRoleCodes.slice(0, 2).map((roleCode) => (
                          <Pill
                            key={`workbench-user-role-${row.id}-${roleCode}`}
                            label={getRoleCatalogEntry(roleCode).code}
                          />
                        ))}
                        {row.topPackageLabels.slice(0, 2).map((packageLabel) => (
                          <Pill key={`workbench-user-package-${row.id}-${packageLabel}`} label={packageLabel} tone="green" />
                        ))}
                      </div>
                      <div className="mt-4 grid gap-3 text-xs text-slate-600 sm:grid-cols-4">
                        <div>
                          <div className="font-semibold text-slate-900">{row.assignmentCount}</div>
                          <div>{l("Bundles", "Paketler")}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{row.currentPackageCodes.length}</div>
                          <div>{l("Packages", "Paketler")}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{row.scopeCount}</div>
                          <div>{l("Scopes", "Kapsamlar")}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">
                            {row.presetCount} / {row.directBundleCount}
                          </div>
                          <div>{l("Preset / direct", "Preset / dogrudan")}</div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <aside className="xl:sticky xl:top-20 xl:self-start">
          <div className="space-y-4">
            {!selectedUser ? (
              <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-12 text-sm text-slate-500 shadow-sm">
                {l(
                  "Choose a user from the left panel to inspect authority detail.",
                  "Yetki detayini incelemek icin sol panelden bir kullanici secin."
                )}
              </div>
            ) : (
              <>
                <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {l("Selected user authority detail", "Secili kullanici yetki detayi")}
                    </div>
                    <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-semibold text-slate-950">{selectedUser.name}</h2>
                        <div className="mt-1 text-sm text-slate-500">{selectedUser.email}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Pill
                          label={getUserStatusMeta(selectedUser.status).label}
                          tone={getUserStatusMeta(selectedUser.status).tone}
                        />
                        {selectedUser.activeDelegationCount > 0 ? (
                          <Pill
                            label={l("{{count}} active delegation", "{{count}} aktif delegation", {
                              count: selectedUser.activeDelegationCount,
                            })}
                            tone="violet"
                          />
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {l(
                        "The workbench keeps one user in focus so scope, package, and source filters stay visible while deeper assignment editors land in the next slices.",
                        "Daha derin atama editorleri sonraki dilimlerde gelirken kapsam, paket ve kaynak filtreleri gorunur kalsin diye bu calisma alani bir kullaniciyi odakta tutar."
                      )}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenUserEditor(selectedUser)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        {l("Edit access", "Erisimi duzenle")}
                      </button>
                      <button
                        type="button"
                        onClick={onOpenBulkAssignments}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        {l("Open bulk assignment view", "Toplu atama gorunumunu ac")}
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-3 px-5 py-5 sm:grid-cols-4">
                    <WorkbenchMetric label={l("Bundles", "Paketler")} value={selectedUser.assignmentCount} />
                    <WorkbenchMetric label={l("Packages", "Paketler")} value={selectedUserPackageLabels.length} />
                    <WorkbenchMetric label={l("Scopes", "Kapsamlar")} value={selectedUser.scopeCount} />
                    <WorkbenchMetric
                      label={l("Preset / direct", "Preset / dogrudan")}
                      value={`${selectedUser.presetCount} / ${selectedUser.directBundleCount}`}
                    />
                  </div>
                  {selectedUser.hasLegacyAssignments ? (
                    <div className="mx-5 mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {l(
                        "This user still carries at least one legacy runtime role assignment. Keep cleanup visible, but prefer the composable package model for new work.",
                        "Bu kullanicida hala en az bir legacy runtime rol atamasi var. Temizligi gorunur tutun; ancak yeni isler icin composable paket modelini tercih edin."
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                    <h3 className="text-lg font-semibold text-slate-950">
                      {l("Business role labels", "Is rol etiketleri")}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {l(
                        "Assign non-authoritative business role labels separately from package authority. These labels improve workflow readability and assignee discovery, but they do not grant action permissions on their own.",
                        "Yetki paketlerinden ayri olarak otorite vermeyen is rol etiketleri atayin. Bu etiketler workflow okunabilirligini ve atanan kisi bulunurlugunu iyilestirir; ancak tek basina aksiyon yetkisi vermez."
                      )}
                    </p>
                  </div>
                  <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1.1fr)_320px]">
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {l("Assigned labels", "Atanmis etiketler")}
                      </div>
                      {selectedBusinessRoleAssignments.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                          {l(
                            "No business role labels are assigned yet.",
                            "Henuz is rol etiketi atanmis degil."
                          )}
                        </div>
                      ) : (
                        selectedBusinessRoleAssignments.map((assignment) => (
                          <div
                            key={`business-role-assignment-${assignment.assignmentId}`}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap gap-2">
                                  <Pill label={assignment.businessRoleLabel} tone="violet" />
                                  <Pill label={assignment.scopeType} tone="blue" />
                                </div>
                                <div className="mt-2 text-sm text-slate-700">
                                  {assignment.scopeLabel}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => onRemoveBusinessRoleLabel(assignment)}
                                disabled={saving && actingRowId === `business-role-${assignment.assignmentId}`}
                                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {saving && actingRowId === `business-role-${assignment.assignmentId}`
                                  ? l("Removing...", "Kaldiriliyor...")
                                  : l("Remove label", "Etiketi kaldir")}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <form
                      onSubmit={onAssignBusinessRoleLabel}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {l("Assign label", "Etiket ata")}
                      </div>
                      <div className="mt-4 space-y-3">
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700">
                            {l("Business role", "Is rolu")}
                          </label>
                          <select
                            value={businessRoleAssignmentForm.businessRoleCode}
                            onChange={(event) =>
                              onUpdateBusinessRoleAssignmentField(
                                "businessRoleCode",
                                event.target.value
                              )
                            }
                            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                          >
                            {roleFilterOptions.map((option) => (
                              <option key={`business-role-form-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-900">
                          <div className="font-semibold">
                            {l("Suggested scope", "Onerilen kapsam")}:{" "}
                            {selectedBusinessRoleCatalogEntry?.defaultScope || "-"}
                          </div>
                          <div className="mt-1 text-sky-800">
                            {l(
                              "This label stays non-authoritative. Package or runtime-role assignments still decide what the user can actually do.",
                              "Bu etiket otorite vermez. Kullanicinin gercekte ne yapabilecegini hala paket veya runtime rol atamalari belirler."
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700">
                            {l("Scope target", "Kapsam hedefi")}
                          </label>
                          <select
                            value={businessRoleAssignmentForm.scopeId}
                            onChange={(event) =>
                              onUpdateBusinessRoleAssignmentField("scopeId", event.target.value)
                            }
                            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                          >
                            {businessRoleScopeOptions.map((option) => (
                              <option key={`business-role-scope-${option.id}`} value={String(option.id)}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {!selectedBusinessRoleRuntimeRoleExists ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                            {canUpsertRole
                              ? l(
                                  "The label-only runtime role does not exist in this tenant yet. It will be created automatically with zero permissions on first assignment.",
                                  "Etiket-yalniz runtime rol bu tenant'ta henuz yok. Ilk atamada sifir yetki ile otomatik olusturulur."
                                )
                              : l(
                                  "First assignment also needs security.role.upsert because the label-only runtime role has not been created in this tenant yet.",
                                  "Ilk atama icin ayrica security.role.upsert gerekir; cunku etiket-yalniz runtime rol bu tenant'ta henuz olusturulmamis."
                                )}
                          </div>
                        ) : null}
                        <button
                          type="submit"
                          disabled={saving || !businessRoleAssignmentWriteAccess.allowed}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {saving ? l("Saving...", "Kaydediliyor...") : l("Assign business role", "Is rolu ata")}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
                <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                    <h3 className="text-lg font-semibold text-slate-950">
                      {l("Runtime authority snapshot", "Runtime yetki ozeti")}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {l(
                        "This section still explains the current permission-bearing runtime role mix and the workflow-package coverage derived from it. Direct package assignment UX lands in the next slices.",
                        "Bu bolum hala mevcut yetki veren runtime rol karisimini ve buradan tureyen workflow-package kapsamini aciklar. Dogrudan paket atama UX'i sonraki dilimlerde gelir."
                      )}
                    </p>
                  </div>
                  <div className="space-y-5 px-5 py-5">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {l("Current runtime role mix", "Mevcut runtime rol karisimi")}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedUserRoleEntries.length > 0 ? (
                          selectedUserRoleEntries.map((entry) => (
                            <Pill
                              key={`selected-role-${entry.runtimeCode || entry.code}`}
                              label={entry.code}
                              tone={
                                entry.legacy
                                  ? "amber"
                                  : entry.category === "system"
                                    ? "blue"
                                    : "slate"
                              }
                            />
                          ))
                        ) : (
                          <span className="text-sm text-slate-500">
                            {l("No runtime roles are assigned yet.", "Henuz runtime rol atanmis degil.")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {l("Workflow package coverage", "Workflow paket kapsami")}
                      </div>
                      {/* Package coverage stays derived from runtime-role mappings until direct package assignment ships. */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedUserPackageLabels.length > 0 ? (
                          selectedUserPackageLabels.map((packageLabel) => (
                            <Pill
                              key={`selected-package-${packageLabel}`}
                              label={packageLabel}
                              tone="green"
                            />
                          ))
                        ) : (
                          <span className="text-sm text-slate-500">
                            {l(
                              "No workflow-package mapping is visible for the current role mix yet.",
                              "Mevcut rol karisimi icin henuz gorunur bir workflow-package eslesmesi yok."
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {l("Scope targets", "Kapsam hedefleri")}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedUserScopeLabels.length > 0 ? (
                          selectedUserScopeLabels.map((scopeLabel) => (
                            <Pill key={`selected-scope-${scopeLabel}`} label={scopeLabel} tone="blue" />
                          ))
                        ) : (
                          <span className="text-sm text-slate-500">
                            {l("No scope targets are assigned yet.", "Henuz kapsam hedefi atanmis degil.")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">
                        {l("Business assignments", "Is atamalari")}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {l(
                          "Grouped business assignment bundles for the selected user. Revoke here when needed, and use the bulk assignment tab for broader edit flows.",
                          "Secili kullanici icin gruplanmis is atama paketleri. Gerektiginde burada geri alin; daha genis duzenleme akislari icin toplu atama sekmesini kullanin."
                        )}
                      </p>
                    </div>
                    <Pill
                      label={l("{{count}} bundles", "{{count}} paket", {
                        count: selectedUserBundles.length,
                      })}
                    />
                  </div>
                  <div className="space-y-3 px-5 py-5">
                    {selectedUserBundles.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                        {l(
                          "This user has no grouped business assignments yet.",
                          "Bu kullanicinin henuz gruplanmis is atamasi yok."
                        )}
                      </div>
                    ) : (
                      selectedUserBundles.map((bundle) => (
                        <WorkbenchBundleCard
                          key={`workbench-bundle-${bundle.id}`}
                          actingRowId={actingRowId}
                          bundle={bundle}
                          expanded={selectedBundle?.id === bundle.id}
                          l={l}
                          onOpenUserEditor={onOpenUserEditor}
                          onRevokeBundle={onRevokeBundle}
                          onSelectBundle={onSelectBundle}
                          saving={saving}
                        />
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
