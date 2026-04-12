import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth.js";
import { useWorkingContext } from "../context/useWorkingContext.js";
import LanguageSwitcher from "../i18n/LanguageSwitcher.jsx";
import { useI18n } from "../i18n/useI18n.js";
import { useLegalEntityActivation } from "../readiness/useLegalEntityActivation.js";
import { useTenantReadiness } from "../readiness/useTenantReadiness.js";
import { toastError, toastSuccess } from "../toast/toastBus.js";
import SidebarSection from "./SidebarSection.jsx";
import { sidebarItems } from "./sidebarConfig.js";
import WorkingContextBar from "./WorkingContextBar.jsx";

const MODULE_PREVIEW_ADMIN_PERMISSIONS = [
  "security.role.upsert",
  "security.role_permissions.assign",
];
const TENANT_SETUP_ROUTE = "/app/ayarlar/sirket-ayarlari";
const ENTITY_ACTIVATION_ROUTE = "/app/ayarlar/entity-aktivasyon-alani";
const TENANT_SETUP_ROUTE_BY_CHECK_KEY = {
  groupCompanies: "/app/ayarlar/organizasyon-yonetimi",
  legalEntities: "/app/ayarlar/organizasyon-yonetimi",
  fiscalCalendars: "/app/ayarlar/organizasyon-yonetimi",
  fiscalPeriods: "/app/ayarlar/organizasyon-yonetimi",
  books: "/app/ayarlar/hesap-plani-ayarlari",
  openBookPeriods: "/app/ayarlar/organizasyon-yonetimi",
  chartsOfAccounts: "/app/ayarlar/hesap-plani-ayarlari",
  accounts: "/app/ayarlar/hesap-plani-ayarlari",
  taxEngineV1: "/app/ayarlar/vergi-kurulumu",
};
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

const MOJIBAKE_PATTERN =
  /(?:\u00C3.|\u00C2.|\u00C4.|\u00C5.|\u00F0\u009F|\u00E2[\u0080-\u00BF]|\u00EF\u00B8[\u0080-\u00BF])/u;

function resolveReadinessChip({
  bootstrapLoading,
  bootstrapError,
  bootstrapReady,
  activationLoading,
  activationError,
  activationSummaryVisible,
  incompleteEntityCount,
  t,
}) {
  if (bootstrapLoading) {
    return {
      label: t("layout.readinessChecking", "Bootstrap: Checking"),
      classes: "border-slate-300 bg-slate-100 text-slate-700",
    };
  }

  if (bootstrapError) {
    return {
      label: t("layout.readinessError", "Bootstrap: Error"),
      classes: "border-amber-300 bg-amber-100 text-amber-900",
    };
  }

  if (!bootstrapReady) {
    return {
      label: t("layout.readinessSetupRequired", "Bootstrap: Setup Required"),
      classes: "border-rose-300 bg-rose-100 text-rose-900 hover:bg-rose-200",
    };
  }

  return {
    label: activationLoading && activationSummaryVisible
      ? t(
          "layout.bootstrapCompletedActivationChecking",
          "Tenant bootstrap complete • Checking activation summary"
        )
      : activationError && activationSummaryVisible
        ? t(
            "layout.bootstrapCompletedActivationError",
            "Tenant bootstrap complete • Activation summary unavailable"
          )
        : incompleteEntityCount > 0
          ? incompleteEntityCount === 1
            ? t(
                "layout.bootstrapCompletedActivationPendingSingular",
                "Tenant bootstrap complete • 1 legal entity needs activation"
              )
            : t(
                "layout.bootstrapCompletedActivationPendingPlural",
                "Tenant bootstrap complete • {{count}} legal entities need activation",
                { count: incompleteEntityCount }
              )
          : activationSummaryVisible
            ? t(
                "layout.bootstrapCompletedActivationReady",
                "Tenant bootstrap complete • All visible legal entities are ready"
              )
            : t("layout.bootstrapCompleted", "Tenant bootstrap complete"),
    classes:
      activationError && activationSummaryVisible
        ? "border-amber-300 bg-amber-100 text-amber-900"
        : incompleteEntityCount > 0
          ? "border-amber-300 bg-amber-100 text-amber-900"
          : "border-emerald-300 bg-emerald-100 text-emerald-900",
  };
}

function resolveActivationSummary({
  loading,
  error,
  visibleEntityCount,
  incompleteEntityCount,
  t,
}) {
  if (loading) {
    return {
      tone: "slate",
      summary: t("layout.activationChecking", "Checking activation summary."),
      description: "",
    };
  }

  if (error) {
    return {
      tone: "amber",
      summary: t(
        "layout.activationError",
        "Activation summary could not be loaded."
      ),
      description: error,
    };
  }

  if (visibleEntityCount === 0) {
    return {
      tone: "slate",
      summary: t(
        "layout.activationNoVisibleEntities",
        "No legal entities are visible in the current scope."
      ),
      description: "",
    };
  }

  if (incompleteEntityCount > 0) {
    return {
      tone: "amber",
      summary:
        incompleteEntityCount === 1
          ? t(
              "layout.activationPendingSingular",
              "1 legal entity needs activation"
            )
          : t(
              "layout.activationPendingPlural",
              "{{count}} legal entities need activation",
              { count: incompleteEntityCount }
            ),
      description:
        incompleteEntityCount === 1
          ? t(
              "layout.activationPendingDescriptionSingular",
              "1 visible legal entity still has blocking activation tasks."
            )
          : t(
              "layout.activationPendingDescriptionPlural",
              "{{count}} visible legal entities still have blocking activation tasks.",
              { count: incompleteEntityCount }
            ),
    };
  }

  return {
    tone: "emerald",
    summary: t(
      "layout.activationAllSet",
      "All visible legal entities are ready."
    ),
    description: t(
      "layout.activationAllSetDescription",
      "No activation blockers remain across {{count}} visible legal entities.",
      { count: visibleEntityCount }
    ),
  };
}

function getStageBadgeClasses(tone) {
  if (tone === "amber") {
    return "border-amber-300 bg-amber-100 text-amber-900";
  }
  if (tone === "emerald") {
    return "border-emerald-300 bg-emerald-100 text-emerald-900";
  }
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function getActivationEntityLabel(row) {
  const code = repairMojibake(String(row?.legalEntityCode || "").trim());
  const name = repairMojibake(String(row?.legalEntityName || "").trim());
  if (code && name) {
    return `${code} - ${name}`;
  }
  return code || name || "Legal entity";
}

function getReadinessCheckLabel(t, check) {
  return t(
    ["readinessChecklist", "checkLabels", check?.key],
    check?.label || check?.key || ""
  );
}

function repairMojibake(value) {
  const text = String(value ?? "");
  if (!text || !MOJIBAKE_PATTERN.test(text)) {
    return text;
  }

  try {
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    return decoded || text;
  } catch {
    return text;
  }
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
    case "vault":
      return (
        <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
          <rect x="2.4" y="2.4" width="15.2" height="15.2" rx="3.1" fill="#0B1220" />
          <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="2.5" fill="#1D4ED8" />
          <rect x="4" y="4.2" width="12" height="11.4" rx="2" fill="#60A5FA" fillOpacity="0.28" />
          <path d="M4.8 6.2h10.4" stroke="#93C5FD" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="10" cy="10.6" r="3.4" fill="#22D3EE" />
          <circle cx="10" cy="10.6" r="2.35" fill="#0F172A" />
          <circle cx="10" cy="10.6" r="0.85" fill="#F59E0B" />
          <path d="M10 9.05v1.55m0 0h1.25" stroke="#F8FAFC" strokeWidth="1.15" strokeLinecap="round" />
          <circle cx="6.2" cy="7.25" r="0.72" fill="#FDE68A" />
          <circle cx="13.8" cy="7.25" r="0.72" fill="#FDE68A" />
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

const BUILTIN_ICON_NAMES = new Set([
  "dashboard",
  "spark",
  "journal",
  "bank",
  "vault",
  "company",
  "box",
  "inventory",
  "calendar",
  "report",
  "settings",
  "logout",
  "menu",
  "chevron-left",
  "chevron-right",
]);

const BUILTIN_ICON_EMOJI = {
  dashboard: "\u{1F3E0}",
  spark: "\u2728",
  journal: "\u{1F4D8}",
  bank: "\u{1F3E6}",
  company: "\u{1F3E2}",
  box: "\u{1F4E6}",
  inventory: "\u{1F5C2}\uFE0F",
  calendar: "\u{1F5D3}\uFE0F",
  report: "\u{1F4CA}",
  settings: "\u2699\uFE0F",
  logout: "\u{1F6AA}",
};

const SIDEBAR_ICON_RULES = [
  { pattern: /(dashboard|anasayfa)/, icon: "\u{1F3E0}" },
  { pattern: /(employee|kullanici|user|personel)/, icon: "\u{1F465}" },
  { pattern: /(permission|yetki|rbac|scope|audit|rol)/, icon: "\u{1F6E1}\uFE0F" },
  { pattern: /(bank)/, icon: "\u{1F3E6}" },
  { pattern: /(stok|inventory|item)/, icon: "\u{1F4E6}" },
  { pattern: /(demirbas|asset|amortisman)/, icon: "\u{1F9F0}" },
  { pattern: /(donem|calendar|month|year|kapanis|acilis)/, icon: "\u{1F5D3}\uFE0F" },
  { pattern: /(report|rapor|mizan|bilanco|gelir)/, icon: "\u{1F4CA}" },
  { pattern: /(ayar|setup|settings|kurulumu)/, icon: "\u2699\uFE0F" },
  { pattern: /(kur|fx|rate)/, icon: "\u{1F4B1}" },
  { pattern: /(konsolidasyon|consolidation)/, icon: "\u{1F9E9}" },
  { pattern: /(tediye|tahsilat|mahsup|yevmiye|journal)/, icon: "\u{1F4D2}" },
  { pattern: /(organizasyon|organization|sirket|company)/, icon: "\u{1F3E2}" },
  { pattern: /(discount|indirim)/, icon: "\u{1F3F7}\uFE0F" },
  { pattern: /(request|talep)/, icon: "\u{1F4DD}" },
  { pattern: /(approve|onay)/, icon: "\u2705" },
];

function deriveSidebarEmoji(item) {
  const rawIcon = repairMojibake(
    typeof item?.icon === "string" ? item.icon.trim() : ""
  );
  if (rawIcon) {
    if (BUILTIN_ICON_EMOJI[rawIcon]) return BUILTIN_ICON_EMOJI[rawIcon];
    return rawIcon;
  }

  const haystack = repairMojibake(
    `${item?.label || ""} ${item?.title || ""} ${item?.to || ""} ${item?.matchPrefix || ""}`
  ).toLowerCase();
  for (const rule of SIDEBAR_ICON_RULES) {
    if (rule.pattern.test(haystack)) return rule.icon;
  }

  return isSectionItem(item) ? "\u{1F4C1}" : "\u{1F4C4}";
}

function renderSidebarIcon(item, options = {}) {
  const { svgClass = "h-4 w-4", emojiClass = "text-[16px]" } = options;
  const rawIcon = repairMojibake(
    typeof item?.icon === "string" ? item.icon.trim() : ""
  );

  if (rawIcon && BUILTIN_ICON_NAMES.has(rawIcon)) {
    return <Icon name={rawIcon} className={svgClass} />;
  }

  const emoji = deriveSidebarEmoji(item);
  return (
    <span className={`inline-flex items-center justify-center leading-none ${emojiClass}`} aria-hidden="true">
      {emoji}
    </span>
  );
}

function mainLinkClass({ isActive }, collapsed) {
  return `group flex items-center text-left text-sm font-semibold transition-colors ${collapsed ? "mx-1 h-10 w-[calc(100%-0.5rem)] justify-center rounded-lg p-0" : "w-full gap-2 rounded-lg pl-4 pr-0 py-1.5"
    } ${isActive
      ? "bg-gray-100 text-[#143c62]"
      : "text-[#143c62] hover:bg-gray-100 hover:text-[#143c62]"
    }`;
}

function subLinkClass(isActive, nested = false) {
  return `flex w-full items-start gap-2 rounded-sm ${nested ? "pl-2 pr-2 py-2" : "pl-2 pr-2 py-1.5"} text-sm font-medium transition-colors ${isActive
    ? "bg-gray-100 text-black"
    : "text-gray-700 hover:bg-gray-100 hover:text-black"
    }`;
}

function toSidebarTitleKey(value) {
  return repairMojibake(String(value || ""))
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

function getTargetSearchParams(target) {
  const value = String(target || "");
  const queryIndex = value.indexOf("?");
  if (queryIndex < 0) {
    return new URLSearchParams();
  }

  const hashIndex = value.indexOf("#", queryIndex);
  const queryString =
    hashIndex < 0
      ? value.slice(queryIndex + 1)
      : value.slice(queryIndex + 1, hashIndex);
  return new URLSearchParams(queryString);
}

function matchesSidebarEntrySearch(target, search) {
  const targetSearchParams = getTargetSearchParams(target);
  if (Array.from(targetSearchParams.keys()).length === 0) {
    return true;
  }

  const currentSearchParams = new URLSearchParams(String(search || ""));
  for (const [key, value] of targetSearchParams.entries()) {
    if (currentSearchParams.get(key) !== value) {
      return false;
    }
  }

  return true;
}

function isSidebarEntryActive(entry, pathname, search, hash) {
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

  if (!matchesSidebarEntrySearch(entry?.to, search)) {
    return false;
  }

  const targetHash = getHashFragment(entry.to);
  if (!targetHash) {
    return true;
  }

  return hash === `#${targetHash}`;
}

function hasActiveChildPath(items, pathname, search, hash) {
  if (!Array.isArray(items)) return false;

  return items.some((entry) => {
    if (isSectionItem(entry)) {
      if (entry.matchPrefix && pathname.startsWith(entry.matchPrefix)) {
        return true;
      }
      return hasActiveChildPath(entry.items, pathname, search, hash);
    }

    return isSidebarEntryActive(entry, pathname, search, hash);
  });
}

function findActiveTopSectionKey(items, pathname, search, hash) {
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    if (!isSectionItem(item)) {
      continue;
    }

    const isActive =
      (item.matchPrefix && pathname.startsWith(item.matchPrefix)) ||
      hasActiveChildPath(item.items, pathname, search, hash);
    if (isActive) {
      return item.matchPrefix || item.title || null;
    }
  }

  return null;
}

function hasRequiredPermissions(item, hasAnyPermission) {
  const requiredPermissions = Array.isArray(item?.requiredPermissions)
    ? item.requiredPermissions.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (requiredPermissions.length === 0) {
    return true;
  }

  return hasAnyPermission(requiredPermissions);
}

function hasRequiredFeatures(item, hasAnyFeature) {
  const requiredFeatureCodes = Array.isArray(item?.requiredFeatureCodes)
    ? item.requiredFeatureCodes
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
    : [];
  if (requiredFeatureCodes.length === 0) {
    return true;
  }
  return hasAnyFeature(requiredFeatureCodes);
}

function annotateSidebarItemsWithAccess(
  items,
  hasAnyPermission,
  hasAnyFeature,
  includeUnimplemented,
  t
) {
  if (!Array.isArray(items)) {
    return [];
  }

  const visible = [];
  for (const item of items) {
    if (item?.sidebarHidden) {
      continue;
    }

    const requiredPermissions = Array.isArray(item?.requiredPermissions)
      ? item.requiredPermissions.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const requiredFeatureCodes = Array.isArray(item?.requiredFeatureCodes)
      ? item.requiredFeatureCodes
          .map((value) => String(value || "").trim().toUpperCase())
          .filter(Boolean)
      : [];
    const hasAccess = hasRequiredPermissions(item, hasAnyPermission);
    const hasFeatureAccess = hasRequiredFeatures(item, hasAnyFeature);
    const lockedReason =
      !hasAccess && requiredPermissions.length > 0
        ? `${t("layout.permissionRequired", "Permission required")}: ${requiredPermissions.join(", ")}`
        : "";

    if (!hasFeatureAccess) {
      continue;
    }

    if (!isSectionItem(item)) {
      if (!includeUnimplemented && item.implemented !== true) {
        continue;
      }
      visible.push({
        ...item,
        requiredPermissions,
        requiredFeatureCodes,
        isLocked: !hasAccess,
        lockedReason,
      });
      continue;
    }

    const children = annotateSidebarItemsWithAccess(
      item.items,
      hasAnyPermission,
      hasAnyFeature,
      includeUnimplemented,
      t
    );
    if (children.length === 0) {
      continue;
    }

    visible.push({
      ...item,
      requiredPermissions,
      requiredFeatureCodes,
      isLocked: !hasAccess,
      lockedReason,
      items: children,
    });
  }

  return visible;
}

/**
 * Renders the main authenticated shell, including staged tenant bootstrap and
 * legal-entity activation status summaries plus links into the relevant
 * workspace for the current blocker type.
 */
export default function AppLayout() {
  const {
    user,
    logout,
    hasAnyPermission,
    hasAnyFeature,
    hasAllPermissions,
  } = useAuth();
  const { workingContext } = useWorkingContext();
  const { t } = useI18n();
  const {
    loading: readinessLoading,
    error: readinessError,
    ready: tenantReady,
    missingChecks,
    refresh: refreshReadiness,
  } = useTenantReadiness();
  const {
    loading: activationLoading,
    error: activationError,
    incompleteEntityCount,
    refresh: refreshActivation,
    getActivationRows,
    getActivationRow,
  } = useLegalEntityActivation();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [readinessMenuPathname, setReadinessMenuPathname] = useState(null);
  const [openTopSectionKey, setOpenTopSectionKey] = useState(() =>
    findActiveTopSectionKey(
      sidebarItems,
      location.pathname,
      location.search,
      location.hash
    )
  );
  const readinessMenuRef = useRef(null);
  const canViewUnimplementedModules = hasAllPermissions(
    MODULE_PREVIEW_ADMIN_PERMISSIONS
  );
  const readinessMenuOpen = readinessMenuPathname === location.pathname;
  const activationRows = getActivationRows();
  const visibleActivationEntityCount = activationRows.length;
  const incompleteActivationRows = useMemo(
    () => activationRows.filter((row) => !row.ready),
    [activationRows]
  );
  const activationSummaryVisible =
    activationLoading ||
    Boolean(activationError) ||
    visibleActivationEntityCount > 0;
  const activationSummary = useMemo(
    () =>
      resolveActivationSummary({
        loading: activationLoading,
        error: activationError,
        visibleEntityCount: visibleActivationEntityCount,
        incompleteEntityCount,
        t,
      }),
    [
      activationError,
      activationLoading,
      incompleteEntityCount,
      t,
      visibleActivationEntityCount,
    ]
  );
  const currentWorkingActivationRow = workingContext?.legalEntityId
    ? getActivationRow(workingContext.legalEntityId)
    : null;
  const currentWorkingActivationStatus = useMemo(() => {
    if (!currentWorkingActivationRow) {
      return null;
    }
    return currentWorkingActivationRow.ready
      ? {
          label: t(
            "layout.currentEntityActivationReady",
            "Current entity ready"
          ),
          classes: "bg-emerald-500",
        }
      : {
          label: t(
            "layout.currentEntityActivationPending",
            "Current entity needs activation"
          ),
          classes: "bg-amber-500",
        };
  }, [currentWorkingActivationRow, t]);

  function getItemDisplayText(item, type) {
    const fallback = type === "title" ? item?.title : item?.label;
    const pathKey = item?.to || item?.matchPrefix;
    if (!pathKey) {
      const titleKey = toSidebarTitleKey(fallback);
      return repairMojibake(t(["sidebar", "titles", titleKey], fallback));
    }
    return repairMojibake(t(["sidebar", "byPath", pathKey], fallback));
  }

  const visibleSidebarItems = useMemo(
    () =>
      annotateSidebarItemsWithAccess(
        sidebarItems,
        hasAnyPermission,
        hasAnyFeature,
        canViewUnimplementedModules,
        t
      ),
    [
      hasAnyFeature,
      hasAnyPermission,
      canViewUnimplementedModules,
      t,
    ]
  );
  const readinessChip = useMemo(
    () =>
      resolveReadinessChip({
        bootstrapLoading: readinessLoading,
        bootstrapError: readinessError,
        bootstrapReady: tenantReady,
        activationLoading,
        activationError,
        activationSummaryVisible,
        incompleteEntityCount,
        t,
      }),
    [
      activationError,
      activationLoading,
      activationSummaryVisible,
      incompleteEntityCount,
      readinessError,
      readinessLoading,
      t,
      tenantReady,
    ]
  );
  const showReadinessChip = true;

  const closeMobileSidebar = () => setMobileOpen(false);
  const closeReadinessMenu = () => setReadinessMenuPathname(null);
  const handleLogout = () => {
    logout();
    closeMobileSidebar();
    navigate("/login", { replace: true });
  };

  async function handleCopyAccessRequest(item) {
    const requiredPermissions = Array.isArray(item?.requiredPermissions)
      ? item.requiredPermissions
      : [];
    if (requiredPermissions.length === 0) {
      return;
    }

    const label = getItemDisplayText(item, "label") || getItemDisplayText(item, "title") || item?.to || "Route";
    const text = [
      "Access request",
      `User: ${user?.email || user?.name || "-"}`,
      `Route: ${label}`,
      `Path: ${item?.to || "-"}`,
      `Required permissions: ${requiredPermissions.join(", ")}`,
    ].join("\n");

    if (!navigator?.clipboard?.writeText) {
      toastError(t("layout.copyAccessRequestUnsupported", "Clipboard is not available in this browser."));
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toastSuccess(t("layout.copyAccessRequestSuccess", "Access request copied."));
    } catch {
      toastError(t("layout.copyAccessRequestFailed", "Failed to copy access request."));
    }
  }

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
            location.search,
            location.hash
          );

        return (
          <div
            key={subItem.title || `section-${depth}-${index}`}
            className="border-l-2 border-gray-300"
          >
            <SidebarSection
              title={getItemDisplayText(subItem, "title") || "Section"}
              icon={renderSidebarIcon(subItem, {
                svgClass: "h-4 w-4",
                emojiClass: "text-[16px]",
              })}
              badge={subItem.badge}
              collapsed={collapsed}
              nested
              flyoutNested
              defaultOpen={nestedSectionActive}
              active={nestedSectionActive}
            >
              {renderSectionChildren(nestedItems, depth + 1)}
            </SidebarSection>
          </div>
        );
      }

      return (
        <div
          key={subItem.to || `${subItem.label}-${depth}-${index}`}
          className="border-l-2 border-gray-300"
        >
          {subItem.isLocked ? (
            <div
              className={`flex w-full items-start gap-2 rounded-sm border border-amber-200 bg-amber-50/70 text-sm font-medium text-amber-900 ${depth > 0 ? "pl-2 pr-2 py-2" : "pl-2 pr-2 py-1.5"
                }`}
              title={subItem.lockedReason || t("layout.lockedMenu", "Access restricted")}
              aria-disabled="true"
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-amber-800">
                {renderSidebarIcon(subItem, {
                  svgClass: "h-4 w-4",
                  emojiClass: "text-[15px]",
                })}
              </span>
              <span className="flex min-w-0 flex-1 items-start justify-between gap-2">
                <span className="whitespace-normal wrap-break-word leading-5">
                  {getItemDisplayText(subItem, "label")}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyAccessRequest(subItem)}
                  className="shrink-0 rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100"
                >
                  {t("layout.copyAccessRequest", "Copy request")}
                </button>
              </span>
            </div>
          ) : (
            <NavLink
              to={subItem.to}
              end={subItem.end}
              className={() =>
                subLinkClass(
                  isSidebarEntryActive(
                    subItem,
                    location.pathname,
                    location.search,
                    location.hash
                  ),
                  depth > 0
                )
              }
              onClick={closeMobileSidebar}
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[#143c62]">
                {renderSidebarIcon(subItem, {
                  svgClass: "h-4 w-4",
                  emojiClass: "text-[15px]",
                })}
              </span>
              <span className="flex min-w-0 flex-1 items-start justify-between gap-2">
                <span className="whitespace-normal wrap-break-word leading-5">{getItemDisplayText(subItem, "label")}</span>
                {subItem.implemented !== true && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-slate-300 px-1 text-[9px] font-semibold uppercase leading-none text-slate-500">
                    S
                  </span>
                )}
              </span>
            </NavLink>
          )}
        </div>
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
        className={`absolute inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white text-slate-900 shadow-xl transition-all duration-300 md:static md:translate-x-0 lg:rounded-br-3xl ${collapsed ? "w-13" : "w-[14.75rem]"
          } ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div
          className={`shrink-0 border-b border-slate-200 ${collapsed ? "px-2 py-2" : "px-3 py-3"
            }`}
        >
          <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2`}>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              aria-label={collapsed ? t("layout.expandSidebar") : t("layout.collapseSidebar")}
            >
              <Icon
                name={collapsed ? "chevron-right" : "chevron-left"}
                className="h-4 w-4"
              />
            </button>
            {!collapsed && <LanguageSwitcher />}
          </div>
          {!collapsed && showReadinessChip && (
            <div className="relative mt-2" ref={readinessMenuRef}>
              <button
                type="button"
                onClick={() =>
                  setReadinessMenuPathname((currentPathname) =>
                    currentPathname === location.pathname ? null : location.pathname
                  )
                }
                className={`inline-flex w-full items-center justify-between rounded-full border px-2.5 py-1.5 text-[11px] font-semibold tracking-wide transition-colors ${readinessChip.classes}`}
                aria-haspopup="menu"
                aria-expanded={readinessMenuOpen}
                aria-label={t("layout.readinessStages", "Readiness stages")}
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
                  className="absolute left-0 top-[calc(100%+0.45rem)] z-50 w-80 max-w-[85vw] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
                  role="menu"
                >
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {t("layout.readinessStages", "Readiness stages")}
                  </p>

                  {readinessLoading && (
                    <p className="mt-2 text-sm text-slate-600">
                      {t("layout.readinessChecking", "Bootstrap: Checking")}
                    </p>
                  )}

                  {!readinessLoading && readinessError && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                      <p className="text-xs font-medium text-amber-900">
                        {t("layout.readinessError", "Bootstrap: Error")}
                      </p>
                      <p className="mt-1 text-xs text-amber-800">{readinessError}</p>
                    </div>
                  )}

                  {!readinessLoading && !readinessError && tenantReady && (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-emerald-900">
                          {t("layout.bootstrapCompleted", "Tenant bootstrap complete")}
                        </p>
                        <span className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          {t(
                            "layout.readinessAllSet",
                            "All required bootstrap steps are complete."
                          )}
                        </span>
                      </div>
                    </div>
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
                            {TENANT_SETUP_ROUTE_BY_CHECK_KEY[check.key] ? (
                              <Link
                                to={TENANT_SETUP_ROUTE_BY_CHECK_KEY[check.key]}
                                className="text-xs text-rose-900 underline decoration-rose-300 underline-offset-2"
                                onClick={closeReadinessMenu}
                              >
                                {getReadinessCheckLabel(t, check)}
                              </Link>
                            ) : (
                              <span className="text-xs text-rose-900">
                                {getReadinessCheckLabel(t, check)}
                              </span>
                            )}
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

                  {!readinessLoading && !readinessError && tenantReady && (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-700">
                          {t(
                            "layout.activationSectionTitle",
                            "Legal-entity activation"
                          )}
                        </p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStageBadgeClasses(
                            activationSummary.tone
                          )}`}
                        >
                          {activationSummary.summary}
                        </span>
                      </div>

                      {activationSummary.description ? (
                        <p className="mt-2 text-xs text-slate-600">
                          {activationSummary.description}
                        </p>
                      ) : null}

                      {incompleteActivationRows.length > 0 ? (
                        <div className="mt-2">
                          <ul className="space-y-1">
                            {incompleteActivationRows.slice(0, 4).map((row) => (
                              <li
                                key={row.legalEntityId}
                                className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5"
                              >
                                <Link
                                  to={ENTITY_ACTIVATION_ROUTE}
                                  className="truncate pr-2 text-xs text-amber-900 underline decoration-amber-300 underline-offset-2"
                                  onClick={closeReadinessMenu}
                                >
                                  {getActivationEntityLabel(row)}
                                </Link>
                                <span className="shrink-0 text-[11px] font-semibold text-amber-800">
                                  {t(
                                    "layout.activationRowPending",
                                    "Pending"
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {incompleteActivationRows.length > 4 ? (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {t(
                                "layout.activationMoreRows",
                                "+{{count}} more",
                                { count: incompleteActivationRows.length - 4 }
                              )}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        refreshReadiness();
                        refreshActivation();
                      }}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      {t("layout.readinessRefresh", "Refresh")}
                    </button>
                    {!tenantReady ? (
                      <Link
                        to={TENANT_SETUP_ROUTE}
                        className="text-xs font-semibold text-cyan-700 hover:text-cyan-800"
                        onClick={closeReadinessMenu}
                      >
                        {t("layout.readinessOpenSetup", "Open setup")}
                      </Link>
                    ) : activationSummaryVisible ? (
                      <Link
                        to={ENTITY_ACTIVATION_ROUTE}
                        className="text-xs font-semibold text-cyan-700 hover:text-cyan-800"
                        onClick={closeReadinessMenu}
                      >
                        {t(
                          "layout.activationOpenWorkspace",
                          "Open activation workspace"
                        )}
                      </Link>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className={collapsed ? "mt-2" : "mt-2"}>
            <WorkingContextBar collapsed={collapsed} />
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <nav
            className={`h-full space-y-0.5 pl-0 pr-0 py-3 ${collapsed
              ? "overflow-visible"
              : "overflow-y-scroll overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
              }`}
          >
            {visibleSidebarItems.map((item) => {
              if (item.type === "link") {
                if (item.isLocked) {
                  return (
                    <div key={item.to} className="relative">
                      <div
                        title={item.lockedReason || t("layout.lockedMenu", "Access restricted")}
                        className={`group flex items-center text-left text-sm font-semibold transition-colors ${collapsed
                          ? "mx-1 h-10 w-[calc(100%-0.5rem)] justify-center rounded-lg border border-amber-300 bg-amber-50/80 p-0 text-amber-900"
                          : "w-full gap-2 rounded-lg border border-amber-300 bg-amber-50/80 pl-4 pr-2 py-1.5 text-amber-900"
                          }`}
                        aria-disabled="true"
                      >
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-amber-800">
                          {renderSidebarIcon(item, {
                            svgClass: "h-5 w-5",
                            emojiClass: "text-[18px]",
                          })}
                        </span>
                        {!collapsed && (
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap leading-5">
                            {getItemDisplayText(item, "label")}
                          </span>
                        )}
                        {!collapsed && (
                          <button
                            type="button"
                            onClick={() => handleCopyAccessRequest(item)}
                            className="ml-auto rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100"
                          >
                            {t("layout.copyAccessRequest", "Copy request")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={item.to} className="relative">
                    <NavLink
                      to={item.to}
                      end={item.end}
                      title={collapsed ? getItemDisplayText(item, "label") : undefined}
                      className={(state) => mainLinkClass(state, collapsed)}
                      onClick={closeMobileSidebar}
                    >
                      {() => (
                        <>
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center transition-colors text-[#143c62]">
                            {renderSidebarIcon(item, {
                              svgClass: "h-5 w-5",
                              emojiClass: "text-[18px]",
                            })}
                          </span>
                          {!collapsed && (
                            <span className="min-w-0 flex-1 truncate whitespace-nowrap leading-5">
                              {getItemDisplayText(item, "label")}
                            </span>
                          )}
                          {!collapsed && item.badge && (
                            <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-700">
                              {item.badge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </div>
                );
              }

              const isSectionActive =
                (item.matchPrefix && location.pathname.startsWith(item.matchPrefix)) ||
                hasActiveChildPath(
                  item.items,
                  location.pathname,
                  location.search,
                  location.hash
                );
              const sectionKey = item.matchPrefix || item.title;
              const isSectionOpen = openTopSectionKey === sectionKey;

              return (
                <SidebarSection
                  key={item.title}
                  title={getItemDisplayText(item, "title")}
                  icon={renderSidebarIcon(item, {
                    svgClass: "h-5 w-5",
                    emojiClass: "text-[18px]",
                  })}
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
        </div>

        <div
          className={`shrink-0 border-t border-slate-200 bg-white overflow-hidden ${collapsed ? "p-1" : "p-3"
            }`}
        >
          <div
            className={`mx-auto flex items-center rounded-lg transition-all duration-300 ${collapsed
              ? "h-10 w-full justify-center gap-0 p-0"
              : "w-full justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-2"
              }`}
          >
            <div
              className={`min-w-0 transition-all duration-200 ${collapsed ? "max-w-0 overflow-hidden opacity-0" : "max-w-44 opacity-100"
                }`}
              aria-hidden={collapsed}
            >
              <p className="truncate whitespace-nowrap text-[10px] uppercase tracking-[0.16em] text-slate-500">
                {t("layout.myAccount")}
              </p>
              <p className="mt-0.5 truncate whitespace-nowrap text-sm font-semibold text-[#143c62]">
                {user?.name || t("layout.loggedInUser")}
              </p>
              {currentWorkingActivationStatus ? (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span
                    className={`inline-flex h-2 w-2 rounded-full ${currentWorkingActivationStatus.classes}`}
                    aria-hidden="true"
                  />
                  <span className="truncate whitespace-nowrap">
                    {currentWorkingActivationStatus.label}
                  </span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={handleLogout}
              title={collapsed ? t("layout.logout") : undefined}
              className={`inline-flex shrink-0 items-center transition-all duration-200 ${collapsed
                ? "h-10 w-full justify-center rounded-lg border border-slate-300 bg-white text-[#143c62] hover:bg-gray-100"
                : "gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-[#143c62] hover:bg-gray-100"
                }`}
            >
              <Icon name="logout" className={collapsed ? "h-4 w-4" : "h-3.5 w-3.5"} />
              <span
                className={`overflow-hidden whitespace-nowrap transition-all duration-200 ${collapsed ? "max-w-0 opacity-0" : "max-w-16 opacity-100"
                  }`}
                aria-hidden={collapsed}
              >
                {t("layout.logout")}
              </span>
            </button>
          </div>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute left-3 top-3 z-20 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
            aria-label={t("layout.openSidebar")}
          >
            <Icon name="menu" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 p-4 md:p-6 overflow-auto">
          <Outlet />
        </div>

        {/* <footer className="border-t border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-500">

        </footer> */}
      </main>
    </div>
  );
}
