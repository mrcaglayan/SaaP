import { useAuth } from "../../../../auth/useAuth.js";
import { useI18n } from "../../../../i18n/useI18n.js";
import SecurityWorkbenchTabsCard from "../SecurityWorkbenchTabsCard.jsx";
import { resolveSecurityWorkbenchAccess } from "../workbenchNavigation.js";

export const SECURITY_DIAGNOSTICS_WORKBENCH_TABS = Object.freeze([
  Object.freeze({
    key: "access",
    to: "/app/ayarlar/security-admin/diagnostics?tab=access",
    permissionPath: "/app/ayarlar/rbac/access-debugger",
    label: Object.freeze({
      en: "Access explainability",
      tr: "Erisim aciklanabilirligi",
    }),
  }),
  Object.freeze({
    key: "compliance",
    to: "/app/ayarlar/security-admin/diagnostics?tab=compliance",
    permissionPath: "/app/ayarlar/rbac/compliance-reports",
    label: Object.freeze({
      en: "Compliance",
      tr: "Uyum",
    }),
  }),
  Object.freeze({
    key: "audit",
    to: "/app/ayarlar/security-admin/diagnostics?tab=audit",
    permissionPath: "/app/ayarlar/rbac/audit-logs",
    label: Object.freeze({
      en: "RBAC audit",
      tr: "RBAC denetimi",
    }),
  }),
  Object.freeze({
    key: "raw-audit",
    to: "/app/ayarlar/security-admin/diagnostics?tab=raw-audit",
    permissionPath: "/app/ayarlar/rbac/raw-audit-logs",
    label: Object.freeze({
      en: "Raw audit",
      tr: "Ham denetim",
    }),
  }),
  Object.freeze({
    key: "sensitive-data",
    to: "/app/ayarlar/security-admin/diagnostics?tab=sensitive-data",
    permissionPath: "/app/ayarlar/rbac/sensitive-data-audit",
    label: Object.freeze({
      en: "Sensitive data",
      tr: "Hassas veri",
    }),
  }),
]);

/**
 * Keeps access explainability, compliance, audit evidence, and sensitive-data
 * review inside one canonical diagnostics workbench during the redesign track.
 */
export default function SecurityDiagnosticsWorkbenchTabs({
  activeTab = "access",
  counts = {},
}) {
  const { hasAnyFeature, hasAnyPermission } = useAuth();
  const { l } = useI18n();

  const tabs = SECURITY_DIAGNOSTICS_WORKBENCH_TABS.map((tab) => ({
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
      title={l("Diagnostics workbench tabs", "Tanilama workbench sekmeleri")}
      description={l(
        "Start from explainability, then move into compliance summaries, audit evidence, and sensitive-data traces without leaving the same investigation family.",
        "Ayni inceleme ailesinden cikmadan once aciklanabilirlikle baslayin, sonra uyum ozetlerine, denetim kanitlarina ve hassas-veri izlerine gecin."
      )}
      tabs={tabs}
    />
  );
}
