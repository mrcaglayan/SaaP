import { useAuth } from "../../../../auth/useAuth.js";
import { useI18n } from "../../../../i18n/useI18n.js";
import SecurityWorkbenchTabsCard from "../SecurityWorkbenchTabsCard.jsx";
import { resolveSecurityWorkbenchAccess } from "../workbenchNavigation.js";

export const SECURITY_WORKFLOW_WORKBENCH_TABS = Object.freeze([
  Object.freeze({
    key: "definitions",
    to: "/app/ayarlar/security-admin/workflows?tab=definitions",
    permissionPath: "/app/ayarlar/workflow-kurulumu",
    label: Object.freeze({
      en: "Definitions",
      tr: "Tanimlar",
    }),
  }),
  Object.freeze({
    key: "assignments",
    to: "/app/ayarlar/security-admin/workflows?tab=assignments",
    permissionPath: "/app/ayarlar/workflow-kurulumu",
    label: Object.freeze({
      en: "Assignments",
      tr: "Atamalar",
    }),
  }),
  Object.freeze({
    key: "coverage",
    to: "/app/ayarlar/security-admin/workflows?tab=coverage",
    permissionPath: "/app/ayarlar/workflow-kurulumu",
    label: Object.freeze({
      en: "Coverage",
      tr: "Coverage",
    }),
  }),
  Object.freeze({
    key: "records",
    to: "/app/ayarlar/security-admin/workflows?tab=records",
    permissionPath: "/app/ayarlar/workflow-kurulumu",
    label: Object.freeze({
      en: "Records",
      tr: "Kayitlar",
    }),
  }),
  Object.freeze({
    key: "setup",
    to: "/app/ayarlar/security-admin/workflows?tab=setup",
    permissionPath: "/app/ayarlar/workflow-kurulumu",
    label: Object.freeze({
      en: "Setup",
      tr: "Kurulum",
    }),
  }),
]);

/**
 * Renders the canonical workflow-governance workbench tabs so definitions,
 * assignments, coverage, records, and the setup wizard stay in one admin family.
 */
export default function SecurityWorkflowWorkbenchTabs({
  activeTab = "definitions",
  counts = {},
}) {
  const { hasAnyFeature, hasAnyPermission } = useAuth();
  const { l } = useI18n();

  const tabs = SECURITY_WORKFLOW_WORKBENCH_TABS.map((tab) => ({
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
      title={l("Workflow workbench tabs", "Workflow workbench sekmeleri")}
      description={l(
        "Inspect definitions, assignments, coverage, and records before dropping into the setup wizard.",
        "Kurulum sihirbazina gecmeden once tanimlari, atamalari, coverage gorunumlerini ve kayitlari inceleyin."
      )}
      tabs={tabs}
    />
  );
}
