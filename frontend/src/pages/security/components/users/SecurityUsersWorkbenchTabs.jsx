import { Link } from "react-router-dom";
import { useAuth } from "../../../../auth/useAuth.js";
import { useI18n } from "../../../../i18n/useI18n.js";
import { collectSidebarLinks } from "../../../../layouts/sidebarConfig.js";

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

export const SECURITY_USERS_WORKBENCH_TABS = Object.freeze([
  Object.freeze({
    key: "people",
    to: "/app/ayarlar/security-admin/users?tab=people",
    permissionPath: "/app/ayarlar/rbac/user-assignments",
    label: Object.freeze({
      en: "People",
      tr: "Kisiler",
    }),
  }),
  Object.freeze({
    key: "assignments",
    to: "/app/ayarlar/security-admin/users?tab=assignments",
    permissionPath: "/app/ayarlar/rbac/user-assignments",
    label: Object.freeze({
      en: "Assignments",
      tr: "Atamalar",
    }),
  }),
  Object.freeze({
    key: "scopes",
    to: "/app/ayarlar/security-admin/users?tab=scopes",
    permissionPath: "/app/ayarlar/rbac/scope-assignments",
    label: Object.freeze({
      en: "Scope access",
      tr: "Kapsam erisimi",
    }),
  }),
  Object.freeze({
    key: "delegations",
    to: "/app/ayarlar/security-admin/users?tab=delegations",
    permissionPath: "/app/ayarlar/rbac/delegations",
    label: Object.freeze({
      en: "Delegations",
      tr: "Delegasyonlar",
    }),
  }),
  Object.freeze({
    key: "coverage",
    to: "/app/ayarlar/security-admin/users?tab=coverage",
    permissionPath: "/app/ayarlar/rbac/temporary-coverage",
    label: Object.freeze({
      en: "Temporary coverage",
      tr: "Gecici kapsama",
    }),
  }),
  Object.freeze({
    key: "authority",
    to: "/app/ayarlar/security-admin/users?tab=authority",
    permissionPath: "/app/ayarlar/rbac/user-assignments",
    label: Object.freeze({
      en: "Effective authority",
      tr: "Etkili yetki",
    }),
  }),
]);

function resolveTabAccess(tab, hasAnyPermission, hasAnyFeature) {
  const sidebarItem = SIDEBAR_LINKS_BY_PATH.get(tab?.permissionPath || tab?.to);
  if (!sidebarItem) {
    return {
      locked: false,
      requiredPermissions: [],
      visible: true,
    };
  }

  const requiredPermissions = Array.isArray(sidebarItem.requiredPermissions)
    ? sidebarItem.requiredPermissions
    : [];
  const requiredFeatureCodes = Array.isArray(sidebarItem.requiredFeatureCodes)
    ? sidebarItem.requiredFeatureCodes
    : [];
  const visible =
    requiredFeatureCodes.length === 0 || hasAnyFeature(requiredFeatureCodes);

  return {
    locked:
      requiredPermissions.length > 0 && !hasAnyPermission(requiredPermissions),
    requiredPermissions,
    visible,
  };
}

function TabPill({ active, count, label, locked, title, to }) {
  const classes = `inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
    active
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
  }`;

  const countNode =
    count === undefined || count === null ? null : (
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
        }`}
      >
        {count}
      </span>
    );

  if (locked) {
    return (
      <span
        title={title}
        className={`${classes} cursor-not-allowed opacity-60 hover:border-slate-200 hover:bg-white`}
      >
        <span>{label}</span>
        {countNode}
      </span>
    );
  }

  return (
    <Link to={to} className={classes}>
      <span>{label}</span>
      {countNode}
    </Link>
  );
}

/**
 * Renders the canonical users-workbench tab strip with permission-aware
 * visibility so all absorbed user-access pages share one navigation grammar.
 */
export default function SecurityUsersWorkbenchTabs({
  activeTab = "people",
  counts = {},
}) {
  const { hasAnyFeature, hasAnyPermission } = useAuth();
  const { l } = useI18n();

  const tabs = SECURITY_USERS_WORKBENCH_TABS.map((tab) => ({
    ...tab,
    access: resolveTabAccess(tab, hasAnyPermission, hasAnyFeature),
  })).filter((tab) => tab.access.visible);

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {l("Users workbench tabs", "Kullanici workbench sekmeleri")}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {l(
              "Keep people, assignments, scope changes, delegations, temporary coverage, and effective authority inside one canonical route family.",
              "Kisileri, atamalari, kapsam degisikliklerini, delegasyonlari, gecici kapsama kayitlarini ve etkili yetkiyi tek bir canonical rota ailesinde tutun."
            )}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <TabPill
            key={tab.key}
            active={tab.key === activeTab}
            count={counts?.[tab.key]}
            label={l(tab.label.en, tab.label.tr)}
            locked={tab.access.locked}
            title={
              tab.access.locked
                ? `${l("Permission required", "Izin gerekli")}: ${tab.access.requiredPermissions.join(", ")}`
                : ""
            }
            to={tab.to}
          />
        ))}
      </div>
    </section>
  );
}
