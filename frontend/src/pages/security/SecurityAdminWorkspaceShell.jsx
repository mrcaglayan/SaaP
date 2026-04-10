import { Link } from "react-router-dom";
import { useAuth } from "../../auth/useAuth.js";
import { useI18n } from "../../i18n/useI18n.js";
import {
  collectSidebarLinks,
  SECURITY_ADMIN_COMPANION_LINKS,
  SECURITY_ADMIN_PRIMARY_SURFACES,
  SECURITY_ADMIN_WORKSPACE_SECTIONS,
} from "../../layouts/sidebarConfig.js";

function toRoutePath(value) {
  return String(value || "").replace(/[?#].*$/, "");
}

const SIDEBAR_LINKS_BY_PATH = collectSidebarLinks().reduce((map, item) => {
  const routePath = toRoutePath(item?.to);
  if (!routePath) {
    return map;
  }

  const current = map.get(routePath);
  if (!current) {
    map.set(routePath, { ...item, to: routePath });
    return map;
  }

  current.requiredPermissions = Array.from(
    new Set([
      ...(Array.isArray(current.requiredPermissions)
        ? current.requiredPermissions
        : []),
      ...(Array.isArray(item.requiredPermissions) ? item.requiredPermissions : []),
    ])
  );
  current.requiredFeatureCodes = Array.from(
    new Set([
      ...(Array.isArray(current.requiredFeatureCodes)
        ? current.requiredFeatureCodes
        : []),
      ...(Array.isArray(item.requiredFeatureCodes)
        ? item.requiredFeatureCodes
        : []),
    ])
  );
  return map;
}, new Map());

function getActionClasses(tone) {
  if (tone === "primary") {
    return "border-slate-900 bg-slate-900 text-white";
  }
  return "border-slate-300 bg-white text-slate-700";
}

function getStatClasses(tone) {
  if (tone === "blue") {
    return "border-sky-200 bg-sky-50";
  }
  if (tone === "green") {
    return "border-emerald-200 bg-emerald-50";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50";
  }
  if (tone === "violet") {
    return "border-violet-200 bg-violet-50";
  }
  return "border-slate-200 bg-white";
}

function resolveWorkspaceLinkAccess(
  item,
  hasAnyPermission,
  hasAnyFeature
) {
  const sidebarItem = SIDEBAR_LINKS_BY_PATH.get(item?.accessPath || item?.to);
  if (!sidebarItem) {
    return {
      locked: false,
      requiredPermissions: [],
      visible: true,
    };
  }

  const requiredPermissions = Array.isArray(sidebarItem.requiredPermissions)
    ? sidebarItem.requiredPermissions
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  const requiredFeatureCodes = Array.isArray(sidebarItem.requiredFeatureCodes)
    ? sidebarItem.requiredFeatureCodes
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
    : [];
  const featureVisible =
    requiredFeatureCodes.length === 0 || hasAnyFeature(requiredFeatureCodes);

  return {
    locked:
      requiredPermissions.length > 0 && !hasAnyPermission(requiredPermissions),
    requiredPermissions,
    visible: featureVisible,
  };
}

function matchesWorkspaceSection(section, workspaceSectionKey) {
  const normalizedWorkspaceSectionKey = String(workspaceSectionKey || "").trim();
  if (!normalizedWorkspaceSectionKey) {
    return false;
  }
  if (section?.key === normalizedWorkspaceSectionKey) {
    return true;
  }
  return Array.isArray(section?.currentSectionKeys)
    ? section.currentSectionKeys.includes(normalizedWorkspaceSectionKey)
    : false;
}

function WorkspaceAction({ action }) {
  const classes = `rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${getActionClasses(
    action?.tone
  )}`;

  if (typeof action?.onClick === "function") {
    return (
      <button
        type="button"
        onClick={action.onClick}
        className={classes}
        disabled={Boolean(action?.disabled)}
      >
        {action?.label}
      </button>
    );
  }

  if (action?.to) {
    return (
      <Link to={action.to} className={classes}>
        {action?.label}
      </Link>
    );
  }

  return null;
}

function WorkspaceNavItem({ active, item, locked, l, title = "" }) {
  const classes = `inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition ${
    active
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
  }`;

  if (locked) {
    return (
      <span
        title={title}
        className={`${classes} cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-white`}
      >
        {l(item.label.en, item.label.tr)}
      </span>
    );
  }

  return (
    <Link to={item.to} className={classes}>
      {l(item.label.en, item.label.tr)}
    </Link>
  );
}

function CompanionLinkCard({ access, item, l }) {
  const label = l(item.label.en, item.label.tr);
  if (access.locked) {
    return (
      <div
        className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500"
        title={`${l("Permission required", "Izin gerekli")}: ${access.requiredPermissions.join(", ")}`}
      >
        <div className="font-medium text-slate-700">{label}</div>
        <div className="mt-1 text-xs leading-5">
          {l("Permission required", "Izin gerekli")}:{" "}
          {access.requiredPermissions.join(", ")}
        </div>
      </div>
    );
  }

  return (
    <Link
      to={item.to}
      className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
    >
      {label}
    </Link>
  );
}

function WorkspaceStatCard({ stat }) {
  return (
    <article
      className={`rounded-[24px] border px-5 py-4 shadow-sm ${getStatClasses(
        stat?.tone
      )}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {stat?.title}
      </div>
      <div className="mt-3 text-3xl font-semibold text-slate-950">{stat?.value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-600">{stat?.description}</div>
    </article>
  );
}

/**
 * Provides the shared security-admin shell so the catalog, role editor, and
 * assignment workspace keep the same framing, planned workbench map, and
 * permission-aware reachability to companion routes during the redesign.
 */
export default function SecurityAdminWorkspaceShell({
  workspaceSectionKey = "",
  sectionKey = "",
  eyebrow = "",
  title = "",
  description = "",
  actions = [],
  stats = [],
  toolbar = null,
  children,
}) {
  const { l } = useI18n();
  const { hasAnyFeature, hasAnyPermission } = useAuth();

  const workspaceSections = SECURITY_ADMIN_WORKSPACE_SECTIONS.map((section) => ({
    ...section,
    access: resolveWorkspaceLinkAccess(
      section,
      hasAnyPermission,
      hasAnyFeature
    ),
  })).filter((section) => section.access.visible);

  const primarySurfaces = SECURITY_ADMIN_PRIMARY_SURFACES.map((surface) => ({
    ...surface,
    access: resolveWorkspaceLinkAccess(
      surface,
      hasAnyPermission,
      hasAnyFeature
    ),
  })).filter((surface) => surface.access.visible);

  const companionGroups = SECURITY_ADMIN_WORKSPACE_SECTIONS.map((workspaceSection) => ({
    workspaceSection,
    links: SECURITY_ADMIN_COMPANION_LINKS.filter(
      (item) => item.workspaceSectionKey === workspaceSection.key
    )
      .map((item) => ({
        ...item,
        access: resolveWorkspaceLinkAccess(
          item,
          hasAnyPermission,
          hasAnyFeature
        ),
      }))
      .filter((item) => item.access.visible),
  })).filter((group) => group.links.length > 0);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,#e0f2fe,transparent_45%),radial-gradient(circle_at_top_right,#dcfce7,transparent_35%),linear-gradient(135deg,#f8fafc,#ffffff)] px-6 py-6">
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                {eyebrow || l("Security Admin Workspace", "Guvenlik yonetim calisma alani")}
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                {title}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
            </div>
            {Array.isArray(actions) && actions.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {actions.map((action) => (
                  <WorkspaceAction
                    key={`${String(action?.label || "")}:${String(action?.to || "")}`}
                    action={action}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="relative z-10 mt-6 grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <section className="rounded-3xl border border-white/80 bg-white/80 px-4 py-4 backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Workspace sections", "Calisma alani bolumleri")}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {l(
                  "Use the canonical workbench routes while the page bodies are still landing in stages.",
                  "Sayfa govdeleri asamali gelirken canonical workbench rotalarini kullanin."
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {workspaceSections.map((section) => (
                  <WorkspaceNavItem
                    key={section.key}
                    active={matchesWorkspaceSection(section, workspaceSectionKey)}
                    item={{
                      ...section,
                      to: `${section.futurePath}${section.defaultSearch || ""}`,
                    }}
                    locked={section.access.locked}
                    l={l}
                    title={
                      section.access.locked
                        ? `${l("Permission required", "Izin gerekli")}: ${section.access.requiredPermissions.join(", ")}`
                        : ""
                    }
                  />
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/80 bg-white/80 px-4 py-4 backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {l("Primary surfaces", "Birincil yuzeyler")}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {l(
                  "These quick links already use the canonical workbench routes even where the body still delegates to current pages.",
                  "Govde halen mevcut sayfalara delegasyon yapsa bile bu hizli baglantilar canonical workbench rotalarini kullanir."
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {primarySurfaces.map((surface) => (
                  <WorkspaceNavItem
                    key={surface.key}
                    active={surface.key === sectionKey}
                    item={surface}
                    locked={surface.access.locked}
                    l={l}
                    title={
                      surface.access.locked
                        ? `${l("Permission required", "Izin gerekli")}: ${surface.access.requiredPermissions.join(", ")}`
                        : ""
                    }
                  />
                ))}
              </div>
            </section>
          </div>

          {companionGroups.length > 0 ? (
            <div className="relative z-10 mt-3 grid gap-3 xl:grid-cols-2">
              {companionGroups.map((group) => (
                <section
                  key={group.workspaceSection.key}
                  className="rounded-3xl border border-white/80 bg-white/80 px-4 py-4 backdrop-blur"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {l(
                      group.workspaceSection.label.en,
                      group.workspaceSection.label.tr
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {l(
                      group.workspaceSection.description.en,
                      group.workspaceSection.description.tr
                    )}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {group.links.map((link) => (
                      <CompanionLinkCard
                        key={link.to}
                        access={link.access}
                        item={link}
                        l={l}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {Array.isArray(stats) && stats.length > 0 ? (
        <section
          className={`grid gap-4 ${
            stats.length >= 4
              ? "xl:grid-cols-4"
              : stats.length === 3
                ? "xl:grid-cols-3"
                : "xl:grid-cols-2"
          }`}
        >
          {stats.map((stat) => (
            <WorkspaceStatCard
              key={`${String(stat?.title || "")}:${String(stat?.value || "")}`}
              stat={stat}
            />
          ))}
        </section>
      ) : null}

      {toolbar ? <section className="space-y-4">{toolbar}</section> : null}

      <div className="space-y-6">{children}</div>
    </div>
  );
}
