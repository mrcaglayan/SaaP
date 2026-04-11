import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import {
  getWorkflowPackageCatalogEntry,
  getWorkflowPresetCatalogEntry,
} from "./roleCatalog.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
import SecurityCatalogWorkbenchTabs from "./components/catalog/SecurityCatalogWorkbenchTabs.jsx";

const GROUP_AP_POST_PACKAGE_CODE = "PKG-AP-POST-GROUP";
const GROUP_CONTROLLED_POST_PRESET_CODE = "AP_GROUP_CONTROLLED_POST";

function buildPackageDetail() {
  const entry = getWorkflowPackageCatalogEntry(GROUP_AP_POST_PACKAGE_CODE);
  return {
    code: GROUP_AP_POST_PACKAGE_CODE,
    displayName: entry.displayName || "AP Documents / Group Post",
    description: entry.description || "",
    defaultScope: entry.defaultScope || "GROUP",
    allowedScopes: Array.isArray(entry.allowedScopes) ? entry.allowedScopes : ["GROUP"],
    permissionCodes: Array.isArray(entry.permissionCodes) ? entry.permissionCodes : [],
    plannedExtension: Boolean(entry.plannedExtension),
  };
}

function buildPresetDetail() {
  const entry = getWorkflowPresetCatalogEntry(GROUP_CONTROLLED_POST_PRESET_CODE);
  return {
    code: GROUP_CONTROLLED_POST_PRESET_CODE,
    displayName: entry.displayName || "AP / Group-Controlled Post",
    description: entry.description || "",
    primaryScope: entry.primaryScope || entry.defaultScope || "GROUP",
    stepCount: entry.stepCount || 0,
    usesExtension: Boolean(entry.usesExtension),
    extensionNote: entry.extensionNote || "",
    steps: Array.isArray(entry.steps) ? entry.steps : [],
    typicalActorLabels: Array.isArray(entry.typicalActorLabels)
      ? entry.typicalActorLabels
      : [],
    requiredPackageLabels: Array.isArray(entry.requiredPackageLabels)
      ? entry.requiredPackageLabels
      : [],
  };
}

function StatusBanner({ enabled }) {
  if (enabled) {
    return (
      <section className="rounded-[28px] border border-emerald-200 bg-[linear-gradient(135deg,_rgba(236,253,245,0.96),_rgba(255,255,255,0.98))] px-5 py-5">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Extension enabled
          </div>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            Group-scoped AP posting is active
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The backend group-post extension is enabled for this tenant. The AP /
            Group-Controlled Post preset and the PKG-AP-POST-GROUP package can be
            used in workflow governance configuration.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-amber-200 bg-[linear-gradient(135deg,_rgba(255,251,235,0.96),_rgba(255,255,255,0.98))] px-5 py-5">
      <div className="max-w-3xl">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
          Extension not enabled
        </div>
        <h3 className="mt-2 text-xl font-semibold text-slate-950">
          Group-scoped AP posting is preview-only
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          The group AP post extension package is cataloged but remains
          preview-only until the backend entitlement model ships the clean
          group-scoped posting authority. The AP / Group-Controlled Post preset
          cannot be applied to live workflows yet.
        </p>
      </div>
    </section>
  );
}

function PackageDetailCard({ pkg }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Extension package
      </div>
      <h3 className="mt-2 text-base font-semibold text-slate-950">
        {pkg.displayName}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{pkg.description}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Package code
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-900">
            {pkg.code}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Scope
          </div>
          <div className="mt-2">
            {pkg.allowedScopes.map((scope) => (
              <span
                key={scope}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
              >
                {scope}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Status
          </div>
          <div className="mt-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                pkg.plannedExtension
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {pkg.plannedExtension ? "Planned extension" : "Active"}
            </span>
          </div>
        </div>
      </div>

      {pkg.permissionCodes.length > 0 ? (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Permission codes
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {pkg.permissionCodes.map((code) => (
              <span
                key={code}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
              >
                {code}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 text-sm text-slate-500">
          Permission codes will be defined when the backend extension ships.
        </div>
      )}

    </section>
  );
}

function PresetPreviewCard({ preset }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Unlocked preset
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-950">
            {preset.displayName}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {preset.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {preset.primaryScope}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {preset.stepCount} steps
          </span>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
              preset.usesExtension
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {preset.usesExtension ? "Extension" : "Shipped"}
          </span>
        </div>
      </div>

      {preset.extensionNote ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm text-amber-800">
          {preset.extensionNote}
        </div>
      ) : null}

      {preset.steps.length > 0 ? (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Workflow steps
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <th className="px-4 py-3">Step</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Required Package</th>
                  <th className="px-4 py-3">Typical Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {preset.steps.map((step) => {
                  const isGroupPost =
                    step.requiredPackageCode === GROUP_AP_POST_PACKAGE_CODE;
                  return (
                    <tr
                      key={step.stepNo}
                      className={isGroupPost ? "bg-sky-50/50" : "bg-white"}
                    >
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                        {step.stepNo}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900">
                        {step.actionLabel}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {step.scopeType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            isGroupPost
                              ? "border-sky-200 bg-sky-50 text-sky-800"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                          }`}
                        >
                          {step.requiredPackageCode}
                        </span>
                        {step.requiredPackageLabel ? (
                          <div className="mt-1 text-xs text-slate-500">
                            {step.requiredPackageLabel}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {Array.isArray(step.eligibleBusinessRoleCodes)
                          ? step.eligibleBusinessRoleCodes.join(", ")
                          : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {preset.typicalActorLabels.length > 0 ? (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Typical actors
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {preset.typicalActorLabels.map((label) => (
              <span
                key={label}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Shows how the group-scoped AP posting extension fits into the catalog
 * workbench before workflow-governance implementation owns the live flows.
 */
export default function GroupApPostExtensionPage() {
  const { securityAdminUiState, securityAdminUiStateLoaded } = useAuth();

  const groupApPostEnabled =
    securityAdminUiStateLoaded &&
    Boolean(securityAdminUiState?.groupApPostExtension?.enabled);

  const pkg = useMemo(() => buildPackageDetail(), []);
  const preset = useMemo(() => buildPresetDetail(), []);

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="catalog"
      sectionKey="access-model"
      eyebrow="Security / Group AP posting"
      title="Group AP Posting"
      description="Position the group-scoped AP posting extension as a governed catalog capability, not as an isolated utility page. The package, preset, and diagnostics links now live inside the canonical access catalog workbench."
      actions={[
        {
          to: "/app/ayarlar/security-admin/workflows?tab=definitions",
          label: "Open workflow governance",
          tone: "primary",
        },
        {
          to: "/app/ayarlar/security-admin/catalog?tab=access-model&modelTab=workflow_packages",
          label: "Browse workflow packages",
        },
      ]}
      stats={[
        {
          title: "Extension status",
          value: groupApPostEnabled ? "Enabled" : "Preview only",
          description: groupApPostEnabled
            ? "Group-scoped AP posting authority is available to workflow governance for this tenant."
            : "The catalog surface exists, but live group-scoped AP posting still depends on backend entitlement rollout.",
          tone: groupApPostEnabled ? "green" : "amber",
        },
        {
          title: "Package permissions",
          value: pkg.permissionCodes.length,
          description: "Permission codes currently exposed on the group-post package detail.",
          tone: "blue",
        },
        {
          title: "Preset steps",
          value: preset.stepCount,
          description: "Ordered workflow steps defined in the group-controlled AP posting preset.",
          tone: "violet",
        },
      ]}
      toolbar={
        <SecurityCatalogWorkbenchTabs
          activeTab="group-ap-post"
          counts={{ "group-ap-post": preset.stepCount }}
        />
      }
    >
      <StatusBanner enabled={groupApPostEnabled} />

      <div className="grid gap-4 xl:grid-cols-2">
        <PackageDetailCard pkg={pkg} />
        <PresetPreviewCard preset={preset} />
      </div>

      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              How it works
            </div>
            <h3 className="mt-2 text-base font-semibold text-slate-950">
              Group-scoped AP posting flow
            </h3>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <p>
                <strong>Step 1:</strong> Branch Accountant creates and submits the
                AP document at operating-unit scope using PKG-AP-DRAFT-SUBMIT.
              </p>
              <p>
                <strong>Step 2:</strong> Entity Accountant approves the document at
                legal-entity scope using PKG-AP-APPROVE.
              </p>
              <p>
                <strong>Step 3:</strong> Group Approver posts the document at group
                scope using {GROUP_AP_POST_PACKAGE_CODE}. This is the extension
                step that replaces entity/country-level posting with group-level
                authority.
              </p>
            </div>
            <div className="mt-4 text-sm leading-6 text-slate-600">
              <p>
                This model is useful when the group holding company retains final
                posting authority across multiple legal entities, rather than
                delegating it to individual entity officers.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/app/ayarlar/security-admin/catalog?tab=access-model&modelTab=workflow_presets"
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Browse presets
            </Link>
            <Link
              to="/app/ayarlar/security-admin/diagnostics?tab=access"
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Open access debugger
            </Link>
          </div>
        </div>
      </section>
    </SecurityAdminWorkspaceShell>
  );
}
