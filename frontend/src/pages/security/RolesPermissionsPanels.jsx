import { AlertTriangle } from "lucide-react";

const ROLE_SCOPE_LEVEL_ORDER = Object.freeze([
  "TENANT",
  "GROUP",
  "COUNTRY",
  "LEGAL_ENTITY",
  "OPERATING_UNIT",
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function getRoleAuthorityLabel(entry) {
  if (entry?.managedPackageRole) {
    return "Managed authority";
  }
  if (entry?.companionOnly) {
    return "Companion authority";
  }
  if (entry?.category === "system") {
    return "Broad administration";
  }
  return "Composable runtime";
}

function getRecommendedScopeSet(entry) {
  return new Set(
    [
      ...(Array.isArray(entry?.recommendedScopes) ? entry.recommendedScopes : []),
      entry?.defaultScope,
    ]
      .map((value) => normalizeText(value).toUpperCase())
      .filter(Boolean)
  );
}

function formatScopeLabel(scopeType) {
  return normalizeText(scopeType).replaceAll("_", " ");
}

function RoleMetadataField({ label, note, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-950">{value}</div>
      {note ? <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div> : null}
    </div>
  );
}

function RoleScopeCoveragePills({ entry, compact = false }) {
  const activeScopes = getRecommendedScopeSet(entry);
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-4"}`}>
      {ROLE_SCOPE_LEVEL_ORDER.map((scopeType) => {
        const active = activeScopes.has(scopeType);
        return (
          <span
            key={`${entry?.code || "role"}-${scopeType}`}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
              active
                ? "border-slate-300 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-300"
            }`}
          >
            {formatScopeLabel(scopeType)}
          </span>
        );
      })}
    </div>
  );
}

function PermissionDependencyHint({ l, permission }) {
  if (permission.requiresRead) {
    return (
      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
        {l("Requires READ", "READ gerekir")}
      </span>
    );
  }
  return <span className="text-xs text-slate-400">-</span>;
}

function PermissionModuleTable({
  canReplaceRolePermissions,
  group,
  l,
  onTogglePermission,
  saving,
}) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {group.moduleLabel}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {l("{{selected}} of {{total}} selected", "{{selected}} / {{total}} secili", {
              selected: group.selectedCount,
              total: group.permissions.length,
            })}
          </div>
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          {group.moduleKey}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[940px]">
          <div className="grid grid-cols-[64px_minmax(260px,1.35fr)_140px_minmax(320px,1.65fr)_150px] gap-3 border-b border-slate-200 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <div>{l("Use", "Sec")}</div>
            <div>{l("Permission code", "Yetki kodu")}</div>
            <div>{l("Action", "Aksiyon")}</div>
            <div>{l("Description", "Aciklama")}</div>
            <div>{l("Dependency", "Bagimlilik")}</div>
          </div>

          <div className="divide-y divide-slate-200">
            {group.permissions.map((permission) => (
              <label
                key={permission.id}
                className={`grid grid-cols-[64px_minmax(260px,1.35fr)_140px_minmax(320px,1.65fr)_150px] gap-3 px-4 py-3 text-sm ${
                  canReplaceRolePermissions && !saving ? "cursor-pointer hover:bg-slate-50" : ""
                }`}
              >
                <span className="pt-0.5">
                  <input
                    type="checkbox"
                    checked={permission.selected}
                    onChange={() => onTogglePermission(permission.code)}
                    disabled={!canReplaceRolePermissions || saving}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </span>
                <span className="min-w-0 font-mono text-xs leading-5 text-slate-900 break-all">
                  {permission.code}
                </span>
                <span className="pt-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">
                  {permission.actionLabel}
                </span>
                <span className="min-w-0 text-sm leading-6 text-slate-600">
                  {permission.description ||
                    l("{{action}} access for {{module}}.", "{{module}} icin {{action}} erisimi.", {
                      action: permission.actionLabel,
                      module: group.moduleLabel,
                    })}
                </span>
                <span className="pt-0.5">
                  <PermissionDependencyHint l={l} permission={permission} />
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Summarizes the selected role's meaning, scope posture, and review notes
 * without recreating the older dashboard-style detail surface.
 */
export function SelectedRoleOverviewPanel({
  entry,
  l,
  selectedRoleAttentionItems,
  selectedRoleDisplayCode,
}) {
  const recommendedScopeLabel =
    Array.isArray(entry?.recommendedScopes) && entry.recommendedScopes.length > 0
      ? entry.recommendedScopes.map(formatScopeLabel).join(", ")
      : formatScopeLabel(entry?.defaultScope) || "-";
  const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : [];
  const capabilitySummary =
    capabilities.length > 0
      ? capabilities.slice(0, 4).join(", ")
      : l("Tenant-specific permissions", "Kiraciya ozel yetkiler");
  const hasAttentionItems = selectedRoleAttentionItems.length > 0;
  const reviewItems = hasAttentionItems
    ? selectedRoleAttentionItems
    : [
        l(
          "This role follows the standard composable runtime model.",
          "Bu rol standart birlestirilebilir runtime modelini izler."
        ),
      ];

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {l("Overview", "Genel bakis")}
          </div>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            {l("Role meaning and scope posture", "Rol anlami ve kapsam durusu")}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{entry.description}</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <RoleMetadataField
              label={l("Runtime label", "Runtime etiketi")}
              value={selectedRoleDisplayCode}
              note={entry.modelTypeLabel}
            />
            <RoleMetadataField
              label={l("Authority model", "Yetki modeli")}
              value={getRoleAuthorityLabel(entry)}
              note={entry.categoryLabel}
            />
            <RoleMetadataField
              label={l("Workflow family", "Workflow ailesi")}
              value={entry.workflowFamilyLabel}
              note={l(
                "Use this role as a direct authority source when assigned at the right scope.",
                "Bu rolu dogru kapsamda atandiginda dogrudan yetki kaynagi olarak kullanin."
              )}
            />
            <RoleMetadataField
              label={l("Typical use", "Tipik kullanim")}
              value={capabilitySummary}
              note={
                capabilities.length > 4
                  ? l(
                      "Showing the main capability signals only.",
                      "Yalnizca ana yetenek sinyalleri gosteriliyor."
                    )
                  : ""
              }
            />
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {l("Review notes", "Inceleme notlari")}
          </div>
          <div className="mt-2 text-sm leading-6 text-slate-600">
            {hasAttentionItems
              ? l(
                  "Keep these role-shape notes visible before changing permissions.",
                  "Yetkileri degistirmeden once bu rol sekli notlarini gorunur tutun."
                )
              : l(
                  "No special role-shape exceptions are active for this record.",
                  "Bu kayit icin etkin ozel rol sekli istisnasi yok."
                )}
          </div>

          <div className="mt-4 space-y-2">
            {reviewItems.map((item) => (
              <div
                key={item}
                className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
                  hasAttentionItems
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                {hasAttentionItems ? (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{item}</span>
                  </div>
                ) : (
                  item
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {l("Recommended scope coverage", "Onerilen kapsam kapsami")}
        </div>
        <div className="mt-2 text-sm leading-6 text-slate-600">
          {l(
            "Keep the intended assignment posture visible before changing permission rows. Recommended scope: {{scope}}.",
            "Yetki satirlarini degistirmeden once hedeflenen atama durusunu gorunur tutun. Onerilen kapsam: {{scope}}.",
            { scope: recommendedScopeLabel }
          )}
        </div>
        <RoleScopeCoveragePills entry={entry} />
      </div>
    </section>
  );
}

/**
 * Renders the grouped permission editor as a flatter module matrix and keeps
 * the replace-permissions flow in a compact sticky save area.
 */
export function PermissionModuleEditor({
  canReplaceRolePermissions,
  groups,
  l,
  loading,
  onResetPermissions,
  onTogglePermission,
  onReplacePermissions,
  savedPermissionCount = 0,
  saving,
  stagedChangeCount = 0,
  selectedRole,
}) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const moduleCount = safeGroups.length;
  const totalPermissionCount = safeGroups.reduce(
    (total, group) => total + group.permissions.length,
    0
  );
  const currentSelectedCount = safeGroups.reduce(
    (total, group) => total + group.selectedCount,
    0
  );
  const replaceDisabled = !selectedRole || saving || !canReplaceRolePermissions;
  const resetDisabled = !selectedRole || saving || stagedChangeCount === 0;

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Permission modules
          </div>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            {l("Permission matrix", "Yetki matrisi")}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {l(
              "Grouped modules stay intact, but the rows are flatter and denser for direct permission review.",
              "Gruplanmis moduller korunur; ancak satirlar dogrudan yetki incelemesi icin daha duz ve daha yogundur."
            )}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {l("Current scan", "Guncel gorunum")}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900">
            {l("{{modules}} modules / {{rows}} rows", "{{modules}} modul / {{rows}} satir", {
              modules: moduleCount,
              rows: totalPermissionCount,
            })}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {l("{{selected}} selected in the staged set.", "Bekleyen sette {{selected}} secili.", {
              selected: currentSelectedCount,
            })}
          </div>
        </div>
      </div>

      {!canReplaceRolePermissions ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
          {l(
            "You can inspect grouped permission rows, but replacing the saved set requires the role-permission assignment permission.",
            "Gruplanmis yetki satirlarini inceleyebilirsiniz; ancak kayitli seti degistirmek icin rol-yetki atama izni gerekir."
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-5 text-sm text-slate-500">
          {l("Loading permissions...", "Yetkiler yukleniyor...")}
        </div>
      ) : null}

      {!loading && !selectedRole ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          {l(
            "Select a role to review grouped permission modules.",
            "Gruplanmis yetki modullerini incelemek icin bir rol secin."
          )}
        </div>
      ) : null}

      {!loading && selectedRole ? (
        <>
          {safeGroups.length > 0 ? (
            <div className="mt-5 space-y-4">
              {safeGroups.map((group) => (
                <PermissionModuleTable
                  key={group.moduleKey}
                  canReplaceRolePermissions={canReplaceRolePermissions}
                  group={group}
                  l={l}
                  onTogglePermission={onTogglePermission}
                  saving={saving}
                />
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              {l(
                "No permission rows are available for the current role.",
                "Mevcut rol icin kullanilabilir yetki satiri yok."
              )}
            </div>
          )}

          {safeGroups.length > 0 ? (
            <div className="sticky bottom-4 z-10 mt-5 rounded-[24px] border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {l("Save area", "Kaydetme alani")}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-950">
                    {stagedChangeCount > 0
                      ? l(
                          "{{count}} staged changes are ready to replace the saved permission set.",
                          "{{count}} bekleyen degisiklik kayitli yetki setinin yerine gecmeye hazir.",
                          { count: stagedChangeCount }
                        )
                      : l(
                          "No staged changes. The current selection matches the saved permission set.",
                          "Bekleyen degisiklik yok. Guncel secim kayitli yetki setiyle eslesiyor."
                        )}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    {l(
                      "Saved permissions: {{saved}}. Current staged selection: {{selected}}.",
                      "Kayitli yetkiler: {{saved}}. Guncel bekleyen secim: {{selected}}.",
                      {
                        saved: savedPermissionCount,
                        selected: currentSelectedCount,
                      }
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onResetPermissions}
                    disabled={resetDisabled}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  >
                    {l("Reset", "Sifirla")}
                  </button>
                  <button
                    type="button"
                    onClick={onReplacePermissions}
                    disabled={replaceDisabled}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {saving
                      ? l("Saving...", "Kaydediliyor...")
                      : l("Replace permissions", "Yetkileri degistir")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
