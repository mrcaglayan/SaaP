import { ROLES_PERMISSIONS_CANONICAL_PATH } from "../../layouts/sidebarConfig.js";

export const ROLE_LIST_PATH = ROLES_PERMISSIONS_CANONICAL_PATH;

function normalizeText(value) {
  return String(value || "").trim();
}

function getPermissionModuleKey(permissionCode) {
  const parts = normalizeText(permissionCode).split(".").filter(Boolean);
  if (parts.length <= 1) {
    return normalizeText(permissionCode);
  }
  return parts.slice(0, -1).join(".");
}

function formatPermissionModuleLabel(moduleKey) {
  return normalizeText(moduleKey)
    .split(".")
    .filter(Boolean)
    .map((part) => part.replaceAll("_", " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function formatPermissionActionLabel(permissionCode) {
  const action = normalizeText(permissionCode).split(".").filter(Boolean).pop() || "";
  return action ? action.replaceAll("_", " ").toUpperCase() : permissionCode;
}

export function buildRoleDetailPath(roleId) {
  return `/app/ayarlar/security-admin/catalog/roles/${encodeURIComponent(String(roleId || "").trim())}`;
}

/**
 * Surfaces business-model caveats that admins should keep visible before
 * changing the saved permission set on a role.
 */
export function buildRoleAttentionItems(entry, l) {
  const items = [];
  if (entry?.managedPackageRole) {
    items.push(
      l(
        "Managed through the workflow package UX so the runtime permission set stays aligned to the package definition.",
        "Runtime yetki seti paket tanimiyla uyumlu kalsin diye workflow package UX uzerinden yonetilir."
      )
    );
  }
  if (entry?.companionOnly && entry?.companionNote) {
    items.push(entry.companionNote);
  }
  if (entry?.category === "system") {
    items.push(
      l(
        "Broad administrative authority. Review least-privilege impact before replacing permissions.",
        "Genis yonetsel yetki. Yetkileri degistirmeden once en az yetki etkisini gozden gecirin."
      )
    );
  }
  return items;
}

/**
 * Groups raw permission rows into module buckets while preserving the staged
 * checkbox selection state used by the replace-permissions workflow.
 */
export function buildPermissionModuleGroups(permissionRows, selectedPermissionCodes) {
  const selectedCodeSet = new Set(
    (Array.isArray(selectedPermissionCodes) ? selectedPermissionCodes : [])
      .map((value) => normalizeText(value))
      .filter(Boolean)
  );
  const byModule = new Map();

  (Array.isArray(permissionRows) ? permissionRows : []).forEach((permission) => {
    const code = normalizeText(permission?.code);
    if (!code) {
      return;
    }
    const moduleKey = getPermissionModuleKey(code);
    if (!byModule.has(moduleKey)) {
      byModule.set(moduleKey, []);
    }
    byModule.get(moduleKey).push({
      id: permission?.id || code,
      code,
      description: normalizeText(permission?.description),
      selected: selectedCodeSet.has(code),
    });
  });

  return Array.from(byModule.entries())
    .map(([moduleKey, permissions]) => {
      const codeSet = new Set(permissions.map((permission) => permission.code));
      return {
        moduleKey,
        moduleLabel: formatPermissionModuleLabel(moduleKey),
        selectedCount: permissions.filter((permission) => permission.selected).length,
        permissions: [...permissions]
          .sort((left, right) => left.code.localeCompare(right.code))
          .map((permission) => ({
            ...permission,
            actionLabel: formatPermissionActionLabel(permission.code),
            requiresRead:
              !permission.code.endsWith(".read") &&
              codeSet.has(`${moduleKey}.read`),
          })),
      };
    })
    .sort((left, right) => left.moduleLabel.localeCompare(right.moduleLabel));
}
