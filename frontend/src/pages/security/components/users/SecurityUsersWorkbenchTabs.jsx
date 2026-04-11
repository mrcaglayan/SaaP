import { useAuth } from "../../../../auth/useAuth.js";
import { useI18n } from "../../../../i18n/useI18n.js";
import SecurityWorkbenchTabsCard from "../SecurityWorkbenchTabsCard.jsx";
import { resolveSecurityWorkbenchAccess } from "../workbenchNavigation.js";

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
    access: resolveSecurityWorkbenchAccess(tab, hasAnyPermission, hasAnyFeature),
  }))
    .filter((tab) => tab.access.visible)
    .map((tab) => ({
      key: tab.key,
      active: tab.key === activeTab,
      count: counts?.[tab.key],
      label: l(tab.label.en, tab.label.tr),
      locked: tab.access.locked,
      title: tab.access.locked
        ? `${l("Permission required", "Izin gerekli")}: ${tab.access.requiredPermissions.join(", ")}`
        : "",
      to: tab.to,
    }));

  return (
    <SecurityWorkbenchTabsCard
      title={l("Users workbench tabs", "Kullanici workbench sekmeleri")}
      description={l(
        "Keep people, assignments, scope changes, delegations, temporary coverage, and effective authority inside one canonical route family.",
        "Kisileri, atamalari, kapsam degisikliklerini, delegasyonlari, gecici kapsama kayitlarini ve etkili yetkiyi tek bir canonical rota ailesinde tutun."
      )}
      tabs={tabs}
    />
  );
}
