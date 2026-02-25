import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import AppLayout from "./layouts/AppLayout";
import RequireAuth from "./auth/RequireAuth";
import RequirePermission from "./auth/RequirePermission";
import { useAuth } from "./auth/useAuth.js";
import AcilisFisiOlustur from "./pages/AcilisFisiOlustur";
import JournalWorkbenchPage from "./pages/JournalWorkbenchPage";
import CompanyOnboardingPage from "./pages/settings/CompanyOnboardingPage";
import GlSetupPage from "./pages/settings/GlSetupPage";
import GlReclassificationPage from "./pages/settings/GlReclassificationPage.jsx";
import HesapPlaniOlustur from "./pages/settings/HesapPlaniOlustur";
import OrganizationManagementPage from "./pages/settings/OrganizationManagementPage";
import FxRatesPage from "./pages/settings/FxRatesPage";
import ConsolidationSetupPage from "./pages/settings/ConsolidationSetupPage";
import RolesPermissionsPage from "./pages/security/RolesPermissionsPage";
import UserAssignmentsPage from "./pages/security/UserAssignmentsPage";
import ScopeAssignmentsPage from "./pages/security/ScopeAssignmentsPage";
import RbacAuditLogsPage from "./pages/security/RbacAuditLogsPage";
import IntercompanyReconciliationPage from "./pages/IntercompanyReconciliationPage";
import ConsolidationReportsPage from "./pages/ConsolidationReportsPage";
import ProviderBootstrapPage from "./pages/ProviderBootstrapPage";
import ProviderLoginPage from "./pages/provider/ProviderLoginPage.jsx";
import ModulePlaceholderPage from "./pages/ModulePlaceholderPage";
import CashRegistersPage from "./pages/cash/CashRegistersPage.jsx";
import CashSessionsPage from "./pages/cash/CashSessionsPage.jsx";
import CashTransactionsPage from "./pages/cash/CashTransactionsPage.jsx";
import CashExceptionsPage from "./pages/cash/CashExceptionsPage.jsx";
import CariCounterpartyPage from "./pages/cari/CariCounterpartyPage.jsx";
import CariDocumentsPage from "./pages/cari/CariDocumentsPage.jsx";
import CariReportsPage from "./pages/cari/CariReportsPage.jsx";
import CariSettlementsPage from "./pages/cari/CariSettlementsPage.jsx";
import CariAuditPage from "./pages/cari/CariAuditPage.jsx";
import ContractsPage from "./pages/contracts/ContractsPage.jsx";
import FutureYearRevenuePage from "./pages/revenue/FutureYearRevenuePage.jsx";
import { collectSidebarLinks, sidebarItems } from "./layouts/sidebarConfig.js";
import TenantReadinessProvider from "./readiness/TenantReadinessProvider.jsx";
import RequireTenantReadiness from "./readiness/RequireTenantReadiness.jsx";
import RequireProviderAuth from "./provider/RequireProviderAuth.jsx";

function toRoutePath(value) {
  return String(value || "").replace(/[?#].*$/, "");
}

const rawSidebarLinks = collectSidebarLinks(sidebarItems);
const sidebarRouteLinks = [];
const sidebarLinkByPath = new Map();
for (const link of rawSidebarLinks) {
  const routePath = toRoutePath(link?.to);
  if (!routePath) {
    continue;
  }

  const existing = sidebarLinkByPath.get(routePath);
  if (!existing) {
    const normalizedLink = { ...link, routePath };
    sidebarLinkByPath.set(routePath, normalizedLink);
    sidebarRouteLinks.push(normalizedLink);
    continue;
  }

  const existingPermissions = Array.isArray(existing.requiredPermissions)
    ? existing.requiredPermissions
    : [];
  const nextPermissions = Array.isArray(link.requiredPermissions)
    ? link.requiredPermissions
    : [];
  if (nextPermissions.length > 0) {
    existing.requiredPermissions = Array.from(
      new Set([...existingPermissions, ...nextPermissions])
    );
  }
}
const MODULE_PREVIEW_ADMIN_PERMISSIONS = [
  "security.role.upsert",
  "security.role_permissions.assign",
];
const PERIODIZATION_REVENUE_CANONICAL_PATH = "/app/gelecek-yillar-gelirleri";

const implementedRoutes = [
  {
    appPath: "/app/acilis-fisi",
    childPath: "acilis-fisi",
    element: <AcilisFisiOlustur />,
  },
  {
    appPath: "/app/mahsup-islemleri",
    childPath: "mahsup-islemleri",
    element: <JournalWorkbenchPage />,
  },
  {
    appPath: "/app/kasa-tanimlari",
    childPath: "kasa-tanimlari",
    element: <CashRegistersPage />,
  },
  {
    appPath: "/app/kasa-oturumlari",
    childPath: "kasa-oturumlari",
    element: <CashSessionsPage />,
  },
  {
    appPath: "/app/tediye-islemleri",
    childPath: "tediye-islemleri",
    element: <CashTransactionsPage />,
  },
  {
    appPath: "/app/tahsilat-islemleri",
    childPath: "tahsilat-islemleri",
    element: <CashTransactionsPage />,
  },
  {
    appPath: "/app/kasa-islemleri",
    childPath: "kasa-islemleri",
    element: <CashTransactionsPage />,
  },
  {
    appPath: "/app/kasa-istisnalari",
    childPath: "kasa-istisnalari",
    element: <CashExceptionsPage />,
  },
  {
    appPath: "/app/alici-kart-olustur",
    childPath: "alici-kart-olustur",
    element: <CariCounterpartyPage pageKey="buyerCreate" />,
  },
  {
    appPath: "/app/alici-kart-listesi",
    childPath: "alici-kart-listesi",
    element: <CariCounterpartyPage pageKey="buyerList" />,
  },
  {
    appPath: "/app/satici-kart-olustur",
    childPath: "satici-kart-olustur",
    element: <CariCounterpartyPage pageKey="vendorCreate" />,
  },
  {
    appPath: "/app/satici-kart-listesi",
    childPath: "satici-kart-listesi",
    element: <CariCounterpartyPage pageKey="vendorList" />,
  },
  {
    appPath: "/app/cari-raporlari",
    childPath: "cari-raporlari",
    element: <CariReportsPage />,
  },
  {
    appPath: "/app/cari-belgeler",
    childPath: "cari-belgeler",
    element: <CariDocumentsPage />,
  },
  {
    appPath: "/app/cari-settlements",
    childPath: "cari-settlements",
    element: <CariSettlementsPage />,
  },
  {
    appPath: "/app/cari-audit",
    childPath: "cari-audit",
    element: <CariAuditPage />,
  },
  {
    appPath: "/app/contracts",
    childPath: "contracts",
    element: <ContractsPage />,
  },
  {
    appPath: "/app/sozlesmeler",
    childPath: "sozlesmeler",
    permissionPath: "/app/contracts",
    element: <Navigate to="/app/contracts" replace />,
  },
  {
    appPath: "/app/contracts-and-revenue",
    childPath: "contracts-and-revenue",
    permissionPath: "/app/contracts",
    element: <Navigate to="/app/contracts" replace />,
  },
  {
    appPath: PERIODIZATION_REVENUE_CANONICAL_PATH,
    childPath: "gelecek-yillar-gelirleri",
    element: <FutureYearRevenuePage />,
  },
  {
    appPath: "/app/donemsellik-ve-tahakkuklar",
    childPath: "donemsellik-ve-tahakkuklar",
    permissionPath: PERIODIZATION_REVENUE_CANONICAL_PATH,
    element: <Navigate to={PERIODIZATION_REVENUE_CANONICAL_PATH} replace />,
  },
  {
    appPath: "/app/periodization-and-accruals",
    childPath: "periodization-and-accruals",
    permissionPath: PERIODIZATION_REVENUE_CANONICAL_PATH,
    element: <Navigate to={PERIODIZATION_REVENUE_CANONICAL_PATH} replace />,
  },
  {
    appPath: "/app/ayarlar/hesap-plani-olustur",
    childPath: "ayarlar/hesap-plani-olustur",
    element: <HesapPlaniOlustur />,
  },
  {
    appPath: "/app/ayarlar/hesap-plani-ayarlari",
    childPath: "ayarlar/hesap-plani-ayarlari",
    element: <GlSetupPage />,
  },
  {
    appPath: "/app/ayarlar/hesap-yeniden-siniflandirma",
    childPath: "ayarlar/hesap-yeniden-siniflandirma",
    element: <GlReclassificationPage />,
  },
  {
    appPath: "/app/ayarlar/sirket-ayarlari",
    childPath: "ayarlar/sirket-ayarlari",
    element: <CompanyOnboardingPage />,
  },
  {
    appPath: "/app/ayarlar/organizasyon-yonetimi",
    childPath: "ayarlar/organizasyon-yonetimi",
    element: <OrganizationManagementPage />,
  },
  {
    appPath: "/app/ayarlar/kur-yonetimi",
    childPath: "ayarlar/kur-yonetimi",
    element: <FxRatesPage />,
  },
  {
    appPath: "/app/ayarlar/konsolidasyon-kurulumu",
    childPath: "ayarlar/konsolidasyon-kurulumu",
    element: <ConsolidationSetupPage />,
  },
  {
    appPath: "/app/ayarlar/rbac/roles-permissions",
    childPath: "ayarlar/rbac/roles-permissions",
    element: <RolesPermissionsPage />,
  },
  {
    appPath: "/app/ayarlar/rbac/user-assignments",
    childPath: "ayarlar/rbac/user-assignments",
    element: <UserAssignmentsPage />,
  },
  {
    appPath: "/app/ayarlar/rbac/scope-assignments",
    childPath: "ayarlar/rbac/scope-assignments",
    element: <ScopeAssignmentsPage />,
  },
  {
    appPath: "/app/ayarlar/rbac/audit-logs",
    childPath: "ayarlar/rbac/audit-logs",
    element: <RbacAuditLogsPage />,
  },
  {
    appPath: "/app/donem-sonu-islemler/aylik/intercompany-mutabakat",
    childPath: "donem-sonu-islemler/aylik/intercompany-mutabakat",
    element: <IntercompanyReconciliationPage />,
  },
  {
    appPath: "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari",
    childPath: "donem-sonu-islemler/yillik/konsolidasyon-raporlari",
    element: <ConsolidationReportsPage />,
  },
];

for (const route of implementedRoutes) {
  const permissionPath = route.permissionPath || route.appPath;
  if (permissionPath === route.appPath) {
    continue;
  }

  const baseLink = sidebarLinkByPath.get(permissionPath);
  if (!baseLink) {
    continue;
  }

  const aliasLink = sidebarLinkByPath.get(route.appPath);
  const basePermissions = Array.isArray(baseLink.requiredPermissions)
    ? baseLink.requiredPermissions
    : [];
  const aliasPermissions = Array.isArray(aliasLink?.requiredPermissions)
    ? aliasLink.requiredPermissions
    : [];
  const mergedPermissions = Array.from(
    new Set([...aliasPermissions, ...basePermissions])
  );
  if (mergedPermissions.length === 0) {
    continue;
  }

  sidebarLinkByPath.set(route.appPath, {
    ...(aliasLink || baseLink),
    to: route.appPath,
    routePath: route.appPath,
    requiredPermissions: mergedPermissions,
  });
}

const implementedPaths = new Set([
  "/app",
  ...implementedRoutes.map((route) => route.appPath),
]);

const allPlaceholderRoutes = sidebarRouteLinks.filter(
  (link) =>
    link.routePath.startsWith("/app/") && !implementedPaths.has(link.routePath)
);

function withPermissionGuard(pathForPermissions, element) {
  const requiredPermissions = sidebarLinkByPath.get(pathForPermissions)?.requiredPermissions;
  if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) {
    return element;
  }

  return (
    <RequirePermission anyOf={requiredPermissions}>{element}</RequirePermission>
  );
}

function toChildPath(appPath) {
  return toRoutePath(appPath).replace(/^\/app\//, "");
}

export default function App() {
  const { hasAllPermissions } = useAuth();
  const canViewUnimplementedModules = hasAllPermissions(
    MODULE_PREVIEW_ADMIN_PERMISSIONS
  );
  const providerPanelEnabled =
    import.meta.env.DEV ||
    String(import.meta.env.VITE_PROVIDER_PANEL_ENABLED || "")
      .trim()
      .toLowerCase() === "true" ||
    String(import.meta.env.VITE_PROVIDER_BOOTSTRAP_ENABLED || "")
      .trim()
      .toLowerCase() === "true";
  const placeholderRoutes = canViewUnimplementedModules
    ? allPlaceholderRoutes
    : [];

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<LoginPage />} />
      {providerPanelEnabled ? (
        <>
          <Route path="/provider" element={<Navigate to="/provider/login" replace />} />
          <Route path="/provider/login" element={<ProviderLoginPage />} />
          <Route
            path="/provider/bootstrap"
            element={
              <RequireProviderAuth>
                <ProviderBootstrapPage />
              </RequireProviderAuth>
            }
          />
          <Route
            path="/provider/admin/tenants"
            element={<Navigate to="/provider/bootstrap" replace />}
          />
        </>
      ) : null}

      <Route
        path="/app"
        element={
          <RequireAuth>
            <TenantReadinessProvider>
              <RequireTenantReadiness>
                <AppLayout />
              </RequireTenantReadiness>
            </TenantReadinessProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />

        {implementedRoutes.map((route) => (
          <Route
            key={route.appPath}
            path={route.childPath}
            element={withPermissionGuard(route.appPath, route.element)}
          />
        ))}

        {placeholderRoutes.map((link) => (
          <Route
            key={link.routePath}
            path={toChildPath(link.routePath)}
            element={withPermissionGuard(
              link.routePath,
              <ModulePlaceholderPage
                title={link.label || "Module"}
                path={link.routePath}
              />
            )}
          />
        ))}
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
