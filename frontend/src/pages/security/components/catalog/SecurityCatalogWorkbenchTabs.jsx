import { useAuth } from "../../../../auth/useAuth.js";
import { useI18n } from "../../../../i18n/useI18n.js";
import { ROLES_PERMISSIONS_CANONICAL_PATH } from "../../../../layouts/sidebarConfig.js";
import SecurityWorkbenchTabsCard from "../SecurityWorkbenchTabsCard.jsx";
import { resolveSecurityWorkbenchAccess } from "../workbenchNavigation.js";

export const SECURITY_CATALOG_WORKBENCH_TABS = Object.freeze([
  Object.freeze({
    key: "access-model",
    to: "/app/ayarlar/security-admin/catalog?tab=access-model",
    permissionPath: "/app/ayarlar/rbac/access-model",
    label: Object.freeze({
      en: "Access model",
      tr: "Erisim modeli",
    }),
  }),
  Object.freeze({
    key: "roles",
    to: ROLES_PERMISSIONS_CANONICAL_PATH,
    permissionPath: "/app/ayarlar/rbac/roles-permissions",
    label: Object.freeze({
      en: "Roles & permissions",
      tr: "Roller ve yetkiler",
    }),
  }),
  Object.freeze({
    key: "field-visibility",
    to: "/app/ayarlar/security-admin/catalog?tab=field-visibility",
    permissionPath: "/app/ayarlar/rbac/field-visibility-policies",
    label: Object.freeze({
      en: "Field visibility",
      tr: "Alan gorunurlugu",
    }),
  }),
  Object.freeze({
    key: "group-ap-post",
    to: "/app/ayarlar/security-admin/catalog?tab=group-ap-post",
    permissionPath: "/app/ayarlar/rbac/group-ap-post-extension",
    label: Object.freeze({
      en: "Group AP posting",
      tr: "Grup AP posting",
    }),
  }),
]);

/**
 * Renders the canonical catalog-workbench tabs so access-model, roles,
 * field-visibility, and group-post governance feel like one catalog family.
 */
export default function SecurityCatalogWorkbenchTabs({
  activeTab = "access-model",
  counts = {},
}) {
  const { hasAnyFeature, hasAnyPermission } = useAuth();
  const { l } = useI18n();

  const tabs = SECURITY_CATALOG_WORKBENCH_TABS.map((tab) => ({
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
      title={l("Catalog workbench tabs", "Katalog workbench sekmeleri")}
      description={l(
        "Keep access-model browsing, runtime-role editing, field visibility, and governance extensions inside one catalog family.",
        "Erisim modeli gezintisini, runtime rol duzenlemelerini, alan gorunurlugunu ve yonetim uzantilarini tek bir katalog ailesinde tutun."
      )}
      tabs={tabs}
    />
  );
}
