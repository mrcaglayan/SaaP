import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth.js";
import LanguageSwitcher from "../i18n/LanguageSwitcher.jsx";
import { useI18n } from "../i18n/useI18n.js";
import { useTenantReadiness } from "../readiness/useTenantReadiness.js";
import SidebarSection from "./SidebarSection.jsx";
import { sidebarItems } from "./sidebarConfig.js";

const MODULE_PREVIEW_ADMIN_PERMISSIONS = [
  "security.role.upsert",
  "security.role_permissions.assign",
];
const TENANT_SETUP_ROUTE = "/app/ayarlar/sirket-ayarlari";
const TENANT_SETUP_ROUTES = [
  {
    to: "/app/ayarlar/sirket-ayarlari",
    fallback: "Company setup",
  },
  {
    to: "/app/ayarlar/organizasyon-yonetimi",
    fallback: "Organization setup",
  },
  {
    to: "/app/ayarlar/hesap-plani-ayarlari",
    fallback: "GL setup",
  },
];

function resolveReadinessChip(loading, error, ready, t) {
  if (loading) {
    return {
      label: t("layout.readinessChecking", "Readiness: Checking"),
      classes: "border-slate-300 bg-slate-100 text-slate-700",
    };
  }

  if (error) {
    return {
      label: t("layout.readinessError", "Readiness: Error"),
      classes: "border-amber-300 bg-amber-100 text-amber-900",
    };
  }

  if (ready) {
    return {
      label: t("layout.readinessReady", "Readiness: Ready"),
      classes: "border-emerald-300 bg-emerald-100 text-emerald-900",
    };
  }

  return {
    label: t("layout.readinessSetupRequired", "Readiness: Setup Required"),
    classes: "border-rose-300 bg-rose-100 text-rose-900 hover:bg-rose-200",
  };
}

function getReadinessCheckLabel(t, check) {
  return t(
    ["readinessChecklist", "checkLabels", check?.key],
    check?.label || check?.key || ""
  );
}

function Icon({ name, className = "h-4 w-4" }) {
  switch (name) {
    case "dashboard":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M3.5 3.5h5.5v5.5H3.5V3.5zm7.5 0h5.5v3.5H11V3.5zM3.5 11h3.5v5.5H3.5V11zm5.5 2h7.5v3.5H9V13z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
      );
    case "spark":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M10 2.5l1.7 3.8 3.9 1.7-3.9 1.7L10 13.5l-1.7-3.8-3.9-1.7 3.9-1.7L10 2.5zM4 12.5l.9 1.9 1.9.9-1.9.8L4 18l-.8-1.9-1.9-.8 1.9-.9L4 12.5zm12.2-.9l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7.7-1.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "journal":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M5 3.5h9a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0114 16.5H5A1.5 1.5 0 013.5 15V5A1.5 1.5 0 015 3.5zm2.5 3h5m-5 3h5m-5 3h3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "bank":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M10 3.5l7 3v1H3v-1l7-3zm-5 4v7m3.8-7v7m3.8-7v7m3.8-7v7M3 16.5h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "company":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M3.5 16.5h13M5.5 16.5V8.5L10 6l4.5 2.5v8m-7-6h1.8m1.4 0h1.8m-5 2.8h1.8m1.4 0h1.8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "box":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M10 2.8l6 3.2v8L10 17.2 4 14V6l6-3.2zm0 0v6.3m6-3.1l-6 3.1-6-3.1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "inventory":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M4 6.5h12M6 6.5v9.5m8-9.5v9.5M4 16h12M5.5 3.5h9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M5 4.5h10A1.5 1.5 0 0116.5 6v9A1.5 1.5 0 0115 16.5H5A1.5 1.5 0 013.5 15V6A1.5 1.5 0 015 4.5zm0 3h10M7 3.5v2m6-2v2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "report":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M5 3.5h10A1.5 1.5 0 0116.5 5v10A1.5 1.5 0 0115 16.5H5A1.5 1.5 0 013.5 15V5A1.5 1.5 0 015 3.5zm2.2 9h5.6m-5.6-3h5.6m-5.6-3h3.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M10 6.9a3.1 3.1 0 100 6.2 3.1 3.1 0 000-6.2zm0-3.4l.7 1.8a5 5 0 011.7.7l1.8-.7 1.1 1.9-1.3 1.4c.2.5.3 1 .3 1.5s-.1 1-.3 1.5l1.3 1.4-1.1 1.9-1.8-.7a5 5 0 01-1.7.7l-.7 1.8H8.6l-.7-1.8a5 5 0 01-1.7-.7l-1.8.7-1.1-1.9 1.3-1.4a5.3 5.3 0 010-3l-1.3-1.4 1.1-1.9 1.8.7a5 5 0 011.7-.7l.7-1.8H10z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "logout":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path
            d="M8 3.5h-3A1.5 1.5 0 003.5 5v10A1.5 1.5 0 005 16.5h3m3-9l3 2.5-3 2.5m-5-2.5h8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "menu":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <path d="M7.5 4.5L13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return <span className={className} />;
  }
}

function mainLinkClass({ isActive }, collapsed) {
  return `group flex w-full items-center gap-3 rounded-md border-l-2 text-sm font-medium transition-colors ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
    } ${isActive
      ? "border-cyan-400 bg-cyan-400/10 text-cyan-100"
      : "border-transparent text-slate-300 hover:bg-white/5 hover:text-white"
    }`;
}

function subLinkClass(isActive) {
  return `block rounded-md border-l px-3 py-1.5 text-sm transition-colors ${isActive
    ? "border-cyan-300 bg-cyan-400/10 text-cyan-100"
    : "border-slate-700 text-slate-400 hover:text-slate-100"
    }`;
}

function formatSegmentLabel(segment) {
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toSidebarTitleKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isSectionItem(item) {
  return item?.type === "section" || Array.isArray(item?.items);
}

function getPathWithoutQueryOrHash(target) {
  return String(target || "").replace(/[?#].*$/, "");
}

function getHashFragment(target) {
  const value = String(target || "");
  const hashIndex = value.indexOf("#");
  if (hashIndex < 0) {
    return "";
  }
  return value.slice(hashIndex + 1);
}

function isSidebarEntryActive(entry, pathname, hash) {
  const targetPath = getPathWithoutQueryOrHash(entry?.to);
  if (!targetPath) {
    return false;
  }

  const pathMatches = entry?.end
    ? pathname === targetPath
    : pathname.startsWith(targetPath);
  if (!pathMatches) {
    return false;
  }

  const targetHash = getHashFragment(entry.to);
  if (!targetHash) {
    return true;
  }

  return hash === `#${targetHash}`;
}

function hasActiveChildPath(items, pathname, hash) {
  if (!Array.isArray(items)) return false;

  return items.some((entry) => {
    if (isSectionItem(entry)) {
      if (entry.matchPrefix && pathname.startsWith(entry.matchPrefix)) {
        return true;
      }
      return hasActiveChildPath(entry.items, pathname, hash);
    }

    return isSidebarEntryActive(entry, pathname, hash);
  });
}

function findActiveTopSectionKey(items, pathname, hash) {
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    if (!isSectionItem(item)) {
      continue;
    }

    const isActive =
      (item.matchPrefix && pathname.startsWith(item.matchPrefix)) ||
      hasActiveChildPath(item.items, pathname, hash);
    if (isActive) {
      return item.matchPrefix || item.title || null;
    }
  }

  return null;
}

function hasRequiredPermissions(item, hasAnyPermission) {
  const requiredPermissions = Array.isArray(item?.requiredPermissions)
    ? item.requiredPermissions
    : [];

  if (requiredPermissions.length === 0) {
    return true;
  }

  return hasAnyPermission(requiredPermissions);
}

function filterSidebarItemsByPermissions(
  items,
  hasAnyPermission,
  includeUnimplemented
) {
  if (!Array.isArray(items)) {
    return [];
  }

  const visible = [];
  for (const item of items) {
    if (!hasRequiredPermissions(item, hasAnyPermission)) {
      continue;
    }

    if (!isSectionItem(item)) {
      if (!includeUnimplemented && item.implemented !== true) {
        continue;
      }
      visible.push(item);
      continue;
    }

    const children = filterSidebarItemsByPermissions(
      item.items,
      hasAnyPermission,
      includeUnimplemented
    );
    if (children.length === 0) {
      continue;
    }

    visible.push({
      ...item,
      items: children,
    });
  }

  return visible;
}

export default function AppLayout() {
  const { user, logout, hasAnyPermission, hasAllPermissions } = useAuth();
  const { t } = useI18n();
  const {
    loading: readinessLoading,
    error: readinessError,
    ready: tenantReady,
    missingChecks,
    refresh: refreshReadiness,
  } = useTenantReadiness();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [readinessMenuPathname, setReadinessMenuPathname] = useState(null);
  const [openTopSectionKey, setOpenTopSectionKey] = useState(() =>
    findActiveTopSectionKey(sidebarItems, location.pathname, location.hash)
  );
  const readinessMenuRef = useRef(null);
  const canViewUnimplementedModules = hasAllPermissions(
    MODULE_PREVIEW_ADMIN_PERMISSIONS
  );
  const readinessMenuOpen = readinessMenuPathname === location.pathname;

  function getItemDisplayText(item, type) {
    const fallback = type === "title" ? item?.title : item?.label;
    const pathKey = item?.to || item?.matchPrefix;
    if (!pathKey) {
      const titleKey = toSidebarTitleKey(fallback);
      return t(["sidebar", "titles", titleKey], fallback);
    }
    return t(["sidebar", "byPath", pathKey], fallback);
  }

  const breadcrumbs = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);

    return segments.map((segment, index) => {
      const builtPath = `/${segments.slice(0, index + 1).join("/")}`;
      const explicitLabel = t(["breadcrumbs", "byPath", builtPath], null);
      const sidebarLabel = t(["sidebar", "byPath", builtPath], null);
      return {
        to: builtPath,
        label: explicitLabel || sidebarLabel || formatSegmentLabel(segment),
        isLast: index === segments.length - 1,
      };
    });
  }, [location.pathname, t]);

  const visibleSidebarItems = useMemo(
    () =>
      filterSidebarItemsByPermissions(
        sidebarItems,
        hasAnyPermission,
        canViewUnimplementedModules
      ),
    [hasAnyPermission, canViewUnimplementedModules]
  );
  const readinessChip = useMemo(
    () =>
      resolveReadinessChip(readinessLoading, readinessError, tenantReady, t),
    [readinessLoading, readinessError, tenantReady, t]
  );

  const closeMobileSidebar = () => setMobileOpen(false);
  const closeReadinessMenu = () => setReadinessMenuPathname(null);

  useEffect(() => {
    if (!readinessMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (!readinessMenuRef.current?.contains(event.target)) {
        closeReadinessMenu();
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeReadinessMenu();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [readinessMenuOpen]);

  function renderSectionChildren(items, depth = 0) {
    if (!Array.isArray(items)) return null;

    return items.map((subItem, index) => {
      if (isSectionItem(subItem)) {
        const nestedItems = Array.isArray(subItem.items) ? subItem.items : [];
        const nestedSectionActive =
          (subItem.matchPrefix && location.pathname.startsWith(subItem.matchPrefix)) ||
          hasActiveChildPath(
            nestedItems,
            location.pathname,
            location.hash
          );

        return (
          <SidebarSection
            key={subItem.title || `section-${depth}-${index}`}
            title={getItemDisplayText(subItem, "title") || "Section"}
            icon={<Icon name={subItem.icon || "spark"} className="h-4 w-4" />}
            badge={subItem.badge}
            collapsed={false}
            defaultOpen={nestedSectionActive}
            active={nestedSectionActive}
          >
            {renderSectionChildren(nestedItems, depth + 1)}
          </SidebarSection>
        );
      }

      return (
        <NavLink
          key={subItem.to || `${subItem.label}-${depth}-${index}`}
          to={subItem.to}
          end={subItem.end}
          className={() =>
            subLinkClass(
              isSidebarEntryActive(subItem, location.pathname, location.hash)
            )
          }
          onClick={closeMobileSidebar}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{getItemDisplayText(subItem, "label")}</span>
            {subItem.implemented !== true && (
              <span className="rounded-full border border-slate-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                Soon
              </span>
            )}
          </span>
        </NavLink>
      );
    });
  }

  return (
    <div className="relative flex h-dvh overflow-hidden bg-slate-100 text-slate-900 font-['Trebuchet_MS','Lucida_Sans_Unicode','Segoe_UI',sans-serif]">
      <div
        className={`absolute inset-0 z-30 bg-slate-950/55 backdrop-blur-[1px] transition-opacity md:hidden ${mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        onClick={closeMobileSidebar}
      />

      <aside
        className={`absolute inset-y-0 left-0 z-40 flex flex-col border-r border-white/10 bg-slate-950 text-slate-100 shadow-2xl transition-all duration-300 md:static md:translate-x-0 ${collapsed ? "w-20" : "w-72"
          } ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="relative border-b border-white/10 px-3 py-3">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,#22d3ee30,transparent_60%)]" />
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-200 transition hover:bg-white/12 hover:text-white"
              aria-label={collapsed ? t("layout.expandSidebar") : t("layout.collapseSidebar")}
            >
              <Icon
                name={collapsed ? "chevron-right" : "chevron-left"}
                className="h-4 w-4"
              />
            </button>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
                  {t("layout.financeConsole")}
                </p>
                <h3 className="truncate text-sm font-semibold text-slate-100">
                  {t("layout.proSidebar")}
                </h3>
              </div>
            )}
          </div>
        </div>

        <nav
          className={`flex-1 space-y-0.5 px-3 py-4 ${collapsed ? "overflow-visible" : "overflow-y-auto"
            }`}
        >
          {visibleSidebarItems.map((item) => {
            if (item.type === "link") {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? getItemDisplayText(item, "label") : undefined}
                  className={(state) => mainLinkClass(state, collapsed)}
                  onClick={closeMobileSidebar}
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${isActive
                          ? "text-cyan-200"
                          : collapsed
                            ? "text-slate-200"
                            : "text-slate-300 group-hover:text-slate-100"
                          }`}
                      >
                        <Icon name={item.icon} className="h-4 w-4" />
                      </span>
                      {!collapsed && (
                        <span className="truncate">{getItemDisplayText(item, "label")}</span>
                      )}
                      {!collapsed && item.badge && (
                        <span className="ml-auto rounded-full bg-rose-400/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-rose-100">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            }

            const isSectionActive =
              (item.matchPrefix && location.pathname.startsWith(item.matchPrefix)) ||
              hasActiveChildPath(
                item.items,
                location.pathname,
                location.hash
              );
            const sectionKey = item.matchPrefix || item.title;
            const isSectionOpen = openTopSectionKey === sectionKey;

            return (
              <SidebarSection
                key={item.title}
                title={getItemDisplayText(item, "title")}
                icon={<Icon name={item.icon} className="h-4 w-4" />}
                badge={item.badge}
                collapsed={collapsed}
                open={isSectionOpen}
                active={isSectionActive}
                onToggle={() =>
                  setOpenTopSectionKey((current) =>
                    current === sectionKey ? null : sectionKey
                  )
                }
              >
                {renderSectionChildren(item.items)}
              </SidebarSection>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-white/10 p-3">
          {!collapsed && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                {t("layout.myAccount")}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-slate-100">
                {user?.name || t("layout.loggedInUser")}
              </p>
            </div>
          )}
          <button
            onClick={() => {
              logout();
              closeMobileSidebar();
              navigate("/login", { replace: true });
            }}
            className={`group flex w-full items-center gap-3 rounded-lg border border-white/15 bg-white/5 text-sm font-semibold text-slate-100 transition hover:bg-white/12 ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
              }`}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-200 transition group-hover:bg-white/20">
              <Icon name="logout" className="h-4 w-4" />
            </span>
            {!collapsed && <span>{t("layout.logout")}</span>}
          </button>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 md:hidden"
              aria-label={t("layout.openSidebar")}
            >
              <Icon name="menu" className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                {t("layout.workspace")}
              </p>
              <nav
                aria-label={t("layout.breadcrumbAria")}
                className="mt-0.5 flex items-center gap-1 overflow-x-auto text-xs text-slate-500"
              >
                {breadcrumbs.map((crumb, index) => (
                  <span
                    key={crumb.to}
                    className="inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    {crumb.isLast ? (
                      <span className="font-semibold text-slate-700">{crumb.label}</span>
                    ) : (
                      <Link
                        to={crumb.to}
                        className="transition-colors hover:text-slate-700"
                      >
                        {crumb.label}
                      </Link>
                    )}
                    {index < breadcrumbs.length - 1 && <span>/</span>}
                  </span>
                ))}
              </nav>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={readinessMenuRef}>
              <button
                type="button"
                onClick={() =>
                  setReadinessMenuPathname((currentPathname) =>
                    currentPathname === location.pathname ? null : location.pathname
                  )
                }
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold tracking-wide transition-colors ${readinessChip.classes}`}
                aria-haspopup="menu"
                aria-expanded={readinessMenuOpen}
                aria-label={t("layout.readinessChecklist", "Readiness checklist")}
              >
                <span>{readinessChip.label}</span>
                <svg
                  viewBox="0 0 20 20"
                  className={`h-3 w-3 transition-transform ${readinessMenuOpen ? "rotate-180" : ""}`}
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M5 7.5L10 12.5l5-5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {readinessMenuOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-80 max-w-[85vw] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
                  role="menu"
                >
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {t("layout.readinessChecklist", "Readiness checklist")}
                  </p>

                  {readinessLoading && (
                    <p className="mt-2 text-sm text-slate-600">
                      {t("layout.readinessChecking", "Readiness: Checking")}
                    </p>
                  )}

                  {!readinessLoading && readinessError && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                      <p className="text-xs font-medium text-amber-900">
                        {t("layout.readinessError", "Readiness: Error")}
                      </p>
                      <p className="mt-1 text-xs text-amber-800">{readinessError}</p>
                    </div>
                  )}

                  {!readinessLoading && !readinessError && tenantReady && (
                    <p className="mt-2 text-sm text-emerald-700">
                      {t(
                        "layout.readinessAllSet",
                        "All required setup items are complete."
                      )}
                    </p>
                  )}

                  {!readinessLoading && !readinessError && !tenantReady && (
                    <div className="mt-2">
                      <p className="text-xs font-semibold text-slate-700">
                        {t("layout.readinessMissingItems", "Missing items")}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {missingChecks.map((check) => (
                          <li
                            key={check.key}
                            className="flex items-center justify-between rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5"
                          >
                            <span className="text-xs text-rose-900">
                              {getReadinessCheckLabel(t, check)}
                            </span>
                            <span className="text-[11px] font-semibold text-rose-700">
                              {check.count}/{check.minimum}
                            </span>
                          </li>
                        ))}
                      </ul>

                      <div className="mt-2 grid gap-1">
                        {TENANT_SETUP_ROUTES.map((route) => (
                          <Link
                            key={route.to}
                            to={route.to}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                            onClick={closeReadinessMenu}
                          >
                            {t(["sidebar", "byPath", route.to], route.fallback)}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        refreshReadiness();
                      }}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      {t("layout.readinessRefresh", "Refresh")}
                    </button>
                    {!tenantReady && (
                      <Link
                        to={TENANT_SETUP_ROUTE}
                        className="text-xs font-semibold text-cyan-700 hover:text-cyan-800"
                        onClick={closeReadinessMenu}
                      >
                        {t("layout.readinessOpenSetup", "Open setup")}
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
            <LanguageSwitcher />
            <p className="truncate text-sm font-medium text-slate-700">
              {user?.name || t("layout.userFallback")}
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0 p-4 md:p-6 overflow-auto">
          <Outlet />
        </div>

        <footer className="border-t border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-500">
          <small>
            &copy; {new Date().getFullYear()} {t("layout.madeWithLoveBy")}{" "}
            <a
              target="_blank"
              rel="noopener noreferrer"
              href="https://granada.com.gt/es/"
              className="font-semibold text-slate-700 hover:text-slate-900"
            >
              Fabrica Granada
            </a>
          </small>
        </footer>
      </main>
    </div>
  );
}
