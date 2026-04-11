import { collectSidebarLinks } from "../../../layouts/sidebarConfig.js";

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

/**
 * Resolves visibility and permission-lock state for security-admin workbench
 * navigation items from the repo's canonical sidebar metadata.
 */
export function resolveSecurityWorkbenchAccess(
  item,
  hasAnyPermission,
  hasAnyFeature
) {
  const sidebarItem = SIDEBAR_LINKS_BY_PATH.get(item?.accessPath || item?.permissionPath || item?.to);
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
  const visible =
    requiredFeatureCodes.length === 0 || hasAnyFeature(requiredFeatureCodes);

  return {
    locked:
      requiredPermissions.length > 0 && !hasAnyPermission(requiredPermissions),
    requiredPermissions,
    visible,
  };
}
