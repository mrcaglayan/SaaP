import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import SecurityAdminWorkspaceShell from "./SecurityAdminWorkspaceShell.jsx";
import SecurityCatalogWorkbenchTabs from "./components/catalog/SecurityCatalogWorkbenchTabs.jsx";

const GROUP_AP_POST_PERMISSION_CODE = "cari.doc.post";

function buildAuthorityDetail() {
  return {
    code: "AP_POST_GROUP_EXTENSION",
    displayName: "Post AP",
    description:
      "Extension-only final AP posting authority that lifts the posting step to GROUP scope without reintroducing legacy assignment abstractions.",
    defaultScope: "GROUP",
    allowedScopes: ["GROUP"],
    permissionCodes: [GROUP_AP_POST_PERMISSION_CODE],
    plannedExtension: true,
  };
}

function buildFlowDetail() {
  return {
    code: "GROUP_AP_POST_REFERENCE_FLOW",
    displayName: "Group-scoped AP posting flow",
    description:
      "Reference AP flow that keeps operating-unit drafting and legal-entity approval, then lifts the final posting action to group scope through the extension authority.",
    primaryScope: "GROUP",
    stepCount: 3,
    usesExtension: true,
    extensionNote:
      "This flow stays gated behind the group AP posting extension because the final posting step requires group scope.",
    requiredAuthorityLabels: ["Draft and submit AP", "Approve AP", "Post AP"],
    steps: [
      {
        stepNo: 1,
        actionLabel: "Create / Edit / Submit",
        scopeType: "OPERATING_UNIT",
        requiredPermissionCode: "cari.doc.submit",
        requiredAuthorityLabel: "Draft and submit AP",
      },
      {
        stepNo: 2,
        actionLabel: "Approve",
        scopeType: "LEGAL_ENTITY",
        requiredPermissionCode: "approvals.requests.approve",
        requiredAuthorityLabel: "Approve AP",
      },
      {
        stepNo: 3,
        actionLabel: "Post",
        scopeType: "GROUP",
        requiredPermissionCode: GROUP_AP_POST_PERMISSION_CODE,
        requiredAuthorityLabel: "Post AP",
      },
    ],
  };
}

function StatusBanner({ enabled }) {
  if (enabled) {
    return (
      <section className="rounded-[28px] border border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))] px-5 py-5">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Extension enabled
          </div>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            Group-scoped AP posting is active
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The backend group-post extension is enabled for this tenant. The AP /
            Group-Controlled Post preset and its final group-scoped posting authority
            can be used in workflow governance configuration.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-amber-200 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.98))] px-5 py-5">
      <div className="max-w-3xl">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
          Extension not enabled
        </div>
        <h3 className="mt-2 text-xl font-semibold text-slate-950">
          Group-scoped AP posting is preview-only
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          The group AP posting authority remains preview-only until the backend
          entitlement model ships the clean group-scoped posting path. The AP /
          Group-Controlled Post preset cannot be applied to live workflows yet.
        </p>
      </div>
    </section>
  );
}

function AuthorityDetailCard({ authority }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        Extension authority
      </div>
      <h3 className="mt-2 text-base font-semibold text-slate-950">
        {authority.displayName}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{authority.description}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Extension code
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-900">
            {authority.code}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Scope
          </div>
          <div className="mt-2">
            {authority.allowedScopes.map((scope) => (
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
                authority.plannedExtension
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {authority.plannedExtension ? "Planned extension" : "Active"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Permission codes
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {authority.permissionCodes.map((code) => (
            <span
              key={code}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {code}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FlowPreviewCard({ flow }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Reference flow
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-950">
            {flow.displayName}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{flow.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {flow.primaryScope}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {flow.stepCount} steps
          </span>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
              flow.usesExtension
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {flow.usesExtension ? "Extension" : "Shipped"}
          </span>
        </div>
      </div>

      {flow.extensionNote ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm text-amber-800">
          {flow.extensionNote}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Required authorities
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {flow.requiredAuthorityLabels.map((label) => (
            <span
              key={label}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {flow.steps.length > 0 ? (
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
                  <th className="px-4 py-3">Required authority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {flow.steps.map((step) => {
                  const isGroupPost =
                    step.requiredPermissionCode === GROUP_AP_POST_PERMISSION_CODE &&
                    step.scopeType === "GROUP";
                  return (
                    <tr key={step.stepNo} className={isGroupPost ? "bg-sky-50/50" : "bg-white"}>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">{step.stepNo}</td>
                      <td className="px-4 py-3 text-sm text-slate-900">{step.actionLabel}</td>
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
                          {step.requiredPermissionCode}
                        </span>
                        {step.requiredAuthorityLabel ? (
                          <div className="mt-1 text-xs text-slate-500">{step.requiredAuthorityLabel}</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

  const authority = useMemo(() => buildAuthorityDetail(), []);
  const flow = useMemo(() => buildFlowDetail(), []);

  return (
    <SecurityAdminWorkspaceShell
      workspaceSectionKey="catalog"
      sectionKey="access-model"
      eyebrow="Security / Group AP posting"
      title="Group AP Posting"
      description="Position the group-scoped AP posting extension as a governed authority preview, not as a legacy utility page."
      actions={[
        {
          to: "/app/ayarlar/security-admin/workflows?tab=definitions",
          label: "Open workflow governance",
          tone: "primary",
        },
        {
          to: "/app/ayarlar/security-admin/diagnostics?tab=access",
          label: "Open access debugger",
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
          title: "Authority permissions",
          value: authority.permissionCodes.length,
          description: "Permission codes currently exposed on the group-post authority detail.",
          tone: "blue",
        },
        {
          title: "Reference steps",
          value: flow.stepCount,
          description: "Ordered workflow steps documented for the group-scoped posting flow.",
          tone: "violet",
        },
      ]}
      toolbar={
        <SecurityCatalogWorkbenchTabs
          activeTab="group-ap-post"
          counts={{ "group-ap-post": flow.stepCount }}
        />
      }
    >
      <StatusBanner enabled={groupApPostEnabled} />

      <div className="grid gap-4 xl:grid-cols-2">
        <AuthorityDetailCard authority={authority} />
        <FlowPreviewCard flow={flow} />
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
                <strong>Step 1:</strong> The operating-unit submit step uses <code>cari.doc.submit</code>.
              </p>
              <p>
                <strong>Step 2:</strong> The legal-entity approval step uses <code>approvals.requests.approve</code>.
              </p>
              <p>
                <strong>Step 3:</strong> The group posting step uses <code>{GROUP_AP_POST_PERMISSION_CODE}</code>. This is the extension step that replaces entity or country posting with group-scoped authority.
              </p>
            </div>
            <div className="mt-4 text-sm leading-6 text-slate-600">
              <p>
                This model is useful when the group holding company retains final posting authority across multiple legal entities, rather than delegating it to individual entity officers.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
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
