import { useAuth } from "../../../../auth/useAuth.js";
import { useI18n } from "../../../../i18n/useI18n.js";
import SecurityWorkbenchTabsCard from "../SecurityWorkbenchTabsCard.jsx";
import { resolveSecurityWorkbenchAccess } from "../workbenchNavigation.js";

export const SECURITY_USERS_WORKBENCH_TABS = Object.freeze([
  Object.freeze({
    key: "delegations",
    to: "/app/ayarlar/rbac/delegations",
    permissionPath: "/app/ayarlar/rbac/delegations",
    label: Object.freeze({
      en: "Delegations",
      tr: "Delegasyonlar",
    }),
  }),
  Object.freeze({
    key: "coverage",
    to: "/app/ayarlar/rbac/temporary-coverage",
    permissionPath: "/app/ayarlar/rbac/temporary-coverage",
    label: Object.freeze({
      en: "Temporary coverage",
      tr: "Gecici kapsama",
    }),
  }),
]);

/**
 * Renders the canonical users-workbench tab strip with permission-aware
 * visibility so all absorbed user-access pages share one navigation grammar.
 */
export default function SecurityUsersWorkbenchTabs({
  activeTab = "",
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
      tabs={tabs}
    />
  );
}
